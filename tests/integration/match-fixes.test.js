'use strict';
/* Интеграция: дефекты склейки дублей, найденные аудитом 2026-07-16.
 * Каждый блок сначала воспроизводит сценарий отказа, потом проверяет, что он закрыт.
 * Поднимает сервер на временной БД. Запуск: node tests/integration/match-fixes.test.js */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PORT = process.env.MF_PORT || 3393;
const DB = path.join(os.tmpdir(), 's1com-match-fixes.sqlite');
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };
// Блоки независимы: падение одного не должно скрывать результат остальных
// (иначе регресс в первом сценарии молча оставляет три других непроверенными).
const block = async (name, fn) => { console.log(name); try { await fn(); } catch (e) { fail++; console.log('  ✗ блок упал: ' + e.message); } };

// Свежая БД на каждый прогон: тест правит visible/merged_into, остатки прошлого прогона исказили бы картину.
for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch (e) {} }

const env = Object.assign({}, process.env, {
  PORT: String(PORT), DB_PATH: DB, SEED_ON_EMPTY: 'true', NODE_ENV: 'development',
  ADMIN_PASSWORD: 'mf-pass', JWT_SECRET: 'mf-secret', IMPORT_TOKEN: 'mf-token', SITE_URL: BASE,
});
const waitHealth = (n) => new Promise((res, rej) => {
  const tick = (k) => { const r = http.get(BASE + '/health', x => { x.resume(); x.statusCode === 200 ? res() : retry(k); }); r.on('error', () => retry(k)); r.setTimeout(1000, () => { r.destroy(); retry(k); }); };
  const retry = (k) => k <= 0 ? rej(new Error('нет старта')) : setTimeout(() => tick(k - 1), 500);
  tick(n || 40);
});
const jget = async (p, o) => (await fetch(BASE + p, o)).json();

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { env, cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' });
  try {
    await waitHealth(40);
    const tok = (await jget('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'mf-pass' }) })).token;
    const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
    const TH = { Authorization: 'Bearer mf-token', 'Content-Type': 'application/json' };

    const imp = (src, prods) => fetch(BASE + '/api/import', { method: 'POST', headers: TH, body: JSON.stringify({ source: src, products: prods }) });
    // supplier — поле верхнего уровня; product_id сервер резолвит сам по ext_id = products.sku.
    const offers = (code, offs) => fetch(BASE + '/api/offers-sync', { method: 'POST', headers: TH, body: JSON.stringify({ supplier: code, offers: offs }) });
    // ⚠️ rowToAdmin отдаёт visible как boolean и НЕ отдаёт merged_into — факт склейки смотрим через match/merged.
    const prodBySku = async (sku) => ((await jget('/api/admin/products?q=' + encodeURIComponent(sku) + '&limit=50', { headers: H })).items || []).find(p => p.sku === sku);
    const isMerged = async (sku) => ((await jget('/api/admin/match/merged', { headers: H })).items || []).some(i => i.sku === sku);

    // Спорная группа (бренд+MPN, без EAN) из двух поставщиков — то, что реально бывает у Al-Style+Complex.
    const seedGroup = async (mpn) => {
      await imp('al-style', [{ sku: 'A-' + mpn, brand: 'TestBrand', model: mpn, grp: 'Видеонаблюдение', price: 10000, stock: 5 }]);
      await imp('complex', [{ sku: 'C-' + mpn, brand: 'TestBrand', model: mpn, grp: 'Видеонаблюдение', price: 12000, stock: 3 }]);
      await offers('al-style', [{ ext_id: 'A-' + mpn, brand: 'TestBrand', mpn, ean: '', price_rrp: 10000, stock: 5 }]);
      await offers('complex', [{ ext_id: 'C-' + mpn, brand: 'TestBrand', mpn, ean: '', price_rrp: 12000, stock: 3 }]);
      return { a: await prodBySku('A-' + mpn), c: await prodBySku('C-' + mpn) };
    };
    const queueFor = async (mpn) => ((await jget('/api/admin/match/queue', { headers: H })).items || [])
      .find(q => (q.items || []).some(i => i.model === mpn));

    // --- Дефект №2: resolve со спрятанным руками победителем прятал товар целиком ---
    await block('[№2: победитель, спрятанный руками]', async () => {
      const { a } = await seedGroup('MF-HIDDEN');
      await jget('/api/admin/match/run', { method: 'POST', headers: H, body: '{}' });
      const q = await queueFor('MF-HIDDEN');
      ok('спорная группа попала в очередь', !!q);
      // Ровно тот воркфлоу, что советовали раньше: спрятать дубль руками через bulk-hide.
      await jget('/api/admin/products/bulk', { method: 'POST', headers: H, body: JSON.stringify({ ids: [a.id], action: 'hide' }) });
      const r = await fetch(BASE + '/api/admin/match/resolve', { method: 'POST', headers: H, body: JSON.stringify({ id: q.id, keep: a.id }) });
      const rj = await r.json();
      ok('выбор спрятанного руками победителя отклонён (400)', r.status === 400);
      ok('ответ объясняет причину', /скрыт вручную/i.test(rj.error || ''));
      const all = (await jget('/api/admin/products?q=MF-HIDDEN&limit=50', { headers: H })).items || [];
      ok('товар НЕ исчез с витрины целиком', all.length >= 2 && all.some(p => p.visible === true));
    });

    // --- Дефект №1: «это разные товары» не запоминалось, группа возвращалась каждый прогон ---
    await block('[№1: «это разные товары» залипает]', async () => {
      await seedGroup('MF-DISMISS');
      await jget('/api/admin/match/run', { method: 'POST', headers: H, body: '{}' });
      const q = await queueFor('MF-DISMISS');
      ok('спорная группа попала в очередь', !!q);
      const d = await jget('/api/admin/match/resolve', { method: 'POST', headers: H, body: JSON.stringify({ id: q.id, keep: 0 }) });
      ok('отказ принят', d.ok && d.dismissed);
      // Ровно тот момент, где раньше ломалось: повторный прогон вставлял группу заново.
      const run2 = await jget('/api/admin/match/run', { method: 'POST', headers: H, body: '{}' });
      ok('повторный прогон учёл отказ', run2.dismissed >= 1);
      ok('группа НЕ вернулась в очередь', !(await queueFor('MF-DISMISS')));
      const dis = await jget('/api/admin/match/dismissed', { headers: H });
      ok('группа видна в «Не дубли»', (dis.items || []).some(x => (x.items || []).some(i => i.model === 'MF-DISMISS')));
      const back = (dis.items || []).find(x => (x.items || []).some(i => i.model === 'MF-DISMISS'));
      ok('отказ отменяем', (await jget('/api/admin/match/undismiss', { method: 'POST', headers: H, body: JSON.stringify({ id: back.id }) })).ok);
      await jget('/api/admin/match/run', { method: 'POST', headers: H, body: '{}' });
      ok('после отмены группа снова предлагается', !!(await queueFor('MF-DISMISS')));
    });

    // --- Дефект №3: «Показать» склеенный товар не переживал импорт ---
    await block('[№3: «Показать» снимает склейку]', async () => {
      const { a, c } = await seedGroup('MF-SHOW');
      await jget('/api/admin/match/run', { method: 'POST', headers: H, body: '{}' });
      const q = await queueFor('MF-SHOW');
      await jget('/api/admin/match/resolve', { method: 'POST', headers: H, body: JSON.stringify({ id: q.id, keep: a.id }) });
      ok('проигравший скрыт склейкой', (await prodBySku('C-MF-SHOW')).visible === false && await isMerged('C-MF-SHOW'));
      await jget('/api/admin/products/bulk', { method: 'POST', headers: H, body: JSON.stringify({ ids: [c.id], action: 'show' }) });
      ok('после «Показать» товар на витрине', (await prodBySku('C-MF-SHOW')).visible === true);
      ok('«Показать» сняло и саму склейку', !(await isMerged('C-MF-SHOW')));
      // Импорт прячет по merged_into>0 — если «Показать» его не сняло, товар пропадёт снова.
      await imp('complex', [{ sku: 'C-MF-SHOW', brand: 'TestBrand', model: 'MF-SHOW', grp: 'Видеонаблюдение', price: 12000, stock: 3 }]);
      ok('импорт НЕ спрятал товар обратно', (await prodBySku('C-MF-SHOW')).visible === true);
    });

    // --- Дефект №5: удаление победителя навсегда хоронило проигравших ---
    await block('[№5: удаление победителя освобождает проигравших]', async () => {
      const { a } = await seedGroup('MF-DEL');
      await jget('/api/admin/match/run', { method: 'POST', headers: H, body: '{}' });
      const q = await queueFor('MF-DEL');
      await jget('/api/admin/match/resolve', { method: 'POST', headers: H, body: JSON.stringify({ id: q.id, keep: a.id }) });
      ok('проигравший скрыт склейкой', (await prodBySku('C-MF-DEL')).visible === false && await isMerged('C-MF-DEL'));
      await jget('/api/admin/products/bulk', { method: 'POST', headers: H, body: JSON.stringify({ ids: [a.id], action: 'delete' }) });
      const orphan = await prodBySku('C-MF-DEL');
      ok('проигравший вернулся на витрину', !!orphan && orphan.visible === true);
      ok('ссылка на удалённого победителя снята', !(await isMerged('C-MF-DEL')));
    });
  } catch (e) { console.error('MATCH-FIXES ОШИБКА:', e.message); fail++; }
  finally { try { srv.kill(); } catch (e) {} }

  console.log('\n════════════════════════════════');
  console.log('MATCH-FIXES: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})();
