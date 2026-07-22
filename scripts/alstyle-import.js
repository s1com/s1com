#!/usr/bin/env node
/**
 * alstyle-import.js — синхронизация каталога Al-Style → сайт «Сервис.com» (POST /api/import).
 * API: https://api.al-style.kz/api/  (GET, ключ access-token в параметре).
 *
 * ГРУППЫ: ниже в BRANCH_MAP перечислены ветки каталога Al-Style (по ID раздела) и то,
 * в какую категорию сайта они попадают. Скрипт сам забирает ВСЕ подкатегории ветки
 * (по дереву) и присваивает товарам нужную группу. Чтобы добавить/убрать раздел —
 * правьте только BRANCH_MAP (ID берутся из метода /categories).
 *
 * ЗАПУСК:
 *   export ALSTYLE_API_KEY="ключ"; export SITE_URL="https://servis-com.kz"; export IMPORT_TOKEN="токен"
 *   node scripts/alstyle-import.js --tree      # разведка: всё дерево категорий Al-Style с ID → categories_full.txt
 *   node scripts/alstyle-import.js --tree сервер освещ электро   # + совпадения по словам в консоль
 *   node scripts/alstyle-import.js --stock     # быстрая синхронизация ТОЛЬКО остатков (/quantity-price)
 *   node scripts/alstyle-import.js --plan      # сколько товаров по каждой группе (без заливки, 1 запрос)
 *   node scripts/alstyle-import.js --dry       # оценка обогащения attrs БЕЗ записи: сколько товаров с ТТХ + примеры (нужен только ALSTYLE_API_KEY)
 *   node scripts/alstyle-import.js --probe     # показать примеры готовых товаров (без заливки)
 *   node scripts/alstyle-import.js             # боевая заливка
 *   FULL_SYNC=true node scripts/alstyle-import.js   # + снять с показа то, чего больше нет (своего источника)
 */

'use strict';
const https = require('https');

// ─────────────── Ветки Al-Style → категории сайта.
// ⚠️ Основной источник теперь — админка (таблица sections, поле «Ветки Al-Style»), импорт берёт их
// через /api/sections. Этот BRANCH_MAP — FALLBACK (если /api/sections недоступен или пуст).
const BRANCH_MAP = [
  // [ID раздела Al-Style, 'Категория на сайте']
  [3732,  'Видеонаблюдение'],                                 // Системы видеонаблюдения (IP, HD, Wi-Fi, регистраторы)
  [3745,  'Видеонаблюдение'],                                 // Аксессуары (кронштейны, коробки, БП, ИК)
  [5652,  'Пожарная безопасность'],                           // Охранные и пожарные системы
  [5650,  'СКУД и домофония'],                                // Системы контроля доступа (+видеодомофония)
  [3539,  'Источники бесперебойного питания (ИБП)'],          // ИБП
  [3423,  'Источники бесперебойного питания (ИБП)'],          // Стабилизаторы напряжения
  // Сетевое — урезанное ядро (а не вся ветка 3451 на 1500 шт):
  [3458,  'Сетевое оборудование'],                            // Коммутаторы
  [3459,  'Сетевое оборудование'],                            // Маршрутизаторы
  [3455,  'Сетевое оборудование'],                            // Wi-Fi точки доступа
  [3454,  'Сетевое оборудование'],                            // PoE адаптеры
  [3465,  'Сетевое оборудование'],                            // Трансиверы
  // Кабель — только нужное (а не вся ветка 21516 с лотками/фасониной):
  [3708,  'Кабельные системы'],                               // Витая пара
  [3707,  'Кабельные системы'],                               // Патч-корды
  [3710,  'Кабельные системы'],                               // Коннекторы
  [3595,  'Кабельные системы'],                               // Компоненты оптоволоконной сети
  // Серверы и СХД:
  [5739,  'Серверное оборудование и СХД'],
  [21689, 'Серверное оборудование и СХД'],
  [21788, 'Серверное оборудование и СХД'],
];

const CFG = {
  API_BASE:     process.env.ALSTYLE_API_BASE || 'https://api.al-style.kz/api',
  API_KEY:      process.env.ALSTYLE_API_KEY  || 'PUT-YOUR-KEY',
  SITE_URL:     process.env.SITE_URL         || 'https://servis-catalog.onrender.com',
  IMPORT_TOKEN: process.env.IMPORT_TOKEN     || 'PUT-IMPORT-TOKEN',
  EXCLUDE_MISSING: String(process.env.EXCLUDE_MISSING || 'true') === 'true',
  MIN_ATTRS: Number(process.env.MIN_ATTRS || 3), // порог качества detailText: <N пар считаем мусором, не используем (падаем на descr)
  MARKUP:   Number(process.env.MARKUP   || 0.30),
  MIN_MULT: Number(process.env.MIN_MULT || 1.15),
  ROUND_TO: Number(process.env.ROUND_TO || 100),
  RESPECT_RRP: String(process.env.RESPECT_RRP || 'true') === 'true',
  PRICE_MODE: process.env.PRICE_MODE || 'alstyle', // 'alstyle' = РРЦ из Al-Style (rrp→price2); 'markup' = наценка от закупа
  FULL_SYNC: String(process.env.FULL_SYNC || 'false') === 'true',
  AUTO_MERGE: String(process.env.AUTO_MERGE || 'false') === 'true', // склеивать дубли сразу после импорта (только совпавшие по EAN)
  PAGE: 250, BATCH: 2000, CAT_CHUNK: 80, TIMEOUT: 45000,
  // barcode — EAN товара: ключ автосклейки дублей между поставщиками (lib/matching.js).
  // Без него offers.ean всегда пуст и склейка по EAN не срабатывает вообще.
  // ⚠️ Al-Style отдаёт 500 на несуществующее additional_fields — если импорт вдруг начнёт падать,
  // первым делом убрать barcode отсюда (переопределяется ENV ALSTYLE_ADDITIONAL, без правки кода).
  ADDITIONAL: process.env.ALSTYLE_ADDITIONAL || 'brand,images,description,rrp,price1,price2,barcode',
  THROTTLE_MS: Number(process.env.THROTTLE_MS || 5500), // Al-Style: не чаще 1 запроса/5с
};

