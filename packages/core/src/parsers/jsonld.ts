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

/** Object values under one property: a single node, an array, or a nested @graph, flattened. */
export function nodesOf(node: JsonLdNode, key: string): JsonLdNode[] {
  const list: JsonLdNode[] = [];
  flatten(node[key], list);
  return list;
}

export function offersOf(product: JsonLdNode): JsonLdNode[] {
  return nodesOf(product, 'offers').filter((offer) => hasType(offer, 'Offer', 'AggregateOffer'));
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

/** A positive pixel count from a number or numeric string (ImageObject width, img attributes). */
export function asDimension(value: unknown): number | null {
  const text = asString(value);
  if (text === null) return null;
  const match = /^(\d{1,6})(?:\.0{1,3})?(?:\s?px)?$/i.exec(text);
  if (!match) return null;
  const parsed = Number(match[1]);
  return parsed > 0 ? parsed : null;
}

export interface BrandValue {
  /** `entity` for an object, `string` for a bare name. */
  kind: 'entity' | 'string';
  /** The object's first @type without the schema.org prefix; null for a string or untyped object. */
  type: string | null;
  name: string | null;
}

/** The product's brand as written: an object with type and name, a bare string, or null. */
export function brandOf(product: JsonLdNode): BrandValue | null {
  const raw: unknown = Array.isArray(product.brand) ? product.brand[0] : product.brand;
  if (typeof raw === 'string') {
    const name = asString(raw);
    return name === null ? null : { kind: 'string', type: null, name };
  }
  if (!raw || typeof raw !== 'object') return null;
  const node = raw as JsonLdNode;
  return {
    kind: 'entity',
    type: nodeTypes(node)[0]?.replace(/^https?:\/\/schema\.org\//, '') ?? null,
    name: asString(node.name),
  };
}

export interface ImageValue {
  url: string | null;
  width: number | null;
  height: number | null;
}

/**
 * The product's primary image: the first entry of `image`, a URL string or an ImageObject
 * (url or contentUrl, optional width and height). Null when the property is absent.
 */
export function imageOf(product: JsonLdNode): ImageValue | null {
  const raw: unknown = Array.isArray(product.image) ? product.image[0] : product.image;
  if (typeof raw === 'string') {
    const url = asString(raw);
    return url === null ? null : { url, width: null, height: null };
  }
  if (!raw || typeof raw !== 'object') return null;
  const node = raw as JsonLdNode;
  return {
    url: asString(node.url) ?? asString(node.contentUrl),
    width: asDimension(node.width),
    height: asDimension(node.height),
  };
}

/** Product nodes listed under hasVariant (a ProductGroup's variants). */
export function variantsOf(group: JsonLdNode): JsonLdNode[] {
  return nodesOf(group, 'hasVariant').filter((node) => hasType(node, 'Product'));
}
