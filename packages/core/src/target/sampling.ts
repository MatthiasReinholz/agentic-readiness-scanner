/**
 * Deterministic sampling. The seed is derived from the hostname so two scans of the
 * same store sample the same product pages and produce comparable results.
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

export function sample<T>(items: readonly T[], seed: string, size: number): T[] {
  const unique = [...new Set(items)].sort();
  return seededShuffle(unique, seed).slice(0, size);
}
