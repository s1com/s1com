#!/usr/bin/env node
/**
 * alstyle-import.js — синхронизация каталога Al-Style → сайт «Сервис.com» (POST /api/import).
 * API: https://api.al-style.kz/api/  (GET, ключ access-token в параметре). Док подтверждён.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  ПОРЯДОК ЗАПУСКА
 * ───────────────────────────────────────────────────────────────────────────
 *  0) Задать ключ:  export ALSTYLE_API_KEY="ваш-ключ"   (или впишите в CFG ниже)
 *
 *  1) Посмотреть дерево категорий Al-Style и выбрать нужные ID:
 *       node scripts/alstyle-import.js --categories
 *     Выпишите ID разделов (видеонаблюдение, СКУД, пожарка, сетевое, кабель, ИБП, СХД).
 *
 *  2) Проверка без заливки (первые товары выбранных категорий):
 *       CATEGORIES="111,222,333" node scripts/alstyle-import.js --probe
 *
 *  3) Полная заливка только этих категорий:
 *       CATEGORIES="111,222,333" node scripts/alstyle-import.js
 *     Ежедневная полная синхронизация (снимает с показа то, чего больше нет):
 *       CATEGORIES="111,222,333" FULL_SYNC=true node scripts/alstyle-import.js
 *
 *  --dry  — преобразовать всё, но НЕ отправлять (печатает первые 3).
 */

'use strict';
const https = require('https');

const CFG = {
  API_BASE:      process.env.ALSTYLE_API_BASE || 'https://api.al-style.kz/api',
  API_KEY:       process.env.ALSTYLE_API_KEY  || 'PUT-YOUR-KEY',     // ← ключ из кабинета
  SITE_URL:      process.env.SITE_URL         || 'https://servis-com.kz',
  IMPORT_TOKEN:  process.env.IMPORT_TOKEN     || 'PUT-IMPORT-TOKEN', // ← из .env сайта

  CATEGORIES:    (process.env.CATEGORIES || '').trim(),  // ID категорий Al-Style через запятую (обязательно для заливки)
  FORCE_ALL:     String(process.env.FORCE_ALL || 'false') === 'true', // залить ВЕСЬ каталог (не нужно)
  EXCLUDE_MISSING: String(process.env.EXCLUDE_MISSING || 'true') === 'true', // не тянуть отсутствующие на складе

  // Цена: розница = дилерская(price1) × (1+MARKUP), округление вверх, но не ниже ×MIN_MULT и не ниже RRP.
  MARKUP:   Number(process.env.MARKUP   || 0.30),  // 0.30 = ×1.30
  MIN_MULT: Number(process.env.MIN_MULT || 1.15),  // жёсткий минимум-множитель к закупу
  ROUND_TO: Number(process.env.ROUND_TO || 100),   // округление розницы вверх, тг
  RESPECT_RRP: String(process.env.RESPECT_RRP || 'true') === 'true', // не опускать цену ниже РРЦ бренда

  FULL_SYNC: String(process.env.FULL_SYNC || 'false') === 'true',
  PAGE:      250,   // макс лимит Al-Style на страницу
  BATCH:     2000,  // отправляем в сайт пачками (лимит сайта 5000)
  TIMEOUT:   45000,
  ADDITIONAL: 'brand,images,description,rrp', // доп. поля в /elements-pagination
};

// ───────────────────────── Карта категорий Al-Style → наши (как в админке сайта)
const CATEGORY_MAP = [
  [/видеонаблюд|ip.?видео|hd.?видео|сетевые камеры|видеокамера|видеорегистратор|poe/i, 'Видеонаблюдение'],
  [/контроля доступа|скуд|считыватель|контроллер|домофон|замок|турникет/i,            'СКУД и домофония'],
  [/пожарн|опс|извещатель|оповещател/i,                                                'Пожарная безопасность'],
  [/коммутатор|маршрутизатор|wi.?fi|трансивер|сетевое|роутер/i,                        'Сетевое оборудование'],
  [/кабел|витая пара|коннектор|гофр|лоток|оптоволокон/i,                               'Кабельные системы'],
  [/ибп|бесперебойн|ups/i,                                                             'Источники бесперебойного питания (ИБП)'],
  [/хранения данных|hdd|ssd|накопител|схд|сервер/i,                                    'Серверное оборудование и СХД'],
];
function mapCategory(name) { const s = String(name || ''); for (const [re, our] of CATEGORY_MAP) if (re.test(s)) return our; return ''; }

