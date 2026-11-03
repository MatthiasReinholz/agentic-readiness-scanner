/**
 * Patterns and validators for legal signals: the official labels laws prescribe, the
 * identifier formats of business registers and tax authorities with their check digits,
 * and the vendor and wording tables the legal checks match against. Checks never carry
 * these tables themselves.
 */

/**
 * The label of the withdrawal function in every official language of Article 11a of the
 * Consumer Rights Directive, as inserted by Directive (EU) 2023/2673 (read from EUR-Lex on
 * 2026-11-03). The law also allows "an unambiguous corresponding formulation".
 */
export const EU_WITHDRAWAL_LABELS: Readonly<Record<string, string>> = {
  bg: 'откажете се от договора тук',
  cs: 'zde odstoupit od smlouvy',
  da: 'fortryd aftale',
  de: 'vertrag widerrufen',
  el: 'πατήστε εδώ για υπαναχώρηση',
  en: 'withdraw from contract here',
  es: 'desistir del contrato aquí',
  et: 'taganen lepingust',
  fi: 'peruuta sopimus tästä',
  fr: 'renoncer au contrat ici',
  ga: 'tarraing siar ón gconradh anseo',
  hr: 'odustati od ugovora',
  hu: 'elállás a szerződéstől',
  it: 'recedere dal contratto qui',
  lt: 'atsisakyti sutarties čia',
  lv: 'atteikties no līguma',
  mt: 'irtira mill-kuntratt hawnhekk',
  nl: 'hier de overeenkomst herroepen',
  pl: 'odstąp od umowy tutaj',
  pt: 'retrate-se do contrato aqui',
  ro: 'retrageți-vă din contract aici',
  sk: 'odstúpiť od zmluvy tu',
  sl: 'kliknite tukaj za odstop od pogodbe',
  sv: 'ångra avtalet här',
};

/** Wording that names withdrawal without the official label; it must still be unambiguous. */
export const WITHDRAWAL_WORDING =
  /\b(withdraw(?:al)?(?: form| from (?:the |your )?(?:contract|order|purchase))?|right of withdrawal|cancel (?:my |your )?(?:contract|order)|widerruf(?:en|sformular|srecht)?|vertrag (?:hier )?widerrufen|rétractation|se rétracter|desistimiento|desistir|recesso|recedere|herroep(?:en|ing)|odstąpienie|ångerrätt|fortrydelse)\b/i;

/** Normalises a visible label for comparison: case, whitespace, curly quotes. */
export function normalizeLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The language of an official Article 11a label the text carries, or null. */
export function officialWithdrawalLanguage(text: string): string | null {
  const label = normalizeLabel(text);
  for (const [language, official] of Object.entries(EU_WITHDRAWAL_LABELS)) {
    if (label.includes(official)) return language;
  }
  return null;
}

const digitsOf = (value: string): number[] =>
  Array.from(value.replace(/\D/g, ''), (digit) => Number(digit));

/** Brazilian CNPJ: 14 digits with two check digits. */
export function isValidCnpj(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length !== 14 || new Set(digits).size === 1) return false;
  const check = (length: number): number => {
    const weights =
      length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, index) => total + weight * (digits[index] ?? 0), 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === digits[12] && check(13) === digits[13];
}

/** Chilean RUT: body plus a mod 11 verifier (0 to 9 or K). */
export function isValidRut(value: string): boolean {
  const match = /^(\d{1,2}\.?\d{3}\.?\d{3})-?([\dkK])$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return false;
  const body = digitsOf(match[1]).reverse();
  let factor = 2;
  let sum = 0;
  for (const digit of body) {
    sum += digit * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  const expected = rest === 11 ? '0' : rest === 10 ? 'K' : String(rest);
  return expected === match[2].toUpperCase();
}

/** Colombian NIT: nine digits plus the DIAN check digit. */
export function isValidNit(value: string): boolean {
  const match = /^(\d{3}\.?\d{3}\.?\d{3})-(\d)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return false;
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const body = digitsOf(match[1]).reverse();
  const sum = body.reduce((total, digit, index) => total + digit * (weights[index] ?? 0), 0);
  const rest = sum % 11;
  const expected = rest > 1 ? 11 - rest : rest;
  return expected === Number(match[2]);
}

/** Argentine CUIT or CUIL: 11 digits, mod 11; a check value of 10 is not issued. */
export function isValidCuit(value: string): boolean {
  if (!/^(?:20|23|24|27|30|33|34)/.test(value.replace(/\D/g, ''))) return false;
  const digits = digitsOf(value);
  if (digits.length !== 11) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + weight * (digits[index] ?? 0), 0);
  const expected = 11 - (sum % 11);
  if (expected === 10) return false;
  return (expected === 11 ? 0 : expected) === digits[10];
}

