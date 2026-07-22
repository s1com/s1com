#!/usr/bin/env node
'use strict';
/*
 * complex-photos.js — дозаливка ФОТО для товаров поставщика Complex.
 *
 * Зачем: API Complex (products_json) фото НЕ отдаёт (поля только name/brand/model/qty/цены),
 * поэтому после complex-import товары стоят без картинок. Фото есть на витрине поставщика
 * complex.com.kz (OpenCart). Скрипт по КАЖДОЙ модели ищет её карточку на витрине, берёт
 * фото товара (с проверкой, что нашли именно эту модель) и обновляет img на нашем сайте
 * через тот же /api/import (ключ склейки — sku=model, как в complex-import).
 *
 * НЕ трогает боевой complex-import.js: переиспользует только его чистую функцию buildProducts
 * (тот же список товаров/маппинг брендов), а поиск фото и заливку делает сам.
 *
 * Соответствие (защита от чужого фото): берём фото, ТОЛЬКО если заголовок карточки на витрине
 * содержит нашу модель (нормализованное сравнение). Не совпало — товар пропускаем (без фото
 * лучше, чем чужое фото). Вежливый rate-limit к сайту поставщика (DELAY, по умолчанию 600 мс).
 *
 * ЗАПУСК:
 *   export COMPLEX_API_KEY=…; export SITE_URL=https://servis-catalog.onrender.com; export IMPORT_TOKEN=…
 *   PHOTO_LIMIT=20 node scripts/complex-photos.js --dry   # проба на 20 товарах: что нашлось, без записи
 *   node scripts/complex-photos.js                        # боевая дозаливка фото (только найденные)
 *   DELAY=800 node scripts/complex-photos.js              # мягче к сайту поставщика
 */
const { buildProducts, BRAND_MAP, normBrand } = require('./complex-import');

const CFG = {
  API_URL:      process.env.COMPLEX_API_URL || 'https://complex.com.kz/index.php?route=api/b2b/products_json',
  API_KEY:      process.env.COMPLEX_API_KEY  || '',
  SITE_URL:     process.env.SITE_URL         || 'https://servis-catalog.onrender.com',
  IMPORT_TOKEN: process.env.IMPORT_TOKEN     || '',
  STORE:        (process.env.COMPLEX_STORE || 'https://complex.com.kz').replace(/\/$/, ''),
  DELAY:        Number(process.env.DELAY || 600),        // пауза между товарами (мс) — вежливость к витрине
  BATCH:        Number(process.env.BATCH || 500),        // размер пачки заливки на наш сайт
  LIMIT:        Number(process.env.PHOTO_LIMIT || 0),    // 0 = все; >0 — только первые N (для пробы)
  UA:           'Mozilla/5.0 (Windows NT 10.0; Win64; x64) s1com-catalog-photos',
};
const DRY = process.argv.slice(2).includes('--dry');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Нормализация для сравнения модели с заголовком витрины: только буквы/цифры, нижний регистр.
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-zа-я0-9]/gi, '');

