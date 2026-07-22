/* Клавиатурная доступность (Playwright): Escape закрывает корзину/мегаменю,
 * onclick-ссылки без href фокусируются и активируются, Tab доходит до интерактивных элементов,
 * фокус видим. Запуск: BASE=http://localhost:PORT node tests/e2e/a11y-keyboard.cjs */
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

(async () => {
  const first = (await (await fetch(BASE + '/api/products?limit=1')).json());
  const sku = ((first.items || first) || [])[0].sku;
  const browser = await chromium.launch();
  const p = await browser.newContext().then(c => c.newPage());

  // 1. Escape закрывает корзину (на карточке товара)
  console.log('[1] Escape закрывает корзину');
  await p.goto(BASE + '/product/' + encodeURIComponent(sku), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  await p.locator('#pdAdd, [data-act="add"]').first().click();
  await p.waitForTimeout(300);
  ok('корзина открыта', await p.locator('#cart.open').count() > 0);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  ok('после Escape корзина закрыта', await p.locator('#cart.open').count() === 0);

  // 2. Популярные запросы (a[onclick] без href) — фокусируемы с клавиатуры
  console.log('[2] onclick-ссылки без href доступны с клавиатуры');
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  const hq = p.locator('.hq a').first();
  if (await hq.count()) {
    const tabindex = await hq.getAttribute('tabindex');
    ok('популярный запрос получил tabindex=0', tabindex === '0');
    ok('и role', !!(await hq.getAttribute('role')));
  } else ok('блок популярных запросов присутствует', false);

  // 3. Tab доходит до интерактивных элементов, фокус НЕ теряется на body
  console.log('[3] Tab-навигация');
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  let reached = 0, tags = {};
  for (let i = 0; i < 15; i++) {
    await p.keyboard.press('Tab');
    const info = await p.evaluate(() => { const a = document.activeElement; return { tag: a ? a.tagName : null, body: a === document.body }; });
    if (info.tag && !info.body) { reached++; tags[info.tag] = (tags[info.tag] || 0) + 1; }
  }
  ok('Tab доходит до интерактивных элементов (' + reached + '/15, ' + JSON.stringify(tags) + ')', reached >= 8);

  // 4. Фокус видим (:focus-visible даёт outline)
  console.log('[4] Видимый фокус');
  await p.evaluate(() => { const el = document.querySelector('a[href],button'); if (el) el.focus(); });
  const hasFocusStyle = await p.evaluate(() => {
    // проверяем, что правило :focus-visible объявлено (в любом стайлшите)
    for (const ss of document.styleSheets) { try { for (const r of ss.cssRules) { if (r.selectorText && r.selectorText.indexOf(':focus-visible') >= 0 && /outline/.test(r.cssText)) return true; } } catch (e) {} }
    return false;
  });
  ok(':focus-visible outline объявлен в CSS', hasFocusStyle);

  await browser.close();
  console.log('\n════════════════════════════════');
  console.log('A11Y-KEYBOARD: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('A11Y ОШИБКА:', e.message); process.exit(2); });