/** Peruvian RUC: 11 digits starting 10, 15, 16, 17 or 20, mod 11 (10 maps to 0). */
export function isValidRuc(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (!/^(?:10|15|16|17|20)/.test(digits)) return false;
  const all = digitsOf(digits);
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((total, weight, index) => total + weight * (all[index] ?? 0), 0);
  const expected = (11 - (sum % 11)) % 10;
  return all.length === 11 && expected === all[10];
}

/** Swiss UID (CHE-123.456.789): eight digits plus a mod 11 check digit. */
export function isValidSwissUid(value: string): boolean {
  const digits = digitsOf(value);
  if (digits.length !== 9) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4];
  const sum = weights.reduce((total, weight, index) => total + weight * (digits[index] ?? 0), 0);
  const expected = 11 - (sum % 11);
  if (expected === 10) return false;
  return (expected === 11 ? 0 : expected) === digits[8];
}

/** EU VAT identifiers by country prefix, format only (spaces and dots removed first). */
const EU_VAT_FORMAT =
  /\b(ATU\d{8}|BE[01]\d{9}|BG\d{9,10}|CY\d{8}[A-Z]|CZ\d{8,10}|DE\d{9}|DK\d{8}|EE\d{9}|EL\d{9}|ES[A-Z0-9]\d{7}[A-Z0-9]|FI\d{8}|FR[A-HJ-NP-Z0-9]{2}\d{9}|HR\d{11}|HU\d{8}|IE\d{7}[A-W][A-I]?|IT\d{11}|LT(?:\d{9}|\d{12})|LU\d{8}|LV\d{11}|MT\d{8}|NL\d{9}B\d{2}|PL\d{10}|PT\d{9}|RO\d{2,10}|SE\d{10}01|SI\d{8}|SK\d{10})\b/;

export interface FoundIdentifier {
  scheme:
    'eu-vat' | 'uk-company' | 'ch-uid' | 'br-cnpj' | 'cl-rut' | 'co-nit' | 'ar-cuit' | 'pe-ruc';
  value: string;
  valid: boolean;
}

/**
 * Register and tax identifiers in a page's text, each tagged with whether its check digit
 * holds (format only where a scheme has none the scanner can verify).
 */