// Логотипы/иконки/заглушки витрины — это НЕ фото товара.
const NOT_A_PRODUCT_IMG = /logo|cards|new-icon|404|mobilelogo|flag|placeholder|no[_-]?image|sprite|banner|payment/i;

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': CFG.UA, 'Accept': 'text/html' }, redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// Забрать сырой каталог Complex (тот же источник, что у импорта) — чтобы прогнать ровно те же товары.
async function fetchRawCatalog() {
  if (!CFG.API_KEY) throw new Error('Не задан COMPLEX_API_KEY.');
  const url = CFG.API_URL + (CFG.API_URL.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(CFG.API_KEY);
  const res = await fetch(url, { headers: { 'User-Agent': CFG.UA, 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('Каталог Complex HTTP ' + res.status);
  const data = await res.json();
  return (data && Array.isArray(data.products)) ? data.products : (Array.isArray(data) ? data : []);
}

// Карта брендов: с нашего сайта (админка) → fallback на встроенный BRAND_MAP импорта.
async function loadBrandMap() {
  let list = BRAND_MAP.map(([brand, section, on]) => ({ brand, section, on }));
  let skipNoPrice = true;
  try {
    const res = await fetch(CFG.SITE_URL.replace(/\/$/, '') + '/api/supplier-config/complex', { headers: { 'User-Agent': CFG.UA } });
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.brands) && data.brands.length) {
        list = data.brands.map(b => ({ brand: normBrand(b.brand), section: String(b.section || ''), on: b.on !== false }));
        if (typeof data.skipNoPrice === 'boolean') skipNoPrice = data.skipNoPrice;
      }
    }
  } catch { /* fallback на встроенный BRAND_MAP */ }
  const byBrand = new Map();
  for (const b of list) if (b.on && b.section) byBrand.set(b.brand.toLowerCase(), b.section);
  return { skipNoPrice, byBrand, list };
}

// Извлечь URL фото товара из HTML страницы витрины. Возвращает полный оригинальный URL или ''.
// Приоритет: картинка, чьё имя файла содержит нашу модель; иначе — первая не-логотип.
function pickImage(html, sku) {
  const re = /image\/(?:cache\/)?catalog\/[A-Za-z0-9/_.\-]+?\.(?:jpg|jpeg|png|webp)/gi;
  const seen = new Set(); const cands = [];
  let m;
  while ((m = re.exec(html))) {
    let p = m[0];
    if (NOT_A_PRODUCT_IMG.test(p)) continue;
    // привести к оригиналу: убрать cache/ и суффикс размера -WxH перед расширением
    const orig = p.replace(/^image\/cache\//, 'image/').replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
    if (seen.has(orig)) continue;
    seen.add(orig);
    cands.push(orig);
  }
  if (!cands.length) return '';
  const nsku = norm(sku);
  const byName = cands.find(u => nsku.length >= 4 && norm(u.split('/').pop()).includes(nsku));
  const chosen = byName || cands[0];
  return CFG.STORE + '/' + chosen.replace(/^\//, '');
}

// Заголовок карточки витрины (для проверки соответствия модели).
function pageTitle(html) {
  const h1 = html.match(/<h1[^>]*>([^<]+)</i);
  if (h1) return h1[1];
  const t = html.match(/<title>([^<]+)</i);
  return t ? t[1] : '';
}

// Найти фото для одной модели: поиск на витрине → страница первого товара → проверка модели → фото.
async function findPhoto(sku) {
  const searchUrl = CFG.STORE + '/index.php?route=product/search&search=' + encodeURIComponent(sku);
  let html;
  try { html = await getText(searchUrl); } catch { return { ok: false, reason: 'search-fail' }; }
  const ids = [...html.matchAll(/product_id=(\d+)/g)].map(x => x[1]);
  if (!ids.length) return { ok: false, reason: 'not-found' };
  // страница первого товара
  let phtml;
  try { phtml = await getText(CFG.STORE + '/index.php?route=product/product&product_id=' + ids[0]); }
  catch { return { ok: false, reason: 'product-fail' }; }
  const title = pageTitle(phtml);
  // проверка соответствия: заголовок карточки должен содержать нашу модель
  if (norm(sku).length >= 4 && !norm(title).includes(norm(sku))) return { ok: false, reason: 'mismatch', title };
  const img = pickImage(phtml, sku);
  if (!img) return { ok: false, reason: 'no-img', title };
  return { ok: true, img, title };
}

async function pushBatch(products) {
  const body = JSON.stringify({ source: 'complex', products, fullSync: false, applyMarkup: false });
  const res = await fetch(CFG.SITE_URL.replace(/\/$/, '') + '/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': 'Bearer ' + CFG.IMPORT_TOKEN },
    body,
  });
  if (!res.ok) throw new Error('Сайт HTTP ' + res.status + ': ' + (await res.text()).slice(0, 150));
  return res.json().catch(() => ({}));
}

(async () => {
  try {
    const map = await loadBrandMap();
    const raw = await fetchRawCatalog();
    const { products } = buildProducts(raw, map);
    let list = products;
    if (process.env.SKUS) {                                   // точечная проба по конкретным моделям (через запятую)
      const want = new Set(process.env.SKUS.split(',').map(s => s.trim().toLowerCase()));
      list = products.filter(p => want.has(String(p.sku).toLowerCase()));
    }
    if (CFG.LIMIT > 0) list = list.slice(0, CFG.LIMIT);
    console.log(`Товаров Complex к обработке: ${list.length}${CFG.LIMIT ? ` (проба, PHOTO_LIMIT=${CFG.LIMIT})` : ''}. Пауза ${CFG.DELAY} мс/товар.`);
    console.log(DRY ? '⚙️  РЕЖИМ --dry: фото ищем, но на сайт НЕ пишем.\n' : '⚙️  БОЕВОЙ режим: найденные фото зальются на сайт.\n');

    const found = [];
    const reasons = {};
    let done = 0;
    for (const p of list) {
      const r = await findPhoto(p.sku);
      done++;
      if (r.ok) { p.img = r.img; found.push(p); }
      else reasons[r.reason] = (reasons[r.reason] || 0) + 1;
      if (done <= 8 || done % 50 === 0) {
        const tag = r.ok ? '✅ ' + r.img.slice(CFG.STORE.length) : '— ' + r.reason;
        console.log(`  [${done}/${list.length}] ${p.brand} ${p.sku} → ${tag}`);
      }
      await sleep(CFG.DELAY);
    }

    console.log(`\n=== ИТОГ ПОИСКА ===`);
    console.log(`Обработано: ${list.length} · фото найдено: ${found.length} (${Math.round(found.length / list.length * 100)}%)`);
    console.log('Не найдено по причинам:', Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(', ') || '—');

    if (!found.length) { console.log('\nНечего заливать.'); return; }
    if (DRY) {
      console.log('\nПримеры найденных фото (до 10):');
      found.slice(0, 10).forEach(p => console.log(`  • ${p.brand} ${p.model} (${p.sku})\n      ${p.img}`));
      console.log('\n--dry: на сайт НЕ писали. Боевой прогон — node scripts/complex-photos.js');
      return;
    }

    let updated = 0;
    for (let i = 0; i < found.length; i += CFG.BATCH) {
      const r = await pushBatch(found.slice(i, i + CFG.BATCH));
      updated += (r.updated || 0) + (r.created || 0);
      console.log(`  пачка ${Math.floor(i / CFG.BATCH) + 1}: обновлено ~${(r.updated || 0) + (r.created || 0)}`);
    }
    console.log(`\nГотово. Фото проставлено у ~${updated} товаров Complex.`);
  } catch (e) { console.error('ОШИБКА:', e.message); process.exit(1); }
})();
