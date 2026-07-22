#!/usr/bin/env node
'use strict';
/*
 * complex-import.js — приём каталога поставщика Complex (complex.com.kz) → каталог сайта «Сервис.com».
 * API: GET https://complex.com.kz/index.php?route=api/b2b/products_json&api_key=<КЛЮЧ>  (JSON, один запрос — весь каталог).
 * Поля товара: name (наименование), model (=артикул), brand, quantity (остаток), price_rrc (розница), price_client (клиентская).
 *
 * ЧТО ГРУЗИМ РЕШАЕТ КАРТА БРЕНДОВ: бренд → раздел сайта + вкл/выкл. Основной источник карты — админка
 * (suppliers.config, поле brands; берётся с сайта через /api/supplier-config/complex). Встроенный BRAND_MAP — FALLBACK
 * (когда сайт недоступен, напр. локальный --dry). Бренда нет в карте или он выключен → товары пропускаются.
 *
 * Цена витрины: показываем РОЗНИЧНУЮ price_rrc как есть, БЕЗ наценки. sku = model (артикул поставщика).
 * source='complex' — полный импорт/деактивация не трогают чужой ассортимент (Al-Style и т.д.).
 *
 * ЗАПУСК:
 *   export COMPLEX_API_KEY="ключ"; export SITE_URL="https://servis-catalog.onrender.com"; export IMPORT_TOKEN="токен"
 *   node scripts/complex-import.js --dry     # проверка маппинга БЕЗ записи: что зальётся, по разделам + примеры (нужен только COMPLEX_API_KEY)
 *   node scripts/complex-import.js           # боевая заливка
 *   FULL_SYNC=true node scripts/complex-import.js   # + снять с показа ушедшие позиции Complex
 */
const https = require('https');
const http = require('http');

const CFG = {
  SUPPLIER_CODE: 'complex',
  API_URL:      process.env.COMPLEX_API_URL || 'https://complex.com.kz/index.php?route=api/b2b/products_json',
  API_KEY:      process.env.COMPLEX_API_KEY  || '',
  SITE_URL:     process.env.SITE_URL         || 'https://servis-catalog.onrender.com',
  IMPORT_TOKEN: process.env.IMPORT_TOKEN     || 'PUT-IMPORT-TOKEN',
  BATCH:  Number(process.env.BATCH || 2000),
  FULL_SYNC: String(process.env.FULL_SYNC || 'false') === 'true',
  AUTO_MERGE: String(process.env.AUTO_MERGE || 'false') === 'true', // склеивать дубли сразу после импорта (только совпавшие по EAN)
  SKIP_NO_PRICE: !(String(process.env.SKIP_NO_PRICE || 'true') === 'false'), // по умолчанию пропускаем товары без цены
  TIMEOUT: Number(process.env.TIMEOUT || 60000),
};
const args = process.argv.slice(2);
const DRY = args.includes('--dry');

// ─────────────── FALLBACK карта брендов (используется, если сайт не отдал свою через /api/supplier-config).
// section — точное имя раздела витрины (products.grp / sections.name). on:false — бренд не грузим.
const BRAND_MAP = [
  ['Dahua',              'Видеонаблюдение', true],
  ['Hikvision',          'Видеонаблюдение', true],
  ['Uniview',            'Видеонаблюдение', true],
  ['IMOU',               'Видеонаблюдение', true],
  ['Uniarch',            'Видеонаблюдение', true],
  ['EVO',                'Видеонаблюдение', true],
  ['Wi-Tek',             'Сетевое оборудование', true],
  ['Ubiquiti',           'Сетевое оборудование', true],
  ['Akuvox',             'СКУД и домофония', true],
  ['ZKTeco',             'СКУД и домофония', true],
  ['Ajax',               'Пожарная безопасность', true],
  ['Seagate',            'Серверное оборудование и СХД', true],
  ['Western Digital',    'Серверное оборудование и СХД', true],
  ['Schneider Electric', 'Электротехника', true],
  ['IEK',                'Электротехника', true],
  ['ITK',                'Кабельные системы', true],
  ['Yealink',            '', false],
  ['Yeastar',            '', false],
  ['SHIP',               'Кабельные системы', false],
];

