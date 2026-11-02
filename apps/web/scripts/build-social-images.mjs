// Build-only rendering: no image renderer or font parser is bundled into the worker.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import {
  SOCIAL_IMAGES,
  SOCIAL_IMAGE_WIDTH,
  SOCIAL_IMAGE_HEIGHT,
  THEME_CSS,
  signalNetwork,
} from '@agentic-readiness/ui';

const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('@fontsource/inter/package.json')), 'files');
const font = await readFile(join(fontDir, 'inter-latin-700-normal.woff'));
const token = (name) => {
  const value = new RegExp(`--${name}:([^;]+)`).exec(THEME_CSS)?.[1];
  if (!value) throw new Error(`Missing social-image colour token: ${name}`);
  // Rasterizers do not consistently support HSL. Resolve the shared tokens to RGB.
  const [hue, saturation, lightness] = value.trim().split(/\s+/).map(parseFloat);
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + hue / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `rgb(${channel(0)}, ${channel(8)}, ${channel(4)})`;
};
const purple = token('hero');
const white = token('hero-foreground');
const lime = token('hero-highlight');
const node = (style, children) => ({
  type: 'div',
  props: { style: { display: 'flex', ...style }, children },
});

export async function buildSocialImages(destination) {
  await mkdir(destination, { recursive: true });
  // Reuse the site's geometry. This is a static illustration, not a screenshot or live data.
  const markup = signalNetwork();
  const network = markup
    .slice(markup.indexOf('<svg'), markup.lastIndexOf('</svg>') + 6)
    .replace('<g class="signal-wires">', `<g stroke="${white}" stroke-opacity=".28">`)
    .replace(
      '<g class="signal-nodes">',
      `<g stroke="${white}" stroke-opacity=".5" fill="${purple}">`,
    )
    .replace('class="signal-packet signal-packet-a"', `cx="590" cy="65" fill="${lime}"`)
    .replace('class="signal-packet signal-packet-b"', `cx="720" cy="210" fill="${lime}"`)
    .replace('class="signal-packet signal-packet-c"', `cx="510" cy="260" fill="${lime}"`);

  for (const card of Object.values(SOCIAL_IMAGES)) {
    const svg = await satori(
      node(
        {
          width: SOCIAL_IMAGE_WIDTH,
          height: SOCIAL_IMAGE_HEIGHT,
          background: purple,
          color: white,
          fontFamily: 'Inter',
          fontWeight: 700,
          flexDirection: 'column',
          padding: '56px 64px',
          position: 'relative',
        },
        [
          {
            type: 'img',
            props: {
              src: `data:image/svg+xml;base64,${Buffer.from(network).toString('base64')}`,
              width: 760,
              height: 400,
              style: { position: 'absolute', right: -170, top: 150, opacity: 0.65 },
            },
          },
          node({ alignItems: 'center', gap: 16 }, [
            node(
              {
                border: `1px solid ${white}`,
                borderRadius: 10,
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
              },
              'AR',
            ),
            node({ fontSize: 22, letterSpacing: -0.7 }, 'Agentic Readiness Scanner'),
          ]),
          node({ fontSize: 13, letterSpacing: 2, marginTop: 48 }, card.eyebrow),
          node(
            {
              flexDirection: 'column',
              fontSize: 72,
              lineHeight: 1.04,
              letterSpacing: -4,
              marginTop: 20,
            },
            card.lines.map((line, i) => node({ color: i === 1 ? lime : white }, line)),
          ),
          node({ fontSize: 23, lineHeight: 1.5, maxWidth: 780, marginTop: 25 }, card.description),
          node(
            {
              position: 'absolute',
              top: 520,
              left: 64,
              width: SOCIAL_IMAGE_WIDTH - 128,
              paddingTop: 20,
              borderTop: `1px solid ${white}`,
              fontSize: 16,
              justifyContent: 'space-between',
              alignItems: 'center',
            },
            [node({}, card.footer), node({ fontSize: 12, letterSpacing: 1 }, 'OPEN SOURCE')],
          ),
        ],
      ),
      {
        width: SOCIAL_IMAGE_WIDTH,
        height: SOCIAL_IMAGE_HEIGHT,
        fonts: [{ name: 'Inter', data: font, weight: 700, style: 'normal' }],
      },
    );
    const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
    await writeFile(join(destination, card.path.split('/').at(-1)), png);
  }
}
