import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { HttpError, handler, json, readJson, requireNotebook } from '~/lib/api';
import { generateText } from '~/lib/gemini';
import { extractJson } from '~/lib/ingest';
import { fileSearchTool, scopeToSelection } from '~/lib/rag';
import { ARTIFACTS, sanitizeMindMap } from '~/lib/studio';

/** Generates one Studio artifact and saves it as a note. */
export const POST: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  const body = await readJson<{ artifact?: string; sourceIds?: string[] }>(context.request);

  const spec = ARTIFACTS[body.artifact ?? ''];
  if (!spec) throw new HttpError('Unknown artifact type', 400);
  if (!notebook.storeName) throw new HttpError('Add a source first', 409);

  const sources = await db.listSources(app.env.DB, notebook.id);
  const ready = sources.filter((s) => s.status === 'ready');
  if (!ready.length) throw new HttpError('No indexed sources yet', 409);

  const selected = body.sourceIds?.length
    ? ready.filter((s) => body.sourceIds!.includes(s.id))
    : ready;
  if (!selected.length) throw new HttpError('Select at least one source', 400);

  const raw = await generateText(app.gemini, {
    contents: [{ role: 'user', parts: [{ text: spec.prompt }] }],
    tools: fileSearchTool(
      notebook.storeName,
      scopeToSelection(
        selected.map((s) => s.id),
        ready.map((s) => s.id),
      ),
    ),
    temperature: 0.4,
    maxOutputTokens: spec.maxOutputTokens,
  });

  let content = raw.trim();
  if (spec.json) {
    const tree = sanitizeMindMap(extractJson(raw));
    if (!tree) throw new HttpError('Could not build a mind map from these sources', 502);
    content = JSON.stringify(tree);
  }
  if (!content) throw new HttpError('The model returned nothing — try again', 502);

  const note = await db.insertNote(app.env.DB, {
    notebookId: notebook.id,
    title: spec.title,
    content,
    kind: spec.kind,
  });
  await db.touchNotebook(app.env.DB, notebook.id);

  return json({ note }, { status: 201 });
});
