import { contentType } from '../../http/types.js';
import { storeApiUrl } from '../shared.js';
import { defineCheck, fail, pass } from '../types.js';

export const woocommerceDetected = defineCheck('B1.1', ({ target }) => {
  const evidence = {
    platform: target.platform,
    generator: target.homeDoc.meta('generator'),
    body_classes: target.homeDoc.bodyClasses().filter((c) => /woocommerce|shopify/i.test(c)),
  };
  if (target.platform === 'woocommerce') {
    return pass('WooCommerce detected', evidence);
  }
  return pass(`WooCommerce not detected (platform: ${target.platform})`, evidence);
});

export const storeApiReachable = defineCheck('B1.2', async ({ target, fetcher }) => {
  const url = storeApiUrl(target, '/products?per_page=1');
  const response = await fetcher.fetch(url);
  const total = response.headers['x-wp-total'] ?? null;
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
    total,
  };
  if (response.status === 401 || response.status === 403) {
    return fail(`Store API requires authentication (HTTP ${response.status})`, evidence);
  }
  if (response.status !== 200) {
    return fail(`Store API returned HTTP ${response.status}`, evidence);
  }
  try {
    const parsed: unknown = JSON.parse(response.body);
    if (!Array.isArray(parsed)) {
      return fail('Store API returned JSON that is not a product array', evidence);
    }
    evidence.products_in_first_page = parsed.length;
    return pass(
      `Store API answers with ${parsed.length} product(s) per page, ${total ?? '?'} total`,
      evidence,
    );
  } catch {
    return fail('Store API returned a non-JSON body', evidence);
  }
});
