'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { esc, fmt } = require('../../lib/product-page');
const { productUrl } = require('../../lib/indexnow');

test('esc: экранирует < > & " \' (защита от XSS в шаблонах)', () => {
  assert.strictEqual(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.strictEqual(esc(null), '');
  assert.strictEqual(esc(undefined), '');
  assert.strictEqual(esc('обычный текст'), 'обычный текст');
});

test('fmt: число → цена с ₸, ноль → пусто', () => {
  const s = fmt(12345);
  assert.ok(/12.?345/.test(s.replace(/\s/g, ' ')), 'разряды: ' + s);
  assert.ok(s.includes('₸'));
  assert.strictEqual(fmt(0), '');
  assert.strictEqual(fmt(null), '');
});

test('productUrl: строит /product/<sku> с encodeURIComponent', () => {
  assert.ok(productUrl('sku-1').endsWith('/product/sku-1'));
  assert.ok(productUrl('HS-TF-C1/64G').includes('/product/HS-TF-C1%2F64G'), 'слэш кодируется');
});
