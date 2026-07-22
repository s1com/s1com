/* Роль «монтажник» (поиск по SKU/модели/бренду/регистру) + отсутствие гориз. скролла
 * на ширинах 320/360/390/430/768 для главной, раздела и карточки товара.
 * Запуск: BASE=http://localhost:PORT node tests/e2e/roles-widths.cjs */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  const fs = require('fs'), path = require('path'); let found;
  try { const npx = path.join(process.env.HOME || '', '.npm', '_npx'); for (const d of fs.readdirSync(npx)) { const c = path.join(npx, d, 'node_modules', 'playwright'); if (fs.existsSync(c)) { found = c; break; } } } catch (e2) {}
  if (found) ({ chromium } = require(found)); else { console.error('playwright не найден'); process.exit(3); }
}
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };
const cnt = async (q) => { const r = await (await fetch(BASE + '/api/products?' + q)).json(); const a = r.items || r; return Array.isArray(a) ? a.length : 0; };

(async () => {
  // реальные данные из каталога (API может отдавать массив ИЛИ {items:[…]})
  const _r = await (await fetch(BASE + '/api/products?limit=1')).json();
  const first = ((_r.items || _r) || [])[0] || {};
  const sku = first.sku || '';
  const brand = first.brand || 'Dahua';
  const modelFrag = String(first.model || '').split(/\s+/).find(w => w.length >= 4) || 'камера';

  // === Роль «монтажник»: поиск (API) ===
  console.log('[Монтажник] Поиск');
  ok('поиск по SKU «' + sku + '»', sku ? (await cnt('q=' + encodeURIComponent(sku))) > 0 : true);
  ok('поиск по бренду «' + brand + '»', (await cnt('q=' + encodeURIComponent(brand))) > 0);
  ok('поиск по бренду в нижнем регистре «' + brand.toLowerCase() + '»', (await cnt('q=' + encodeURIComponent(brand.toLowerCase()))) > 0);
  ok('поиск по фрагменту названия «' + modelFrag + '»', (await cnt('q=' + encodeURIComponent(modelFrag))) > 0);
  ok('фильтр по бренду (?brand=)', (await cnt('brand=' + encodeURIComponent(brand))) > 0);
  ok('слишком короткий/пустой запрос не падает', (await cnt('q=')) >= 0);

  // === Мобильные/планшетные ширины: нет гориз. скролла ===
  const browser = await chromium.launch();
  const prodPath = sku ? '/product/' + encodeURIComponent(sku) : '/';
  const pages = [['главная', '/'], ['раздел', '/videonablyudenie.html'], ['товар', prodPath]];
  for (const w of [320, 360, 390, 430, 768]) {
    console.log('[Ширина ' + w + 'px]');
    const ctx = await browser.newContext({ viewport: { width: w, height: 820 } });
    const pg = await ctx.newPage();
    for (const [label, path] of pages) {
      await pg.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      await pg.waitForTimeout(500);
      const ov = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(label + ': нет гориз. скролла (overflow=' + ov + ')', ov <= 2);
    }
    await ctx.close();
  }
  await browser.close();

  console.log('\n════════════════════════════════');
  console.log('ROLES/WIDTHS: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('ROLES/WIDTHS ОШИБКА:', e.message); process.exit(2); });