// ─────────────── HTTP
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let _lastApiCall = 0;
async function throttle() {
  const wait = CFG.THROTTLE_MS - (Date.now() - _lastApiCall);
  if (wait > 0) await sleep(wait);
  _lastApiCall = Date.now();
}
function rawGet(method, params) {
  const url = new URL(CFG.API_BASE.replace(/\/$/, '') + '/' + method);
  url.searchParams.set('access-token', CFG.API_KEY);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers: { Accept: 'application/json' }, timeout: CFG.TIMEOUT }, (res) => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Al-Style HTTP ${res.statusCode}: ${d.slice(0,200)}`));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('Ответ не JSON: ' + d.slice(0,200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Таймаут Al-Style')));
    req.on('error', reject); req.end();
  });
}
async function apiGet(method, params) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await throttle();
    try { return await rawGet(method, params); }
    catch (e) {
      if (/HTTP 403/.test(e.message) && attempt < 4) { console.log('  лимит Al-Style (403) — пауза 10с и повтор…'); await sleep(10000); continue; }
      throw e;
    }
  }
}
function httpPost(urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(urlStr), { method: 'POST', headers, timeout: CFG.TIMEOUT }, (res) => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Сайт HTTP ${res.statusCode}: ${d.slice(0,200)}`));
        try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(new Error('Сайт вернул не JSON: ' + d.slice(0,200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Таймаут сайта')));
    req.on('error', reject); req.write(body); req.end();
  });
}
function httpGetJson(urlStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(urlStr), { method: 'GET', headers: { Accept: 'application/json' }, timeout: CFG.TIMEOUT }, (res) => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(d || '[]')); } catch (e) { reject(new Error('ответ не JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('таймаут')));
    req.on('error', reject); req.end();
  });
}
// Карта веток Al-Style: сперва из админки (/api/sections), fallback — встроенный BRANCH_MAP.
async function loadBranchMap() {
  try {
    const data = await httpGetJson(CFG.SITE_URL.replace(/\/$/, '') + '/api/sections');
    if (Array.isArray(data) && data.length) {
      const map = [];
      for (const s of data) (s.branches || []).forEach(id => { const n = parseInt(id, 10); if (n > 0 && s.name) map.push([n, s.name]); });
      if (map.length) { console.log(`Ветки из /api/sections: ${map.length} (разделов ${data.length}).`); return map; }
    }
    console.log('  /api/sections без веток — использую встроенный BRANCH_MAP.');
  } catch (e) { console.log('  /api/sections недоступен (' + e.message + ') — использую встроенный BRANCH_MAP.'); }
  return BRANCH_MAP;
}

// ─────────────── Дерево категорий → привязка к группам + родитель/глубина/путь (nested sets)
async function buildGroups(branchMap) {
  branchMap = branchMap || await loadBranchMap();
  const raw = await apiGet('categories', {});
  const list = Array.isArray(raw) ? raw : (raw.data || raw.elements || []);
  const byId = new Map(list.map(c => [String(c.id), c]));

  // корни наших разделов из BRANCH_MAP
  const ranges = [];
  for (const [pid, group] of branchMap) {
    const node = byId.get(String(pid));
    if (!node) { console.warn(`⚠ ветка ${pid} (${group}) не найдена в дереве — пропущена`); continue; }
    ranges.push({ id: String(pid), left: +node.left, right: +node.right, group, name: node.name });
  }

  // родитель каждой категории через nested sets (стек по возрастанию left)
  const sorted = list.slice().sort((a, b) => (+a.left) - (+b.left));
  const parentOf = new Map(); // id → parentId | null
  const stack = [];
  for (const c of sorted) {
    while (stack.length && +stack[stack.length - 1].right < +c.right) stack.pop();
    parentOf.set(String(c.id), stack.length ? String(stack[stack.length - 1].id) : null);
    stack.push(c);
  }

  const leafGroup = new Map(); // id → группа (только внутри веток)
  const leafName  = new Map(); // id → имя (для всех)
  const catMeta   = new Map(); // id → {name, parentId(в дереве, 0=верхний под группой), grp, depth, left}
  let plan = {};
  for (const c of list) {
    leafName.set(String(c.id), c.name);
    const L = +c.left;
    const r = ranges.find(rr => L > rr.left && L < rr.right); // строго внутри ветки
    if (!r) continue;
    leafGroup.set(String(c.id), r.group);
    const par = parentOf.get(String(c.id));
    const parentId = (par && par !== r.id) ? +par : 0; // если родитель = корень ветки → верхний уровень
    let depth = 0, cur = String(c.id);
    while (true) { const p = parentOf.get(cur); if (!p || p === r.id) break; depth++; cur = p; }
    catMeta.set(String(c.id), { name: c.name, parentId, grp: r.group, depth, left: L });
    if ((+c.elements || 0) > 0) { (plan[r.group] = plan[r.group] || { count: 0 }); plan[r.group].count += (+c.elements || 0); }
  }

  // путь категорий товара: [id верхнего-под-группой, …, id листа] (корень ветки исключён)
  function pathOf(leafId) {
    const out = [];
    let cur = String(leafId);
    while (cur && leafGroup.has(cur)) { out.unshift(+cur); const p = parentOf.get(cur); if (!p) break; cur = p; }
    return out;
  }

  const targetLeafIds = list.filter(c => (+c.elements || 0) > 0 && leafGroup.has(String(c.id))).map(c => String(c.id));
  return { leafGroup, leafName, catMeta, parentOf, ranges, pathOf, plan, targetLeafIds };
}

