import type { NoteKind } from './types';

export interface ArtifactSpec {
  kind: NoteKind;
  label: string;
  title: string;
  prompt: string;
  /** Mind maps come back as JSON so the client can render a real tree. */
  json?: boolean;
  maxOutputTokens: number;
}

const COMMON_RULES = `Work only from the retrieved sources. Never introduce outside facts. If the sources are thin on a section, keep it short rather than padding it.`;

export const ARTIFACTS: Record<string, ArtifactSpec> = {
  study_guide: {
    kind: 'study_guide',
    label: 'Study guide',
    title: 'Study guide',
    maxOutputTokens: 8192,
    prompt: `Create a study guide from the sources.

${COMMON_RULES}

Use this markdown structure:
# Study guide
## Key concepts
A definition list — each term in bold, then a one-or-two sentence explanation.
## Short-answer questions
8-10 questions that test comprehension. Number them. Do not include answers here.
## Answer key
The answers, numbered to match.
## Essay questions
4-5 prompts that require synthesis across sources. No answers.
## Glossary
Every term of art used in the sources, alphabetised, with a concise definition.`,
  },

  briefing: {
    kind: 'briefing',
    label: 'Briefing doc',
    title: 'Briefing document',
    maxOutputTokens: 8192,
    prompt: `Write an executive briefing document on the sources.

${COMMON_RULES}

Use this markdown structure:
# Briefing document
## Executive summary
Three to five sentences. What matters and why.
## Main themes
Each theme as a "### " heading, with the supporting evidence beneath it. Quote the sources where the exact wording carries weight.
## Key facts and figures
A bullet list of the specific numbers, dates and names that appear in the sources.
## Open questions
What the sources raise but do not resolve.`,
  },

  faq: {
    kind: 'faq',
    label: 'FAQ',
    title: 'Frequently asked questions',
    maxOutputTokens: 8192,
    prompt: `Write an FAQ covering what someone would actually want to ask about these sources.

${COMMON_RULES}

Use this markdown structure:
# FAQ
Then 10-15 entries. Each question is a "## " heading phrased the way a real reader would ask it, followed by a direct answer of 2-4 sentences. Order from most fundamental to most specific.`,
  },

  timeline: {
    kind: 'timeline',
    label: 'Timeline',
    title: 'Timeline',
    maxOutputTokens: 8192,
    prompt: `Build a timeline of the events described in the sources.

${COMMON_RULES}
If the sources contain no dated events, say so in one line and stop.

Use this markdown structure:
# Timeline
## Chronology
One bullet per event: "**<date or period>** — <what happened, one or two sentences>". Order earliest to latest. Use the sources' own granularity; do not invent precision.
## Cast of characters
One bullet per person or organisation that appears: "**<name>** — <role, and what they did>".`,
  },

  mindmap: {
    kind: 'mindmap',
    label: 'Mind map',
    title: 'Mind map',
    json: true,
    maxOutputTokens: 8192,
    prompt: `Build a mind map of the sources.

${COMMON_RULES}

Return JSON only, no prose and no code fence:
{"label": "<the central topic, 1-4 words>", "children": [{"label": "<branch>", "children": [{"label": "<sub-branch>", "children": []}]}]}

Rules: 4-7 top-level branches. Each branch gets 2-6 children. Go at most 3 levels deep below the centre. Labels are noun phrases of 1-6 words — never sentences.`,
  },
};

/** The notebook-level overview card shown above the chat. */
export const OVERVIEW_PROMPT = `Summarise this collection of sources for the top of a research notebook.

Return JSON only:
{
  "title": "<a 2-5 word title for the notebook as a whole>",
  "emoji": "<a single emoji that fits the subject>",
  "summary": "<3-5 sentences describing what this collection covers, as a whole rather than source by source>",
  "questions": ["<4 specific, interesting questions a reader could ask that these sources genuinely answer>"]
}`;

export interface MindMapNode {
  label: string;
  children?: MindMapNode[];
}

/** Guards against a model returning something unbounded or malformed. */
export function sanitizeMindMap(node: unknown, depth = 0): MindMapNode | null {
  if (!node || typeof node !== 'object') return null;
  const raw = node as { label?: unknown; children?: unknown };
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 120) : '';
  if (!label) return null;
  if (depth >= 4) return { label, children: [] };

  const children = Array.isArray(raw.children)
    ? raw.children
        .slice(0, 12)
        .map((c) => sanitizeMindMap(c, depth + 1))
        .filter((c): c is MindMapNode => c !== null)
    : [];
  return { label, children };
}
