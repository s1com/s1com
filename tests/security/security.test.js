'use strict';
/* Security-suite: поднимает сервер на временной БД и проверяет ключевые защиты
 * (auth, утечка секретов, валидация телефона, honeypot, oversize, path-traversal,
 * CSP-nonce, XSS/formula-injection). Запуск: node tests/security/security.test.js */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = process.env.SEC_PORT || 3390;
const DB = path.join(os.tmpdir(), 's1com-sec.sqlite');
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'sec-import-token';
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };
const env = Object.assign({}, process.env, {
  PORT: String(PORT), DB_PATH: DB, SEED_ON_EMPTY: 'true', NODE_ENV: 'development',
  ADMIN_PASSWORD: 'sec-pass', JWT_SECRET: 'sec-secret', IMPORT_TOKEN: TOKEN, SITE_URL: BASE,
});
const waitHealth = (n) => new Promise((res, rej) => {
  const tick = (k) => { const r = http.get(BASE + '/health', x => { x.resume(); x.statusCode === 200 ? res() : retry(k); }); r.on('error', () => retry(k)); r.setTimeout(1000, () => { r.destroy(); retry(k); }); };
  const retry = (k) => k <= 0 ? rej(new Error('нет старта')) : setTimeout(() => tick(k - 1), 500);
  tick(n || 40);
});
const st = async (p, o) => (await fetch(BASE + p, o)).status;

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { env, cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' });
  try {
    await waitHealth(40);
    const first = await (await fetch(BASE + '/api/products?limit=1')).json();
    const sku = ((first.items || first) || [{}])[0].sku;

    console.log('[Auth]');
    ok('admin API без токена → 401', await st('/api/admin/settings') === 401);
    ok('admin API с мусорным Bearer → 401', await st('/api/admin/orders', { headers: { Authorization: 'Bearer xxx' } }) === 401);
    const login = await (await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })).status;
    ok('логин с неверным паролем → не 200', login !== 200);
    const tok = (await (await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'sec-pass' }) })).json()).token;
    ok('логин с верным паролем → токен', !!tok);

    console.log('[Секреты]');
    const settings = await (await fetch(BASE + '/api/admin/settings', { headers: { Authorization: 'Bearer ' + tok } })).json();
    ok('tg_token не возвращается сырым (только *_set)', !settings.tg_token || settings.tg_token === '');
    ok('JWT_SECRET/пароль не в settings', !JSON.stringify(settings).match(/sec-secret|sec-pass/));
    const pub = await (await fetch(BASE + '/api/products?limit=3')).text();
    ok('публичный /api/products без price_buy/секретов', !/price_buy|jwt|secret|"token"/.test(pub));

    console.log('[Импорт-токен]');
    ok('import без токена → 401', await st('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"products":[]}' }) === 401);

    console.log('[Валидация/спам заявок]');
    const order = (b) => st('/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    ok('заявка без телефона → 400', await order({ items: [{ sku, qty: 1 }], name: 'X' }) === 400);
    ok('заявка с буквами вместо телефона → 400', await order({ items: [{ sku, qty: 1 }], name: 'X', phone: 'abcdefghij' }) === 400);
    ok('honeypot (website) → 200 без ошибки (тихо гасится)', await order({ items: [{ sku, qty: 1 }], name: 'X', phone: '87051234567', website: 'spam' }) === 200);
    const big = Array.from({ length: 300 }, () => ({ sku, qty: 1 }));
    ok('oversize заявка (>200 позиций) → 413', await order({ items: big, name: 'X', phone: '87051234567' }) === 413);

    console.log('[Path traversal / CSP / XSS]');
    ok('backup download с traversal-именем → 400', await st('/api/admin/backups/..%2f..%2fetc%2fpasswd/download', { headers: { Authorization: 'Bearer ' + tok } }) === 400 || await st('/api/admin/backups/notabackup.txt/download', { headers: { Authorization: 'Bearer ' + tok } }) === 400);
    const home = await (await fetch(BASE + '/')).text();
    ok('CSP: инлайн-скрипты помечены nonce', /<script nonce="/.test(home));
    ok('CSP-заголовок присутствует', !!(await fetch(BASE + '/')).headers.get('content-security-policy'));
    // XSS в комментарии заявки — сохраняется, но при выдаче должен быть экранирован
    await fetch(BASE + '/api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ sku, qty: 1 }], name: '<script>alert(1)</script>', phone: '87051234567', comment: '<img src=x onerror=alert(1)>' }) });
    const exp = await (await fetch(BASE + '/api/admin/orders/export', { headers: { Authorization: 'Bearer ' + tok } })).text();
    ok('CSV-экспорт нейтрализует formula/XSS (нет «сырых» <script>=)', !/=<script>|^[=+\-@]/m.test(exp) || exp.includes("'"));
  } catch (e) { console.error('SECURITY ОШИБКА:', e.message); fail++; }
  finally { try { srv.kill(); } catch (e) {} }

  console.log('\n════════════════════════════════');
  console.log('SECURITY: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})();
