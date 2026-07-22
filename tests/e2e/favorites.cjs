/* Избранное через реальный браузер (Playwright): ♡ на карточке → бейдж в шапке → страница /izbrannoe →
 * синк с аккаунтом. Запуск: BASE=http://localhost:PORT node tests/e2e/favorites.cjs */
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
const STAMP = String(Date.now()).slice(-9);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('dialog', d => d.dismiss().catch(() => {}));

  // 1. Раздел (дефолтный вид — список) → дождаться строк → ♡ на первой
  await p.goto(BASE + '/videonablyudenie.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('tr[data-sku]', { timeout: 8000 });
  const sku = await p.locator('tr[data-sku]').first().getAttribute('data-sku');
  ok('строки раздела отрисованы', !!sku);
  await p.locator('tr[data-sku]').first().locator('[data-act="lfav"]').click();
  await p.waitForTimeout(300);
  ok('бейдж избранного в шапке = 1', (await p.locator('a.fav-link [data-fav-badge]').first().innerText()).trim() === '1');
  ok('сердечко строки стало активным (♥)', (await p.locator('tr[data-sku]').first().locator('[data-act="lfav"]').innerText()).indexOf('♥') >= 0);

  // 2. Страница избранного показывает товар
  await p.goto(BASE + '/izbrannoe', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  ok('на /izbrannoe есть добавленный товар', await p.locator('.pcard[data-sku="' + sku + '"]').count() > 0);
  ok('кнопка «Все в заявку» есть', await p.locator('#favAll').count() > 0);

  // 3. «В заявку» из избранного открывает корзину
  await p.locator('.pcard[data-sku="' + sku + '"] [data-act="add"]').click();
  await p.waitForTimeout(400);
  ok('«В заявку» открыл корзину', await p.locator('#cart.open, #cart[class*="open"]').count() > 0);
  await p.locator('#cartClose').click().catch(() => {});

  // 4. Убрать из избранного → карточка исчезает
  await p.locator('.pcard[data-sku="' + sku + '"] [data-act="unfav"]').click();
  await p.waitForTimeout(300);
  ok('после «убрать» товар пропал из избранного', await p.locator('.pcard[data-sku="' + sku + '"]').count() === 0);

  // 5. Синк с аккаунтом: регистрируемся, добавляем в избранное, проверяем на сервере
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(300);
  await p.locator('.cab-tabs2 button[data-m="reg"]').click();
  await p.waitForTimeout(120);
  await p.locator('#rName').fill('Fav E2E');
  await p.locator('#rPhone').fill('87' + STAMP);
  await p.locator('#rEmail').fill('fav' + STAMP + '@test.kz');
  await p.locator('#rPass').fill('secret123');
  await p.locator('#rBtn').click();
  await p.waitForTimeout(700);
  const token = await p.evaluate(() => localStorage.getItem('sc_user_token'));
  ok('регистрация — токен получен', !!token);
  // добавляем товар в избранное на разделе (залогинен → scFav.push синкает)
  await p.goto(BASE + '/videonablyudenie.html', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('tr[data-sku]', { timeout: 8000 });
  const sku2 = await p.locator('tr[data-sku]').first().getAttribute('data-sku');
  await p.locator('tr[data-sku]').first().locator('[data-act="lfav"]').click();
  await p.waitForTimeout(900); // дать debounce-push долететь
  const srv = await (await fetch(BASE + '/api/user/favorites', { headers: { Authorization: 'Bearer ' + token } })).json();
  ok('избранное синкнулось в аккаунт', (srv.skus || []).indexOf(sku2) >= 0);

  await browser.close();
  console.log('\n════════════════════════════════');
  console.log('FAVORITES: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FAVORITES ОШИБКА:', e.message); process.exit(2); });
