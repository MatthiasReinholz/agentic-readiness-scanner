/**
 * @agentic-readiness/ui: the visual system shared by the HTML report in core and the
 * hosted app. Tokens and the Tailwind configuration follow the app-base UI standard;
 * what this package ships is the compiled stylesheet, class recipes for the primitives
 * and the icons, all as strings for server-rendered HTML. See
 * docs/decisions/0008-ui-standard.md.
 */
export { THEME_CSS } from './generated/theme-css.js';
export { ICON_SVG, type IconName } from './generated/icons.js';
export { icon } from './icon.js';
export { FONT_FILES, interFontFaceCss } from './fonts.js';
export * from './recipes.js';
