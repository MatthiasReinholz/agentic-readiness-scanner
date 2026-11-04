/** GTIN validation: length 8, 12, 13 or 14 digits and a GS1 mod-10 check digit. */
export function normalizeGtin(value: string): string {
  return value.replace(/[\s-]/g, '');
}

export function isValidGtin(value: string): boolean {
  const digits = normalizeGtin(value);
  if (!/^\d+$/.test(digits)) return false;
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const payload = digits.slice(0, -1);
  const check = Number(digits.at(-1));
  let sum = 0;
  let weight = 3;
  for (let index = payload.length - 1; index >= 0; index -= 1) {
    sum += Number(payload[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Why a GTIN with a valid check digit is still not a trade item number, or null. GS1
 * reserves some prefixes for numbers that never identify a product in open trade, and
 * Google Merchant Center rejects them: 02, 04 and 2 (restricted circulation: in-store and
 * company-internal numbers) and 05, 98 and 99 (coupons). Read on the GTIN-13 form, so a
 * UPC (GTIN-12) starting with 2, 4 or 5 is caught too.
 * https://support.google.com/merchants/answer/6324461
 */
export function gtinRestrictedPrefix(value: string): string | null {
  const digits = normalizeGtin(value);
  if (!/^\d+$/.test(digits) || ![12, 13, 14].includes(digits.length)) return null;
  const gtin13 =
    digits.length === 12 ? `0${digits}` : digits.length === 14 ? digits.slice(1) : digits;
  if (/^(02|04|2)/.test(gtin13)) return 'restricted circulation (an in-store or internal number)';
  if (/^(05|98|99)/.test(gtin13)) return 'a coupon number';
  return null;
}
