/* Роль «корпоративный клиент» (Playwright + API): понять B2B, запросить опт/КП,
 * расчёт комплекта, подбор по списку, комментарий/ТЗ, доставка/оплата/о компании.
 * Запуск: BASE=http://localhost:PORT node tests/e2e/corp-journey.cjs */
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
const status = async (p) => (await fetch(BASE + p)).status;

(async () => {
  const _r = await (await fetch(BASE + '/api/products?limit=1')).json();
  const sku = ((_r.items || _r) || [])[0].sku;

  // === API-точки ===
  console.log('[API] Корпоративные ресурсы');
  ok('страница доставки (/page/dostavka) 200', await status('/page/dostavka') === 200);
  ok('страница оплаты (/page/oplata) 200', await status('/page/oplata') === 200);
  ok('о компании (/page/o-kompanii) 200', await status('/page/o-kompanii') === 200);
  ok('быстрый заказ/подбор по списку (/bystryy-zakaz) 200', await status('/bystryy-zakaz') === 200);
  const bundles = await (await fetch(BASE + '/api/bundles')).json();
  ok('расчёт комплекта — готовые решения есть', Array.isArray(bundles) && bundles.length > 0);

  const browser = await chromium.launch();
  const p = await browser.newContext().then(c => c.newPage());

  // === Главная: понять, что работают с организациями/оптом ===
  console.log('[Главная] B2B-сигналы');
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  const body = (await p.locator('body').innerText()).toLowerCase();
  ok('упоминание опт/организаций/B2B на главной', /опт|организац|b2b|юридическ|монтажник/.test(body));
  ok('CTA/ссылка «Оптовикам»/опт присутствует', (await p.locator('a,button').filter({ hasText: /оптов|опт |b2b|коммерческ|прайс/i }).count()) > 0);
  ok('WhatsApp-контакт доступен (запрос КП/опт цены)', (await p.locator('a[href*="wa.me"]').count()) > 0);

  // === Карточка товара: опт-цена + комментарий/ТЗ ===
  console.log('[Товар] Опт + комментарий');
  await p.goto(BASE + '/product/' + encodeURIComponent(sku), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(500);
  ok('упоминание опт/B2B на карточке', /опт|b2b|организац/i.test((await p.locator('body').innerText())));
  ok('WhatsApp-опт/запрос цены на карточке', (await p.locator('a[href*="wa.me"]').count()) > 0);
  await p.locator('#pdAdd, [data-act="add"]').first().click();
  await p.waitForTimeout(300);
  ok('в заявке есть поле комментария (для ТЗ/объекта)', await p.locator('#cComment').count() > 0);

  await browser.close();
  console.log('\n════════════════════════════════');
  console.log('CORP-JOURNEY: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('CORP ОШИБКА:', e.message); process.exit(2); });
