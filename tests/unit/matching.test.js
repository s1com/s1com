'use strict';
// Юнит-тесты чистой логики склейки (lib/matching.js): нормализация ключей, выбор победителя, группировка.
const test = require('node:test');
const assert = require('node:assert');
const { normBrand, normMpn, validEan, offerKeys, pickWinner, buildGroups } = require('../../lib/matching');

test('normBrand: регистр и знаки не значимы', () => {
  assert.equal(normBrand('Schneider-Electric'), normBrand('schneider electric'));
  assert.equal(normBrand('  Dahua  '), 'dahua');
  assert.equal(normBrand(null), '');
});

test('normMpn: артикул нормализуется до букв и цифр', () => {
  assert.equal(normMpn('A9F75-316'), 'A9F75316');
  assert.equal(normMpn('a9f75 316'), 'A9F75316');
  assert.equal(normMpn(undefined), '');
});

test('validEan: только 8..14 цифр', () => {
  assert.ok(validEan('6923172512345'));
  assert.ok(validEan('12345678'));
  assert.ok(!validEan('1234567'));        // коротко
  assert.ok(!validEan('123456789012345')); // длинно
  assert.ok(!validEan('69231A2512345'));   // буквы
  assert.ok(!validEan(''));
});

test('offerKeys: короткий артикул не даёт ключа (защита от ложных склеек)', () => {
  assert.equal(offerKeys({ brand: 'Dahua', mpn: 'A1' }).bm, null);
  assert.equal(offerKeys({ brand: 'Dahua', mpn: 'DH-IPC-1230' }).bm, 'dahua|DHIPC1230');
  assert.equal(offerKeys({ brand: '', mpn: 'DH-IPC-1230' }).bm, null); // без бренда не склеиваем
});

test('pickWinner: приоритет поставщика важнее цены', () => {
  const w = pickWinner([
    { product_id: 2, supplier_priority: 50, stock: 9, price: 100 },
    { product_id: 1, supplier_priority: 10, stock: 1, price: 900 },
  ]);
  assert.equal(w.product_id, 1);
});

test('pickWinner: при равном приоритете вперёд идёт тот, что в наличии', () => {
  const w = pickWinner([
    { product_id: 1, supplier_priority: 10, stock: 0, price: 100 },
    { product_id: 2, supplier_priority: 10, stock: 5, price: 500 },
  ]);
  assert.equal(w.product_id, 2);
});

test('pickWinner: при равном приоритете и наличии — дешевле', () => {
  const w = pickWinner([
    { product_id: 1, supplier_priority: 10, stock: 5, price: 500 },
    { product_id: 2, supplier_priority: 10, stock: 5, price: 400 },
  ]);
  assert.equal(w.product_id, 2);
});

const row = (o) => Object.assign({ offer_id: o.product_id * 10, supplier_id: 1, supplier_priority: 10, brand: 'Dahua', mpn: 'DH-IPC-1230', ean: '', stock: 1, price: 100 }, o);

test('buildGroups: EAN-совпадение → надёжная группа', () => {
  const g = buildGroups([
    row({ product_id: 1, supplier_id: 1, supplier_priority: 10, ean: '6923172512345' }),
    row({ product_id: 2, supplier_id: 2, supplier_priority: 50, ean: '6923172512345', mpn: 'ДРУГОЙ-АРТИКУЛ' }),
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].confidence, 'high');
  assert.equal(g[0].winner.product_id, 1);
  assert.equal(g[0].losers.length, 1);
});

test('buildGroups: бренд+MPN без EAN → спорная группа', () => {
  const g = buildGroups([
    row({ product_id: 1, supplier_id: 1 }),
    row({ product_id: 2, supplier_id: 2, supplier_priority: 50 }),
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].confidence, 'medium');
});

test('buildGroups: один поставщик — не дубль (это его собственный ассортимент)', () => {
  const g = buildGroups([
    row({ product_id: 1, supplier_id: 1 }),
    row({ product_id: 2, supplier_id: 1 }),
  ]);
  assert.equal(g.length, 0);
});

test('buildGroups: разные бренды с одинаковым артикулом не склеиваются', () => {
  const g = buildGroups([
    row({ product_id: 1, supplier_id: 1, brand: 'Dahua' }),
    row({ product_id: 2, supplier_id: 2, brand: 'Hikvision' }),
  ]);
  assert.equal(g.length, 0);
});

test('buildGroups: EAN-группа исключает те же офферы из MPN-группировки (нет двойного учёта)', () => {
  const g = buildGroups([
    row({ product_id: 1, supplier_id: 1, ean: '6923172512345' }),
    row({ product_id: 2, supplier_id: 2, ean: '6923172512345' }),
  ]);
  assert.equal(g.length, 1); // одна high, а не high + medium по тому же MPN
});

test('buildGroups: два оффера одного товара не создают группу сами по себе', () => {
  const g = buildGroups([
    row({ product_id: 1, supplier_id: 1, offer_id: 11 }),
    row({ product_id: 1, supplier_id: 2, offer_id: 12 }),
  ]);
  assert.equal(g.length, 0); // товар один — скрывать нечего
});
