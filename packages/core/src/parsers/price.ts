/**
 * Prices in page text: a currency sign or code next to an amount. The amount pattern has
 * bounded repetitions (groups of three digits, at most two decimals) so matching stays
 * linear on pages full of numbers; the text is capped as well.
 *
 * Symbols match anywhere; letter codes (ISO 4217 and the written forms stores use, such as
 * "kr", "zł" or "Rs") only where no other letter touches them, so "Rs" in "colours" or
 * "kr" in "krone" is not a currency marker. Codes are case-sensitive on purpose.
 */
const CURRENCY_SYMBOL = '[$€£¥₹₩₪₺₱₫฿₴₦]|R\\$|US\\$|C\\$|A\\$|NZ\\$|S\\$|HK\\$';
const CURRENCY_CODE =
  'USD|EUR|GBP|CHF|JPY|CNY|AUD|CAD|NZD|SEK|NOK|DKK|ISK|PLN|CZK|HUF|RON|BGN|TRY|ILS|AED|SAR|QAR|INR|KRW|SGD|HKD|TWD|MYR|THB|PHP|IDR|VND|ZAR|MXN|BRL|ARS|CLP|COP|PEN|RUB|UAH|kr|zł|Kč|lei|Rp|RM|Rs';
const CURRENCY = `(?:${CURRENCY_SYMBOL}|(?<![A-Za-z])(?:${CURRENCY_CODE})(?![A-Za-z]))`;
const AMOUNT = '(?:\\d{1,3}(?:[.,]\\d{3}){1,4}|\\d{1,7})(?:[.,]\\d{1,2})?';
const PRICE_TEXT = new RegExp(`${CURRENCY}\\s?${AMOUNT}|\\b${AMOUNT}\\s?${CURRENCY}`);
const PRICE_TEXT_ALL = new RegExp(`${CURRENCY}\\s?(${AMOUNT})|\\b(${AMOUNT})\\s?${CURRENCY}`, 'g');
/**
 * One amount on its own: either thousands groups of exactly three digits or a plain run
 * of digits, then an optional decimal part of one or two digits. Anchored, so "1.234" is
 * read as 1234 (a two-digit decimal would be "1.23") and "1.234,56" as 1234.56.
 */
const AMOUNT_ONLY = /^(\d{1,3}(?:[.,]\d{3}){1,4}|\d{1,7})(?:[.,](\d{1,2}))?$/;
/** Characters of page text examined for a price; prices appear early on a product page. */
export const PRICE_TEXT_LIMIT = 50_000;

export function hasPriceText(text: string): boolean {
  return PRICE_TEXT.test(text.slice(0, PRICE_TEXT_LIMIT));
}

/**
 * Reads one amount as written in a feed, a JSON-LD offer or page text, normalising both
 * "1.234,56" and "1,234.56" to 1234.56. A trailing currency code ("24.00 EUR") is ignored.
 * Returns null when the text is not a single amount.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim().replace(/^[^\d]*|[^\d]*$/g, '');
  if (!trimmed) return null;
  const match = AMOUNT_ONLY.exec(trimmed);
  if (!match) return null;
  const whole = Number((match[1] ?? '').replace(/[.,]/g, ''));
  const decimals = match[2];
  const fraction = decimals ? Number(decimals) / (decimals.length === 1 ? 10 : 100) : 0;
  const value = whole + fraction;
  return Number.isFinite(value) ? value : null;
}

/**
 * Every amount that appears next to a currency marker in the first PRICE_TEXT_LIMIT
 * characters of the text, de-duplicated, in document order.
 */
export function pricesInText(text: string): number[] {
  const capped = text.slice(0, PRICE_TEXT_LIMIT);
  const found: number[] = [];
  const seen = new Set<number>();
  PRICE_TEXT_ALL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PRICE_TEXT_ALL.exec(capped)) !== null) {
    const amount = parseAmount(match[1] ?? match[2]);
    if (amount !== null && !seen.has(amount)) {
      seen.add(amount);
      found.push(amount);
    }
  }
  return found;
}

/** True when `wanted` appears among `amounts` within a cent. */
export function amountVisible(
  wanted: number,
  amounts: readonly number[],
  tolerance = 0.01,
): boolean {
  // Compare in whole cents so binary rounding (24 - 23.99 > 0.01) cannot miss a match.
  const limit = Math.round(tolerance * 100);
  return amounts.some(
    (amount) => Math.abs(Math.round(amount * 100) - Math.round(wanted * 100)) <= limit,
  );
}
