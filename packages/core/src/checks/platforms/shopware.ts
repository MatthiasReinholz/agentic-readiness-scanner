import { contentType } from '../../http/types.js';
import { isRecord, parseJson } from '../json.js';
import { blockedByRobots, describeFailure } from '../shared.js';
import { defineCheck, pass, skip, warn } from '../types.js';
import { isTransient, transientPhrase } from './shared.js';

/** One of the three agentic files Shopware 6.7.12 and later publishes per sales channel. */
export const SHOPWARE_AI_CATALOG = '/.well-known/ai-catalog.json';

export const shopwareAgenticFiles = defineCheck('A4.9', async ({ target, fetcher }) => {
  const url = `${target.origin}${SHOPWARE_AI_CATALOG}`;
  const response = await fetcher.fetch(url, { headers: { accept: 'application/json' } });
  const evidence: Record<string, unknown> = {
    url,
    status: response.status,
    content_type: contentType(response),
  };
  if (blockedByRobots(response)) {
    return warn(
      `${SHOPWARE_AI_CATALOG} was not requested because robots.txt disallows it for the scanner`,
      evidence,
    );
  }
  if (isTransient(response)) {
    return skip(
      'error',
      `the request for ${SHOPWARE_AI_CATALOG} ${transientPhrase(response)}`,
      evidence,
    );
  }
  const body = parseJson(response.body);
  if (response.status === 200 && isRecord(body)) {
    evidence.keys = Object.keys(body).slice(0, 12);
    return pass(
      `${SHOPWARE_AI_CATALOG} is published, so the sales channel's agentic files are on`,
      evidence,
    );
  }
  return warn(
    response.status === 404
      ? `${SHOPWARE_AI_CATALOG} answers 404: the sales channel's agentic files (llms.txt, agents.md, ai-catalog.json) are off, or the shop runs a Shopware version before 6.7.12`
      : `${SHOPWARE_AI_CATALOG} is not a JSON document (${describeFailure(response)}, ${contentType(response) || 'no content type'})`,
    evidence,
  );
});