// ───────────────────────── HTTP
function apiGet(method, params) {
  const url = new URL(CFG.API_BASE.replace(/\/$/, '') + '/' + method);
  url.searchParams.set('access-token', CFG.API_KEY);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'GET', headers: { Accept: 'application/json' }, timeout: CFG.TIMEOUT }, (res) => {
      let d = ''; res.on('data', c => (d += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Al-Style HTTP ${res.statusCode}: ${d.slice(0, 200)}`));
        try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('Ответ не JSON: ' + d.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Таймаут Al-Style')));
    req.on('error', reject); req.end();
  });
}
function httpPost(urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(urlStr), { method: 'POST', headers, timeout: CFG.TIMEOUT }, (res) => {
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

// ───────────────────────── Разбор остатка ( ">50", 13, "0" → число )
function parseQty(q) {
  if (typeof q === 'number') return Math.max(0, Math.round(q));
  const m = String(q || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// ───────────────────────── Цена: дилер → розница
function retailPrice(price1, rrp) {
  const d = Number(price1) || 0;
  if (d <= 1) return 0; // price1 == 1 → «цена по запросу»
  let r = Math.max(d * (1 + CFG.MARKUP), d * CFG.MIN_MULT);
  r = Math.ceil(r / CFG.ROUND_TO) * CFG.ROUND_TO;
  if (CFG.RESPECT_RRP) { const rr = Number(rrp) || 0; if (rr > r) r = Math.ceil(rr / CFG.ROUND_TO) * CFG.ROUND_TO; }
  return r;
}

// ───────────────────────── Фото: берём первое из images, переводим http→https
function pickImage(el) {
  let imgs = el.images;
  if (typeof imgs === 'string') imgs = [imgs];
  if (Array.isArray(imgs) && imgs.length) return String(imgs[0]).replace(/^http:\/\//i, 'https://');
  const code = String(el.article || '').padStart(5, '0');
  return code ? `https://img.al-style.kz/${code}_1.jpg` : '';
}

// ───────────────────────── Элемент Al-Style → наш товар
function transform(el, catName) {
  const article = el.article;
  if (article == null || article === '') return null;
  const cat = catName(el.category);
  return {
    sku:   String(article),
    brand: String(el.brand || '').trim(),
    model: String(el.name || '').trim().slice(0, 200),
    group: mapCategory(cat),
    cat:   String(cat || el.category || '').slice(0, 100),
    desc:  String(el.full_name || el.description || el.name || '').slice(0, 2000),
    res:   '',
    price: retailPrice(el.price1, el.rrp),
    stock: parseQty(el.quantity),
    img:   pickImage(el),
  };
}

// ───────────────────────── Категории: загрузка дерева и резолв id→имя
async function loadCategories() {
  const raw = await apiGet('categories', {});
  const list = Array.isArray(raw) ? raw : (raw.data || raw.elements || []);
  const byId = new Map(list.map(c => [String(c.id), c.name]));
  return { list, name: (id) => byId.get(String(id)) || '' };
}

// ───────────────────────── РЕЖИМ: дерево категорий
async function showCategories() {
  const { list } = await loadCategories();
  list.sort((a, b) => (a.left || 0) - (b.left || 0));
  console.log('ID      | товаров | категория');
  console.log('--------+---------+------------------------------------------');
  for (const c of list) {
    const indent = '  '.repeat(Math.max(0, (c.level || 1) - 1));
    console.log(String(c.id).padEnd(7), '|', String(c.elements ?? '').padStart(6), '| ' + indent + c.name);
  }
  console.log('\nВыпишите нужные ID и запустите:  CATEGORIES="id1,id2,..." node scripts/alstyle-import.js --probe');
}

// ───────────────────────── Сбор товаров (с пагинацией) по списку категорий
async function collectProducts(catName, onlyFirstPage) {
  const cats = CFG.CATEGORIES ? CFG.CATEGORIES.split(',').map(s => s.trim()).filter(Boolean) : [null];
  const out = [];
  for (const cat of cats) {
    let page = 1, totalPages = 1;
    do {
      const r = await apiGet('elements-pagination', {
        category: cat || undefined,
        limit: CFG.PAGE,
        offset: (page - 1) * CFG.PAGE,
        exclude_missing: CFG.EXCLUDE_MISSING ? 1 : undefined,
        additional_fields: CFG.ADDITIONAL,
      });
      const els = r.elements || [];
      totalPages = (r.pagination && r.pagination.totalPages) || 1;
      for (const el of els) { const t = transform(el, catName); if (t) out.push(t); }
      process.stdout.write(`\r  категория ${cat || 'ВСЕ'}: страница ${page}/${totalPages}, собрано ${out.length}   `);
      page++;
      if (onlyFirstPage) break;
    } while (page <= totalPages);
    process.stdout.write('\n');
  }
  return out;
}

// ───────────────────────── Отправка в сайт (1 повтор при сбое)
async function pushBatch(products) {
  const body = JSON.stringify({ source: 'al-style', products, fullSync: CFG.FULL_SYNC });
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    Authorization: 'Bearer ' + CFG.IMPORT_TOKEN,
  };
  const url = CFG.SITE_URL.replace(/\/$/, '') + '/api/import';
  try { return await httpPost(url, headers, body); }
  catch (e) { await new Promise(r => setTimeout(r, 2000)); return httpPost(url, headers, body); }
}

// ───────────────────────── MAIN
(async () => {
  const args = process.argv.slice(2);
  try {
    if (CFG.API_KEY === 'PUT-YOUR-KEY') throw new Error('Не задан ALSTYLE_API_KEY (export ALSTYLE_API_KEY="...").');

    if (args.includes('--categories')) { await showCategories(); return; }

    if (!CFG.CATEGORIES && !CFG.FORCE_ALL)
      throw new Error('Не выбраны категории. Запустите --categories, затем CATEGORIES="id1,id2,...". (Залить ВСЁ: FORCE_ALL=true.)');

    const { name } = await loadCategories();

    if (args.includes('--probe')) {
      console.log('Проба (первая страница каждой категории)…');
      const sample = await collectProducts(name, true);
      console.log(`\nГотово к показу. Первые 3 из ${sample.length}:`);
      console.log(JSON.stringify(sample.slice(0, 3), null, 2));
      const noImg = sample.filter(p => !p.img).length, noPrice = sample.filter(p => !p.price).length;
      console.log(`\nБез фото: ${noImg}, «цена по запросу» (0): ${noPrice}. Проверьте — потом убирайте --probe.`);
      return;
    }

    console.log('Сбор каталога Al-Style…');
    const products = await collectProducts(name, false);
    console.log('Всего к загрузке:', products.length);
    if (!products.length) { console.log('Пусто — проверьте ID категорий.'); return; }

    if (args.includes('--dry')) {
      console.log('[--dry] Первые 3 (НЕ отправлено):\n' + JSON.stringify(products.slice(0, 3), null, 2));
      return;
    }

    let created = 0, updated = 0, skipped = 0, deactivated = 0;
    for (let i = 0; i < products.length; i += CFG.BATCH) {
      const r = await pushBatch(products.slice(i, i + CFG.BATCH));
      created += r.created || 0; updated += r.updated || 0; skipped += r.skipped || 0; deactivated += r.deactivated || 0;
      console.log(`  пачка ${Math.floor(i / CFG.BATCH) + 1}: +${r.created || 0} / ~${r.updated || 0}`);
    }
    console.log(`Готово. Создано ${created}, обновлено ${updated}, снято с показа ${deactivated}, пропущено ${skipped}.`);
  } catch (e) { console.error('ОШИБКА:', e.message); process.exit(1); }
})();
