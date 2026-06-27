#!/usr/bin/env node
/**
 * alstyle-import.js — выгрузка из API Al-Style → каталог «Сервис.com» (POST /api/import).
 *
 * ────────────────────────────────────────────────────────────────────────
 *  БЫСТРЫЙ СТАРТ (3 шага)
 * ────────────────────────────────────────────────────────────────────────
 *  1) Заполнить блок ENV ниже (или задать переменные окружения):
 *       ALSTYLE_API_URL   — реальный метод каталога из кабинета b2bportal
 *       ALSTYLE_API_KEY   — ключ из «Интеграции (API)»
 *       SITE_URL          — адрес сайта (напр. https://servis-com.kz)
 *       IMPORT_TOKEN      — из .env сайта
 *  2) ОДИН РАЗ запустить диагностику — она сама покажет имена полей:
 *       node scripts/alstyle-import.js --probe
 *     Скопировать вывод сюда — и я зафиксирую маппинг точно.
 *  3) Обычный запуск (заливка в сайт):
 *       node scripts/alstyle-import.js              (быстрое обновление цен/остатков)
 *       FULL_SYNC=true node scripts/alstyle-import.js   (полная синхронизация раз в сутки)
 *
 *  --dry  — преобразовать, но НЕ отправлять (печатает первые 3 товара) — для проверки.
 */

'use strict';
const https = require('https');

// ───────────────────────────────────── ENV / CONFIG
const CFG = {
  ALSTYLE_API_URL: process.env.ALSTYLE_API_URL || 'https://b2bportal.al-style.kz/get-api/PLACEHOLDER', // TODO: метод каталога
  ALSTYLE_API_KEY: process.env.ALSTYLE_API_KEY || 'PUT-YOUR-KEY',                                       // TODO: ключ
  SITE_URL:        process.env.SITE_URL        || 'https://servis-com.kz',
  IMPORT_TOKEN:    process.env.IMPORT_TOKEN    || 'PUT-IMPORT-TOKEN',

  // Как Al-Style принимает ключ. После --probe станет ясно. Варианты: 'query' | 'bearer' | 'header'.
  AUTH_MODE:  process.env.AUTH_MODE  || 'query',     // 'query' — ключ в параметре URL (часто у Al-Style)
  AUTH_PARAM: process.env.AUTH_PARAM || 'access-token', // имя параметра/заголовка с ключом

  // Наценка дилер→розница. См. блок retailPrice ниже про правила интегратора.
  MARKUP:   Number(process.env.MARKUP   || 0.30),   // 0.30 = ×1.30 (монтажная база); опт-минимум — ×1.15
  ROUND_TO: Number(process.env.ROUND_TO || 100),    // округление розницы вверх, тг
  MIN_MULT: Number(process.env.MIN_MULT || 1.15),   // жёсткий минимум: розница ≥ закуп × 1.15 (опт-минимум)

  FULL_SYNC: String(process.env.FULL_SYNC || 'false') === 'true',
  BATCH:     Number(process.env.BATCH || 1000),
  TIMEOUT:   Number(process.env.TIMEOUT || 30000),
  IMG_TPL:   process.env.IMG_TPL || 'https://img.al-style.kz/{code}_01.jpg', // TODO: подтвердить схему фото
};

// ───────────────────────────────────── МАППИНГ ПОЛЕЙ Al-Style → наш каталог
// ПОДТВЕРДИТЬ через --probe. Слева — имя поля в ответе Al-Style, как достать значение.
const FIELDS = {
  code:     ['code', 'id', 'ID', 'article_id'],          // → sku (уникальный ключ)
  article:  ['article', 'partnumber', 'PartNumber'],     // → партномер (в model)
  name:     ['name', 'title', 'naименование'],           // → название (в model/desc)
  brand:    ['brand', 'vendor', 'manufacturer'],         // → бренд
  price:    ['price', 'price_kzt', 'cost'],              // → ДИЛЕРСКАЯ цена
  stock:    ['quantity', 'count', 'stock', 'balance'],   // → остаток
  category: ['category', 'category_name', 'section'],    // → категория (через карту)
};
function pick(obj, names) { for (const n of names) if (obj[n] != null && obj[n] !== '') return obj[n]; return undefined; }

