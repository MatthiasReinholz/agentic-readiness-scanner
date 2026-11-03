import { WIX_GENERATOR } from '../../target/platforms.js';
import { defineCheck, pass, warn } from '../types.js';

/** A store link Ecwid builds without clean URLs: /store/#!/product-name/p/123456 */
const HASHBANG = '#!/';
/** window.ec.config.storefrontUrls.cleanUrls = true, in any of the usual spellings. */
const CLEAN_URLS = /cleanurls["']?\s*[:=]\s*(?:!0|true)/i;

export const ecwidCleanUrls = defineCheck('A3.13', ({ target }) => {
  const doc = target.homeDoc;
  const generator = (doc.meta('generator') ?? '').toLowerCase();
  const body = target.home.body;
  const hashbangLinks = doc
    .anchors()
    .map((anchor) => anchor.href)
    .filter((href) => href.includes(HASHBANG))
    .slice(0, 5);
  const configured = CLEAN_URLS.test(body);
  // Ecwid documents clean URLs as automatic on Instant Site and in its WordPress and Wix plugins.
  const host = generator.includes('ec-instant-site')
    ? 'Instant Site'
    : generator.includes('wordpress') || body.includes('/wp-content/')
      ? 'WordPress'
      : WIX_GENERATOR.test(generator) || target.home.headers['x-wix-request-id'] !== undefined
        ? 'Wix'
        : null;
  const evidence = { host, clean_urls_configured: configured, hashbang_links: hashbangLinks };
  if (hashbangLinks.length > 0) {
    return warn(
      `store links use hashbang URLs such as ${hashbangLinks[0] ?? ''}: everything after #! never reaches the server, so crawlers and agents cannot fetch a product page on its own`,
      evidence,
    );
  }
  if (host) {
    return pass(
      `clean store URLs are automatic on ${host}, and no hashbang link was found`,
      evidence,
    );
  }
  if (configured) {
    return pass('the integration code switches clean URLs on', evidence);
  }
  return warn(
    'the store is embedded in a custom site without clean URLs switched on, so its product pages default to hashbang URLs that crawlers and agents cannot fetch on their own',
    evidence,
  );
});