// ─────────────── Разведка: полное дерево категорий Al-Style с ID (для расширения BRANCH_MAP)
//   node scripts/alstyle-import.js --tree                 → всё дерево в categories_full.txt
//   node scripts/alstyle-import.js --tree сервер освещ    → + список совпадений по словам в консоль
async function dumpTree() {
  const fs = require('fs');
  const raw = await apiGet('categories', {});
  const list = Array.isArray(raw) ? raw : (raw.data || raw.elements || []);
  const sorted = list.slice().sort((a, b) => (+a.left) - (+b.left));
  const stack = [], lines = [];
  for (const c of sorted) {
    while (stack.length && +stack[stack.length - 1].right < +c.right) stack.pop();
    const depth = stack.length; stack.push(c);
    const el = +c.elements || 0;
    lines.push('  '.repeat(depth) + `[${c.id}] ${c.name}` + (el ? `  (${el} тов.)` : ''));
  }
  fs.writeFileSync('categories_full.txt', lines.join('\n') + '\n', 'utf8');
  console.log(`Всего категорий Al-Style: ${list.length}. Полное дерево с ID → categories_full.txt`);
  const kw = process.argv.slice(2).filter(a => !a.startsWith('--')).map(s => s.toLowerCase());
  if (kw.length) {
    console.log(`\nСовпадения по [${kw.join(', ')}]  (ID — название — товаров):`);
    let found = 0;
    for (const c of sorted) {
      const nm = String(c.name || '').toLowerCase();
      if (kw.some(k => nm.includes(k))) { console.log(`  ${c.id}  —  ${c.name}  —  ${+c.elements || 0}`); found++; }
    }
    if (!found) console.log('  (ничего не найдено — смотрите categories_full.txt целиком)');
  }
}

