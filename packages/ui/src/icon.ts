import { ICON_SVG, type IconName } from './generated/icons.js';

/**
 * Inline SVG for a lucide icon. Decorative by default (`aria-hidden`); the caller sizes
 * it through the class list, usually `size-4`. Icons inside button and badge recipes are
 * sized by the recipe already.
 */
export function icon(name: IconName, className?: string): string {
  const attributes = [className ? `class="${className}"` : '', 'aria-hidden="true"']
    .filter(Boolean)
    .join(' ');
  return ICON_SVG[name].replace('<svg ', `<svg ${attributes} `);
}
