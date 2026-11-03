import { contentType } from '../../http/types.js';
import { isRecord, looksLikeHtml, parseJson } from '../json.js';
import { blockedByRobots, describeFailure } from '../shared.js';
import { defineCheck, fail, pass, skip, warn } from '../types.js';
import { isTransient, transientPhrase } from './shared.js';

/**
 * A read-only catalog query. Adobe documents that GraphQL queries may be sent with GET
 * (mutations must be POST) and that GET answers for products are cacheable.
 */
export const MAGENTO_PRODUCT_QUERY =
  '{products(search:"a",pageSize:1){total_count items{name sku url_key}}}';

export const magentoGraphqlCatalog = defineCheck('B1.9', async ({ target, fetcher }) => {
  const url = `${target.origin}/graphql?query=${encodeURIComponent(MAGENTO_PRODUCT_QUERY)}`;
  const response = await fetcher.fetch(url, { headers: { accept: 'application/json' } });
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
  };
  if (blockedByRobots(response)) {
    return warn(
      'the GraphQL endpoint was not requested because robots.txt disallows /graphql for the scanner. Agents that honour robots.txt cannot use it either',
      evidence,
    );
  }
  if (isTransient(response)) {
    return skip('error', `the GraphQL request ${transientPhrase(response)}`, evidence);
  }
  const body = parseJson(response.body);
  const products = isRecord(body) && isRecord(body.data) ? body.data.products : undefined;
  const items = isRecord(products) && Array.isArray(products.items) ? products.items : null;
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors : [];
  evidence.errors = errors
    .slice(0, 3)
    .map((error) =>
      isRecord(error) && typeof error.message === 'string' ? error.message : String(error),
    );
  if (response.status === 200 && items) {
    const total =
      isRecord(products) && typeof products.total_count === 'number' ? products.total_count : null;
    evidence.total_count = total;
    evidence.first_item = isRecord(items[0]) ? (items[0].name ?? null) : null;
    return errors.length > 0
      ? warn(
          `GraphQL answers a catalog query over GET, but with errors: ${String((evidence.errors as string[])[0])}`,
          evidence,
        )
      : pass(
          `the catalog answers a GraphQL query over GET without a token (${String(total ?? items.length)} matching products)`,
          evidence,
        );
  }
  if (isRecord(body) && errors.length > 0) {
    return warn(
      `GraphQL answers but refuses the catalog query: ${String((evidence.errors as string[])[0])}`,
      evidence,
    );
  }
  if (response.status === 401 || response.status === 403) {
    return fail(`GraphQL refuses anonymous catalog reads (${describeFailure(response)})`, evidence);
  }
  return fail(
    looksLikeHtml(response.body)
      ? `/graphql answers with an HTML page (${describeFailure(response)}), not GraphQL; a firewall rule or a redirect sits in front of it`
      : `/graphql does not answer a catalog query (${describeFailure(response)}, ${contentType(response) || 'no content type'})`,
    evidence,
  );
});