// ─────────────── Утилиты товара
function parseQty(q) { if (typeof q === 'number') return Math.max(0, Math.round(q)); const m = String(q||'').match(/\d+/); return m ? +m[0] : 0; }
function retailPrice(price1, rrp) {
  const d = Number(price1) || 0; if (d <= 1) return 0;
  let r = Math.max(d * (1 + CFG.MARKUP), d * CFG.MIN_MULT);
  r = Math.ceil(r / CFG.ROUND_TO) * CFG.ROUND_TO;
  if (CFG.RESPECT_RRP) { const rr = Number(rrp) || 0; if (rr > r) r = Math.ceil(rr / CFG.ROUND_TO) * CFG.ROUND_TO; }
  return r;
}
// Надёжный разбор числа (на случай строк с пробелами/валютой: "12 500 ₸" → 12500)
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
// Цена для каталога. По умолчанию — розничная цена «с сайта» Al-Style.
// ВАЖНО: у Al-Style цена ≤ 1 = «нет цены»/заглушка (часто rrp приходит как 1) — её НЕ показываем как 1 ₸.
function catalogPrice(el) {
  const rrp = num(el.rrp), p2 = num(el.price2), p1 = num(el.price1);
  if (CFG.PRICE_MODE === 'markup') {
    return p1 > 1 ? retailPrice(p1, rrp) : 0;
  }
  // розничная: сначала price2 («розничная»), затем rrp («РРЦ»), но только если значение осмысленное (> 1)
  let r = p2 > 1 ? p2 : (rrp > 1 ? rrp : 0);
  return r > 0 ? Math.round(r) : 0;
}
function pickImage(el) {
  let imgs = el.images;
  if (typeof imgs === 'string') imgs = imgs.split(',').map(s => s.trim()).filter(Boolean);
  if (Array.isArray(imgs)) {
    for (const it of imgs) {
      let u = typeof it === 'string' ? it : (it && (it.full || it.url || it.src || it.image || it.big || it.original));
      if (!u) continue;
      u = String(u).trim();
      if (/^https?:\/\//i.test(u)) return u.replace(/^http:\/\//i, 'https://'); // полная ссылка
      if (u.startsWith('//')) return 'https:' + u;
      if (u.startsWith('/')) return 'https://al-style.kz' + u;                  // относительный путь Bitrix
      return 'https://al-style.kz/' + u.replace(/^\.?\//, '');                  // имя файла
    }
  }
  const code = String(el.article || '').trim();
  return code ? `https://img.al-style.kz/${code.padStart(5, '0')}_1.jpg` : ''; // шаблон Al-Style (суффикс _1, как в методе /images); битую сайт заменит плейсхолдером
}
// Собираем ВСЕ фото товара (галерея). Возвращает массив ссылок (https), без дублей, до 12 шт.
function pickImages(el) {
  const out = [];
  let imgs = el.images;
  if (typeof imgs === 'string') imgs = imgs.split(',').map(s => s.trim()).filter(Boolean);
  if (Array.isArray(imgs)) {
    for (const it of imgs) {
      let u = typeof it === 'string' ? it : (it && (it.full || it.url || it.src || it.image || it.big || it.original));
      if (!u) continue;
      u = String(u).trim();
      if (/^https?:\/\//i.test(u)) u = u.replace(/^http:\/\//i, 'https://');
      else if (u.startsWith('//')) u = 'https:' + u;
      else if (u.startsWith('/')) u = 'https://al-style.kz' + u;
      else u = 'https://al-style.kz/' + u.replace(/^\.?\//, '');
      if (!out.includes(u)) out.push(u);
      if (out.length >= 12) break;
    }
  }
  if (!out.length) { const one = pickImage(el); if (one) out.push(one); } // запасной вариант — шаблон _01.jpg
  return out;
}
function enrich(group, catName) { // лёгкое обогащение для видеонаблюдения
  const out = {};
  if (group === 'Видеонаблюдение') {
    const mp = String(catName||'').match(/(\d+)\s*мегапиксел/i); if (mp) { out.mp = mp[1] + ' МП'; out.res = mp[1] + ' МП'; }
    if (/купольн/i.test(catName)) out.type = 'Купольная камера';
    else if (/цилиндр/i.test(catName)) out.type = 'Цилиндрическая камера';
    else if (/PTZ|PT и/i.test(catName)) out.type = 'PTZ камера';
    else if (/видеорегистратор/i.test(catName)) out.type = 'Видеорегистратор';
  }
  return out;
}
function stripHtml(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<\/(p|li|div)>/gi, '. ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ').replace(/\s*\.\s*\./g, '.').trim();
}
// Бренды, отданные другому поставщику (в админке «убрать из Al-Style») — Al-Style их пропускает, чтобы не задваивать.
let EXCLUDE_BRANDS = new Set();
async function loadExcludeBrands() {
  try {
    const d = await httpGetJson(CFG.SITE_URL.replace(/\/$/, '') + '/api/brand-owners');
    const list = (d && Array.isArray(d.excludeFromAlstyle)) ? d.excludeFromAlstyle : [];
    EXCLUDE_BRANDS = new Set(list.map(b => String(b || '').trim().toLowerCase()).filter(Boolean));
    if (EXCLUDE_BRANDS.size) console.log(`Бренды исключены из Al-Style (отданы другому поставщику): ${[...EXCLUDE_BRANDS].join(', ')}.`);
  } catch (e) { console.log('  /api/brand-owners недоступен (' + e.message + ') — без исключений брендов.'); }
}

function transform(el, leafGroup, leafName, pathOf) {
  const article = el.article; if (article == null || article === '') return null;
  if (EXCLUDE_BRANDS.has(String(el.brand || '').trim().toLowerCase())) return null; // бренд отдан другому поставщику
  const group = leafGroup.get(String(el.category)) || '';
  const cat = leafName.get(String(el.category)) || String(el.category || '');
  const model = String(el.name || el.article_pn || '').trim().slice(0, 200);
  const desc = stripHtml(el.description || el.full_name || el.name || '').slice(0, 6000);
  const imgs = pickImages(el);
  const cat_path = pathOf ? pathOf(String(el.category)) : [];
  return Object.assign({
    sku: String(article),
    brand: String(el.brand || '').trim(),
    model,
    group, cat: String(cat).slice(0, 100),
    cat_id: Number(el.category) || 0,
    cat_path,
    desc,
    res: '', price: catalogPrice(el), stock: parseQty(el.quantity), img: imgs[0] || '', images: imgs,
    // --- сырьё для оффера (на сайте в products игнорируется, идёт в /api/offers-sync) ---
    _buy: num(el.price1), _retail: num(el.price2), _rrp: num(el.rrp),
    _ean: String(el.barcode || el.ean || el.gtin || '').trim(),
    _pn: String(el.article_pn || '').trim(),
  }, enrich(group, cat));
}

// ─────────────── Сбор товаров по целевым листам (с пагинацией, чанками категорий)
async function collect(leafGroup, leafName, targetLeafIds, firstPageOnly, pathOf) {
  const out = [];
  for (let i = 0; i < targetLeafIds.length; i += CFG.CAT_CHUNK) {
    const chunk = targetLeafIds.slice(i, i + CFG.CAT_CHUNK).join(',');
    let page = 1, totalPages = 1;
    do {
      const r = await apiGet('elements-pagination', {
        category: chunk, limit: CFG.PAGE, offset: (page - 1) * CFG.PAGE,
        exclude_missing: CFG.EXCLUDE_MISSING ? 1 : undefined, additional_fields: CFG.ADDITIONAL,
      });
      const els = r.elements || [];
      totalPages = (r.pagination && r.pagination.totalPages) || 1;
      for (const el of els) { const t = transform(el, leafGroup, leafName, pathOf); if (t) out.push(t); }
      process.stdout.write(`\r  собрано ${out.length}…   `); page++;
      if (firstPageOnly) break;
    } while (page <= totalPages);
  }
  process.stdout.write('\n');
  return out;
}

// ─────────────── Быстрая синхронизация ТОЛЬКО остатков (метод /quantity-price → /api/stock)
async function postStock(items) {
  const body = JSON.stringify({ items });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/stock';
  try { return await httpPost(url, headers, body); } catch (e) { await new Promise(r => setTimeout(r, 2000)); return httpPost(url, headers, body); }
}
async function syncStock() {
  console.log('Запрашиваю остатки Al-Style (/quantity-price)…');
  const raw = await apiGet('quantity-price', {}); // { "<sku>": { quantity, price1, ... }, ... }
  const map = (raw && raw.data && typeof raw.data === 'object') ? raw.data : raw;
  const items = Object.entries(map || {}).map(([sku, v]) => ({ sku: String(sku), stock: parseQty(v && v.quantity) }));
  console.log('Получено позиций у Al-Style:', items.length);
  if (!items.length) { console.log('Пусто — проверьте метод/ключ.'); return; }
  let updated = 0, missing = 0;
  for (let i = 0; i < items.length; i += CFG.BATCH) {
    const r = await postStock(items.slice(i, i + CFG.BATCH));
    updated += r.updated || 0; missing += r.missing || 0;
    console.log(`  пачка ${Math.floor(i / CFG.BATCH) + 1}: обновлено ${r.updated || 0}, нет на сайте ${r.missing || 0}`);
  }
  console.log(`Готово. Обновлено остатков на сайте: ${updated}. (Позиций Al-Style не на сайте: ${missing} — игнор.)`);
}

async function pushBatch(products) {
  // fullSync НЕ шлём по пачкам: сервер видел бы артикулы только этой пачки и погасил бы
  // весь остальной ассортимент. Деактивация — один раз в конце через deactivateMissing().
  const body = JSON.stringify({ source: 'al-style', products, fullSync: false });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/import';
  try { return await httpPost(url, headers, body); } catch (e) { await new Promise(r => setTimeout(r, 2000)); return httpPost(url, headers, body); }
}

// Заливка ТОЛЬКО характеристик (attrs) — безопасно, не трогает цену/остаток/название (см. /api/import/attrs).
async function postAttrs(items, onlyEmpty) {
  const body = JSON.stringify({ items, onlyEmpty: !!onlyEmpty });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/import/attrs';
  try { return await httpPost(url, headers, body); } catch (e) { await new Promise(r => setTimeout(r, 2000)); return httpPost(url, headers, body); }
}

// Финальная деактивация: снимает с показа товары al-style, которых нет во всей выгрузке.
async function deactivateMissing(keepSkus) {
  const body = JSON.stringify({ source: 'al-style', keepSkus });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/import/deactivate';
  try { return await httpPost(url, headers, body); } catch (e) { await new Promise(r => setTimeout(r, 2000)); return httpPost(url, headers, body); }
}

// ─────────────── Дозагрузка характеристик из /properties (опционально, FETCH_PROPS=true)
// Обогащает products полем attrs=[{name,value}]. Сервер (cleanAttrs) отфильтрует служебные.
async function enrichAttrs(products, force) {
  if (!force && String(process.env.FETCH_PROPS || 'false') !== 'true') return;
  const CHUNK = 200;
  const bySku = new Map(products.map(p => [String(p.sku), p]));
  const skus = [...bySku.keys()];
  console.log(`Дозагрузка характеристик (/properties) для ${skus.length} товаров…`);
  let filled = 0;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK).join(',');
    let r; try { r = await apiGet('properties', { article: chunk }); }
    catch (e) { console.log('\n  /properties ошибка на пачке:', e.message); continue; }
    const els = (r && r.elements) || [];
    for (const el of els) {
      const p = bySku.get(String(el.article));
      if (!p || !Array.isArray(el.properties)) continue;
      p.attrs = el.properties
        .map(x => ({ name: String(x.name || '').trim(), value: x.value, sort: x.sort || 0 }))
        .filter(x => x.name && x.value != null && String(x.value).trim() !== '')
        .sort((a, b) => a.sort - b.sort)
        .map(x => ({ name: x.name, value: String(x.value).trim() }));
      if (p.attrs.length) filled++;
    }
    process.stdout.write(`\r  характеристики: ${filled}…   `);
  }
  process.stdout.write('\n');
  console.log(`Готово: характеристики получены у ${filled} товаров.`);
}

// ─────────────── Характеристики из detailText (главный источник — там реальные ТТХ, а не логистика /properties)
// detailText Al-Style — это <li>Название; Значение (пункты; заголовки разделов идут как <li><b>Раздел</b> без «;»).
function parseDetailAttrs(html) {
  if (!html) return [];
  const out = [], seen = {};
  const items = String(html).split(/<li[^>]*>/i);
  for (let i = 1; i < items.length; i++) {
    let text = items[i]
      .replace(/&gt;/gi, '>').replace(/&lt;/gi, '<').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const semi = text.indexOf(';');
    if (semi <= 0) continue; // заголовок раздела / нет пары
    const name = text.slice(0, semi).trim();
    const value = text.slice(semi + 1).trim();
    if (!name || !value || name.length > 60) continue;
    const key = name.toLowerCase();
    if (seen[key]) continue; seen[key] = 1;
    out.push({ name, value: value.slice(0, 300) });
    if (out.length >= 40) break;
  }
  return out;
}
// Обогащает products характеристиками из detailText (element-info). force — не зависит от FETCH_DETAIL.
async function enrichDetail(products, force) {
  if (!force && String(process.env.FETCH_DETAIL || 'false') !== 'true' && String(process.env.FETCH_PROPS || 'false') !== 'true') return;
  const CHUNK = 25;
  const bySku = new Map(products.map(p => [String(p.sku), p]));
  const skus = [...bySku.keys()];
  console.log(`Дозагрузка характеристик из detailText для ${skus.length} товаров…`);
  let filled = 0;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK).join(',');
    let r = null, tries = 0;
    while (true) {
      try { r = await apiGet('element-info', { article: chunk, additional_fields: 'detailText' }); break; }
      catch (e) {
        if (++tries >= 4) { console.log('\n  /element-info пропуск пачки после 4 попыток:', e.message); break; }
        await new Promise(res => setTimeout(res, 2000 * tries)); // бэкофф на сетевые сбои/таймауты
      }
    }
    if (!r) continue;
    const els = Array.isArray(r) ? r : (r.elements || r.data || []);
    for (const el of els) {
      const p = bySku.get(String(el.article)); if (!p) continue;
      const a = parseDetailAttrs(el.detailText || el.detail_text || '');
      // порог качества: 1-2 пары обычно значат, что detailText не в формате «Название; Значение»
      // (мусорный разбор) → не используем, товар покажет характеристики из descr.
      if (a.length >= CFG.MIN_ATTRS) { p.attrs = a; filled++; }
    }
    process.stdout.write(`\r  характеристики(detailText): ${filled}…   `);
  }
  process.stdout.write('\n');
  console.log(`Готово: характеристики из detailText у ${filled} товаров.`);
}

