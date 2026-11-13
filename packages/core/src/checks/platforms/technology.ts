/**
 * Technology checks: how a store is built on its platform, read from its own pages. Each
 * records a choice (the kind of theme, a headless front end) as facts and is never scored
 * (weight info). A fact the page does not show is left out, not guessed.
 */
import type { TechnologyFact } from '@agentic-readiness/catalog';

import { detectFramework, type FrameworkMatch } from '../../parsers/frontend.js';
import {
  hasStencilBootstrap,
  readMagentoFrontend,
  readShopifyTheme,
  salesforceStorefront,
} from '../../parsers/storefront.js';
import { pageBuilders, readWooSettings, readWordPressTheme } from '../../parsers/wordpress.js';
import type { Target } from '../../target/types.js';
import { defineCheck, pass } from '../types.js';

function homeFramework(target: Target): FrameworkMatch | null {
  return detectFramework(target.homeDoc, target.home.body, target.home.headers);
}

function themeName(theme: string | null, childTheme: string | null): string | null {
  if (!theme) return null;
  return childTheme ? `${childTheme}, child of ${theme}` : theme;
}

export const wordpressThemeType = defineCheck('A3.15', ({ target }) => {
  const theme = readWordPressTheme(target.homeDoc, readWooSettings(target.homeDoc));
  const builders = pageBuilders(target.homeDoc);
  const evidence: Record<string, unknown> = {
    kind: theme.kind,
    kind_signal: theme.kindSignal,
    theme: theme.theme,
    child_theme: theme.childTheme,
    theme_signal: theme.themeSignal,
    page_builders: builders,
  };
  const facts: TechnologyFact[] = [];
  const name = themeName(theme.theme, theme.childTheme);

  if (theme.kind === null) {
    const framework = homeFramework(target);
    evidence.framework = framework?.framework ?? null;
    evidence.framework_signal = framework?.signal ?? null;
    if (framework) {
      facts.push({ label: 'Front end', value: `Headless (${framework.framework})` });
      evidence.facts = facts;
      return pass(
        `no WordPress theme renders the home page: it is a headless front end built with ${framework.framework} (${framework.signal}) that reads WordPress for its content`,
        evidence,
      );
    }
    evidence.facts = facts;
    return pass(
      'no WordPress theme could be recognised on the home page: it shows no theme folder, no theme body class and no block-theme wrapper, so the site may run a headless front end or a heavily customised setup',
      evidence,
    );
  }

  const kindLabel = theme.kind === 'block' ? 'Block theme' : 'Classic theme';
  facts.push({ label: 'Theme', value: name ? `${kindLabel} (${name})` : kindLabel });
  if (builders.length > 0) facts.push({ label: 'Page builder', value: builders.join(', ') });
  evidence.facts = facts;
  const builderPhrase =
    builders.length > 0 ? `, with pages built in ${builders.join(' and ')}` : '';
  return pass(
    `a ${theme.kind} theme renders the site${name ? ` (${name})` : ''}${builderPhrase}, recognised by ${theme.kindSignal ?? 'the page'}`,
    evidence,
  );
});

/** Hydrogen's default response header: `powered-by: Shopify, Hydrogen` (Oxygen adds itself). */
function hydrogenHeader(target: Target): { hydrogen: boolean; oxygen: boolean } {
  const header = target.home.headers['powered-by'] ?? '';
  return { hydrogen: /\bhydrogen\b/i.test(header), oxygen: /\boxygen\b/i.test(header) };
}

export const shopifyStorefrontType = defineCheck('A3.16', ({ target }) => {
  const theme = readShopifyTheme(target.homeDoc);
  const { hydrogen, oxygen } = hydrogenHeader(target);
  const framework = homeFramework(target);
  const evidence: Record<string, unknown> = {
    powered_by: target.home.headers['powered-by'] ?? null,
    shopify_hosted: target.shopifyHosted ?? null,
    theme_name: theme?.name ?? null,
    theme_schema_name: theme?.schemaName ?? null,
    theme_schema_version: theme?.schemaVersion ?? null,
    theme_store_id: theme?.themeStoreId ?? null,
    framework: framework?.framework ?? null,
    framework_signal: framework?.signal ?? null,
  };
  const facts: TechnologyFact[] = [];
  const done = (message: string) => {
    evidence.facts = facts;
    return pass(message, evidence);
  };

  if (hydrogen) {
    const host = oxygen ? ', hosted on Oxygen' : '';
    facts.push({ label: 'Storefront', value: `Headless (Hydrogen${host})` });
    return done(
      `a headless Hydrogen storefront serves the store${host}, as its powered-by header states`,
    );
  }
  if (theme) {
    // Shopify sets theme_store_id only for its own themes installed from the Theme Store,
    // so a missing id says nothing about where the theme came from.
    const named = [theme.schemaName ?? theme.name, theme.schemaVersion].filter(Boolean).join(' ');
    const storeId = theme.themeStoreId ? `Theme Store id ${String(theme.themeStoreId)}` : null;
    const detail = [named, storeId].filter(Boolean).join(', ');
    facts.push({
      label: 'Storefront',
      value: detail ? `Online Store theme (${detail})` : 'Online Store theme',
    });
    return done(`an Online Store theme renders the store${detail ? ` (${detail})` : ''}`);
  }
  if (target.shopifyHosted === false) {
    facts.push({
      label: 'Storefront',
      value: framework ? `Headless (${framework.framework})` : 'Headless',
    });
    return done(
      `a headless storefront serves the store: Shopify does not serve this domain${framework ? `, and the front end is built with ${framework.framework} (${framework.signal})` : ''}`,
    );
  }
  return done(
    'the storefront type could not be recognised: the home page carries no Shopify.theme object and no Hydrogen header',
  );
});

