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
 *   node scripts/alstyle-import.js --plan     # сколько товаров по каждой группе (без заливки, 1 запрос)
 *   node scripts/alstyle-import.js --probe     # показать примеры готовых товаров (без заливки)
 *   node scripts/alstyle-import.js             # боевая заливка
 *   FULL_SYNC=true node scripts/alstyle-import.js   # + снять с показа то, чего больше нет
 */

'use strict';
const https = require('https');

// ─────────────── Ветки Al-Style → категории сайта  (ПРАВИТЬ ЗДЕСЬ)
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
  // Серверы/СХД (по желанию — раскомментируйте):
  // [5739, 'Серверное оборудование и СХД'],
  // [21689,'Серверное оборудование и СХД'],
  // [21788,'Серверное оборудование и СХД'],
];

const CFG = {
  API_BASE:     process.env.ALSTYLE_API_BASE || 'https://api.al-style.kz/api',
  API_KEY:      process.env.ALSTYLE_API_KEY  || 'PUT-YOUR-KEY',
  SITE_URL:     process.env.SITE_URL         || 'https://servis-com.kz',
  IMPORT_TOKEN: process.env.IMPORT_TOKEN     || 'PUT-IMPORT-TOKEN',
  EXCLUDE_MISSING: String(process.env.EXCLUDE_MISSING || 'true') === 'true',
  MARKUP:   Number(process.env.MARKUP   || 0.30),
  MIN_MULT: Number(process.env.MIN_MULT || 1.15),
  ROUND_TO: Number(process.env.ROUND_TO || 100),
  RESPECT_RRP: String(process.env.RESPECT_RRP || 'true') === 'true',
  PRICE_MODE: process.env.PRICE_MODE || 'alstyle', // 'alstyle' = РРЦ из Al-Style (rrp→price2); 'markup' = наценка от закупа
  FULL_SYNC: String(process.env.FULL_SYNC || 'false') === 'true',
  PAGE: 250, BATCH: 2000, CAT_CHUNK: 80, TIMEOUT: 45000,
  ADDITIONAL: 'brand,images,description,rrp',
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

// ─────────────── Дерево категорий → диапазоны веток (nested sets) и привязка листьев к группам
async function buildGroups() {
  const raw = await apiGet('categories', {});
  const list = Array.isArray(raw) ? raw : (raw.data || raw.elements || []);
  const byId = new Map(list.map(c => [String(c.id), c]));
  const ranges = [];
  for (const [pid, group] of BRANCH_MAP) {
    const node = byId.get(String(pid));
    if (!node) { console.warn(`⚠ ветка ${pid} (${group}) не найдена в дереве — пропущена`); continue; }
    ranges.push({ left: +node.left, right: +node.right, group, name: node.name });
  }
  const leafGroup = new Map(); // id листа → группа сайта
  const leafName  = new Map(); // id → имя категории
  let plan = {};               // группа → {count, leaves}
  for (const c of list) {
    leafName.set(String(c.id), c.name);
    const L = +c.left;
    const r = ranges.find(r => L > r.left && L < r.right); // строго внутри ветки = подкатегория
    if (!r) continue;
    leafGroup.set(String(c.id), r.group);
    if ((+c.elements || 0) > 0) { (plan[r.group] = plan[r.group] || { count: 0 }); plan[r.group].count += (+c.elements || 0); }
  }
  const targetLeafIds = list.filter(c => (+c.elements || 0) > 0 && leafGroup.has(String(c.id))).map(c => String(c.id));
  return { leafGroup, leafName, plan, targetLeafIds };
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
// Цена для каталога. По умолчанию — РРЦ из Al-Style: rrp («контроль розничной цены»),
// иначе price2 («розничная»). Если у Al-Style нет розничной — запасной расчёт по наценке.
function catalogPrice(el) {
  if (CFG.PRICE_MODE === 'markup') {
    if ((Number(el.price1) || 0) <= 1) return 0;
    return retailPrice(el.price1, el.rrp);
  }
  // РРЦ из Al-Style: rrp («контроль розн. цены») → price2 («розничная»).
  // «Цена по запросу» только если у Al-Style нет розничной цены.
  const rrp = Number(el.rrp) || 0, p2 = Number(el.price2) || 0;
  const p = rrp > 0 ? rrp : p2;
  return p > 0 ? Math.round(p) : 0;
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
  return ''; // у Al-Style нет фото → на сайте «фото по запросу»
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
function transform(el, leafGroup, leafName) {
  const article = el.article; if (article == null || article === '') return null;
  const group = leafGroup.get(String(el.category)) || '';
  const cat = leafName.get(String(el.category)) || String(el.category || '');
  const model = String(el.article_pn || el.name || '').trim().slice(0, 120);
  const desc = stripHtml(el.description || el.full_name || el.name || '').slice(0, 2000);
  return Object.assign({
    sku: String(article),
    brand: String(el.brand || '').trim(),
    model,
    group, cat: String(cat).slice(0, 100),
    desc,
    res: '', price: catalogPrice(el), stock: parseQty(el.quantity), img: pickImage(el),
  }, enrich(group, cat));
}

// ─────────────── Сбор товаров по целевым листам (с пагинацией, чанками категорий)
async function collect(leafGroup, leafName, targetLeafIds, firstPageOnly) {
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
      for (const el of els) { const t = transform(el, leafGroup, leafName); if (t) out.push(t); }
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
  const body = JSON.stringify({ source: 'al-style', products, fullSync: CFG.FULL_SYNC });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/import';
  try { return await httpPost(url, headers, body); } catch (e) { await new Promise(r => setTimeout(r, 2000)); return httpPost(url, headers, body); }
}

// Дерево категорий (наши группы + подкатегории из товаров) → сайт (/api/categories-sync, полная замена)
async function syncCategories(products) {
  const order = [], byGroup = {};
  for (const [, g] of BRANCH_MAP) if (!order.includes(g)) order.push(g);
  for (const p of products) { if (!p.group) continue; (byGroup[p.group] = byGroup[p.group] || new Set()); if (p.cat) byGroup[p.group].add(p.cat); }
  const groups = order.filter(g => byGroup[g]).map(g => ({ name: g, subs: [...byGroup[g]].sort((a, b) => a.localeCompare(b, 'ru')) }));
  const body = JSON.stringify({ groups });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), Authorization: 'Bearer ' + CFG.IMPORT_TOKEN };
  const r = await httpPost(CFG.SITE_URL.replace(/\/$/, '') + '/api/categories-sync', headers, body);
  console.log(`Категории обновлены: групп ${groups.length}, подкатегорий ${groups.reduce((s, g) => s + g.subs.length, 0)}.`);
  return r;
}

// ─────────────── MAIN
(async () => {
  const args = process.argv.slice(2);
  try {
    if (CFG.API_KEY === 'PUT-YOUR-KEY') throw new Error('Не задан ALSTYLE_API_KEY.');

    if (args.includes('--stock')) { await syncStock(); return; }

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

    const { leafGroup, leafName, plan, targetLeafIds } = await buildGroups();

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
      const sample = await collect(leafGroup, leafName, targetLeafIds, true);
      console.log(`Примеры (3 из ${sample.length}):\n` + JSON.stringify(sample.slice(0, 3), null, 2));
      console.log(`\nБез фото: ${sample.filter(p=>!p.img).length}, цена по запросу(0): ${sample.filter(p=>!p.price).length}`);
      return;
    }

    console.log('Сбор каталога Al-Style…');
    const products = await collect(leafGroup, leafName, targetLeafIds, false);
    console.log('Всего к загрузке:', products.length);
    if (!products.length) { console.log('Пусто — проверьте BRANCH_MAP.'); return; }
    if (args.includes('--dry')) { console.log('[--dry] Первые 3:\n' + JSON.stringify(products.slice(0,3), null, 2)); return; }

    let created = 0, updated = 0, skipped = 0, deactivated = 0;
    for (let i = 0; i < products.length; i += CFG.BATCH) {
      const r = await pushBatch(products.slice(i, i + CFG.BATCH));
      created += r.created||0; updated += r.updated||0; skipped += r.skipped||0; deactivated += r.deactivated||0;
      console.log(`  пачка ${Math.floor(i/CFG.BATCH)+1}: +${r.created||0} / ~${r.updated||0}`);
    }
    console.log(`Готово. Создано ${created}, обновлено ${updated}, снято с показа ${deactivated}, пропущено ${skipped}.`);
    try { await syncCategories(products); } catch (e) { console.error('Категории не обновились:', e.message); }
  } catch (e) { console.error('ОШИБКА:', e.message); process.exit(1); }
})();
