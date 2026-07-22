/* Самодостаточный запуск браузерного E2E: поднимает сервер на временной БД (с сидом),
 * ждёт /health, прогоняет tests/e2e/smoke.cjs через реальный Chromium, гасит сервер.
 * Требует установленный Playwright (npm i -D playwright && npx playwright install chromium).
 * Запуск: npm run test:e2e */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = process.env.E2E_PORT || 3399;
const DB = path.join(os.tmpdir(), 's1com-e2e.sqlite');
const BASE = `http://localhost:${PORT}`;

const env = Object.assign({}, process.env, {
  PORT: String(PORT), DB_PATH: DB, SEED_ON_EMPTY: 'true', NODE_ENV: 'development',
  ADMIN_PASSWORD: 'e2e-test-pass', JWT_SECRET: 'e2e-test-secret', IMPORT_TOKEN: 'e2e-test-token',
  SITE_URL: BASE,
});

function waitHealth(tries) {
  return new Promise((resolve, reject) => {
    const tick = (n) => {
      const req = http.get(BASE + '/health', (r) => { r.resume(); r.statusCode === 200 ? resolve() : retry(n); });
      req.on('error', () => retry(n));
      req.setTimeout(1000, () => { req.destroy(); retry(n); });
    };
    const retry = (n) => n <= 0 ? reject(new Error('сервер не поднялся')) : setTimeout(() => tick(n - 1), 500);
    tick(tries || 30);
  });
}

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { env, cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' });
  let code = 1;
  try {
    await waitHealth(40);
    code = 0;
    const specs = ['smoke.cjs', 'order-flow.cjs', 'cabinet.cjs', 'favorites.cjs', 'roles-widths.cjs', 'a11y-keyboard.cjs', 'corp-journey.cjs', 'perf.cjs', 'conversion.cjs', 'match-admin.cjs', 'articles.cjs']; // +кабинет +избранное +склейка дублей +«Полезное»
    for (const spec of specs) {
      const rc = await new Promise((resolve) => {
        const t = spawn(process.execPath, [path.join(__dirname, spec)], {
          env: Object.assign({}, process.env, { BASE, ADMIN_PASSWORD: env.ADMIN_PASSWORD, IMPORT_TOKEN: env.IMPORT_TOKEN }), stdio: 'inherit',
        });
        t.on('exit', (c) => resolve(c == null ? 1 : c));
      });
      if (rc !== 0) code = rc;
    }
  } catch (e) { console.error('E2E runner:', e.message); code = 2; }
  finally { try { srv.kill(); } catch (e) {} }
  process.exit(code);
})();