// ─────────────── Дозагрузка реальных фото через /api/images (опционально, FETCH_IMAGES=true)
// Ставит только СУЩЕСТВУЮЩИЕ у Al-Style файлы (метод отдаёт то, что реально есть) → убирает битые
// шаблонные ссылки. URL содержит код товара (…/<code>_1.jpg), по нему и матчим ответ на товар.
async function enrichImages(products) {
  if (String(process.env.FETCH_IMAGES || 'false') !== 'true') return;
  const CHUNK = 60;
  const bySku = new Map(products.map(p => [String(p.sku), p]));
  const byCode = new Map(); // 5-значный код с нулями → sku
  products.forEach(p => byCode.set(String(p.sku).padStart(5, '0'), String(p.sku)));
  const skus = [...bySku.keys()];
  console.log(`Дозагрузка реальных фото (/images) для ${skus.length} товаров…`);
  let filled = 0;
  for (let i = 0; i < skus.length; i += CHUNK) {
    const chunk = skus.slice(i, i + CHUNK).join(',');
    let r = null;
    for (let tries = 0; tries < 5; tries++) {
      try { r = await apiGet('images', { article: chunk }); }
      catch (e) { r = null; await new Promise(res => setTimeout(res, 2000 * (tries + 1))); continue; }
      // троттлинг Al-Style: ответ {success:false,…,interval} без sku-массивов — ждём interval и повторяем
      const throttled = r && typeof r === 'object' && !Array.isArray(r)
        && (r.success === false || r.interval != null)
        && !Object.keys(r).some(k => Array.isArray(r[k]));
      if (throttled) { const w = Math.min(15000, (Number(r.interval) || 3) * 1000); r = null; await new Promise(res => setTimeout(res, w)); continue; }
      break;
    }
    if (!r) { console.log('\n  /images пропуск пачки (троттлинг/ошибка)'); continue; }
    const groups = {};
    const addUrl = (u) => {
      u = String(u || '').trim(); if (!/^https?:\/\//i.test(u)) return;
      u = u.replace(/^http:\/\//i, 'https://');
      const m = u.match(/\/(\d+)_/); if (!m) return;
      const sku = byCode.get(m[1]) || String(parseInt(m[1], 10));
      (groups[sku] = groups[sku] || []).push(u);
    };
    if (Array.isArray(r)) r.forEach(addUrl);
    else if (r && typeof r === 'object') for (const k in r) { const v = r[k]; Array.isArray(v) ? v.forEach(addUrl) : addUrl(v); }
    for (const sku in groups) {
      const p = bySku.get(sku); if (!p) continue;
      const urls = groups[sku].filter((u, i2, a) => a.indexOf(u) === i2).slice(0, 12);
      if (urls.length) { p.images = urls; p.img = urls[0]; filled++; }
    }
    process.stdout.write(`\r  фото: ${filled}…   `);
    await new Promise(res => setTimeout(res, 350)); // пауза между пачками — не провоцируем лимит /images
  }
  process.stdout.write('\n');
  console.log(`Готово: реальные фото получены у ${filled} товаров.`);
}

// Отправка офферов поставщика в новый слой (offers). Изолировано от /api/import.
async function pushOffers(products) {
  const offers = products.map(p => ({
    ext_id: String(p.sku), ext_category: String(p.cat_id || ''),
    brand: p.brand || '', mpn: p._pn || String(p.sku), ean: p._ean || '',
    name: p.model || '', price_buy: p._buy || 0, price_rrp: p._rrp || 0, price_retail: p._retail || 0,
    stock: p.stock || 0,
  }));
  let upserted = 0;
  for (let i = 0; i < offers.length; i += CFG.BATCH) {
    const body = JSON.stringify({ supplier: 'alstyle', offers: offers.slice(i, i + CFG.BATCH) });
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
    const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/offers-sync';
    const r = await httpPost(url, headers, body);
    upserted += (r && r.upserted) || 0;
  }
  // Здоровье ключей склейки дублей (lib/matching.js). Молча пустой EAN уже стоил нам мёртвой автосклейки:
  // поле barcode не запрашивалось в additional_fields, и никто этого не видел. Теперь видно из логов cron.
  const withEan = offers.filter(o => /^\d{8,14}$/.test(o.ean)).length;
  const withMpn = offers.filter(o => o.mpn && o.mpn !== o.ext_id).length;
  const pct = (n) => offers.length ? Math.round(n * 100 / offers.length) + '%' : '0%';
  console.log(`Офферы Al-Style синхронизированы: ${upserted}.`);
  console.log(`  ключи склейки: EAN у ${withEan} (${pct(withEan)}), артикул производителя у ${withMpn} (${pct(withMpn)})`);
  if (!withEan) console.log('  ⚠️ EAN не пришёл ни у одного товара → автосклейка по штрихкоду работать НЕ будет.\n     Проверьте, что ALSTYLE_ADDITIONAL содержит barcode (сейчас: ' + CFG.ADDITIONAL + ').');
  if (!withMpn) console.log('  ⚠️ article_pn пуст у всех → склейка по «бренд+артикул» работать НЕ будет (mpn падает на внутренний код Al-Style).');
  return upserted;
}

// Авто-склейка дублей после импорта: без неё дубли, приехавшие ночью, висят на витрине до ручного запуска.
// Склеивает только надёжные (совпал EAN), спорные складывает в очередь админки. Выключено по умолчанию —
// включать ENV AUTO_MERGE=true, посмотрев сначала предпросмотр глазами (🏭 Поставщики → 🔎 Предпросмотр).
async function autoMerge() {
  if (!CFG.AUTO_MERGE) return;
  const body = '{}';
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  try {
    const r = await httpPost(CFG.SITE_URL.replace(/\/$/, '') + '/api/match/auto', headers, body);
    console.log(`Авто-склейка дублей: склеено ${(r && r.merged) || 0}, в очередь ${(r && r.queued) || 0}.`);
  } catch (e) { console.error('Авто-склейка не выполнена:', e.message); } // импорт из-за этого не валим
}

// Дерево категорий (узлы по ID Al-Style, что встречаются в путях товаров) → сайт (полная замена)
async function syncCategories(products, catMeta) {
  const used = new Set();
  for (const p of products) for (const id of (p.cat_path || [])) used.add(+id);
  const nodes = [...used]
    .map(id => { const m = catMeta.get(String(id)); return m ? { cat_id: +id, parent_id: m.parentId || 0, grp: m.grp || '', name: m.name || String(id), depth: m.depth || 0, left: m.left || 0 } : null; })
    .filter(Boolean)
    .sort((a, b) => a.left - b.left)
    .map((n, i) => ({ cat_id: n.cat_id, parent_id: n.parent_id, grp: n.grp, name: n.name, depth: n.depth, sort: i + 1 }));
  const body = JSON.stringify({ nodes });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const r = await httpPost(CFG.SITE_URL.replace(/\/$/, '') + '/api/categories-sync', headers, body);
  console.log(`Категории обновлены: узлов дерева ${nodes.length}.`);
  return r;
}

// ─────────────── MAIN
(async () => {
  const args = process.argv.slice(2);
  try {
    if (CFG.API_KEY === 'PUT-YOUR-KEY') throw new Error('Не задан ALSTYLE_API_KEY.');

    if (args.includes('--stock')) { await syncStock(); return; }

    if (args.includes('--tree')) { await dumpTree(); return; }

    if (args.includes('--imgcheck')) {
      const { targetLeafIds } = await buildGroups();
      const chunk = targetLeafIds.slice(0, 80).join(',');
      const r = await apiGet('elements-pagination', { category: chunk, limit: 20, offset: 0, additional_fields: CFG.ADDITIONAL });
      const els = r.elements || [];
      console.log(`Проверка поля images (первые ${Math.min(els.length, 12)} товаров):\n`);
      for (const el of els.slice(0, 12)) {
        console.log(`код ${el.article} | ${el.article_pn || ''} | images = ${JSON.stringify(el.images)}`);
      }
      console.log(`\nИтог: с непустым images — ${els.filter(e => e.images && (Array.isArray(e.images) ? e.images.length : true)).length} из ${els.length}.`);
      return;
    }

    await loadExcludeBrands(); // бренды, отданные другому поставщику (не грузим из Al-Style)
    const { leafGroup, leafName, catMeta, pathOf, plan, targetLeafIds } = await buildGroups();

    if (args.includes('--plan')) {
      console.log('План импорта (из дерева категорий, без заливки):\n');
      let total = 0;
      for (const [g, v] of Object.entries(plan)) { console.log('  ' + g.padEnd(42) + String(v.count).padStart(6)); total += v.count; }
      console.log('  ' + '─'.repeat(48)); console.log('  ' + 'ИТОГО'.padEnd(42) + String(total).padStart(6));
      console.log(`\nЦелевых подкатегорий с товарами: ${targetLeafIds.length}. Правьте BRANCH_MAP, чтобы изменить состав.`);
      return;
    }

    if (args.includes('--probe')) {
      console.log('Проба (первая страница каждого чанка категорий)…');
      const sample = await collect(leafGroup, leafName, targetLeafIds, true, pathOf);
      console.log(`Примеры (3 из ${sample.length}):\n` + JSON.stringify(sample.slice(0, 3), null, 2));
      console.log(`\nБез фото: ${sample.filter(p=>!p.img).length}, цена по запросу(0): ${sample.filter(p=>!p.price).length}`);
      return;
    }

    // --dry: как --props, но БЕЗ записи на сайт. Собирает каталог, парсит ТТХ из detailText и печатает
    // статистику (сколько товаров с характеристиками, по разделам) + примеры. Нужен только ALSTYLE_API_KEY,
    // сервер/IMPORT_TOKEN не требуются. Оценка «сколько обогатит боевой --props» перед реальным прогоном.
    if (args.includes('--dry')) {
      console.log('DRY-RUN: сбор каталога и характеристик БЕЗ записи на сайт…');
      const products = await collect(leafGroup, leafName, targetLeafIds, false, pathOf);
      console.log('Всего артикулов в ветках:', products.length);
      if (!products.length) { console.log('Пусто — проверьте BRANCH_MAP.'); return; }
      await enrichDetail(products, true);
      const withAttrs = products.filter(p => Array.isArray(p.attrs) && p.attrs.length);
      const pct = products.length ? Math.round(withAttrs.length / products.length * 100) : 0;
      console.log(`\n=== ИТОГ DRY-RUN ===`);
      console.log(`С характеристиками (detailText): ${withAttrs.length} из ${products.length} (${pct}%).`);
      // разбивка по разделам
      const byGroup = {};
      for (const p of products) {
        const g = p.group || '—';
        byGroup[g] = byGroup[g] || { total: 0, withA: 0 };
        byGroup[g].total++;
        if (Array.isArray(p.attrs) && p.attrs.length) byGroup[g].withA++;
      }
      console.log('\nПо разделам (с ТТХ / всего):');
      for (const [g, s] of Object.entries(byGroup).sort((a, b) => b[1].total - a[1].total))
        console.log(`  ${g}: ${s.withA} / ${s.total}`);
      // гистограмма по числу пар (сигнал качества: 1 пара = обычно мусор, 5+ = нормальные ТТХ)
      const buckets = { '1': 0, '2': 0, '3-4': 0, '5-9': 0, '10-19': 0, '20+': 0 };
      for (const p of withAttrs) {
        const n = p.attrs.length;
        if (n === 1) buckets['1']++; else if (n === 2) buckets['2']++;
        else if (n <= 4) buckets['3-4']++; else if (n <= 9) buckets['5-9']++;
        else if (n <= 19) buckets['10-19']++; else buckets['20+']++;
      }
      console.log('\nРаспределение по числу пар характеристик:');
      for (const [k, v] of Object.entries(buckets)) if (v) console.log(`  ${k} пар: ${v} тов.`);
      const rich = withAttrs.filter(p => p.attrs.length >= 5).length;
      console.log(`\n«Качественных» (≥5 пар): ${rich}. «Тонких» (1-2 пары, вероятно мусор): ${buckets['1'] + buckets['2']}.`);
      // примеры БОГАТЫХ товаров (топ по числу пар) — реальное качество парсинга
      const sorted = withAttrs.slice().sort((a, b) => b.attrs.length - a.attrs.length);
      console.log('\nПримеры БОГАТЫХ характеристик (топ-3 по числу пар):');
      for (const p of sorted.slice(0, 3)) {
        console.log(`\n  • ${p.brand || ''} ${p.model || p.sku} (арт. ${p.sku}) — ${p.attrs.length} пар:`);
        for (const a of p.attrs.slice(0, 10)) console.log(`      ${a.name}: ${a.value}`);
        if (p.attrs.length > 10) console.log(`      … и ещё ${p.attrs.length - 10}`);
      }
      console.log('\nПримеры ТОНКИХ (1-2 пары) — кандидаты на отсев:');
      for (const p of withAttrs.filter(p => p.attrs.length <= 2).slice(0, 3)) {
        console.log(`  • ${p.brand || ''} ${p.model || p.sku} (арт. ${p.sku}): ` +
          p.attrs.map(a => `${a.name}=${a.value}`).join(' | '));
      }
      // дамп в JSON для офлайн-анализа (без повторных запросов к API)
      try {
        const fs = require('fs');
        const dump = withAttrs.map(p => ({ sku: p.sku, brand: p.brand, model: p.model, group: p.group, attrs: p.attrs }));
        fs.writeFileSync('attrs-dry.json', JSON.stringify(dump, null, 1));
        console.log(`\nДамп ${dump.length} товаров с attrs → attrs-dry.json`);
      } catch (e) { console.log('Дамп не записан:', e.message); }
      console.log('\nЗаписи на сайт НЕ было (dry-run). Для боевого прогона — node scripts/alstyle-import.js --props');
      return;
    }

    // --props: залить ТОЛЬКО характеристики (attrs) у существующих товаров, без перезаливки цен/остатков/фото
    // и без деактивации. Форсит /properties независимо от FETCH_PROPS. По умолчанию заливает лишь там, где
    // характеристик ещё нет (onlyEmpty); --force перезаписывает все (в т.ч. ручные правки из админки).
    if (args.includes('--props')) {
      const onlyEmpty = !args.includes('--force');
      console.log(`Сбор артикулов каталога (для дозагрузки характеристик, onlyEmpty=${onlyEmpty})…`);
      const products = await collect(leafGroup, leafName, targetLeafIds, false, pathOf);
      console.log('Всего артикулов:', products.length);
      if (!products.length) { console.log('Пусто — проверьте BRANCH_MAP.'); return; }
      await enrichDetail(products, true); // характеристики из detailText (реальные ТТХ, а не логистика /properties)
      const items = products.filter(p => Array.isArray(p.attrs) && p.attrs.length).map(p => ({ sku: p.sku, attrs: p.attrs }));
      console.log(`С характеристиками получено: ${items.length} из ${products.length}.`);
      if (!items.length) { console.log('Нечего заливать (у товаров нет /properties).'); return; }
      let updated = 0, missing = 0, empty = 0;
      for (let i = 0; i < items.length; i += CFG.BATCH) {
        const r = await postAttrs(items.slice(i, i + CFG.BATCH), onlyEmpty);
        updated += r.updated || 0; missing += r.missing || 0; empty += r.empty || 0;
        console.log(`  пачка ${Math.floor(i / CFG.BATCH) + 1}: залито ${r.updated || 0}`);
      }
      console.log(`Готово. Характеристики залиты у ${updated} товаров. Пропущено (уже заполнены/нет на сайте): ${missing}. Без валидных пар: ${empty}.`);
      return;
    }

    console.log('Сбор каталога Al-Style…');
    const products = await collect(leafGroup, leafName, targetLeafIds, false, pathOf);
    console.log('Всего к загрузке:', products.length);
    if (!products.length) { console.log('Пусто — проверьте BRANCH_MAP.'); return; }
    try { await enrichDetail(products); } catch (e) { console.error('Характеристики не дозагрузились (не критично):', e.message); }
    try { await enrichImages(products); } catch (e) { console.error('Фото не дозагрузились (не критично):', e.message); }
    if (args.includes('--dry')) { console.log('[--dry] Первые 3:\n' + JSON.stringify(products.slice(0,3), null, 2)); return; }

    let created = 0, updated = 0, skipped = 0, deactivated = 0;
    for (let i = 0; i < products.length; i += CFG.BATCH) {
      const r = await pushBatch(products.slice(i, i + CFG.BATCH));
      created += r.created||0; updated += r.updated||0; skipped += r.skipped||0; deactivated += r.deactivated||0;
      console.log(`  пачка ${Math.floor(i/CFG.BATCH)+1}: +${r.created||0} / ~${r.updated||0}`);
    }
    // fullSync: один раз после всех пачек гасим то, чего больше нет в выгрузке (по полному множеству SKU).
    if (CFG.FULL_SYNC) {
      const keepSkus = products.map(p => String(p.sku)).filter(Boolean);
      try {
        const r = await deactivateMissing(keepSkus);
        deactivated = r.deactivated || 0;
        console.log(`  деактивация отсутствующих: снято с показа ${deactivated}`);
      } catch (e) { console.error('Деактивация отсутствующих не выполнена:', e.message); }
    }
    console.log(`Готово. Создано ${created}, обновлено ${updated}, снято с показа ${deactivated}, пропущено ${skipped}.`);
    try { await syncCategories(products, catMeta); } catch (e) { console.error('Категории не обновились:', e.message); }
    try { await pushOffers(products); } catch (e) { console.error('Офферы не синхронизировались (не критично):', e.message); }
    await autoMerge(); // после офферов: склейке нужны свежие ключи (сама себя выключает, если AUTO_MERGE не задан)
  } catch (e) { console.error('ОШИБКА:', e.message); process.exit(1); }
})();
