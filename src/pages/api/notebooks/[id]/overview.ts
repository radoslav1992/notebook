import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { HttpError, handler, json, requireNotebook } from '~/lib/api';
import { generateText } from '~/lib/gemini';
import { extractJson } from '~/lib/ingest';
import { fileSearchTool } from '~/lib/rag';
import { OVERVIEW_PROMPT } from '~/lib/studio';

interface Overview {
  title?: string;
  emoji?: string;
  summary?: string;
  questions?: string[];
}

/**
 * Regenerates the notebook's title, emoji, blurb and suggested questions from
 * whatever is currently indexed. Called automatically after the first source.
 */
export const POST: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  if (!notebook.storeName) throw new HttpError('Add a source first', 409);

  const ready = (await db.listSources(app.env.DB, notebook.id)).filter((s) => s.status === 'ready');
  if (!ready.length) throw new HttpError('No indexed sources yet', 409);

  const raw = await generateText(app.gemini, {
    contents: [{ role: 'user', parts: [{ text: OVERVIEW_PROMPT }] }],
    tools: fileSearchTool(notebook.storeName),
    temperature: 0.4,
    maxOutputTokens: 2048,
  });

  const parsed = extractJson<Overview>(raw);
  if (!parsed?.summary) throw new HttpError('Could not summarise these sources', 502);

  const description = JSON.stringify({
    summary: parsed.summary.slice(0, 3000),
    questions: (parsed.questions ?? []).slice(0, 6).map((q) => String(q).slice(0, 220)),
  });

  // Only rename a notebook the user has not titled themselves.
  const autoTitled = notebook.title === 'Untitled notebook';
  await db.updateNotebook(app.env.DB, notebook.id, {
    description,
    ...(autoTitled && parsed.title ? { title: parsed.title.slice(0, 200) } : {}),
    ...(autoTitled && parsed.emoji ? { emoji: [...parsed.emoji][0] ?? '📓' } : {}),
  });

  return json({ notebook: await db.getNotebook(app.env.DB, notebook.id, notebook.ownerId) });
});
