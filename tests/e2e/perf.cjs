/* Регресс-гард производительности (Playwright): Core Web Vitals в бюджете на ключевых страницах.
 * Бюджеты: LCP ≤ 2500ms, CLS ≤ 0.1, картинки без размеров и без lazy = 0 (нет сдвигов).
 * Замер на localhost (без сети) — цифры «идеальные»; смысл — ловить РЕГРЕССИИ, не абсолют.
 * Запуск: BASE=http://localhost:PORT node tests/e2e/perf.cjs */
'use strict';
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  const fs = require('fs'), path = require('path'); let found;
  try { const npx = path.join(process.env.HOME || '', '.npm', '_npx'); for (const d of fs.readdirSync(npx)) { const c = path.join(npx, d, 'node_modules', 'playwright'); if (fs.existsSync(c)) { found = c; break; } } } catch (e2) {}
  if (found) ({ chromium } = require(found)); else { console.error('playwright не найден'); process.exit(3); }
}
const BASE = process.env.BASE || 'http://localhost:3000';
const LCP_BUDGET = 2500, CLS_BUDGET = 0.1;
let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n)); };

(async () => {
  const _r = await (await fetch(BASE + '/api/products?limit=1')).json();
  const sku = ((_r.items || _r) || [{}])[0].sku;
  const pages = [['главная', '/'], ['раздел', '/videonablyudenie.html'], ['товар', sku ? '/product/' + encodeURIComponent(sku) : '/']];
  const browser = await chromium.launch();
  for (const [label, path] of pages) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(BASE + path, { waitUntil: 'load' });
    await p.waitForTimeout(700);
    const m = await p.evaluate(() => new Promise(res => {
      let lcp = 0, cls = 0;
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch (e) {}
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) {}
      setTimeout(() => res({
        lcp: Math.round(lcp), cls: +cls.toFixed(3),
        imgsNoDim: [...document.images].filter(i => !i.getAttribute('width') && !i.getAttribute('height') && i.loading !== 'lazy').length,
      }), 400);
    }));
    console.log(`[${label}] LCP ${m.lcp}ms | CLS ${m.cls} | img без размеров/lazy ${m.imgsNoDim}`);
    ok(`${label}: LCP ≤ ${LCP_BUDGET}ms`, m.lcp > 0 && m.lcp <= LCP_BUDGET);
    ok(`${label}: CLS ≤ ${CLS_BUDGET}`, m.cls <= CLS_BUDGET);
    ok(`${label}: нет картинок без размеров и без lazy (CLS-риск)`, m.imgsNoDim === 0);
    await ctx.close();
  }
  await browser.close();
  console.log('\n════════════════════════════════');
  console.log('PERF: ПРОШЛО ' + pass + ', ПРОВАЛ ' + fail);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('PERF ОШИБКА:', e.message); process.exit(2); });