// ───────────────────────────────────── Карта категорий Al-Style → наши (как в админке)
const CATEGORY_MAP = [
  [/видеонаблюд|ip.?видео|hd.?видео|сетевые камеры|видеокамера|видеорегистратор/i, 'Видеонаблюдение'],
  [/контроля доступа|скуд|считыватель|контроллер|домофон|замок/i,                 'СКУД и домофония'],
  [/пожарн|опс|извещатель|оповещател/i,                                            'Пожарная безопасность'],
  [/коммутатор|маршрутизатор|wi.?fi|трансивер|сетевое|роутер|poe/i,                'Сетевое оборудование'],
  [/кабел|витая пара|коннектор|гофр|лоток|оптоволокон/i,                           'Кабельные системы'],
  [/ибп|бесперебойн|ups/i,                                                         'Источники бесперебойного питания (ИБП)'],
  [/хранения данных|hdd|ssd|накопител|схд|сервер/i,                                'Серверное оборудование и СХД'],
];
function mapCategory(c) { const s = String(c || ''); for (const [re, our] of CATEGORY_MAP) if (re.test(s)) return our; return ''; }

// ───────────────────────────────────── Цена: дилер → розница (защита маржи)
// Правила интегратора: наценка — множитель к закупу. Опт-минимум ×1.15, монтаж ×1.30.
// На витрине показываем розницу = закуп × (1 + MARKUP), но НИКОГДА ниже закуп × MIN_MULT.
function retailPrice(dealer) {
  const d = Number(dealer) || 0;
  if (d <= 0) return 0;
  let r = d * (1 + CFG.MARKUP);
  const floor = d * CFG.MIN_MULT;       // жёсткий минимум
  if (r < floor) r = floor;
  r = Math.ceil(r / CFG.ROUND_TO) * CFG.ROUND_TO; // округление вверх
  return r;
}

// ───────────────────────────────────── Преобразование одной позиции
function transform(p) {
  const code = pick(p, FIELDS.code);
  if (code == null || code === '') return null;
  const article = pick(p, FIELDS.article) || '';
  const name    = pick(p, FIELDS.name) || '';
  const brand   = pick(p, FIELDS.brand) || '';
  const price   = pick(p, FIELDS.price) || 0;
  const stock   = pick(p, FIELDS.stock) || 0;
  const cat     = pick(p, FIELDS.category) || '';
  return {
    sku:   String(code),
    brand: String(brand).trim(),
    model: String(article || name).trim().slice(0, 200),
    group: mapCategory(cat),
    cat:   String(cat).slice(0, 100),
    desc:  String(name).slice(0, 2000),
    res:   '',
    price: retailPrice(price),
    stock: Math.max(0, Math.round(Number(stock) || 0)),
    img:   CFG.IMG_TPL.replace('{code}', encodeURIComponent(String(code))),
  };
}

// ───────────────────────────────────── HTTP helper
function httpJSON(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = { method, headers: headers || {}, timeout: CFG.TIMEOUT };
    const req = https.request(url, opts, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300)
          return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Ответ не JSON: ' + e.message + ' | начало: ' + data.slice(0, 200))); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Таймаут запроса')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ───────────────────────────────────── Запрос каталога Al-Style
function fetchAlStyle() {
  let url = CFG.ALSTYLE_API_URL;
  const headers = { 'Accept': 'application/json' };
  if (CFG.AUTH_MODE === 'query') {
    const u = new URL(url); u.searchParams.set(CFG.AUTH_PARAM, CFG.ALSTYLE_API_KEY); url = u.toString();
  } else if (CFG.AUTH_MODE === 'bearer') {
    headers['Authorization'] = 'Bearer ' + CFG.ALSTYLE_API_KEY;
  } else { // 'header'
    headers[CFG.AUTH_PARAM] = CFG.ALSTYLE_API_KEY;
  }
  return httpJSON('GET', url, headers).then(json => ({
    json,
    list: json.elements || json.data || json.products || json.items || (Array.isArray(json) ? json : []),
  }));
}

