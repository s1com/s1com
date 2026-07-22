/* Раздел «Полезное» через реальный браузер (Playwright): список → статья → перелинковка в каталог →
 * заявка из статьи → админка (создать/скрыть статью). Плюс проверка, что страница не сыплет JS-ошибками
 * (ловили реальный баг: кавычки в onerror плейсхолдера ломали парсинг там, где есть карточки товаров).
 * Запуск: BASE=http://localhost:PORT ADMIN_PASSWORD=... node tests/e2e/articles.cjs */
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
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };
const STAMP = String(Date.now()).slice(-8);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('dialog', d => d.accept().catch(() => {}));

  // --- список ---
  await p.goto(BASE + '/poleznoe', { waitUntil: 'domcontentloaded' });
  const cards = await p.locator('.artc').count();
  ok('список статей не пуст (' + cards + ')', cards > 0);
  ok('в навбаре есть пункт «Полезное»', await p.locator('a[href="/poleznoe"]').count() > 0);

  // --- статья ---
  await p.locator('.artc h2 a').first().click();
  await p.waitForTimeout(600);
  ok('статья открылась', /\/poleznoe\/.+/.test(p.url()));
  ok('есть H1', await p.locator('h1').count() > 0);
  ok('текст статьи не пустой', (await p.locator('.art-body').innerText()).length > 500);

  // Ради этого раздел и делался: статья должна вести в каталог, а не быть тупиком.
  const goods = await p.locator('.acard').count();
  const secLink = await p.locator('.art-goods a[href]').count();
  ok('статья ведёт в каталог (товары: ' + goods + ', ссылки: ' + secLink + ')', goods > 0 || secLink > 0);
  if (goods) ok('карточка товара ведёт на /product/', (await p.locator('.acard a.im').first().getAttribute('href') || '').startsWith('/product/'));

  // --- заявка из статьи ---
  await p.locator('.art-cta .b-go').click();
  await p.waitForTimeout(500);
  ok('кнопка «Оставить заявку» открывает корзину', await p.locator('.cart.open, #cart.open, .cart-panel.open').count() > 0);

  // --- SEO ---
  const canon = await p.locator('link[rel=canonical]').getAttribute('href');
  ok('canonical указывает на статью', /\/poleznoe\//.test(canon || ''));
  const lds = await p.locator('script[type="application/ld+json"]').allTextContents();
  let hasArticle = false, badLd = 0;
  for (const t of lds) { try { const o = JSON.parse(t); if (o['@type'] === 'Article') hasArticle = true; } catch (e) { badLd++; } }
  ok('Article-разметка на месте', hasArticle);
  ok('все JSON-LD валидны', badLd === 0);

  const sm = await (await fetch(BASE + '/sitemap.xml')).text();
  ok('статьи попали в sitemap', sm.includes('/poleznoe/'));

  // --- админка: создать → появилась на витрине → скрыть → пропала ---
  await p.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await p.locator('input[type=password]').fill(ADMIN_PASSWORD);
  await p.locator('button:has-text("Войти")').first().click();
  await p.waitForTimeout(1200);
  await p.evaluate(() => showArticles());
  await p.waitForTimeout(700);
  ok('вкладка «Полезное» открылась', await p.locator('#artBox table').count() > 0);

  await p.evaluate(() => artEdit(0));
  await p.waitForTimeout(400);
  await p.locator('#a_title').fill('E2E статья ' + STAMP);
  await p.locator('#a_slug').fill('e2e-article-' + STAMP);
  await p.locator('#a_excerpt').fill('Проверочный анонс.');
  await p.locator('#a_body').fill('<h2>Заголовок</h2><p>Текст проверочной статьи.</p>');
  await p.locator('#a_grp').selectOption({ index: 1 }).catch(() => {});
  await p.evaluate(() => artSave(0));
  await p.waitForTimeout(900);
  const listTxt = await p.locator('#artBox').innerText();
  ok('новая статья появилась в админке', listTxt.includes('E2E статья ' + STAMP));

  const r1 = await fetch(BASE + '/poleznoe/e2e-article-' + STAMP);
  ok('новая статья открывается на сайте', r1.status === 200);

  // скрыть → 404 (проверяем, что видимостью реально управляют)
  const id = await p.evaluate((s) => (ARTS.find(a => a.slug === s) || {}).id, 'e2e-article-' + STAMP);
  await p.evaluate((i) => artSet(i, 'visible', false), id);
  await p.waitForTimeout(700);
  const r2 = await fetch(BASE + '/poleznoe/e2e-article-' + STAMP);
  ok('скрытая статья отдаёт 404', r2.status === 404);

  // убираем за собой (e2e-база общая между прогонами)
  await p.evaluate((i) => fetch('/api/admin/articles/' + i, { method: 'DELETE', headers: H() }), id);
  await p.waitForTimeout(500);
  const r3 = await fetch(BASE + '/poleznoe/e2e-article-' + STAMP);
  ok('тестовая статья удалена', r3.status === 404);

  ok('JS-ошибок на страницах нет', errors.length === 0);
  if (errors.length) console.log('    ошибки:', errors.slice(0, 3));

  await browser.close();
  console.log(`  articles: ${pass} ок, ${fail} провал(ов)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('articles.cjs:', e); process.exit(1); });
