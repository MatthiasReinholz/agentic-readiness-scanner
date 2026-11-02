/**
 * The key a host is stored and looked up under. `www.example.com` and `example.com` are
 * one site to a reader, so scans, history, targets, monitors and badges share one key:
 * lower case, without a trailing dot and without a leading `www.`. Other subdomains stay
 * (`shop.example.com` is its own key), and so does `www.` when nothing but a top-level
 * domain would remain (`www.com`). The scan itself still fetches the URL that was given.
 */
export function hostKey(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return /^www\.[^.]+\.[^.]/.test(host) ? host.slice(4) : host;
}

/**
 * Statements that move rows stored before hosts were normalised onto the bare host. Each
 * is idempotent and runs once per store instance after the table exists. Where the bare
 * host already has a row (a primary or unique key), the `www.` row is a duplicate and is
 * dropped; scan rows and history rows are only re-keyed.
 */
export function wwwHostMigrations(table: string, unique: boolean): string[] {
  const rows = `host LIKE 'www.%.%'`;
  return unique
    ? [
        `UPDATE IGNORE ${table} SET host = SUBSTRING(host, 5) WHERE ${rows}`,
        `DELETE FROM ${table} WHERE ${rows}`,
      ]
    : [`UPDATE ${table} SET host = SUBSTRING(host, 5) WHERE ${rows}`];
}
