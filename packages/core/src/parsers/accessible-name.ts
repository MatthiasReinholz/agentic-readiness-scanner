/**
 * The accessible name of a form control, the label a screen reader announces and a browser
 * agent reads from the accessibility tree. A static subset of the W3C Accessible Name
 * computation for buttons, inputs, selects and text areas: aria-labelledby, aria-label,
 * a label element, the control's own content (button text, input value, image alt), then
 * title and placeholder. CSS, scripts and shadow DOM are out of reach without a browser.
 */
import { isTag, type Element } from 'domhandler';

import { attribute, elementText, type HtmlDocument } from './html.js';

/** Input types whose name comes from their value, like a button. */
const BUTTON_INPUT = /^(?:submit|button|reset)$/i;

function labelledByText(doc: HtmlDocument, element: Element): string {
  const ids = (attribute(element, 'aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  if (ids.length === 0) return '';
  return ids
    .map((id) => doc.firstElement((candidate) => attribute(candidate, 'id') === id))
    .map((target) => (target ? elementText(target) : ''))
    .join(' ')
    .trim();
}

function labelText(doc: HtmlDocument, element: Element): string {
  const id = attribute(element, 'id');
  if (id) {
    const label = doc.elements('label').find((candidate) => attribute(candidate, 'for') === id);
    if (label && elementText(label)) return elementText(label);
  }
  let parent = element.parent;
  while (parent) {
    if (isTag(parent) && parent.name === 'label') return elementText(parent);
    parent = parent.parent;
  }
  return '';
}

function ownContent(element: Element): string {
  if (element.name === 'button') {
    const text = elementText(element);
    if (text) return text;
    const image = element.children.find(
      (child): child is Element => isTag(child) && child.name === 'img',
    );
    return image ? (attribute(image, 'alt') ?? '').trim() : '';
  }
  if (element.name === 'input') {
    const type = attribute(element, 'type') ?? 'text';
    if (BUTTON_INPUT.test(type)) return (attribute(element, 'value') ?? '').trim();
    if (/^image$/i.test(type)) return (attribute(element, 'alt') ?? '').trim();
  }
  return '';
}

/** The control's accessible name, or an empty string when it has none. */
export function accessibleName(doc: HtmlDocument, element: Element): string {
  return (
    labelledByText(doc, element) ||
    (attribute(element, 'aria-label') ?? '').trim() ||
    labelText(doc, element) ||
    ownContent(element) ||
    (attribute(element, 'title') ?? '').trim() ||
    (attribute(element, 'placeholder') ?? '').trim()
  );
}
