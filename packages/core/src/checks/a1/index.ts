import { contentType } from '../../http/types.js';
import { isWellFormedLlmsTxt, parseLlmsTxt } from '../../parsers/llms-txt.js';
import { defineCheck, fail, pass, warn } from '../types.js';

export const robotsTxtExists = defineCheck('A1.1', ({ target }) => {
  const response = target.robotsResponse;
  const evidence = {
    url: response.finalUrl,
    status: response.status,
    content_type: contentType(response),
    groups: target.robots?.groups.length ?? 0,
    sitemaps: target.robots?.sitemaps ?? [],
  };
  if (response.status === 200 && target.robots) {
    return pass(`robots.txt parsed with ${target.robots.groups.length} group(s)`, evidence);
  }
  if (response.status === 404) {
    return warn(
      'robots.txt is missing; everything is allowed by default but intent is unstated',
      evidence,
    );
  }
  // RFC 9309 section 2.3.1.3: any other 4xx means "unavailable", and crawlers may then
  // access everything, so it is the same unstated-intent case as a missing file.
  if (response.status >= 400 && response.status < 500) {
    return warn(
      `robots.txt returned HTTP ${response.status}; crawlers treat that as "allow all" but intent is unstated`,
      evidence,
    );
  }
  if (response.status === 0) {
    return fail(`robots.txt could not be fetched: ${response.error ?? 'no response'}`, evidence);
  }
  if (response.status === 200) {
    return fail(
      'robots.txt returned HTML instead of a robots file (challenge page or soft 404)',
      evidence,
    );
  }
  return fail(`robots.txt returned HTTP ${response.status}`, evidence);
});

export const sitemapReachable = defineCheck('A1.2', ({ target }) => {
  const sitemap = target.sitemap;
  if (!sitemap) {
    return fail(
      'no sitemap found via robots.txt, /sitemap.xml, /sitemap_index.xml or /wp-sitemap.xml',
      { declared_in_robots: target.robots?.sitemaps ?? [] },
    );
  }
  const evidence = {
    url: sitemap.url,
    kind: sitemap.kind,
    child_sitemaps: sitemap.childSitemaps.length,
    urls: sitemap.urls.length,
    declared_in_robots: target.robots?.sitemaps.includes(sitemap.url) ?? false,
  };
  if (sitemap.urls.length === 0 && sitemap.childSitemaps.length === 0) {
    return warn('sitemap is reachable but lists no URLs', evidence);
  }
  return pass(`sitemap ${sitemap.kind} at ${sitemap.url}`, evidence);
});

export const productUrlsInSitemap = defineCheck('A1.3', ({ target }) => {
  const sitemap = target.sitemap;
  const productSitemaps = sitemap?.childSitemaps.filter((url) => /product/i.test(url)) ?? [];
  const evidence = {
    product_sitemaps: productSitemaps,
    product_urls: sitemap?.productUrls.length ?? 0,
    sample: sitemap?.productUrls.slice(0, 5) ?? [],
  };
  if ((sitemap?.productUrls.length ?? 0) > 0) {
    return pass(`${sitemap?.productUrls.length ?? 0} product URL(s) in sitemap`, evidence);
  }
  if (productSitemaps.length > 0) {
    return warn(
      'a product sitemap is declared but no product URLs were read within budget',
      evidence,
    );
  }
  return fail('no product URLs or product sitemap found', evidence);
});

export const llmsTxtPresent = defineCheck('A1.5', async ({ target, fetcher }) => {
  const url = `${target.origin}/llms.txt`;
  const response = await fetcher.fetch(url);
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
  };
  if (response.status !== 200) {
    return fail(`llms.txt returned HTTP ${response.status}`, evidence);
  }
  if (/<html|<!doctype/i.test(response.body.slice(0, 500))) {
    return fail('llms.txt returned HTML (soft 404 or challenge page)', evidence);
  }
  const parsed = parseLlmsTxt(response.body);
  evidence.title = parsed.title;
  evidence.sections = parsed.sections;
  evidence.links = parsed.links.length;
  if (!isWellFormedLlmsTxt(parsed)) {
    return warn('llms.txt is present but lacks an H1 title or link sections', evidence);
  }
  return pass(`llms.txt "${parsed.title ?? ''}" with ${parsed.links.length} link(s)`, evidence);
});

const CATALOG_LINK_PATTERN =
  /feed|wc\/store|products?\.(xml|json|csv)|sitemap.*product|product.*sitemap|\/shop\/?$|\/products?\/?$|catalog/i;

export const llmsTxtLinksToCatalog = defineCheck('A1.6', async ({ target, fetcher }) => {
  const response = await fetcher.fetch(`${target.origin}/llms.txt`);
  const parsed = parseLlmsTxt(response.body);
  const catalogLinks = parsed.links.filter((link) =>
    CATALOG_LINK_PATTERN.test(`${link.text} ${link.url}`),
  );
  const evidence = { catalog_links: catalogLinks.map((link) => link.url) };
  if (catalogLinks.length > 0) {
    return pass(`${catalogLinks.length} catalog link(s) in llms.txt`, evidence);
  }
  return fail('llms.txt has no link to a feed, Store API or product index', evidence);
});
