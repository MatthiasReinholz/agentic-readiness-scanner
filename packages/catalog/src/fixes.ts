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
 *   ## On WordPress     (optional; one per platform, by name or id: On Shopify, On Magento)
 *   ...
 *
 * A platform section holds advice that is true only on that platform. Reports add it to
 * the agent prompt only when the scan detected the platform; a WordPress section also
 * applies to WooCommerce.
 */
import { KNOWN_PLATFORMS, type KnownPlatform } from './platform-ids.js';
import { PLATFORM_LABEL } from './platforms.js';
import { CatalogFixSchema, type CatalogFix, type PlatformNote } from './schema.js';

const PLATFORM_SECTION = /^on (.+)$/;
const KNOWN_SECTIONS = new Set(['summary', 'snippet', 'agent prompt']);

/** "On Shopify", "On Adobe Commerce (Magento)" or "On Magento": the platform's label or id. */
function sectionPlatform(heading: string): KnownPlatform | undefined {
  const name = PLATFORM_SECTION.exec(heading)?.[1];
  if (name === undefined) return undefined;
  return KNOWN_PLATFORMS.find(
    (platform) => platform === name || PLATFORM_LABEL[platform].toLowerCase() === name,
  );
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;
const FENCE = /```([\w-]*)\n([\s\S]*?)```/;

export function parseFixMarkdown(source: string, fileName: string): CatalogFix {
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

  const platformNotes: PlatformNote[] = [];
  for (const [heading, text] of sections) {
    if (KNOWN_SECTIONS.has(heading)) continue;
    const platform = sectionPlatform(heading);
    if (!platform) throw new Error(`${fileName}: unknown section "${heading}"`);
    if (!text) throw new Error(`${fileName}: empty section "${heading}"`);
    platformNotes.push({ platform, text });
  }

  const candidate = {
    summary: sections.get('summary'),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(snippetLanguage !== undefined ? { snippet_language: snippetLanguage } : {}),
    agent_prompt: sections.get('agent prompt'),
    auto_fix: meta.auto_fix === 'true',
    platform_notes: platformNotes,
  };
  const parsed = CatalogFixSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(
      `${fileName}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  }
  return parsed.data;
}
