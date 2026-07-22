'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { cleanTitle, buildProducts, num } = require('../../scripts/complex-import.js');

test('cleanTitle: убирает ведущий артикул-код и дублирующий бренд', () => {
  assert.strictEqual(cleanTitle('MDV11-2-016-030 IEK Выключатель ВД1-63', 'IEK', 'MDV11-2-016-030'), 'Выключатель ВД1-63');
  assert.strictEqual(cleanTitle('A9F75316 Автоматический выключатель', 'Schneider Electric', 'A9F75316'), 'Автоматический выключатель');
  assert.strictEqual(cleanTitle('NVR301-08S3 8-ми канальный видеорегистратор', 'Uniview', 'NVR301-08S3'), '8-ми канальный видеорегистратор');
});

test('cleanTitle: словесный артикул (с буквами, без цифр) НЕ вырезается как код', () => {
  // «Ajax Hub» — не код (нет цифр); ведущий бренд «Ajax» убирается, остальное сохраняется
  assert.strictEqual(cleanTitle('Ajax Hub белый централь', 'Ajax', 'Ajax Hub'), 'Hub белый централь');
});

test('cleanTitle: пустое имя → fallback на бренд+sku', () => {
  assert.strictEqual(cleanTitle('', 'Dahua', 'DH-1'), 'Dahua DH-1');
});

test('num: парсит число из строки, мусор → 0', () => {
  assert.strictEqual(num('12 500 ₸'), 12500);
  assert.strictEqual(num('abc'), 0);
  assert.strictEqual(num(null), 0);
  assert.strictEqual(num(999), 999);
});

test('buildProducts: берёт только бренды из карты, в назначенный раздел', () => {
  const map = { skipNoPrice: true, byBrand: new Map([['dahua', 'Видеонаблюдение']]) };
  const raw = [
    { model: 'DH-1', brand: 'Dahua', name: 'Камера', price_rrc: 1000, quantity: 5 },
    { model: 'IEK-1', brand: 'IEK', name: 'Автомат', price_rrc: 500, quantity: 2 }, // бренда нет в карте
  ];
  const { products, stats } = buildProducts(raw, map);
  assert.strictEqual(products.length, 1);
  assert.strictEqual(products[0].grp, 'Видеонаблюдение');
  assert.strictEqual(products[0].sku, 'DH-1');
  assert.strictEqual(stats.brandOff, 1);
});

test('buildProducts: пропускает товары без цены при skipNoPrice', () => {
  const map = { skipNoPrice: true, byBrand: new Map([['dahua', 'Видеонаблюдение']]) };
  const raw = [{ model: 'DH-0', brand: 'Dahua', name: 'Без цены', price_rrc: 0, quantity: 3 }];
  const { products, stats } = buildProducts(raw, map);
  assert.strictEqual(products.length, 0);
  assert.strictEqual(stats.noPrice, 1);
});

test('buildProducts: дедуп по sku (модели), оставляет с ценой/большим остатком', () => {
  const map = { skipNoPrice: true, byBrand: new Map([['dahua', 'Видеонаблюдение']]) };
  const raw = [
    { model: 'DH-1', brand: 'Dahua', name: 'Камера', price_rrc: 1000, quantity: 5 },
    { model: 'DH-1', brand: 'Dahua', name: 'Камера дубль', price_rrc: 1000, quantity: 9 },
  ];
  const { products, stats } = buildProducts(raw, map);
  assert.strictEqual(products.length, 1);
  assert.strictEqual(stats.dups, 1);
  assert.strictEqual(products[0].stock, 9, 'оставлен с бОльшим остатком');
});

test('buildProducts: descr = полное имя, цена из price_rrc', () => {
  const map = { skipNoPrice: true, byBrand: new Map([['dahua', 'Видеонаблюдение']]) };
  const { products } = buildProducts([{ model: 'DH-2', brand: 'Dahua', name: 'DH-2 IP камера 4Мп', price_rrc: 25000, quantity: 1 }], map);
  assert.strictEqual(products[0].price, 25000);
  assert.strictEqual(products[0].descr, 'DH-2 IP камера 4Мп');
});
