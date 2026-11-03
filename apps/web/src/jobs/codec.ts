/**
 * Cached responses are stored gzipped and base64-encoded: store pages compress five to
 * ten times, which keeps a two-megabyte page inside what the database broker accepts in
 * one statement. Web-standard streams only, so it runs in the worker and in Node.
 */
async function pipe(
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function packJson(value: unknown): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  return toBase64(await pipe(raw, new CompressionStream('gzip')));
}

export async function unpackJson(packed: string): Promise<unknown> {
  const raw = await pipe(fromBase64(packed), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(raw)) as unknown;
}
