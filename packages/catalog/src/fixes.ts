/**
 * Parses one fix Markdown file into a Fix object.
 *
 * File format:
 *
 *   ---
 *   auto_fix: true
 *   ---
 *   ## Summary
 *   ...
 *   ## Snippet          (optional; one fenced code block)
 *   ```robots
 *   ...
 *   ```
 *   ## Agent prompt
 *   ...
 */
import { FixSchema, type Fix } from './schema.js';

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;
const FENCE = /```([\w-]*)\n([\s\S]*?)```/;

export function parseFixMarkdown(source: string, fileName: string): Fix {
  const frontMatter = FRONT_MATTER.exec(source);
  if (!frontMatter) {
    throw new Error(`${fileName}: missing front matter`);
  }
  const meta: Record<string, string> = {};
  for (const line of frontMatter[1]?.split('\n') ?? []) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    meta[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  const body = source.slice(frontMatter[0].length);

  const sections = new Map<string, string>();
  let current: string | null = null;
  const buffer: string[] = [];
  const flush = (): void => {
    if (current !== null) sections.set(current, buffer.join('\n').trim());
    buffer.length = 0;
  };
  let inFence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    const heading = inFence ? null : /^## (.+)$/.exec(line);
    if (heading) {
      flush();
      current = heading[1]?.trim().toLowerCase() ?? '';
    } else {
      buffer.push(line);
    }
  }
  flush();

  const snippetSection = sections.get('snippet');
  let snippet: string | undefined;
  let snippetLanguage: string | undefined;
  if (snippetSection) {
    const fence = FENCE.exec(snippetSection);
    if (!fence) {
      throw new Error(`${fileName}: Snippet section must contain one fenced code block`);
    }
    snippetLanguage = fence[1]?.length ? fence[1] : undefined;
    snippet = fence[2]?.replace(/\n$/, '');
  }

  const candidate = {
    summary: sections.get('summary'),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(snippetLanguage !== undefined ? { snippet_language: snippetLanguage } : {}),
    agent_prompt: sections.get('agent prompt'),
    auto_fix: meta.auto_fix === 'true',
  };
  const parsed = FixSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `${fileName}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}