export function findIdentifiers(text: string): FoundIdentifier[] {
  const found: FoundIdentifier[] = [];
  const add = (scheme: FoundIdentifier['scheme'], value: string, valid: boolean) => {
    if (!found.some((item) => item.scheme === scheme && item.value === value))
      found.push({ scheme, value, valid });
  };
  const vatContext =
    /(?:VAT|USt|UID|TVA|IVA|BTW|NIF|CIF|P\.\s?IVA|Mehrwertsteuer|moms|ALV|DIČ|ДДС)[^A-Z0-9]{0,40}((?:[A-Z]{2}|ATU)[ .]?[A-Z0-9][A-Z0-9 .]{6,15})/gi;
  for (const match of text.matchAll(vatContext)) {
    const candidate = (match[1] ?? '').replace(/[ .]/g, '').toUpperCase();
    const vat = EU_VAT_FORMAT.exec(candidate);
    if (vat?.[1]) add('eu-vat', vat[1], true);
  }
  for (const match of text.matchAll(/\b(?:DE|AT ?U)\s?\d{3}\s?\d{3}\s?\d{3}\b/g)) {
    add('eu-vat', match[0].replace(/\s/g, ''), true);
  }
  const ukCompany =
    /(?:company (?:no\.?|number|registration(?: number)?)|registered (?:in england|in scotland|in northern ireland|number|no\.?)|companies house)[^0-9A-Z]{0,40}((?:SC|NI|OC|SO|NC|R0)?\d{6,8})\b/gi;
  for (const match of text.matchAll(ukCompany)) {
    const value = (match[1] ?? '').toUpperCase();
    if (/^(?:\d{8}|(?:SC|NI|OC|SO|NC|R0)\d{6})$/.test(value)) add('uk-company', value, true);
  }
  for (const match of text.matchAll(/\bCHE[- ]?\d{3}\.?\d{3}\.?\d{3}\b/g)) {
    add('ch-uid', match[0], isValidSwissUid(match[0]));
  }
  for (const match of text.matchAll(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g)) {
    add('br-cnpj', match[0], isValidCnpj(match[0]));
  }
  for (const match of text.matchAll(
    /(?:RUT|R\.U\.T\.)[^0-9]{0,10}(\d{1,2}\.\d{3}\.\d{3}-[\dkK])\b/g,
  )) {
    if (match[1]) add('cl-rut', match[1], isValidRut(match[1]));
  }
  for (const match of text.matchAll(/(?:NIT|N\.I\.T\.)[^0-9]{0,10}(\d{3}\.?\d{3}\.?\d{3}-\d)\b/g)) {
    if (match[1]) add('co-nit', match[1], isValidNit(match[1]));
  }
  for (const match of text.matchAll(/(?:CUIT|C\.U\.I\.T\.)[^0-9]{0,10}(\d{2}-?\d{8}-?\d)\b/g)) {
    if (match[1]) add('ar-cuit', match[1], isValidCuit(match[1]));
  }
  for (const match of text.matchAll(/(?:RUC|R\.U\.C\.)[^0-9]{0,10}(\d{11})\b/g)) {
    if (match[1]) add('pe-ruc', match[1], isValidRuc(match[1]));
  }
  return found;
}

/** An email address in text, not an image file name. */
export const EMAIL_PATTERN =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.(?!png\b|jpe?g\b|gif\b|webp\b|svg\b)[A-Z]{2,24}\b/i;

/** A street address: a postcode next to a word, or a street-type word next to a number. */
export const POSTAL_ADDRESS_PATTERN =
  /\b(?:\d{4,5}\s+[A-ZÄÖÜ][\p{L}-]{2,}|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|\d{5}-\d{3}|\d{5}(?:-\d{4})?\b[^.]{0,40}\b(?:USA|United States)|[\p{L}-]{3,}(?:straße|strasse|str\.|weg|gasse|platz|allee|street|st\.|road|rd\.|avenue|ave\.|lane|rue|calle|avenida|via|viale|rua)\s+\d{1,4}|\d{1,5}\s+[\p{L}. -]{2,30}\s(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|lane|drive|dr\.?))/iu;

/** A legal form after a name: GmbH, Ltd, S.A., Inc. and their kin. */
export const LEGAL_FORM_PATTERN =
  /\b(?:GmbH|AG|UG|KG|OHG|e\.K\.|GbR|mbH|Ltd\.?|Limited|LLP|PLC|LLC|Inc\.?|Corp\.?|S\.?A\.?S?|S\.?L\.?U?|S\.?R\.?L\.?|S\.?p\.?A\.?|B\.?V\.?|N\.?V\.?|SARL|EURL|Sp\. z o\.o\.|s\.r\.o\.|Oy|AB|ApS|A\/S|Ltda\.?|EIRELI|SpA|S\.A\.C\.?)\b/;

/** Labels that name a privacy notice, in the languages the scanner reads. */
export const PRIVACY_LABEL =
  /\b(privacy|datenschutz\w*|confidentialit(?:é|e)|données personnelles|privacidad|privacidade|riservatezza|tratamiento de (?:datos|la información)|protecci(?:ó|o)n de datos|aviso de privacidad|privacybeleid|integritetspolicy)\b/i;

