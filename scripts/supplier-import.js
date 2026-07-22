#!/usr/bin/env node
'use strict';
/*
 * ОБОБЩЁННЫЙ АДАПТЕР ПРИЁМА ВТОРОГО ПОСТАВЩИКА (API) → каталог сайта.
 * Каркас по образцу scripts/alstyle-import.js. Заполните два TODO-места под конкретный API:
 *   1) fetchRawCatalog() — как ходить в API поставщика и получить список сырьевых элементов.
 *   2) mapProduct(el)   — как из элемента поставщика собрать наш товар.
 * Всё остальное (батчи, наценка, изоляция по источнику, деактивация ушедших) уже готово.
 *
 * Сценарий: поставщик даёт НОВЫЕ товары (не пересекаются с Al-Style). Товары льются в /api/import
 * под своим source=SUPPLIER_CODE; деактивация ушедших идёт ТОЛЬКО по этому источнику (чужой каталог цел).
 * Цена витрины: показываем РОЗНИЧНУЮ цену поставщика как есть, БЕЗ наценки — mapProduct кладёт её в price.
 * (Если позже понадобится наценка от закупа — задайте наценку у поставщика в админке и в pushBatch поставьте
 *  applyMarkup:true; сервер посчитает price = закуп × наценка для товаров без розничной цены.)
 *
 * Перед запуском:
 *   1) Заведите поставщика в админке (🏭 Поставщики → «Новый поставщик»): код = SUPPLIER_CODE.
 *   2) export SUPPLIER_CODE=... API_BASE=... API_KEY=... SITE_URL=... IMPORT_TOKEN=...
 *   3) node scripts/supplier-import.js --dry   # проверка маппинга без заливки
 *   4) node scripts/supplier-import.js          # боевая заливка
 *      FULL_SYNC=true node scripts/supplier-import.js   # + снять с показа ушедшие позиции этого поставщика
 */
const https = require('https');
const http = require('http');

const CFG = {
  SUPPLIER_CODE: process.env.SUPPLIER_CODE || '',              // код поставщика = source товаров (лат.)
  API_BASE:      process.env.API_BASE      || '',              // база API поставщика
  API_KEY:       process.env.API_KEY       || '',              // ключ доступа к API поставщика
  SITE_URL:      process.env.SITE_URL      || 'https://servis-catalog.onrender.com',
  IMPORT_TOKEN:  process.env.IMPORT_TOKEN  || 'PUT-IMPORT-TOKEN',
  BATCH:  Number(process.env.BATCH || 2000),
  FULL_SYNC: String(process.env.FULL_SYNC || 'false') === 'true',
  THROTTLE_MS: Number(process.env.THROTTLE_MS || 300),
  TIMEOUT: Number(process.env.TIMEOUT || 45000),
};
const args = process.argv.slice(2);
const DRY = args.includes('--dry');

