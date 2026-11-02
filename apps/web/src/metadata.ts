/** Hosted-page discovery and sharing metadata. Values describe public, visible content only. */
import { catalog } from '@agentic-readiness/catalog';
import { escapeHtml, SCANNER_VERSION } from '@agentic-readiness/core';
import {
  SOCIAL_IMAGES,
  SOCIAL_IMAGE_WIDTH,
  SOCIAL_IMAGE_HEIGHT,
  type SocialImageKind,
} from '@agentic-readiness/ui';

import type { AppConfig } from './config.js';
import type { StoredScan } from './store/types.js';

export const AUTHOR = {
  name: 'Matthias Reinholz',
  url: 'https://matthiasreinholz.com/about/',
} as const;
export const HOME_DESCRIPTION =
  'Scan public signals for agentic ingestion and commerce readiness. Get a shareable report with evidence, prioritized findings and a fix for every finding.';
export type SchemaNode = Record<string, unknown>;

/** Escape HTML raw-text delimiters without changing the JSON values after parsing. */
export function jsonLd(data: SchemaNode): string {
  const safe = JSON.stringify(data).replace(
    /[<>&\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return `<script type="application/ld+json">${safe}</script>`;
}

export function socialImage(config: AppConfig, kind: SocialImageKind) {
  return { ...SOCIAL_IMAGES[kind], url: `${config.baseUrl}${SOCIAL_IMAGES[kind].path}` };
}

export function imageObject(config: AppConfig, kind: SocialImageKind): SchemaNode {
  const image = socialImage(config, kind);
  return {
    '@type': 'ImageObject',
    '@id': `${image.url}#image`,
    url: image.url,
    contentUrl: image.url,
    width: SOCIAL_IMAGE_WIDTH,
    height: SOCIAL_IMAGE_HEIGHT,
    encodingFormat: 'image/png',
    caption: image.alt,
  };
}

/** Shared entities have stable IDs on every page, rather than disconnected copies. */
export function siteGraph(config: AppConfig, kind: SocialImageKind): SchemaNode[] {
  const home = `${config.baseUrl}/`;
  return [
    {
      '@type': 'WebSite',
      '@id': `${home}#website`,
      url: home,
      name: config.appName,
      description: HOME_DESCRIPTION,
      inLanguage: 'en',
      publisher: { '@id': `${AUTHOR.url}#person` },
    },
    { '@type': 'Person', '@id': `${AUTHOR.url}#person`, ...AUTHOR },
    {
      '@type': 'WebApplication',
      '@id': `${home}#application`,
      url: home,
      name: config.appName,
      description: HOME_DESCRIPTION,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Any',
      isAccessibleForFree: true,
      softwareVersion: SCANNER_VERSION,
      creator: { '@id': `${AUTHOR.url}#person` },
      license: 'https://www.gnu.org/licenses/gpl-3.0.html',
      softwareHelp: { '@id': `${config.baseUrl}/knowledge-base#webpage` },
      featureList: [
        'Public-signal scans',
        'Separate ingestion and commerce scores',
        'Evidence and prioritized fixes',
        'JSON and Markdown reports',
        'MCP access',
      ],
    },
    imageObject(config, kind),
  ];
}

export function webPage(
  config: AppConfig,
  path: string,
  title: string,
  description: string,
  kind: SocialImageKind,
): SchemaNode {
  const url = `${config.baseUrl}${path}`;
  return {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: 'en',
    isPartOf: { '@id': `${config.baseUrl}/#website` },
    publisher: { '@id': `${AUTHOR.url}#person` },
    primaryImageOfPage: { '@id': `${socialImage(config, kind).url}#image` },
  };
}

interface MetadataOptions {
  path: string;
  title: string;
  description: string;
  image: SocialImageKind;
  type?: 'website' | 'article';
  published?: string;
  modified?: string;
}

/** Exactly one canonical and one complete Open Graph/X card set per hosted page. */
export function metadataHead(config: AppConfig, options: MetadataOptions): string {
  const image = socialImage(config, options.image);
  const url = `${config.baseUrl}${options.path}`;
  const meta = (attribute: 'name' | 'property', name: string, value: string | number) =>
    `<meta ${attribute}="${name}" content="${escapeHtml(String(value))}">`;
  return [
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    meta('name', 'robots', 'index, follow, max-image-preview:large'),
    meta('name', 'author', AUTHOR.name),
    meta('property', 'og:type', options.type ?? 'website'),
    meta('property', 'og:title', options.title),
    meta('property', 'og:description', options.description),
    meta('property', 'og:url', url),
    meta('property', 'og:site_name', config.appName),
    meta('property', 'og:locale', 'en_US'),
    meta('property', 'og:image', image.url),
    ...(image.url.startsWith('https:') ? [meta('property', 'og:image:secure_url', image.url)] : []),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', SOCIAL_IMAGE_WIDTH),
    meta('property', 'og:image:height', SOCIAL_IMAGE_HEIGHT),
    meta('property', 'og:image:alt', image.alt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', options.title),
    meta('name', 'twitter:description', options.description),
    meta('name', 'twitter:image', image.url),
    meta('name', 'twitter:image:alt', image.alt),
    ...(options.type === 'article' ? [meta('property', 'article:author', AUTHOR.url)] : []),
    ...(options.published ? [meta('property', 'article:published_time', options.published)] : []),
    ...(options.modified ? [meta('property', 'article:modified_time', options.modified)] : []),
  ].join('\n');
}

export function homeMetadata(config: AppConfig): string {
  const title = `${config.appName}: Is your store ready for AI agents?`;
  return `${metadataHead(config, { path: '/', title, description: HOME_DESCRIPTION, image: 'home' })}\n${jsonLd(
    {
      '@context': 'https://schema.org',
      '@graph': [
        {
          ...webPage(config, '/', title, HOME_DESCRIPTION, 'home'),
          mainEntity: { '@id': `${config.baseUrl}/#application` },
          about: [
            { '@type': 'Thing', name: 'Agentic ingestion' },
            { '@type': 'Thing', name: 'Agentic commerce' },
          ],
          hasPart: { '@id': `${config.baseUrl}/knowledge-base#webpage` },
        },
        ...siteGraph(config, 'home'),
      ],
    },
  )}`;
}

/** No sampled URLs, query strings, evidence or personal signup data enter sharing metadata. */
export function reportMetadata(config: AppConfig, stored: StoredScan) {
  const result = stored.result;
  const origin = new URL(result.target.url).origin;
  const hostname = new URL(origin).hostname;
  const path = `/r/${stored.id}`;
  const url = `${config.baseUrl}${path}`;
  const title = `Agentic readiness report for ${hostname}`;
  const description = `Level ${result.level.value} (${result.level.name}). Ingestion ${result.scores.ingestion}/100; commerce ${result.scores.commerce === null ? 'not scored' : `${result.scores.commerce}/100`}. Public signals only; checkout not verified.`;
  const graph = [
    {
      ...webPage(config, path, title, description, 'report'),
      mainEntity: { '@id': `${url}#report` },
      datePublished: result.scanned_at,
      dateModified: result.scanned_at,
    },
    {
      '@type': 'Report',
      '@id': `${url}#report`,
      url,
      name: title,
      headline: title,
      description,
      inLanguage: 'en',
      reportNumber: stored.id,
      datePublished: result.scanned_at,
      dateModified: result.scanned_at,
      mainEntityOfPage: { '@id': `${url}#webpage` },
      author: { '@id': `${AUTHOR.url}#person` },
      publisher: { '@id': `${AUTHOR.url}#person` },
      image: { '@id': `${socialImage(config, 'report').url}#image` },
      about: { '@type': 'WebSite', url: origin, name: hostname },
      isBasedOn: { '@id': `${url}#scan-data` },
      abstract:
        'An automated assessment of public HTTP signals. It does not verify product approval or a working checkout.',
    },
    {
      '@type': 'Dataset',
      '@id': `${url}#scan-data`,
      name: `Public-signal observations for ${hostname}`,
      description,
      url,
      creator: { '@id': `${AUTHOR.url}#person` },
      dateCreated: result.scanned_at,
      version: `${result.scanner_version}; catalog ${result.catalog_version}; scoring ${result.scoring_version}`,
      measurementTechnique:
        'Public HTTP signals fetched under the scanner identity; no sign-in, JavaScript execution or checkout transaction.',
      variableMeasured: [
        {
          '@type': 'PropertyValue',
          name: 'Readiness level',
          value: result.level.value,
          minValue: 0,
          maxValue: Math.max(...catalog.levels.map((level) => level.value)),
        },
        {
          '@type': 'PropertyValue',
          name: 'Agentic ingestion score',
          value: result.scores.ingestion,
          minValue: 0,
          maxValue: 100,
        },
        ...(result.scores.commerce === null
          ? []
          : [
              {
                '@type': 'PropertyValue',
                name: 'Agentic commerce score',
                value: result.scores.commerce,
                minValue: 0,
                maxValue: 100,
              },
            ]),
      ],
      distribution: [
        { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${url}.json` },
      ],
    },
    ...siteGraph(config, 'report'),
  ];
  return {
    title,
    description,
    head: `${metadataHead(config, { path, title, description, image: 'report', type: 'article', published: result.scanned_at, modified: result.scanned_at })}\n${jsonLd({ '@context': 'https://schema.org', '@graph': graph })}`,
  };
}
