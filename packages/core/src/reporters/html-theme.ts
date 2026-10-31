/**
 * The visual system shared by the HTML report and the hosted app: colour tokens for the
 * dark (default) and light themes, base typography and spacing, and the small set of
 * components both use. One file, no framework, no external assets, so the CLI's HTML
 * report and the hosted pages look the same and change together.
 *
 * Verdict and score colours are the semantic layer: pass is green, warn amber, fail red,
 * skip neutral. The accent is a bright blue in both themes.
 */

export const THEME_STORAGE_KEY = 'ars-theme';

export const THEME_CSS = `
:root,[data-theme=dark]{color-scheme:dark;
--bg:#0b1220;--bg-raised:#111a2e;--bg-sunken:#070d19;--fg:#e6edf7;--fg-muted:#9fb0c8;--fg-faint:#6b7a94;
--line:#1f2b44;--line-strong:#2f3f61;
--accent:#5aa9ff;--accent-strong:#8cc4ff;--accent-fg:#06111f;--accent-soft:rgba(90,169,255,.14);--focus:rgba(90,169,255,.55);
--pass:#3ddc84;--pass-soft:rgba(61,220,132,.14);--warn:#ffb547;--warn-soft:rgba(255,181,71,.16);--fail:#ff6b6b;--fail-soft:rgba(255,107,107,.16);--skip:#8b98b1;--skip-soft:rgba(139,152,177,.14);
--shadow:0 1px 0 rgba(255,255,255,.03) inset,0 8px 24px rgba(0,0,0,.35)}
[data-theme=light]{color-scheme:light;
--bg:#f6f8fc;--bg-raised:#ffffff;--bg-sunken:#eef2f9;--fg:#0f1a2e;--fg-muted:#4b5b78;--fg-faint:#7a89a6;
--line:#dde4f0;--line-strong:#c3cee2;
--accent:#1d6ef5;--accent-strong:#0f5bd6;--accent-fg:#ffffff;--accent-soft:rgba(29,110,245,.1);--focus:rgba(29,110,245,.4);
--pass:#15803d;--pass-soft:rgba(21,128,61,.1);--warn:#b45309;--warn-soft:rgba(180,83,9,.12);--fail:#b91c1c;--fail-soft:rgba(185,28,28,.1);--skip:#64748b;--skip-soft:rgba(100,116,139,.12);
--shadow:0 1px 2px rgba(15,26,46,.06),0 8px 24px rgba(15,26,46,.06)}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:920px;margin:0 auto;padding:32px 20px 64px}
@media (min-width:720px){main{padding:48px 24px 80px}}
h1,h2,h3{line-height:1.2;margin:0;letter-spacing:-.01em}
h1{font-size:clamp(1.6rem,2.6vw + 1rem,2.25rem);font-weight:700}
h2{font-size:1.2rem;font-weight:650}
h3{font-size:1rem;font-weight:650}
p{margin:0}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline;color:var(--accent-strong)}
code,pre,kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{font-size:.9em;background:var(--bg-sunken);padding:.1em .35em;border-radius:5px;border:1px solid var(--line)}
pre{margin:0;overflow:auto;background:var(--bg-sunken);border:1px solid var(--line);border-radius:8px;padding:12px 14px;font-size:.84rem;line-height:1.5}
pre code{background:none;border:0;padding:0;font-size:inherit}
ul{margin:0;padding-left:1.25rem}li+li{margin-top:.35rem}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:6px}
::selection{background:var(--accent-soft)}
.stack>*+*{margin-top:var(--stack,16px)}
.muted{color:var(--fg-muted)}.faint{color:var(--fg-faint)}.small{font-size:.9rem}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:32px}
.brand{display:inline-flex;align-items:center;gap:10px;color:var(--fg);font-weight:650;text-decoration:none}
.brand:hover{text-decoration:none;color:var(--fg)}
.brand-mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent-strong));display:inline-grid;place-items:center;color:var(--accent-fg);font-size:.8rem;font-weight:800}
.card{background:var(--bg-raised);border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:var(--shadow)}
.card+.card{margin-top:16px}
.btn,button.btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;border-radius:10px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);font:inherit;font-weight:650;cursor:pointer;text-decoration:none;transition:background .15s,border-color .15s,transform .05s}
.btn:hover{background:var(--accent-strong);border-color:var(--accent-strong);text-decoration:none;color:var(--accent-fg)}
.btn:active{transform:translateY(1px)}
.btn-ghost,button.btn-ghost{background:transparent;color:var(--fg);border-color:var(--line-strong)}
.btn-ghost:hover{background:var(--accent-soft);border-color:var(--accent);color:var(--fg)}
.btn-sm{min-height:34px;padding:0 12px;font-size:.9rem;font-weight:600;border-radius:8px}
.field{appearance:none;width:100%;min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--line-strong);background:var(--bg-raised);color:var(--fg);font:inherit;line-height:1.2;transition:border-color .15s,box-shadow .15s}
.field::placeholder{color:var(--fg-faint)}
.field:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
select.field{padding-right:40px;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='%239fb0c8' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M4 6l4 4 4-4'/></svg>");background-repeat:no-repeat;background-position:right 12px center;background-size:16px 16px;cursor:pointer}
[data-theme=light] select.field{background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16' fill='none' stroke='%234b5b78' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M4 6l4 4 4-4'/></svg>")}
.pill{display:inline-flex;align-items:center;gap:6px;min-height:26px;padding:0 10px;border-radius:999px;font-size:.78rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;line-height:1;white-space:nowrap;border:1px solid transparent}
.pill-pass{color:var(--pass);background:var(--pass-soft);border-color:color-mix(in srgb,var(--pass) 35%,transparent)}
.pill-warn{color:var(--warn);background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 35%,transparent)}
.pill-fail{color:var(--fail);background:var(--fail-soft);border-color:color-mix(in srgb,var(--fail) 35%,transparent)}
.pill-skip{color:var(--skip);background:var(--skip-soft);border-color:color-mix(in srgb,var(--skip) 35%,transparent)}
.pill-accent{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 35%,transparent)}
.tone-good{color:var(--pass)}.tone-mid{color:var(--warn)}.tone-bad{color:var(--fail)}.tone-none{color:var(--fg-faint)}
.theme-toggle{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 12px;border-radius:999px;border:1px solid var(--line-strong);background:var(--bg-raised);color:var(--fg-muted);font:inherit;font-size:.85rem;cursor:pointer}
.theme-toggle:hover{border-color:var(--accent);color:var(--fg)}
.theme-toggle .when-dark,[data-theme=light] .theme-toggle .when-light{display:inline}
.theme-toggle .when-light,[data-theme=light] .theme-toggle .when-dark{display:none}
footer.site{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);color:var(--fg-muted);font-size:.9rem;line-height:1.7}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

/**
 * Applies the stored theme before first paint. Inline it in <head>. Dark is the default;
 * a visitor's choice is kept in localStorage under THEME_STORAGE_KEY.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;

/** Wires every .theme-toggle button. Inline it at the end of <body>. */
export const THEME_TOGGLE_SCRIPT = `(function(){var r=document.documentElement;document.querySelectorAll('.theme-toggle').forEach(function(b){b.addEventListener('click',function(){var n=r.getAttribute('data-theme')==='light'?'dark':'light';r.setAttribute('data-theme',n);try{localStorage.setItem('${THEME_STORAGE_KEY}',n)}catch(e){}})})})();`;

export function themeToggleButton(): string {
  return `<button type="button" class="theme-toggle" aria-label="Switch colour theme"><span class="when-dark" aria-hidden="true">☾</span><span class="when-light" aria-hidden="true">☀</span><span class="when-dark">Dark</span><span class="when-light">Light</span></button>`;
}

/** Tone class for a 0 to 100 score, or none when the score does not apply. */
export function scoreTone(
  score: number | null,
): 'tone-good' | 'tone-mid' | 'tone-bad' | 'tone-none' {
  if (score === null) return 'tone-none';
  if (score >= 80) return 'tone-good';
  if (score >= 50) return 'tone-mid';
  return 'tone-bad';
}

export interface HtmlDocumentOptions {
  title: string;
  description?: string;
  /** Extra <head> markup, e.g. link relations. */
  head?: string;
  /** Extra inline scripts, appended after the theme toggle wiring. */
  scripts?: string[];
}

/** Wraps page markup in a complete document with the theme applied. */
export function htmlDocument(options: HtmlDocumentOptions, body: string): string {
  const scripts = [THEME_TOGGLE_SCRIPT, ...(options.scripts ?? [])]
    .map((script) => `<script>${script}</script>`)
    .join('\n');
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeAttribute(options.title)}</title>
${options.description ? `<meta name="description" content="${escapeAttribute(options.description)}">` : ''}
${options.head ?? ''}
<script>${THEME_BOOT_SCRIPT}</script>
<style>${THEME_CSS}</style>
</head>
<body>
${body}
${scripts}
</body>
</html>
`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
