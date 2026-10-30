export interface SecurityTxt {
  contacts: string[];
  expires: Date | null;
  fields: Record<string, string[]>;
}

export function parseSecurityTxt(text: string): SecurityTxt {
  const fields: Record<string, string[]> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    (fields[name] ??= []).push(value);
  }
  const expiresRaw = fields.expires?.[0];
  const expires = expiresRaw ? new Date(expiresRaw) : null;
  return {
    contacts: fields.contact ?? [],
    expires: expires && !Number.isNaN(expires.getTime()) ? expires : null,
    fields,
  };
}