export const bigcommerceStorefrontType = defineCheck('A3.17', ({ target }) => {
  const stencil = hasStencilBootstrap(target.home.body);
  const framework = stencil ? null : homeFramework(target);
  const evidence: Record<string, unknown> = {
    stencil_bootstrap: stencil,
    framework: framework?.framework ?? null,
    framework_signal: framework?.signal ?? null,
  };
  const facts: TechnologyFact[] = [];
  let message: string;
  if (stencil) {
    facts.push({ label: 'Storefront', value: 'Stencil theme' });
    message =
      'a Stencil theme renders the store, as the stencilBootstrap script of Cornerstone-based themes shows';
  } else if (framework?.framework === 'Next.js') {
    facts.push({ label: 'Storefront', value: 'Headless (Next.js, such as Catalyst)' });
    message = `a headless Next.js storefront serves the store (${framework.signal}), the stack of BigCommerce's Catalyst`;
  } else if (framework) {
    facts.push({ label: 'Storefront', value: `Headless (${framework.framework})` });
    message = `a headless storefront built with ${framework.framework} serves the store (${framework.signal})`;
  } else {
    message =
      'the storefront type could not be recognised: the home page has no stencilBootstrap script and no known front-end framework (a Stencil theme not built on Cornerstone shows neither)';
  }
  evidence.facts = facts;
  return pass(message, evidence);
});

export const salesforceStorefrontType = defineCheck('A3.19', ({ target }) => {
  const kind = salesforceStorefront(target.home.body);
  const facts: TechnologyFact[] = [];
  let message: string;
  if (kind === 'pwa-kit') {
    facts.push({ label: 'Storefront', value: 'Composable Storefront (PWA Kit)' });
    message =
      'the Composable Storefront built with PWA Kit serves the store, as its /mobify/bundle/ assets show';
  } else if (kind === 'server') {
    facts.push({ label: 'Storefront', value: 'Server-rendered storefront (SFRA or SiteGenesis)' });
    message =
      'B2C Commerce renders the storefront on its own servers (SFRA or SiteGenesis), as its /on/demandware.static/ assets show; the two cannot be told apart from the page';
  } else {
    message =
      'the storefront type could not be recognised: the home page loads neither /on/demandware.static/ nor /mobify/bundle/ assets';
  }
  return pass(message, { storefront: kind, facts });
});

export const magentoStorefrontType = defineCheck('A3.18', ({ target }) => {
  const frontend = readMagentoFrontend(target.homeDoc, target.home.body);
  const framework = frontend.theme === null && !frontend.requireJs ? homeFramework(target) : null;
  const evidence: Record<string, unknown> = {
    theme: frontend.theme,
    require_js: frontend.requireJs,
    hyva: frontend.hyva,
    breeze: frontend.breeze,
    framework: framework?.framework ?? null,
    framework_signal: framework?.signal ?? null,
  };
  const facts: TechnologyFact[] = [];
  const themed = frontend.theme ? ` (${frontend.theme})` : '';
  let message: string;
  if (frontend.hyva) {
    facts.push({ label: 'Theme', value: `Hyvä${themed}` });
    message = `a Hyvä theme renders the store${themed}, as its ${/^hyva\//i.test(frontend.theme ?? '') ? 'theme path' : 'window.hyva script'} shows`;
  } else if (frontend.breeze) {
    facts.push({ label: 'Theme', value: `Breeze${themed}` });
    message = `Breeze renders the store${themed}: the page loads its scripts as breeze/dynamic-js and breeze/async-js instead of RequireJS`;
  } else if (frontend.requireJs) {
    facts.push({ label: 'Theme', value: `Luma-based theme${themed}` });
    message = `a Luma-based theme renders the store${themed}: the page loads RequireJS and x-magento-init scripts, the stack of Adobe Commerce's Luma and Blank themes`;
  } else if (frontend.theme) {
    facts.push({ label: 'Theme', value: `Theme ${frontend.theme}` });
    message = `the theme ${frontend.theme} renders the store; it loads neither RequireJS nor Hyvä's or Breeze's scripts, so its family is not recognised`;
  } else if (framework) {
    facts.push({ label: 'Storefront', value: `Headless (${framework.framework})` });
    message = `a headless storefront built with ${framework.framework} serves the store (${framework.signal}); no Adobe Commerce theme renders the home page`;
  } else {
    message =
      'the storefront type could not be recognised: the home page shows no theme asset path, no RequireJS, no Hyvä or Breeze scripts and no known front-end framework';
  }
  evidence.facts = facts;
  return pass(message, evidence);
});