// ─────────────── HTTP-хелперы
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let _lastApiCall = 0;
async function throttle() {
  const wait = CFG.THROTTLE_MS - (Date.now() - _lastApiCall);
  if (wait > 0) await sleep(wait);
  _lastApiCall = Date.now();
}
// GET к API поставщика (JSON). Подстройте авторизацию под конкретный API (query-ключ / заголовок Bearer / …).
function apiGet(pathOrUrl, params) {
  const url = new URL(/^https?:/i.test(pathOrUrl) ? pathOrUrl : (CFG.API_BASE.replace(/\/$/, '') + '/' + pathOrUrl));
  // TODO(авторизация): здесь ключ передаётся query-параметром. Если у поставщика Bearer — уберите строку ниже
  //                    и добавьте headers: { Authorization: 'Bearer ' + CFG.API_KEY }.
  if (CFG.API_KEY) url.searchParams.set('access-token', CFG.API_KEY);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers: { Accept: 'application/json' }, timeout: CFG.TIMEOUT }, (res) => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`API HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('Ответ API не JSON: ' + d.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Таймаут API поставщика')));
    req.on('error', reject); req.end();
  });
}
function httpPost(urlStr, headers, body) {
  const mod = urlStr.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(new URL(urlStr), { method: 'POST', headers, timeout: CFG.TIMEOUT }, (res) => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Сайт HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
        try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(new Error('Сайт вернул не JSON: ' + d.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Таймаут сайта')));
    req.on('error', reject); req.write(body); req.end();
  });
}
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };

// ─────────────── TODO 1: получить сырьё из API поставщика
// Верните массив «сырых» элементов товара (как их отдаёт поставщик). Пагинация/ветки — по документации API.
async function fetchRawCatalog() {
  if (!CFG.API_BASE) throw new Error('Не задан API_BASE (см. шапку файла). Заполните fetchRawCatalog() под API поставщика.');
  // ПРИМЕР (замените на реальные вызовы):
  //   const all = [];
  //   for (let offset = 0; ; offset += 250) {
  //     const r = await apiGet('products', { limit: 250, offset });
  //     const items = (r && r.data) || r || [];
  //     if (!items.length) break;
  //     all.push(...items);
  //   }
  //   return all;
  throw new Error('fetchRawCatalog() не реализован — заполните под конкретный API поставщика (см. TODO 1).');
}

// ─────────────── TODO 2: маппинг элемента поставщика → наш товар
// Ключевые поля: sku (обязателен, уникален у поставщика), brand, model, grp (раздел витрины),
// price — РОЗНИЧНАЯ цена поставщика (показываем как есть), stock, img.
// Доп.: cat, descr, res, images(массив URL), cat_id, attrs [{name,value}].
function mapProduct(el) {
  return {
    sku:   String(el.code || el.article || el.id || '').trim(),
    brand: el.brand || el.vendor || '',
    model: el.name || el.title || '',
    grp:   '',                        // TODO: раздел витрины (одна из 7 строк grp) — по категории поставщика
    cat:   el.category || '',
    descr: el.description || '',
    price: num(el.price_retail || el.retail || el.price || el.rrp), // РОЗНИЧНАЯ цена поставщика — показываем как есть
    stock: num(el.quantity || el.stock),
    img:   el.image || el.img || '',
    images: Array.isArray(el.images) ? el.images : undefined,
  };
}

// ─────────────── Заливка на сайт
async function pushBatch(products) {
  const body = JSON.stringify({ source: CFG.SUPPLIER_CODE, products, fullSync: false, applyMarkup: false });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/import';
  try { return await httpPost(url, headers, body); } catch (e) { await sleep(2000); return httpPost(url, headers, body); }
}
async function deactivateMissing(keepSkus) {
  const body = JSON.stringify({ source: CFG.SUPPLIER_CODE, keepSkus });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/import/deactivate';
  try { return await httpPost(url, headers, body); } catch (e) { await sleep(2000); return httpPost(url, headers, body); }
}

(async () => {
  try {
    if (!CFG.SUPPLIER_CODE) throw new Error('Не задан SUPPLIER_CODE (код поставщика). Заведите поставщика в админке и укажите его код.');
    console.log(`Сбор каталога поставщика «${CFG.SUPPLIER_CODE}»…`);
    const raw = await fetchRawCatalog();
    const products = raw.map(mapProduct).filter(p => p.sku);
    console.log('Всего к загрузке:', products.length);
    if (!products.length) { console.log('Пусто — проверьте fetchRawCatalog()/mapProduct().'); return; }
    if (DRY) { console.log('[--dry] Первые 3 после маппинга:\n' + JSON.stringify(products.slice(0, 3), null, 2)); return; }

    let created = 0, updated = 0, skipped = 0, deactivated = 0;
    for (let i = 0; i < products.length; i += CFG.BATCH) {
      const r = await pushBatch(products.slice(i, i + CFG.BATCH));
      created += r.created || 0; updated += r.updated || 0; skipped += r.skipped || 0;
      console.log(`  пачка ${Math.floor(i / CFG.BATCH) + 1}: +${r.created || 0} / ~${r.updated || 0}`);
    }
    if (CFG.FULL_SYNC) {
      const keepSkus = products.map(p => String(p.sku)).filter(Boolean);
      try { deactivated = (await deactivateMissing(keepSkus)).deactivated || 0; console.log(`  деактивация отсутствующих: снято с показа ${deactivated}`); }
      catch (e) { console.error('Деактивация отсутствующих не выполнена:', e.message); }
    }
    console.log(`Готово. Создано ${created}, обновлено ${updated}, снято с показа ${deactivated}, пропущено ${skipped}.`);
  } catch (e) { console.error('ОШИБКА:', e.message); process.exit(1); }
})();
