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
