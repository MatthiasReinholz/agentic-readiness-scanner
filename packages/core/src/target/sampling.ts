/**
 * Deterministic, stable sampling. The seed is derived from the hostname so two scans of
 * the same store sample the same product pages and produce comparable results, and each
 * URL is ranked on its own so a new product does not reshuffle the whole sample.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const random = mulberry32(fnv1a32(seed));
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const a = result[index];
    const b = result[swap];
    if (a !== undefined && b !== undefined) {
      result[index] = b;
      result[swap] = a;
    }
  }
  return result;
}

/** The MurmurHash3 finalizer: spreads FNV-1a's weakly mixed last characters over all 32 bits. */
export function mix32(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** The rank of one item in a sample: a hash of the seed and the item alone. */
export function sampleRank(seed: string, item: string): number {
  return mix32(fnv1a32(`${seed}\n${item}`));
}

/**
 * The `size` items with the lowest hash of seed and item. Each item's rank depends on
 * nothing but itself and the seed, so adding or removing one product changes the sample by
 * at most that one item, and the same store samples the same pages on every scan whatever
 * order its sitemap lists them in.
 */
export function sample<T>(items: readonly T[], seed: string, size: number): T[] {
  if (size <= 0) return [];
  const ranked = [...new Set(items)].map((item) => ({
    item,
    key: String(item),
    rank: sampleRank(seed, String(item)),
  }));
  ranked.sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return ranked.slice(0, size).map((entry) => entry.item);
}
