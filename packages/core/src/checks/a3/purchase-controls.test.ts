import { describe, expect, it } from 'vitest';

import { mapFetcher, runCheck, targetFor } from '../../testing/index.js';
import { purchaseControlsNamed } from './purchase-controls.js';

const ORIGIN = 'https://shop.example';
const PRODUCT = `${ORIGIN}/product/mug/`;

function run(form: string) {
  const target = targetFor({ products: [PRODUCT] });
  const fetcher = mapFetcher({ [PRODUCT]: `<html><body><main>${form}</main></body></html>` });
  return runCheck(purchaseControlsNamed, target, fetcher);
}

describe('A3.14 purchase controls have accessible names', () => {
  it('passes when the button, the quantity field and the select are named', async () => {
    const outcome = await run(`<form class="cart">
      <label for="size">Size</label><select id="size" name="size"><option>S</option></select>
      <label>Quantity <input type="number" name="quantity" value="1"></label>
      <input type="hidden" name="product_id" value="7">
      <button type="submit" class="single_add_to_cart_button">Add to cart</button></form>`);
    expect(outcome.verdict).toBe('pass');
    expect(outcome.message).toContain('3 control(s)');
  });

  it('warns when the quantity field has no name', async () => {
    const outcome = await run(`<form class="cart"><input type="number" name="quantity" value="1">
      <button type="submit" class="single_add_to_cart_button">Add to cart</button></form>`);
    expect(outcome.verdict).toBe('warn');
    expect(outcome.message).toContain('input[type=number][name=quantity]');
  });

  it('fails on an icon-only add-to-cart button in a cart form', async () => {
    const outcome = await run(`<form action="/cart/add" method="post">
      <button type="submit" name="add"><svg aria-hidden="true"></svg></button></form>`);
    expect(outcome.verdict).toBe('fail');
    expect(outcome.message).toContain('button[name=add]');
  });

  it('accepts aria-label and aria-labelledby as names', async () => {
    const outcome = await run(`<span id="qty-label">Quantity</span><form action="/cart/add">
      <input type="number" name="quantity" aria-labelledby="qty-label">
      <button type="submit" aria-label="Add to cart"><svg></svg></button></form>`);
    expect(outcome.verdict).toBe('pass');
  });

  it('is not applicable when the server HTML has no add-to-cart control', async () => {
    const outcome = await run('<div id="app"></div>');
    expect(outcome).toMatchObject({ verdict: 'skip', skipReason: 'not_applicable' });
  });
});
