/* Конверсия (Playwright): липкая мобильная панель действий (Звонок/WhatsApp/Заявка).
 * Мобильный — панель видна, ссылки из настроек, «Заявка» открывает корзину; десктоп — скрыта.
 * Запуск: BASE=http://localhost:PORT node tests/e2e/conversion.cjs */
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
  const browser = await chromium.launch();

  console.log('[Мобильный 375] Липкая панель действий');
  const m = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const p = await m.newPage();
  await p.goto(BASE + '/videonablyudenie.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  ok('панель .mcta видна', await p.locator('.mcta').isVisible());
  const tel = await p.locator('.mcta a[href^="tel:"]').getAttribute('href');
  const wa = await p.locator('.mcta a[href*="wa.me"]').getAttribute('href');
  ok('кнопка «Звонок» с tel:', !!tel && tel.startsWith('tel:+'));
  ok('кнопка WhatsApp с wa.me', !!wa && wa.includes('wa.me/'));
  const rect = await p.evaluate(() => { const r = document.querySelector('.mcta').getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: innerHeight }; });
  ok('панель прижата к низу экрана', Math.abs(rect.bottom - rect.vh) <= 2);
  await p.evaluate(() => document.querySelector('.mcta .cart').click());
  await p.waitForTimeout(400);
  ok('«Заявка» открывает корзину', await p.locator('#cart.open').count() > 0);
  const ovf = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('панель не даёт гориз. скролла (overflow=' + ovf + ')', ovf <= 2);
  ok('десктопная плавающая .wafab на мобильном скрыта', !(await p.locator('.wafab').isVisible().catch(() => false)));
  await m.close();

  console.log('[Десктоп 1200] Панель скрыта, плавающая WhatsApp видна');
  const d = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const dp = await d.newPage();
  await dp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await dp.waitForTimeout(400);
  ok('на десктопе .mcta скрыта', !(await dp.locator('.mcta').isVisible().catch(() => false)));
  ok('на десктопе плавающая WhatsApp .wafab видна', await dp.locator('.wafab').isVisible().catch(() => false));
  ok('.wafab ведёт на wa.me', ((await dp.locator('.wafab').getAttribute('href')) || '').includes('wa.me/'));
  await d.close();

  await browser.close();
  console.log('\n════════════════════════════════');
  console.log('CONVERSION: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('CONVERSION ОШИБКА:', e.message); process.exit(2); });