/** Roles that answer privacy requests, followed in the notice by their contact. */
export const PRIVACY_ROLE =
  /\b(data protection officer|DPO|datenschutzbeauftragte[rn]?|délégué(?:e)? à la protection des données|encarregad[oa]|responsable de la protection des renseignements personnels|privacy officer|chief privacy officer|delegado de protección de datos|responsabile della protezione dei dati|functionaris gegevensbescherming)\b/i;

/** The opt-out link wordings of the CCPA regulations (§7013 to §7015). */
export const CCPA_OPT_OUT_LABEL =
  /\b(do not sell(?: or share)? my personal information|do not sell or share my info|your (?:california )?privacy choices|limit the use of my sensitive personal information)\b/i;

/** Labels and paths that name an accessibility statement. */
export const ACCESSIBILITY_LABEL =
  /\b(accessibilit(?:y|é|à)|barrierefrei\w*|erklärung zur barrierefreiheit|accesibilidad|acessibilidade|toegankelijkheid|tillgänglighet\w*|saavutettavuus\w*|dostępność|přístupnost)\b/i;

/**
 * A third-party script by where it loads from: its host (or a subdomain of it) and,
 * where the host serves other things too, a path. Matched on parsed URLs, never on raw
 * text, so a lookalike host or a host named in a query string does not count.
 */
export interface Vendor {
  name: string;
  hosts: readonly string[];
  path?: RegExp;
}

/** Accessibility overlay vendors. */
export const OVERLAY_VENDORS: readonly Vendor[] = [
  { name: 'accessiBe', hosts: ['acsbapp.com', 'accessibe.com'] },
  { name: 'UserWay', hosts: ['userway.org'] },
  { name: 'AudioEye', hosts: ['audioeye.com'] },
  { name: 'EqualWeb', hosts: ['equalweb.com', 'nagich.co'] },
  { name: 'Max Access', hosts: ['maxaccess.io'] },
  { name: 'eSSENTIAL Accessibility', hosts: ['essentialaccessibility.com'] },
  { name: 'Recite Me', hosts: ['reciteme.com'] },
  { name: 'Eye-Able', hosts: ['eye-able.com', 'eye-able-cdn.com'] },
  { name: 'Enable', hosts: ['enable.co.il'] },
];

/** Chat and AI assistant vendors. */
export const CHAT_VENDORS: readonly Vendor[] = [
  { name: 'Intercom', hosts: ['widget.intercom.io', 'js.intercomcdn.com'] },
  { name: 'Zendesk', hosts: ['static.zdassets.com', 'zopim.com'] },
  { name: 'Gorgias', hosts: ['gorgias.chat', 'config.gorgias.io'] },
  { name: 'Tidio', hosts: ['code.tidio.co'] },
  { name: 'Drift', hosts: ['js.driftt.com'] },
  { name: 'LivePerson', hosts: ['lpsnmedia.net', 'liveperson.net'] },
  { name: 'Ada', hosts: ['static.ada.support'] },
  { name: 'Crisp', hosts: ['client.crisp.chat'] },
  { name: 'HubSpot chat', hosts: ['js.usemessages.com'] },
  { name: 'Freshchat', hosts: ['wchat.freshchat.com'] },
  {
    name: 'Shopify Inbox',
    hosts: ['cdn.shopify.com'],
    path: /shopify-chat|\/extensions\/.*inbox/i,
  },
  { name: 'Re:amaze', hosts: ['cdn.reamaze.com'] },
  { name: 'Chatbase', hosts: ['chatbase.co', 'www.chatbase.co'], path: /^\/embed/i },
  { name: 'Voiceflow', hosts: ['cdn.voiceflow.com'] },
  { name: 'Botpress', hosts: ['cdn.botpress.cloud'] },
  { name: 'Kustomer', hosts: ['cdn.kustomerapp.com'] },
  {
    name: 'Salesforce Embedded Service',
    hosts: ['salesforceliveagent.com', 'force.com', 'salesforce.com'],
    path: /embeddedservice|liveagent/i,
  },
];

