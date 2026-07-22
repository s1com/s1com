/* Личный кабинет через реальный браузер (Playwright): регистрация → кабинет → предзаполнение
 * контактов в заявке → оформление заказа (привязка к аккаунту) → история → повтор в корзину.
 * Запуск: BASE=http://localhost:PORT ADMIN_PASSWORD=... node tests/e2e/cabinet.cjs */
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

// уникальные телефон/email на прогон (e2e-БД может переживать между запусками)
const STAMP = String(Date.now()).slice(-9);
const PHONE = '87' + STAMP;               // 11 цифр, начинается с 8 → нормализуется в +77...
const PHONE_DIGITS = '7' + '7' + STAMP;   // ожидаемый E.164-хвост
const EMAIL = 'e2e' + STAMP + '@test.kz';
const NAME = 'E2E Кабинет';

(async () => {
  const list = await (await fetch(BASE + '/api/products?limit=1')).json();
  const sku = (list.items || list)[0].sku;

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const dialogs = [];
  p.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });

  // 1. Регистрация в кабинете
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(400);
  ok('форма входа отрисована', await p.locator('#lLogin').count() > 0);
  await p.locator('.cab-tabs2 button[data-m="reg"]').click();
  await p.waitForTimeout(150);
  await p.locator('#rName').fill(NAME);
  await p.locator('#rPhone').fill(PHONE);
  await p.locator('#rEmail').fill(EMAIL);
  await p.locator('#rPass').fill('secret123');
  await p.locator('#rBtn').click();
  await p.waitForTimeout(700);
  ok('после регистрации показан кабинет (приветствие)', /Здравствуйте/.test(await p.locator('#cab').innerText()));
  const token = await p.evaluate(() => localStorage.getItem('sc_user_token'));
  ok('токен сохранён в localStorage', !!token);

  // 2. Предзаполнение контактов из профиля на странице товара
  await p.goto(BASE + '/product/' + encodeURIComponent(sku), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(400);
  ok('индикатор «вы вошли» (зелёная точка на 👤) в шапке', await p.locator('a.acc .acc-dot').count() > 0);
  await p.locator('#pdAdd, [data-act="add"]').first().click();
  await p.waitForTimeout(500);
  ok('корзина открылась', await p.locator('#cart.open, #cart[class*="open"]').count() > 0);
  await p.waitForTimeout(400); // дать prefillContact дорезолвить /api/user/me
  ok('имя предзаполнено из профиля', (await p.locator('#cName').inputValue()) === NAME);
  ok('телефон предзаполнен из профиля', (await p.locator('#cPhone').inputValue()).replace(/\D/g, '').includes(PHONE_DIGITS));

  // 3. Оформление заявки (должна привязаться к аккаунту через Authorization)
  const [resp] = await Promise.all([
    p.waitForResponse(r => r.url().includes('/api/order') && r.request().method() === 'POST', { timeout: 8000 }).catch(() => null),
    p.locator('#cSend').click(),
  ]);
  await p.waitForTimeout(500);
  ok('POST /api/order → 200', resp && resp.status() === 200);

  // 4. История заказов в кабинете + повтор
  await p.goto(BASE + '/cabinet', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  const cabText = await p.locator('#cab').innerText();
  ok('вкладка «Мои заказы» активна по умолчанию', /Заказ №/.test(cabText));
  const repeat = p.locator('[data-repeat]').first();
  ok('кнопка «Повторить» есть', await repeat.count() > 0);
  await repeat.click();
  await p.waitForTimeout(500);
  ok('повтор открыл корзину с товаром', await p.locator('#cart.open, #cart[class*="open"]').count() > 0);

  // 5. Заказ привязан к аккаунту (проверка через API тем же токеном)
  const uo = await (await fetch(BASE + '/api/user/orders', { headers: { Authorization: 'Bearer ' + token } })).json();
  ok('заказ виден в /api/user/orders (привязан к аккаунту)', (uo.orders || []).some(o => JSON.stringify(o).includes(sku)));

  await browser.close();
  console.log('\n════════════════════════════════');
  console.log('CABINET: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('CABINET ОШИБКА:', e.message); process.exit(2); });
