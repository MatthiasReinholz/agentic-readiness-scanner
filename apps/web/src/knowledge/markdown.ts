/**
 * Renders the Markdown subset knowledge-base articles are written in (see
 * docs/knowledge-base.md): ## and ### headings, paragraphs, flat bullet and numbered
 * lists, fenced code, pipe tables, inline code, bold and links. Everything is escaped
 * first; nothing an article contains reaches the page as raw HTML. No dependencies, no
 * `node:` imports, so it runs in the worker.
 */
import { escapeHtml } from '@agentic-readiness/core';
import { codeInline } from '@agentic-readiness/ui';

export interface Heading {
  level: 2 | 3;
  text: string;
  id: string;
}

export interface RenderedMarkdown {
  html: string;
  headings: Heading[];
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*?]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Removes inline Markdown, for plain-text uses (structured data, Markdown-free summaries). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeHref(url: string): string | null {
  if (url.startsWith('https://') || /^\/(?!\/)/.test(url) || url.startsWith('#')) return url;
  return null;
}

/** Inline Markdown to HTML; the input is raw text, escaped here. */
export function renderInline(text: string): string {
  const codes: string[] = [];
  // Code spans first, so their content is never read as bold or links.
  let html = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code class="${codeInline}">${escapeHtml(code)}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  html = escapeHtml(html);
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_whole, label: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, '&'));
    if (!href) return label;
    const external = href.startsWith('https://');
    return `<a class="font-medium text-primary underline-offset-4 hover:underline" href="${escapeHtml(href)}"${external ? ' rel="noopener"' : ''}>${label}</a>`;
  });
  html = html.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong class="font-semibold text-foreground">$1</strong>',
  );
  return html.replace(/\uE000(\d+)\uE000/g, (_, index: string) => codes[Number(index)] ?? '');
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function markdownToHtml(markdown: string): RenderedMarkdown {
  const lines = markdown.split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  const used = new Set<string>();
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let openSection = false;

  const flushParagraph = () => {
    if (paragraph.length > 0)
      out.push(
        `<p class="mt-4 leading-7 text-muted-foreground">${renderInline(paragraph.join(' '))}</p>`,
      );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    const style = list.ordered ? 'list-decimal' : 'list-disc';
    out.push(
      `<${tag} class="mt-4 ${style} space-y-2 pl-6 leading-7 text-muted-foreground marker:text-muted-foreground/70">${list.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`,
    );
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const fence = /^```([\w-]*)\s*$/.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      const language = fence[1] === undefined || fence[1] === '' ? 'text' : fence[1];
      out.push(
        `<pre class="mt-4 overflow-x-auto rounded-lg border border-border bg-muted/50 p-4 text-[0.82rem] leading-6" data-language="${escapeHtml(language)}"><code>${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }
    const heading = /^(##|###) (.+)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1] === '##' ? 2 : 3;
      const text = heading[2]?.trim() ?? '';
      let id = slugify(text);
      while (used.has(id)) id = `${id}-x`;
      used.add(id);
      headings.push({ level, text, id });
      if (level === 2) {
        if (openSection) out.push('</section>');
        out.push(`<section aria-labelledby="${id}">`);
        openSection = true;
      }
      out.push(
        level === 2
          ? `<h2 id="${id}" class="mt-10 scroll-mt-6 text-xl font-semibold tracking-tight text-foreground">${renderInline(text)}</h2>`
          : `<h3 id="${id}" class="mt-7 scroll-mt-6 text-base font-semibold text-foreground">${renderInline(text)}</h3>`,
      );
      continue;
    }
    if (line.startsWith('|')) {
      flush();
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? '').startsWith('|')) {
        rows.push(tableCells(lines[index] ?? ''));
        index += 1;
      }
      index -= 1;
      const [head, separator, ...body] = rows;
      const hasHeader = separator?.every((cell) => /^:?-{3,}:?$/.test(cell)) ?? false;
      const bodyRows = hasHeader ? body : rows.slice(1);
      out.push(
        `<div class="mt-4 overflow-x-auto rounded-lg border border-border"><table class="w-full text-left text-sm">${
          head
            ? `<thead class="bg-muted/50"><tr>${head.map((cell) => `<th class="px-3 py-2 font-semibold text-foreground">${renderInline(cell)}</th>`).join('')}</tr></thead>`
            : ''
        }<tbody>${bodyRows
          .map(
            (row) =>
              `<tr class="border-t border-border">${row.map((cell) => `<td class="px-3 py-2 align-top text-muted-foreground">${renderInline(cell)}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    const bullet = /^- (.+)$/.exec(line);
    const numbered = /^\d+\. (.+)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)?.[1] ?? '');
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      // A wrapped list item continues the last item.
      const last = list.items.length - 1;
      list.items[last] = `${list.items[last] ?? ''} ${line.trim()}`;
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flush();
  if (openSection) out.push('</section>');
  return { html: out.join('\n'), headings };
}

/** The `##` section with this title, as Markdown, without its heading. */
export function section(markdown: string, title: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line === `## ${title}`);
  if (start === -1) return '';
  let end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  if (end === -1) end = lines.length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/** FAQ pairs from the FAQ section: each ### question with the paragraphs under it. */
export function faqPairs(markdown: string): { question: string; answer: string }[] {
  const pairs: { question: string; answer: string }[] = [];
  for (const block of section(markdown, 'FAQ').split(/^### /m).slice(1)) {
    const [question, ...rest] = block.split('\n');
    pairs.push({ question: (question ?? '').trim(), answer: plainText(rest.join('\n')) });
  }
  return pairs;
}