// ─────────────── HTTP-хелперы
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const normBrand = (b) => String(b == null ? '' : b).trim();
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };

// Заголовок карточки = «бренд + model», а артикул показывается отдельно («арт. sku»). Complex `name` часто идёт
// как «<артикул> [бренд] <описание>» → в заголовке задваивается бренд и артикул. Чистим: убираем ведущий
// артикул-код (если он с цифрой — значит код, а не слова вроде «Ajax Hub») и дублирующий ведущий бренд.
function cleanTitle(name, brand, sku) {
  let t = String(name || '').replace(/\s+/g, ' ').trim();
  const b = String(brand || '').trim();
  const s = String(sku || '').trim();
  const isCode = /\d/.test(s); // артикул с цифрой убираем из заголовка; чисто-словесный (Ajax Hub) оставляем
  const strip = (str, pre) => str.slice(pre.length).replace(/^[\s\-–—:·|,]+/, '');
  for (let i = 0; i < 4; i++) {
    const before = t;
    if (b && t.toLowerCase().startsWith(b.toLowerCase())) t = strip(t, b);
    else if (isCode && s && t.toLowerCase().startsWith(s.toLowerCase())) t = strip(t, s);
    if (t === before) break;
  }
  t = t.replace(/\s+/g, ' ').trim();
  return t || String(name || '').trim() || (b + ' ' + s).trim();
}

