/* Склейка дублей между поставщиками через реальный браузер (Playwright):
 * готовим дубль (два поставщика, один EAN) → 🏭 Поставщики → предпросмотр → склейка →
 * товар пропал с витрины → «Что склеено» → возврат на витрину. Плюс сценарий очереди (без EAN).
 * Запуск: BASE=http://localhost:PORT ADMIN_PASSWORD=... node tests/e2e/match-admin.cjs */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  const fs = require('fs'), path = require('path'); let found;
  try { const npx = path.join(process.env.HOME || '', '.npm', '_npx'); for (const d of fs.readdirSync(npx)) { const c = path.join(npx, d, 'node_modules', 'playwright'); if (fs.existsSync(c)) { found = c; break; } } } catch (e2) {}
  if (found) ({ chromium } = require(found)); else { console.error('playwright не найден'); process.exit(3); }
}
const BASE = process.env.BASE || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'e2e-test-pass';
const IMPORT_TOKEN = process.env.IMPORT_TOKEN || 'e2e-test-token';
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

const STAMP = String(Date.now()).slice(-8);
const SKU_A = 'E2EA' + STAMP;          // «Al-Style»: внутренний код
const MPN = 'E2E-CAM-' + STAMP;        // артикул производителя (= sku у Complex)
const EAN = '46' + STAMP.padStart(11, '0');

const post = (path, body, token) => fetch(BASE + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body),
}).then(r => r.json());

