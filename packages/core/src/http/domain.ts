/**
 * The registrable domain of a hostname without a public suffix list: the last two labels,
 * or three under a two-letter country code with a second-level division (co.uk, com.au).
 * Good enough to tell a store's own subdomain (support.shop.example) from a stranger.
 */
export function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1] ?? '';
  const second = labels[labels.length - 2] ?? '';
  const countryDivision = tld.length === 2 && /^(co|com|org|net|gov|edu|ac|or|ne)$/.test(second);
  return labels.slice(countryDivision ? -3 : -2).join('.');
}
