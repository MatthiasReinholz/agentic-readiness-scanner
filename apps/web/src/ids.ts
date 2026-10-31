/** Random identifiers shared by scans, monitors and tokens. Web Crypto only. */

export function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Scan and monitor ids are randomHex(8): sixteen lower-case hex digits. */
export const SCAN_ID = /^[0-9a-f]{16}$/;

export function newScanId(): string {
  return randomHex(8);
}