// ───────────────────────────────────── Отправка в сайт (с 1 повтором)
async function pushBatch(products) {
  const body = JSON.stringify({ source: 'al-style', products, fullSync: CFG.FULL_SYNC });
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Authorization': 'Bearer ' + CFG.IMPORT_TOKEN,
  };
  const url = CFG.SITE_URL + '/api/import';
  try { return await httpJSON('POST', url, headers, body); }
  catch (e) { await new Promise(r => setTimeout(r, 1500)); return httpJSON('POST', url, headers, body); }
}

// ───────────────────────────────────── РЕЖИМ ДИАГНОСТИКИ (--probe)
function probeGuess(field, sampleKeys) {
  const pats = {
    code: /^(code|id|article_id|product_id|sku)$/i, article: /article|partnumber|part_number/i,
    name: /name|title|наимен/i, brand: /brand|vendor|manufactur|бренд|произв/i,
    price: /price|cost|цена/i, stock: /quantity|count|stock|balance|qty|остат/i,
    category: /categ|section|group|раздел|категор/i,
  };
  return sampleKeys.filter(k => pats[field] && pats[field].test(k));
}
async function probe() {
  console.log('🔍 Диагностика API Al-Style…');
  console.log('   URL:', CFG.ALSTYLE_API_URL, '| auth:', CFG.AUTH_MODE, '(' + CFG.AUTH_PARAM + ')');
  const { json, list } = await fetchAlStyle();
  console.log('\n── Верхний уровень ответа ──');
  console.log('   тип:', Array.isArray(json) ? 'массив' : 'объект', '| ключи:', Object.keys(json).slice(0, 20).join(', ') || '(нет)');
  console.log('   найден массив товаров длиной:', list.length);
  if (!list.length) { console.log('\n⚠ Массив товаров пуст. Проверьте метод/ключ или ключ-обёртку списка.'); return; }
  const sample = list[0];
  const keys = Object.keys(sample);
  console.log('\n── Поля первого товара (имя: пример) ──');
  for (const k of keys) {
    let v = sample[k]; if (typeof v === 'object') v = JSON.stringify(v);
    console.log('   ' + k + ': ' + String(v).slice(0, 60));
  }
  console.log('\n── Авто-подсказка маппинга (проверьте!) ──');
  for (const f of Object.keys(FIELDS)) {
    const g = probeGuess(f, keys);
    console.log('   ' + f.padEnd(9) + '→ ' + (g.length ? g.join(' / ') : '❓ не найдено — указать вручную'));
  }
  console.log('\nСкопируйте этот вывод — по нему зафиксируем FIELDS точно.');
}

// ───────────────────────────────────── MAIN
(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--probe')) { try { await probe(); } catch (e) { console.error('ОШИБКА probe:', e.message); process.exit(1); } return; }

  try {
    console.log('Запрашиваю каталог Al-Style…');
    const { list } = await fetchAlStyle();
    console.log('Получено позиций:', list.length);
    const products = list.map(transform).filter(Boolean);
    console.log('Преобразовано:', products.length);
    if (!products.length) { console.log('Нет товаров — проверьте FIELDS (запустите --probe).'); return; }

    if (args.includes('--dry')) {
      console.log('\n[--dry] Первые 3 товара (НЕ отправлено):');
      console.log(JSON.stringify(products.slice(0, 3), null, 2));
      console.log(`\nИтого готово к отправке: ${products.length}. Уберите --dry для заливки.`);
      return;
    }

    let created = 0, updated = 0, skipped = 0, deactivated = 0;
    for (let i = 0; i < products.length; i += CFG.BATCH) {
      const chunk = products.slice(i, i + CFG.BATCH);
      const r = await pushBatch(chunk);
      created += r.created || 0; updated += r.updated || 0; skipped += r.skipped || 0; deactivated += r.deactivated || 0;
      console.log(`  партия ${Math.floor(i / CFG.BATCH) + 1}: +${r.created || 0} / ~${r.updated || 0}`);
    }
    console.log(`Готово. Создано ${created}, обновлено ${updated}, снято с показа ${deactivated}, пропущено ${skipped}.`);
  } catch (e) { console.error('ОШИБКА:', e.message); process.exit(1); }
})();
