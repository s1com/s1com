/* Реальная отправка заявки через браузер (Playwright) + проверка сохранения в админке.
 * Сценарий покупателя: товар → «В заявку» → форма (имя/телефон) → отправка → подтверждение → запись в БД.
 * Запуск: BASE=http://localhost:PORT ADMIN_PASSWORD=... node tests/e2e/order-flow.cjs */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  const fs = require('fs'), path = require('path'); let found;
  try { const npx = path.join(process.env.HOME || '', '.npm', '_npx'); for (const d of fs.readdirSync(npx)) { const c = path.join(npx, d, 'node_modules', 'playwright'); if (fs.existsSync(c)) { found = c; break; } } } catch (e2) {}
  if (found) ({ chromium } = require(found)); else { console.error('playwright не найден'); process.exit(3); }
}
const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN = process.env.ADMIN_PASSWORD || 'p';
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };
const TEST_PHONE_DIGITS = '77001112233'; // уникальный маркер заявки

(async () => {
  // sku для карточки
  const list = await (await fetch(BASE + '/api/products?limit=1')).json();
  const sku = (list.items || list)[0].sku;
  console.log('Товар для теста:', sku);

  const browser = await chromium.launch();
  const p = await browser.newContext().then(c => c.newPage());
  const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); }); // confirm WhatsApp → отклоняем

  // 1. Товар → добавить в заявку
  await p.goto(BASE + '/product/' + encodeURIComponent(sku), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  const addBtn = p.locator('#pdAdd, [data-act="add"]').first();
  ok('кнопка «В заявку» есть', await addBtn.count() > 0);
  await addBtn.click();
  await p.waitForTimeout(400);
  ok('корзина открылась', await p.locator('#cart.open, #cart[class*="open"]').count() > 0);

  // 2. Негатив: отправка без телефона → блок (client-side alert)
  await p.locator('#cName').fill('E2E Тест');
  await p.locator('#cPhone').fill('');
  await p.locator('#cSend').click();
  await p.waitForTimeout(300);
  ok('без телефона — блок (alert), заявка не ушла', dialogs.some(m => /телефон/i.test(m)));

  // 3. Валидная отправка
  await p.locator('#cPhone').fill('+7 700 111 22 33');
  const [resp] = await Promise.all([
    p.waitForResponse(r => r.url().includes('/api/order') && r.request().method() === 'POST', { timeout: 8000 }).catch(() => null),
    p.locator('#cSend').click(),
  ]);
  await p.waitForTimeout(600);
  ok('POST /api/order отправлен и 200', resp && resp.status() === 200);
  ok('показано подтверждение «Заявка отправлена»', dialogs.some(m => /отправлена/i.test(m)));

  await browser.close();

  // 4. Проверка в админке (реально сохранилось?)
  const tok = (await (await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN }) })).json()).token;
  const orders = await (await fetch(BASE + '/api/admin/orders', { headers: { Authorization: 'Bearer ' + tok } })).json();
  const arr = Array.isArray(orders) ? orders : (orders.items || orders.orders || []);
  const mine = arr.find(o => JSON.stringify(o).replace(/\D/g, '').includes(TEST_PHONE_DIGITS));
  ok('заявка появилась в админке', !!mine);
  if (mine) {
    ok('сохранён телефон (+7 700 111 22 33 → 7700…)', JSON.stringify(mine).replace(/\D/g, '').includes(TEST_PHONE_DIGITS));
    ok('сохранён состав (SKU в заявке)', JSON.stringify(mine).includes(sku));
    ok('есть дата/created', /created|date|\d{4}-\d{2}-\d{2}/.test(JSON.stringify(mine)));
  }

  console.log('\n════════════════════════════════');
  console.log('ORDER-FLOW: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('ORDER-FLOW ОШИБКА:', e.message); process.exit(2); });
