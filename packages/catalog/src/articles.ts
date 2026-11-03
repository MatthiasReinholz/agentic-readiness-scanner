/**
 * The knowledge base as data: one article per check and the guides, generated from
 * knowledge/*.md and knowledge/guides/*.md by src/build.ts. A separate entry point (`@agentic-readiness/catalog/knowledge`) so the
 * scanner bundles never carry the article text; only the hosted app imports it.
 */
import { guides, knowledge } from './generated/knowledge.js';
import type { KnowledgeArticle, KnowledgeGuide } from './knowledge.js';

export type { KnowledgeArticle, KnowledgeGuide } from './knowledge.js';
export { GUIDE_FIRST_SECTION, GUIDE_LAST_SECTION, KNOWLEDGE_SECTIONS } from './knowledge.js';
export { guides, knowledge };

export function getArticle(checkId: string): KnowledgeArticle | undefined {
  return knowledge.find((article) => article.id === checkId);
}

export function getArticleBySlug(slug: string): KnowledgeArticle | undefined {
  return knowledge.find((article) => article.slug === slug);
}

export function getGuideBySlug(slug: string): KnowledgeGuide | undefined {
  return guides.find((guide) => guide.slug === slug);
}

/** Guides about a check, for its article to link to. */
export function guidesForCheck(checkId: string): KnowledgeGuide[] {
  return guides.filter((guide) => guide.related.includes(checkId));
}
