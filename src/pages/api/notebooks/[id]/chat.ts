import type { APIRoute } from 'astro';
import { allowedDatasetIds } from '~/lib/datasets';
import {
  env,
  handler,
  json,
  ragContext,
  readJson,
  requireNotebook,
  requireVerified,
  selectedSources,
} from '~/lib/api';
import { HttpError, clearMessages, insertMessage, listMessages, touchNotebook } from '~/lib/db';
import { assertCanAsk, countQuestion } from '~/lib/limits';
import { answerStream } from '~/lib/rag';

export const prerender = false;

export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id);
  const messages = await listMessages(env.DB, id);
  return json({ messages });
});

export const DELETE: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id);
  await clearMessages(env.DB, id);
  return json({ ok: true });
});

/**
 * Стриймва отговора като Server-Sent Events.
 * Записваме въпроса веднага, а отговора — след като потокът приключи, за да
 * не остават половин отговори в историята при прекъсване.
 */
export const POST: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const notebook = await requireNotebook(ctx, id);

  const body = await readJson<{ question?: string }>(ctx.request);
  const question = body.question?.trim();
  if (!question) throw new HttpError(400, 'Въпросът е празен.');
  if (question.length > 4000) throw new HttpError(400, 'Въпросът е твърде дълъг.');

  requireVerified(ctx);
  // Кой „джоб“ плаща въпроса (личният план или пакетът на организация) се
  // решава тук и се подава на отчитането — двете трябва да гледат едно и също.
  const payer = await assertCanAsk(env.DB, ctx.locals.user.id);

  const [history, sources, datasets, rag] = await Promise.all([
    listMessages(env.DB, id),
    selectedSources(ctx, id),
    allowedDatasetIds(env.DB, ctx.locals.user.id, id),
    ragContext(ctx, notebook),
  ]);

  const userMessage = await insertMessage(env.DB, id, 'user', question);
  // Отчита се на задаване, не на успешен отговор: иначе повтарящ се въпрос
  // при грешка в модела не се брои и лимитът се обхожда.
  await countQuestion(env.DB, ctx.locals.user.id, payer);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send('user', { message: userMessage });

      try {
        for await (const part of answerStream(rag, {
          notebookId: id,
          datasets,
          question,
          sources,
          history: history.map((m) => ({ role: m.role, text: m.text })),
        })) {
          if (part.type === 'passages') {
            send('passages', { count: part.count });
          } else if (part.type === 'delta') {
            send('delta', { text: part.text });
          } else {
            const saved = await insertMessage(env.DB, id, 'ai', part.text, part.citations);
            await touchNotebook(env.DB, id);
            send('done', { message: saved });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Неочаквана грешка.';
        console.error('[zapiski:chat]', err);
        send('error', { error: message });
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
      'x-accel-buffering': 'no',
    },
  });
});
