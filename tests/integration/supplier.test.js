'use strict';
/* Интеграция: эндпоинты второго поставщика Complex (карта брендов, выбор источника).
 * Поднимает сервер на временной БД. Запуск: node tests/integration/supplier.test.js */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = process.env.SUP_PORT || 3391;
const DB = path.join(os.tmpdir(), 's1com-supplier.sqlite');
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };
const env = Object.assign({}, process.env, {
  PORT: String(PORT), DB_PATH: DB, SEED_ON_EMPTY: 'true', NODE_ENV: 'development',
  ADMIN_PASSWORD: 'sup-pass', JWT_SECRET: 'sup-secret', IMPORT_TOKEN: 'sup-token', SITE_URL: BASE,
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
    const tok = (await jget('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'sup-pass' }) })).token;
    const H = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };

    console.log('[Поставщик Complex засеян]');
    const sup = await jget('/api/admin/suppliers', { headers: H });
    ok('поставщик complex есть в списке', (sup.suppliers || []).some(s => s.code === 'complex'));

    console.log('[/api/supplier-config/:code — публично, без секретов]');
    const cfg = await jget('/api/supplier-config/complex');
    ok('отдаёт массив brands', Array.isArray(cfg.brands) && cfg.brands.length > 0);
    ok('есть skipNoPrice', typeof cfg.skipNoPrice === 'boolean');
    ok('НЕ отдаёт ключ/токен API', !JSON.stringify(cfg).match(/api_key|tokenEnv|COMPLEX_API_KEY/i));

    console.log('[POST /api/admin/supplier-brands — сохранение карты]');
    const save = await jget('/api/admin/supplier-brands', {
      method: 'POST', headers: H,
      body: JSON.stringify({ code: 'complex', skipNoPrice: true, brands: [
        { brand: 'Dahua', on: true, section: 'Видеонаблюдение', exAlstyle: true },
        { brand: 'SHIP', on: false, section: 'Кабельные системы' },
      ] }),
    });
    ok('сохранение вернуло ok+count', save.ok && save.count === 2);

    console.log('[GET /api/brand-owners — исключения для Al-Style]');
    const owners = await jget('/api/brand-owners');
    ok('excludeFromAlstyle содержит Dahua (on+exAlstyle)', Array.isArray(owners.excludeFromAlstyle) && owners.excludeFromAlstyle.includes('Dahua'));
    ok('SHIP (off) НЕ в исключениях', !owners.excludeFromAlstyle.includes('SHIP'));

    console.log('[/api/supplier-config отражает сохранение]');
    const cfg2 = await jget('/api/supplier-config/complex');
    const dahua = cfg2.brands.find(b => b.brand === 'Dahua');
    ok('Dahua сохранён с exAlstyle=true', dahua && dahua.exAlstyle === true && dahua.on === true);

    console.log('[Разделы Электротехника/Светотехника засеяны]');
    const secs = await jget('/api/sections');
    ok('раздел Электротехника есть', (secs || []).some(s => s.name === 'Электротехника'));
    ok('раздел Светотехника есть', (secs || []).some(s => s.name === 'Светотехника'));

    console.log('[404 для неизвестного поставщика]');
    ok('/api/supplier-config/nope → 404', (await fetch(BASE + '/api/supplier-config/nope')).status === 404);

    console.log('[Детектор дублей между поставщиками]');
    const imp = (src, prods) => fetch(BASE + '/api/import', { method: 'POST', headers: { Authorization: 'Bearer sup-token', 'Content-Type': 'application/json' }, body: JSON.stringify({ source: src, products: prods }) });
    await imp('al-style', [{ sku: '900001', brand: 'Dahua', model: 'IPC-TEST-1', grp: 'Видеонаблюдение', price: 25000, stock: 5 }]);
    await imp('complex', [{ sku: 'IPC-TEST-1', brand: 'Dahua', model: 'IPC-TEST-1', grp: 'Видеонаблюдение', price: 27000, stock: 3 }]);
    const dup = await jget('/api/admin/duplicates', { headers: H });
    const grp = (dup.groups || []).find(g => /IPC-TEST-1/i.test(g.model));
    ok('дубль Dahua IPC-TEST-1 найден в 2 источниках', !!grp && grp.sources.length >= 2);
    ok('в группе есть id для скрытия', !!grp && grp.items.every(i => i.id));
    ok('admin/duplicates без токена → 401', (await fetch(BASE + '/api/admin/duplicates')).status === 401);
    if (grp) {
      const victim = grp.items.find(i => i.source === 'complex');
      await jget('/api/admin/products/bulk', { method: 'POST', headers: H, body: JSON.stringify({ ids: [victim.id], action: 'hide' }) });
      const dup2 = await jget('/api/admin/duplicates', { headers: H });
      const g2 = (dup2.groups || []).find(g => /IPC-TEST-1/i.test(g.model));
      ok('после hide лишний помечен скрытым', !!g2 && g2.items.find(i => i.id === victim.id).visible === 0);
    }
  } catch (e) { console.error('SUPPLIER ОШИБКА:', e.message); fail++; }
  finally { try { srv.kill(); } catch (e) {} }

  console.log('\n════════════════════════════════');
  console.log('SUPPLIER-INTEGRATION: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})();
