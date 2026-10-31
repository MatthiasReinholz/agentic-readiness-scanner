import { escapeHtml } from '@agentic-readiness/core';

const STYLES = `
:root{--bg:#fff;--fg:#0f172a;--muted:#475569;--line:#e2e8f0;--accent:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--fg:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--accent:#2dd4bf}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 16px}h1{font-size:2rem;line-height:1.15;margin:0 0 .5rem}p{margin:.5rem 0 1rem}
form{display:flex;gap:8px;flex-wrap:wrap;margin:1.5rem 0}input[type=url]{flex:1 1 320px;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit}
select,button{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:transparent;color:inherit}
button{background:var(--accent);color:#fff;border-color:var(--accent);cursor:pointer}
.muted{color:var(--muted);font-size:.95rem}ul{padding-left:1.2rem}footer{margin-top:3rem;color:var(--muted);font-size:.9rem}
code{font-size:.9em}a{color:var(--accent)}
`;

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="/llms.txt" title="llms.txt">
<style>${STYLES}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}
