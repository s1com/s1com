/* Реальный браузерный smoke (Playwright) — прогоняет ключевые пользовательские сценарии
 * против запущенного сервера. Запуск: BASE=http://localhost:PORT node tests/e2e/smoke.cjs
 * Ловит console-ошибки, проверяет наличие ключевых элементов, отправку форм, мобильную ширину. */
'use strict';
// playwright: из node_modules проекта, иначе из кэша npx (после `npx playwright install chromium`).
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  const fs = require('fs'), path = require('path');
  let found;
  try {
    const npx = path.join(process.env.HOME || '', '.npm', '_npx');
    for (const d of fs.readdirSync(npx)) { const c = path.join(npx, d, 'node_modules', 'playwright'); if (fs.existsSync(c)) { found = c; break; } }
  } catch (e2) {}
  if (found) ({ chromium } = require(found));
  else { console.error('playwright не найден. Установите: npm i -D playwright && npx playwright install chromium'); process.exit(3); }
}
const BASE = process.env.BASE || 'http://localhost:3000';
let pass = 0, fail = 0; const fails = [];
function ok(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; fails.push(name); console.log('  ✗ ' + name); } }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const consoleErrors = [];
  ctx.on('weberror', e => consoleErrors.push(String(e.error())));

  async function page(path, opts) {
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(600);
    p._errs = errs;
    return p;
  }

  // 1. Главная
  console.log('\n[1] Главная');
  let p = await page('/');
  ok('заголовок/логотип виден', await p.locator('.logo, h1').first().isVisible().catch(() => false));
  ok('нет console-ошибок', p._errs.length === 0 || (console.log('    errs:', p._errs.slice(0,3)), false) || p._errs.length === 0);
  const hasCTA = await p.locator('a,button').filter({ hasText: /заявк|прайс|подобрать|whatsapp|оптов/i }).count();
  ok('есть CTA (заявка/прайс/WhatsApp)', hasCTA > 0);
  const homeHtml = await p.content();
  ok('WebSite+SearchAction JSON-LD (право на sitelinks-поиск)', homeHtml.includes('"SearchAction"') && homeHtml.includes('"WebSite"'));
  await p.close();

  // 2. Каталог/мегаменю
  console.log('\n[2] Мегаменю');
  p = await page('/');
  const catBtn = p.locator('#catBtn');
  if (await catBtn.count()) { await catBtn.click().catch(()=>{}); await p.waitForTimeout(400); }
  ok('кнопка «Каталог» есть', await catBtn.count() > 0);
  await p.close();

  // 3. Поиск (typeahead)
  console.log('\n[3] Поиск');
  p = await page('/');
  const inp = p.locator('.search input, .hbox input, input[type=search], input[placeholder*=Поиск]').first();
  if (await inp.count()) { await inp.click(); await inp.type('камера', { delay: 40 }); await p.waitForTimeout(700); }
  const dd = await p.locator('.ta-dd, .ta-i').count();
  ok('поле поиска есть', await inp.count() > 0);
  ok('typeahead-подсказки появились', dd > 0);
  await p.close();

  // 4. Раздел
  console.log('\n[4] Раздел');
  p = await page('/videonablyudenie.html');
  ok('раздел открылся (H1/grid)', await p.locator('#grid, .prodgrid, h1').first().isVisible().catch(()=>false));
  const cards = await p.locator('a[href^="/product/"]').count();
  ok('карточки товаров есть (' + cards + ')', cards > 0);
  ok('нет console-ошибок в разделе', p._errs.length === 0);
  const firstHref = cards ? await p.locator('a[href^="/product/"]').first().getAttribute('href') : null;
  await p.close();

  // 5. Карточка товара
  console.log('\n[5] Товар');
  if (firstHref) {
    p = await page(firstHref);
    ok('карточка открылась (H1)', await p.locator('h1').first().isVisible().catch(()=>false));
    ok('есть цена или «по запросу»', (await p.locator('text=/₸|запрос/i').count()) > 0);
    ok('есть CTA «В заявку»/WhatsApp', (await p.locator('a,button').filter({ hasText: /заявк|whatsapp|✆|наличи/i }).count()) > 0);
    ok('JSON-LD Product в DOM', (await p.locator('script[type="application/ld+json"]').count()) > 0);
    ok('нет console-ошибок на товаре', p._errs.length === 0);
    await p.close();
  }

  // 6. Заявка (форма быстрого заказа)
  console.log('\n[6] Быстрый заказ');
  p = await page('/bystryy-zakaz');
  ok('страница быстрого заказа открылась', await p.locator('textarea, #qoText').first().isVisible().catch(()=>false));
  ok('нет console-ошибок', p._errs.length === 0);
  await p.close();

  // 7. Админка — вход
  console.log('\n[7] Админка');
  p = await page('/admin');
  const pwd = p.locator('input[type=password]');
  ok('форма входа админки', await pwd.count() > 0);
  if (await pwd.count()) {
    await pwd.fill('p');
    await p.locator('button:has-text("Войти"), button[type=submit], form button').first().click().catch(()=>{});
    await p.waitForTimeout(1200);
    ok('вход выполнен (панель видна)', (await p.locator('text=/Поставщик|Товары|Заявк|Дашборд|Настройк/i').count()) > 0);
  }
  await p.close();

  // 8. Мобильная ширина 375 — нет горизонтального скролла
  console.log('\n[8] Мобильная ширина 375');
  const mob = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await mob.newPage();
  for (const path of ['/', '/videonablyudenie.html']) {
    await mp.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await mp.waitForTimeout(500);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok('нет гориз. скролла на ' + path + ' (overflow=' + overflow + ')', overflow <= 2);
  }
  await mob.close();

  await browser.close();
  console.log('\n════════════════════════════════');
  console.log('E2E: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  if (fails.length) console.log('Провалы: ' + fails.join(' | '));
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('E2E ОШИБКА:', e.message); process.exit(2); });