/** URLs written in script text: absolute and protocol-relative ones. */
const URL_IN_TEXT = /(?:https?:)?\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s"'<>\\)]*)?/gi;

function hostMatches(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

/** The vendor a URL loads from, or undefined. */
export function vendorOfUrl(
  url: string,
  vendors: readonly Vendor[],
  base = 'https://localhost/',
): Vendor | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return undefined;
  }
  const hostname = parsed.hostname.toLowerCase();
  return vendors.find(
    (vendor) =>
      vendor.hosts.some((host) => hostMatches(hostname, host)) &&
      (vendor.path === undefined || vendor.path.test(parsed.pathname)),
  );
}

/** Vendors loaded by script URLs or named by URL inside inline scripts. */
export function vendorsIn(
  scriptUrls: readonly string[],
  inlineScripts: readonly string[],
  vendors: readonly Vendor[],
): string[] {
  const urls = [...scriptUrls, ...inlineScripts.flatMap((text) => text.match(URL_IN_TEXT) ?? [])];
  const found = new Set<string>();
  for (const url of urls) {
    const vendor = vendorOfUrl(url, vendors);
    if (vendor) found.add(vendor.name);
  }
  return [...found];
}

/** Cookies set server-side on a first response that track for advertising. */
export const ADVERTISING_COOKIES =
  /^(?:_fbp|_fbc|fr|_gcl_au|_gcl_aw|IDE|test_cookie|_uetsid|_uetvid|MUID|_ttp|_tt_enable_cookie|li_sugr|bcookie|_pin_unauth|_scid|_rdt_uuid)$/;
/** Cookies set server-side on a first response that measure use. */
export const ANALYTICS_COOKIES =
  /^(?:_ga|_ga_[A-Z0-9]+|_gid|_gat\w*|_hjSessionUser_\d+|_hjSession_\d+|_clck|_clsk|mp_[a-f0-9]+_mixpanel|ajs_anonymous_id|_pk_id\.\d+\.\w+|_pk_ses\.\d+\.\w+)$/;

/** Tracker loaders. */
export const TRACKERS: readonly Vendor[] = [
  { name: 'Google tag', hosts: ['googletagmanager.com'], path: /^\/gtag\/js/ },
  { name: 'Google Analytics', hosts: ['google-analytics.com'], path: /^\/(?:analytics|ga)\.js/ },
  { name: 'Google Tag Manager', hosts: ['googletagmanager.com'], path: /^\/gtm\.js/ },
  { name: 'Meta pixel', hosts: ['connect.facebook.net'], path: /fbevents\.js$/ },
  { name: 'TikTok pixel', hosts: ['analytics.tiktok.com'] },
  { name: 'LinkedIn Insight', hosts: ['snap.licdn.com'] },
  { name: 'Pinterest tag', hosts: ['s.pinimg.com'], path: /^\/ct\/core\.js/ },
  { name: 'Microsoft Advertising UET', hosts: ['bat.bing.com'], path: /^\/bat\.js/ },
  { name: 'Hotjar', hosts: ['static.hotjar.com'] },
  { name: 'Microsoft Clarity', hosts: ['clarity.ms', 'www.clarity.ms'], path: /^\/tag/ },
  { name: 'Snap pixel', hosts: ['sc-static.net'], path: /scevent\.min\.js$/ },
];

