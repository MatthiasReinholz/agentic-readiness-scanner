/**
 * The knowledge base as data: one article per check, generated from knowledge/*.md by
 * src/build.ts. A separate entry point (`@agentic-readiness/catalog/knowledge`) so the
 * scanner bundles never carry the article text; only the hosted app imports it.
 */
import { knowledge } from './generated/knowledge.js';
import type { KnowledgeArticle } from './knowledge.js';

export type { KnowledgeArticle } from './knowledge.js';
export { KNOWLEDGE_SECTIONS } from './knowledge.js';
export { knowledge };

export function getArticle(checkId: string): KnowledgeArticle | undefined {
  return knowledge.find((article) => article.id === checkId);
}

export function getArticleBySlug(slug: string): KnowledgeArticle | undefined {
  return knowledge.find((article) => article.slug === slug);
}
