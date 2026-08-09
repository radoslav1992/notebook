import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { HttpError, handler, json, readJson, requireNotebook } from '~/lib/api';
import { GeminiError, streamGenerateContent, type GroundingMetadata } from '~/lib/gemini';
import {
  GROUNDED_SYSTEM_PROMPT,
  annotateWithCitations,
  fileSearchTool,
  mapCitations,
  scopeToSelection,
  toGeminiHistory,
} from '~/lib/rag';

export const DELETE: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  await db.clearMessages(app.env.DB, notebook.id);
  return json({ ok: true });
});

export const POST: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  const body = await readJson<{ message?: string; sourceIds?: string[] }>(context.request);

  const question = (body.message ?? '').trim();
  if (!question) throw new HttpError('Ask a question first', 400);
  if (!notebook.storeName) throw new HttpError('Add a source before chatting', 409);

  const sources = await db.listSources(app.env.DB, notebook.id);
  const ready = sources.filter((s) => s.status === 'ready');
  if (!ready.length) {
    throw new HttpError(
      sources.length ? 'Your sources are still being indexed — try again in a moment' : 'Add a source before chatting',
      409,
    );
  }

  const requested = body.sourceIds?.length
    ? ready.filter((s) => body.sourceIds!.includes(s.id))
    : ready;
  if (!requested.length) throw new HttpError('Select at least one source', 400);

  const history = await db.listMessages(app.env.DB, notebook.id);
  await db.insertMessage(app.env.DB, {
    notebookId: notebook.id,
    role: 'user',
    content: question,
  });

  // Resolve doc names so citations can be traced back to the exact source row.
  const withDocNames = await Promise.all(
    requested.map(async (s) => {
      const full = await db.getSource(app.env.DB, s.id);
      return { id: s.id, title: s.title, docName: full?.docName ?? null };
    }),
  );

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      let answer = '';
      let grounding: GroundingMetadata | undefined;

      try {
        const chunks = streamGenerateContent(app.gemini, {
          systemInstruction: GROUNDED_SYSTEM_PROMPT,
          contents: [
            ...toGeminiHistory(history),
            { role: 'user', parts: [{ text: question }] },
          ],
          tools: fileSearchTool(
            notebook.storeName!,
            scopeToSelection(
              requested.map((s) => s.id),
              ready.map((s) => s.id),
            ),
          ),
          temperature: 0.3,
          maxOutputTokens: 8192,
        });

        for await (const chunk of chunks) {
          const candidate = chunk.candidates?.[0];
          const delta = (candidate?.content?.parts ?? [])
            .map((p) => p.text ?? '')
            .join('');
          if (delta) {
            answer += delta;
            send({ type: 'text', delta });
          }
          // Grounding metadata accumulates; the last non-empty one wins.
          if (candidate?.groundingMetadata?.groundingChunks?.length) {
            grounding = candidate.groundingMetadata;
          }
        }

        if (!answer.trim()) {
          throw new Error('The model returned an empty answer. Try rephrasing the question.');
        }

        const citations = mapCitations(grounding, withDocNames);
        const annotated = annotateWithCitations(answer, citations);
        const message = await db.insertMessage(app.env.DB, {
          notebookId: notebook.id,
          role: 'assistant',
          content: annotated,
          citations,
        });
        await db.touchNotebook(app.env.DB, notebook.id);

        send({ type: 'done', message });
      } catch (err) {
        const detail =
          err instanceof GeminiError
            ? `Gemini API: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Something went wrong';
        send({ type: 'error', error: detail });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
});
