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

export function hasType(node: JsonLdNode, ...types: string[]): boolean {
  const wanted = new Set(types.map((t) => t.toLowerCase()));
  return nodeTypes(node).some((t) =>
    wanted.has(t.replace(/^https?:\/\/schema\.org\//, '').toLowerCase()),
  );
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

/** The Product nodes listed under a ProductGroup's hasVariant (empty for a plain Product). */
export function variantNodes(product: JsonLdNode): JsonLdNode[] {
  const list: JsonLdNode[] = [];
  flatten(product.hasVariant, list);
  return list.filter((variant) => hasType(variant, 'Product'));
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