(async () => {
  // --- подготовка: два товара-дубля от разных поставщиков + офферы с общим EAN ---
  await post('/api/import', { source: 'al-style', products: [{ sku: SKU_A, brand: 'E2EBrand', model: MPN, grp: 'Видеонаблюдение', price: 50000, stock: 5 }] }, IMPORT_TOKEN);
  await post('/api/import', { source: 'complex', products: [{ sku: MPN, brand: 'E2EBrand', model: 'Камера E2E', grp: 'Видеонаблюдение', price: 47000, stock: 3 }] }, IMPORT_TOKEN);
  await post('/api/offers-sync', { supplier: 'al-style', offers: [{ ext_id: SKU_A, brand: 'E2EBrand', mpn: MPN, ean: EAN, price_buy: 42000, stock: 5 }] }, IMPORT_TOKEN);
  await post('/api/offers-sync', { supplier: 'complex', offers: [{ ext_id: MPN, brand: 'E2EBrand', mpn: MPN, ean: EAN, price_buy: 40000, stock: 3 }] }, IMPORT_TOKEN);

  const before = await (await fetch(BASE + '/api/products?q=' + MPN)).json();
  const beforeN = (before.items || before).length;
  ok('до склейки товар двоится на витрине (' + beforeN + ' шт)', beforeN === 2);

  const browser = await chromium.launch();
  const p = await (await browser.newContext()).newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', d => d.accept().catch(() => {}));   // confirm() в склейке — подтверждаем

  // --- вход в админку ---
  await p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await p.locator('input[type=password]').fill(ADMIN_PASSWORD);
  await p.locator('button:has-text("Войти")').first().click();
  await p.waitForTimeout(1200);

  // --- 🏭 Поставщики → панель склейки ---
  await p.evaluate(() => showSuppliers());
  await p.waitForTimeout(700);
  ok('панель склейки отрисована', await p.locator('#matchBox').count() > 0);

  // --- предпросмотр: группа найдена, база не тронута ---
  await p.evaluate(() => matchPreview());
  await p.waitForTimeout(700);
  const prev = await p.locator('#matchBox').innerText();
  ok('предпросмотр нашёл группу и назвал её надёжной', /EAN совпал/.test(prev));
  ok('предпросмотр показал, кто останется и кто скроется', /останется/.test(prev) && /скроется/.test(prev));
  const midPreview = await (await fetch(BASE + '/api/products?q=' + MPN)).json();
  ok('предпросмотр ничего не склеил', (midPreview.items || midPreview).length === 2);

  // --- склейка ---
  await p.evaluate(() => matchRun());
  await p.waitForTimeout(1200);
  const runTxt = await p.locator('#matchBox').innerText();
  ok('склейка отчиталась о результате', /Готово: склеено/.test(runTxt));

  const after = await (await fetch(BASE + '/api/products?q=' + MPN)).json();
  const afterN = (after.items || after).length;
  ok('после склейки на витрине 1 товар вместо 2', afterN === 1);
  ok('на витрине остался приоритетный поставщик (Al-Style)', ((after.items || after)[0] || {}).sku === SKU_A);

  // --- «что склеено» + возврат ---
  await p.evaluate(() => matchMerged());
  await p.waitForTimeout(700);
  const mergedTxt = await p.locator('#matchBox').innerText();
  ok('«Что склеено» показывает скрытый дубль', mergedTxt.includes(MPN));

  await p.locator('#matchBox button:has-text("Вернуть на витрину")').first().click();
  await p.waitForTimeout(900);
  const back = await (await fetch(BASE + '/api/products?q=' + MPN)).json();
  ok('возврат на витрину работает (снова 2 товара)', (back.items || back).length === 2);

  // --- очередь: без EAN совпадение только по бренду+артикулу → спрашиваем человека ---
  await post('/api/offers-sync', { supplier: 'al-style', offers: [{ ext_id: SKU_A, brand: 'E2EBrand', mpn: MPN, ean: '', price_buy: 42000, stock: 5 }] }, IMPORT_TOKEN);
  await post('/api/offers-sync', { supplier: 'complex', offers: [{ ext_id: MPN, brand: 'E2EBrand', mpn: MPN, ean: '', price_buy: 40000, stock: 3 }] }, IMPORT_TOKEN);
  await p.evaluate(() => matchRun());
  await p.waitForTimeout(1200);
  const qTxt = await p.locator('#matchBox').innerText();
  ok('спорная группа ушла в очередь, а не склеилась молча', /Спорных групп/.test(qTxt) || /в очередь/.test(qTxt));
  const stillTwo = await (await fetch(BASE + '/api/products?q=' + MPN)).json();
  ok('спорная группа ничего не скрыла до решения', (stillTwo.items || stillTwo).length === 2);

  await p.evaluate(() => matchQueue());
  await p.waitForTimeout(700);
  const keepBtn = p.locator('#matchBox button:has-text("Оставить этот")').first();
  ok('в очереди есть кнопка выбора товара', await keepBtn.count() > 0);
  await keepBtn.click();
  await p.waitForTimeout(1100);
  const resolved = await (await fetch(BASE + '/api/products?q=' + MPN)).json();
  ok('после решения на витрине снова 1 товар', (resolved.items || resolved).length === 1);

  ok('JS-ошибок на странице нет', errors.length === 0);
  if (errors.length) console.log('    ошибки:', errors.slice(0, 3));

  // Убираем за собой: e2e-база переживает прогоны, а эти товары с длинными артикулами
  // попадают в раздел «Видеонаблюдение» и ломают чужие проверки (напр. roles-widths — гориз. скролл).
  try {
    const tok = (await (await fetch(BASE + '/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: ADMIN_PASSWORD }),
    })).json()).token;
    // Чистим ВЕСЬ тестовый бренд, а не только позиции этого прогона: база общая и переживает запуски,
    // поэтому мусор прошлых прогонов (с другим STAMP) иначе копится и ломает соседние спеки.
    const list = await (await fetch(BASE + '/api/admin/products?q=E2EBrand', { headers: { Authorization: 'Bearer ' + tok } })).json();
    const ids = (list.items || []).filter(p => p.brand === 'E2EBrand').map(p => p.id);
    if (ids.length) await fetch(BASE + '/api/admin/products/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ ids, action: 'delete' }),
    });
    const left = await (await fetch(BASE + '/api/products?q=' + MPN)).json();
    ok('тестовые товары убраны из базы', ((left.items || left).length) === 0);
  } catch (e) { ok('тестовые товары убраны из базы', false); console.log('    очистка:', e.message); }

  await browser.close();
  console.log(`  match-admin: ${pass} ок, ${fail} провал(ов)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('match-admin.cjs:', e); process.exit(1); });
