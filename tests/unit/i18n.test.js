'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { translate, clientBootJs, SECTION_KK } = require('../../lib/i18n');

test('translate: длинная фраза раньше короткой-подстроки (регресс «Только в наличии»)', () => {
  assert.strictEqual(translate('Только в наличии', 'kk'), 'Тек қоймада бар');
  assert.strictEqual(translate('В наличии', 'kk'), 'Қоймада бар');
});

test('translate: базовые UI-строки', () => {
  assert.strictEqual(translate('Цена по запросу', 'kk'), 'Баға сұраныс бойынша');
  assert.strictEqual(translate('Оформить заявку', 'kk'), 'Өтінім рәсімдеу');
});

test('translate: НЕ трогает содержимое <script> и <style>', () => {
  const html = '<script>var g="Видеонаблюдение";</script><h1>Видеонаблюдение</h1>';
  const out = translate(html, 'kk');
  assert.ok(out.includes('var g="Видеонаблюдение"'), 'PAGE_GROUP/данные в script целы');
  assert.ok(out.includes('<h1>Бейнебақылау</h1>'), 'видимый текст переведён');
});

test('translate: для не-kk возвращает исходник без изменений', () => {
  assert.strictEqual(translate('Видеонаблюдение', 'ru'), 'Видеонаблюдение');
  assert.strictEqual(translate('В наличии', undefined), 'В наличии');
});

test('clientBootJs(kk): содержит словарь и MutationObserver', () => {
  const js = clientBootJs('kk');
  assert.ok(js.includes('window.LANG="kk"'));
  assert.ok(js.includes('MutationObserver'));
  assert.ok(js.includes('Қоймада бар'), 'словарь встроен');
});

test('clientBootJs(ru): пусто', () => {
  assert.strictEqual(clientBootJs('ru'), '');
});

test('SECTION_KK: 7 разделов', () => {
  assert.strictEqual(SECTION_KK['Видеонаблюдение'], 'Бейнебақылау');
  assert.ok(Object.keys(SECTION_KK).length >= 7);
});
