import type { HtmlDocument } from './html.js';

export type JsonLdNode = Record<string, unknown>;

export interface JsonLdExtraction {
  nodes: JsonLdNode[];
  errors: string[];
}

function flatten(value: unknown, into: JsonLdNode[]): void {
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, into);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as JsonLdNode;
  if (Array.isArray(node['@graph'])) {
    for (const item of node['@graph']) flatten(item, into);
    return;
  }
  into.push(node);
}

export function extractJsonLd(doc: HtmlDocument): JsonLdExtraction {
  const nodes: JsonLdNode[] = [];
  const errors: string[] = [];
  for (const script of doc.scriptsOfType('application/ld+json')) {
    try {
      flatten(JSON.parse(script), nodes);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { nodes, errors };
}

export function nodeTypes(node: JsonLdNode): string[] {
  const type = node['@type'];
  if (typeof type === 'string') return [type];
  if (Array.isArray(type)) return type.filter((t): t is string => typeof t === 'string');
  return [];
}

/** A schema.org type name without the vocabulary prefix, lower-cased. */
function normalizeType(type: string): string {
  return type.replace(/^https?:\/\/schema\.org\//, '').toLowerCase();
}

export function hasType(node: JsonLdNode, ...types: string[]): boolean {
  const wanted = new Set(types.map((t) => t.toLowerCase()));
  return nodeTypes(node).some((t) => wanted.has(normalizeType(t)));
}

const ORGANIZATION_TYPES = new Set([
  'organization',
  'onlinestore',
  'onlinebusiness',
  'localbusiness',
  'store',
  'corporation',
]);

/**
 * Organization and its common subtypes. schema.org's Store and LocalBusiness subtypes
 * (BookStore, ClothingStore, ...) all end in Store or Business, so the suffix covers
 * them without listing each one.
 */
export function isOrganizationType(type: string): boolean {
  const normalized = normalizeType(type);
  return ORGANIZATION_TYPES.has(normalized) || /(?:store|business)$/.test(normalized);
}

/** Top-level Organization nodes (any subtype), e.g. from a publisher graph. */
export function organizationNodes(nodes: JsonLdNode[]): JsonLdNode[] {
  return nodes.filter((node) => nodeTypes(node).some(isOrganizationType));
}

/** True when the property carries a value: a non-blank string, a number, or a non-empty object or array. */
export function hasValue(node: JsonLdNode, key: string): boolean {
  const value = node[key];
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

/** Product and ProductGroup nodes, including variants nested under hasVariant. */
export function productNodes(nodes: JsonLdNode[]): JsonLdNode[] {
  const result: JsonLdNode[] = [];
  for (const node of nodes) {
    if (hasType(node, 'Product', 'ProductGroup')) {
      result.push(node);
    }
  }
  return result;
}

export function offersOf(product: JsonLdNode): JsonLdNode[] {
  const offers = product.offers;
  const list: JsonLdNode[] = [];
  flatten(offers, list);
  return list.filter((offer) => hasType(offer, 'Offer', 'AggregateOffer'));
}

export function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

const GTIN_KEYS = ['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14'] as const;

export function gtinOf(product: JsonLdNode): string | null {
  for (const key of GTIN_KEYS) {
    const value = asString(product[key]);
    if (value) return value;
  }
  return null;
}