function httpGetJson(urlStr) {
  const mod = urlStr.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(new URL(urlStr), { method: 'GET', headers: { Accept: 'application/json' }, timeout: CFG.TIMEOUT }, (res) => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('Ответ не JSON: ' + d.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Таймаут запроса')));
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

// ─────────────── Карта брендов: с сайта (админка) → fallback на встроенную. Возвращает { skipNoPrice, byBrand:Map }.
async function loadBrandMap() {
  let list = BRAND_MAP.map(([brand, section, on]) => ({ brand, section, on }));
  let skipNoPrice = CFG.SKIP_NO_PRICE;
  try {
    const data = await httpGetJson(CFG.SITE_URL.replace(/\/$/, '') + '/api/supplier-config/' + CFG.SUPPLIER_CODE);
    if (data && Array.isArray(data.brands) && data.brands.length) {
      list = data.brands.map(b => ({ brand: normBrand(b.brand), section: String(b.section || ''), on: b.on !== false }));
      if (typeof data.skipNoPrice === 'boolean') skipNoPrice = data.skipNoPrice;
      console.log(`Карта брендов с сайта: ${list.length} записей.`);
    } else {
      console.log('  Сайт не отдал карту брендов — использую встроенный BRAND_MAP.');
    }
  } catch (e) { console.log('  /api/supplier-config недоступен (' + e.message + ') — встроенный BRAND_MAP.'); }
  const byBrand = new Map();
  for (const b of list) if (b.on && b.section) byBrand.set(b.brand.toLowerCase(), b.section);
  return { skipNoPrice, byBrand, list };
}

// ─────────────── Забрать сырой каталог Complex (один запрос — весь список).
async function fetchRawCatalog() {
  if (!CFG.API_KEY) throw new Error('Не задан COMPLEX_API_KEY.');
  const url = CFG.API_URL + (CFG.API_URL.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(CFG.API_KEY);
  const data = await httpGetJson(url);
  const items = (data && Array.isArray(data.products)) ? data.products : (Array.isArray(data) ? data : []);
  console.log(`Каталог Complex: ${items.length} товаров (updated: ${data && data.updated || '—'}).`);
  return items;
}

// ─────────────── Маппинг + фильтрация по карте брендов. Возвращает { products, stats }.
function buildProducts(raw, map) {
  const out = [];
  const stats = { total: raw.length, kept: 0, noBrand: 0, brandOff: 0, noPrice: 0, noSku: 0, bySection: {}, skippedBrands: {} };
  for (const el of raw) {
    const sku = String(el.model == null ? '' : el.model).trim();
    if (!sku) { stats.noSku++; continue; }
    const brand = normBrand(el.brand);
    const section = map.byBrand.get(brand.toLowerCase());
    if (!section) {
      if (!brand) stats.noBrand++; else { stats.brandOff++; stats.skippedBrands[brand] = (stats.skippedBrands[brand] || 0) + 1; }
      continue;
    }
    const price = num(el.price_rrc);
    if (price <= 0 && map.skipNoPrice) { stats.noPrice++; continue; }
    const fullName = String(el.name || '').replace(/\s+/g, ' ').trim();
    out.push({
      sku,
      brand,
      model: cleanTitle(fullName, brand, sku).slice(0, 200), // чистый заголовок (бренд/артикул показаны отдельно)
      grp: section,
      cat: section,
      descr: fullName.slice(0, 500), // полное название → описание/поиск (у Complex нет отдельного descr)
      price,
      stock: num(el.quantity),
      img: '',
      // --- сырьё для оффера (в products игнорируется, уходит в /api/offers-sync для склейки дублей) ---
      // У Complex model = артикул производителя → он же MPN, ключ склейки с Al-Style (article_pn). EAN API не отдаёт.
      _buy: num(el.price_client), _rrp: price, _pn: sku, _ean: '',
    });
    stats.kept++;
    stats.bySection[section] = (stats.bySection[section] || 0) + 1;
  }
  // дедуп по sku (модель): оставляем с ценой, при равенстве — с большим остатком
  const byKey = new Map();
  for (const p of out) {
    const k = p.sku.toLowerCase();
    const ex = byKey.get(k);
    if (!ex || (p.price > 0 && ex.price <= 0) || (p.price === ex.price && p.stock > ex.stock)) byKey.set(k, p);
  }
  const deduped = [...byKey.values()];
  stats.dups = out.length - deduped.length;
  return { products: deduped, stats };
}

// ─────────────── Заливка на сайт
async function pushBatch(products) {
  const body = JSON.stringify({ source: CFG.SUPPLIER_CODE, products, fullSync: false, applyMarkup: false });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/import';
  try { return await httpPost(url, headers, body); } catch (e) { await sleep(2000); return httpPost(url, headers, body); }
}
// Офферы Complex → слой offers (сырьё для склейки дублей между поставщиками, lib/matching.js).
// Изолировано от /api/import: витрину не трогает, ошибка не валит импорт.
async function pushOffers(products) {
  const offers = products.map(p => ({
    ext_id: String(p.sku), ext_category: '',
    brand: p.brand || '', mpn: p._pn || String(p.sku), ean: p._ean || '',
    name: p.model || '', price_buy: p._buy || 0, price_rrp: p._rrp || 0, stock: p.stock || 0,
  }));
  let upserted = 0;
  for (let i = 0; i < offers.length; i += CFG.BATCH) {
    const body = JSON.stringify({ supplier: CFG.SUPPLIER_CODE, offers: offers.slice(i, i + CFG.BATCH) });
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
    const r = await httpPost(CFG.SITE_URL.replace(/\/$/, '') + '/api/offers-sync', headers, body);
    upserted += (r && r.upserted) || 0;
  }
  // Здоровье ключей склейки — как в alstyle-import. У Complex EAN нет (API его не отдаёт), поэтому
  // единственный ключ — бренд+артикул (model): если он вдруг опустеет, дубли перестанут находиться молча.
  const withMpn = offers.filter(o => o.mpn && String(o.mpn).length >= 4).length;
  const pct = offers.length ? Math.round(withMpn * 100 / offers.length) + '%' : '0%';
  console.log(`  ключи склейки: артикул производителя у ${withMpn} (${pct}); EAN у Complex нет → дубли идут в очередь админки`);
  if (!withMpn) console.log('  ⚠️ артикулы пусты → склейка дублей с Al-Style работать НЕ будет.');
  return upserted;
}
// Авто-склейка дублей после импорта (только надёжные, по EAN; спорные — в очередь админки).
// Выключено по умолчанию: включать ENV AUTO_MERGE=true. У Complex EAN нет → его дубли идут в очередь.
async function autoMerge() {
  if (!CFG.AUTO_MERGE) return;
  const body = '{}';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  try {
    const r = await httpPost(CFG.SITE_URL.replace(/\/$/, '') + '/api/match/auto', headers, body);
    console.log(`  авто-склейка дублей: склеено ${(r && r.merged) || 0}, в очередь ${(r && r.queued) || 0}`);
  } catch (e) { console.error('  авто-склейка не выполнена:', e.message); }
}
async function deactivateMissing(keepSkus) {
  const body = JSON.stringify({ source: CFG.SUPPLIER_CODE, keepSkus });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/import/deactivate';
  try { return await httpPost(url, headers, body); } catch (e) { await sleep(2000); return httpPost(url, headers, body); }
}

// Экспорт чистых функций для unit-тестов; боевой прогон — только при прямом запуске (не при require).
module.exports = { cleanTitle, buildProducts, normBrand, num, BRAND_MAP };

if (require.main === module) (async () => {
  try {
    const map = await loadBrandMap();
    const enabled = [...map.byBrand.entries()].map(([b, s]) => `${b}→${s}`);
    console.log(`Включённых брендов: ${enabled.length}. Пропуск без цены: ${map.skipNoPrice}.`);
    const raw = await fetchRawCatalog();
    const { products, stats } = buildProducts(raw, map);

    console.log(`\n=== МАППИНГ ===`);
    console.log(`Всего в каталоге: ${stats.total}`);
    console.log(`К заливке (после карты/цены/дедупа): ${products.length}`);
    console.log(`Пропущено: без бренда ${stats.noBrand}, бренд выключен ${stats.brandOff}, без цены ${stats.noPrice}, без артикула ${stats.noSku}, дублей склеено ${stats.dups}`);
    console.log('\nПо разделам:');
    for (const [s, n] of Object.entries(stats.bySection).sort((a, b) => b[1] - a[1])) console.log(`  ${s}: ${n}`);
    const offTop = Object.entries(stats.skippedBrands).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (offTop.length) { console.log('\nПропущенные бренды (выключены/нет в карте), топ:'); offTop.forEach(([b, n]) => console.log(`  ${b}: ${n}`)); }

    if (DRY) {
      console.log('\nПримеры к заливке (5):');
      products.slice(0, 5).forEach(p => console.log(`  • [${p.grp}] ${p.brand} ${p.model} (арт. ${p.sku}) — ${p.price ? p.price + ' ₸' : 'по запросу'}, ост. ${p.stock}`));
      try { require('fs').writeFileSync('complex-dry.json', JSON.stringify(products, null, 1)); console.log(`\nДамп ${products.length} тов. → complex-dry.json`); } catch (e) { console.log('Дамп не записан:', e.message); }
      console.log('\nЗаписи на сайт НЕ было (--dry). Боевой прогон — node scripts/complex-import.js');
      return;
    }

    if (!products.length) { console.log('Нечего заливать.'); return; }
    let created = 0, updated = 0, skipped = 0, deactivated = 0;
    for (let i = 0; i < products.length; i += CFG.BATCH) {
      const r = await pushBatch(products.slice(i, i + CFG.BATCH));
      created += r.created || 0; updated += r.updated || 0; skipped += r.skipped || 0;
      console.log(`  пачка ${Math.floor(i / CFG.BATCH) + 1}: +${r.created || 0} / ~${r.updated || 0}`);
    }
    // Офферы — после товаров: offers-sync привязывает оффер к product_id по sku, товары уже в базе.
    try { console.log(`  офферы синхронизированы: ${await pushOffers(products)}`); }
    catch (e) { console.error('  офферы не синхронизированы (склейка дублей их не увидит):', e.message); }
    if (CFG.FULL_SYNC) {
      const keepSkus = products.map(p => String(p.sku)).filter(Boolean);
      try { deactivated = (await deactivateMissing(keepSkus)).deactivated || 0; console.log(`  деактивация отсутствующих: снято с показа ${deactivated}`); }
      catch (e) { console.error('Деактивация отсутствующих не выполнена:', e.message); }
    }
    await autoMerge(); // после офферов: склейке нужны свежие ключи (без AUTO_MERGE — ничего не делает)
    console.log(`Готово. Создано ${created}, обновлено ${updated}, снято с показа ${deactivated}, пропущено ${skipped}.`);
  } catch (e) { console.error('ОШИБКА:', e.message); process.exit(1); }
})();