/** Attributes and defaults a consent manager uses to hold a tag until consent. */
export const CONSENT_BLOCKED =
  /type\s*=\s*["']text\/plain["']|data-cookieconsent|data-cookiecategory|data-category\s*=|data-consent|class\s*=\s*["'][^"']*optanon-category|data-usercentrics|data-cmp-|data-borlabs|data-complianz/i;
export const CONSENT_MODE_DENIED =
  /gtag\(\s*['"]consent['"]\s*,\s*['"]default['"]\s*,\s*\{[^}]*(?:ad_storage|analytics_storage)['"]?\s*:\s*['"]denied['"]/i;

/** Manufacturer and responsible-person wording on product pages. */
export const MANUFACTURER_WORDING =
  /\b(manufacturer|manufactured by|hersteller|herstellerangaben|fabricant|fabricante|produttore|fabrikant|producent|tillverkare|valmistaja|responsible person|verantwortliche person|personne responsable|persona responsable|persona responsabile|eu[- ]verantwortliche\w*)\b/i;

/** Wording that states the lowest price of the previous 30 days. */
export const PRIOR_PRICE_WORDING =
  /(lowest price (?:in|of|during) the (?:last|previous|past) 30 days|30[- ]day (?:lowest|low) price|niedrigste[rn]? (?:gesamt)?preis (?:der|in den) letzten 30 tage|prix le plus bas (?:des|pratiqué au cours des) 30 derniers jours|precio más bajo (?:de|en) los últimos 30 días|prezzo più basso (?:degli|negli) ultimi 30 giorni|laagste prijs (?:van|in) de afgelopen 30 dagen|najniższa cena z (?:ostatnich )?30 dni|lägsta pris(?:et)? (?:de|under de) senaste 30 dagarna|preço mais baixo (?:dos|nos) últimos 30 dias)/i;

/** Wording that explains how reviews are checked. */
export const REVIEW_VERIFICATION_WORDING =
  /\b(verified (?:purchase|buyer|customer|review)s?|how we (?:check|verify|moderate) reviews|reviews? (?:are|is) (?:checked|verified|moderated)|geprüfte bewertung\w*|verifizierte[rn]? (?:kauf|käufer|bewertung\w*)|bewertungen werden (?:geprüft|verifiziert)|avis vérifiés?|opiniones verificadas|recensioni verificate|geverifieerde (?:aankoop|review)\w*)\b/i;

/** Known review widgets, so reviews loaded later still count as reviews present. */
export const REVIEW_WIDGETS =
  /trustpilot|judge\.me|yotpo|reviews\.io|okendo|stamped\.io|loox\.io|feefo|trustedshops|ekomi|bazaarvoice|powerreviews/i;

/** Generic environmental claims the Green Transition Directive blacklists without proof. */
export const GENERIC_GREEN_CLAIMS =
  /\b(climate[- ]neutral|carbon[- ]neutral|co2[- ]neutral|net[- ]zero product|eco[- ]friendly|environmentally friendly|planet[- ]friendly|nature[- ]friendly|klimaneutral|co2-neutral|umweltfreundlich|nachhaltig(?:es|er|e)? produkt|respectueux de l'environnement|neutre en carbone|écologique|respetuoso con el medio ambiente|ecológico|neutro en carbono|rispettoso dell'ambiente|ecologico|klimaatneutraal|milieuvriendelijk)\b/i;

/** VAT-inclusive wording near a Swiss price. */
export const SWISS_VAT_INCLUDED =
  /\b(inkl\.?\s?(?:mwst|mwst\.|mehrwertsteuer)|inklusive mwst|tva (?:comprise|incluse)|iva inclusa|incl\.?\s?vat|vat included|incl\.?\s?mwst)\b/i;

/** Wording that offers a subscription. */
export const SUBSCRIPTION_WORDING =
  /\b(auto[- ]?renew(?:s|al|ing)?|renews automatically|billed (?:monthly|annually|yearly|every)|subscribe (?:&|and) save|subscription plan|abonnement|abo-modell|im abo|suscripci(?:ó|o)n|assinatura|abbonamento)\b/i;

/** Labels that lead to an online cancellation route. */
export const CANCELLATION_LABEL =
  /\b(cancel (?:my |your )?(?:subscription|membership|plan)|manage (?:my |your )?subscriptions?|verträge hier kündigen|kündigung\w*|abo kündigen|résilier (?:mon |votre )?abonnement|cancelar (?:la |mi )?suscripci(?:ó|o)n|bot(?:ó|o)n de baja|dar(?:se)? de baja|disdetta)\b/i;

/** Links that still point consumers to the EU ODR platform. */
export const ODR_LINK = /ec\.europa\.eu\/consumers\/odr/i;
export const ODR_WORDING =
  /\b(online[- ]streitbeilegung|online dispute resolution platform|règlement en ligne des litiges|os-plattform|odr[- ]platt?form)\b/i;
