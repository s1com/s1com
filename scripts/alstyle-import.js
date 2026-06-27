#!/usr/bin/env node
/**
 * alstyle-import.js — адаптер: выгрузка из API Al-Style → наш каталог (/api/import).
 *
 * ЧТО СДЕЛАТЬ ПЕРЕД ЗАПУСКОМ (отмечено TODO):
 *   1. Заполнить CONFIG (ключ Al-Style, URL метода, наш домен, IMPORT_TOKEN).
 *   2. В fetchAlStyle() подставить реальный URL/параметры метода каталога Al-Style.
 *   3. В transform() подтвердить НАЗВАНИЯ ПОЛЕЙ по реальному ответу API
 *      (сделайте один запрос и посмотрите JSON — займёт пару минут).
 *   4. Настроить MARKUP (наценку) и CATEGORY_MAP под себя.
 *
 * Запуск:  node alstyle-import.js
 * По расписанию: cron / Render Cron Job (напр. ежедневно с FULL_SYNC=true).
 */

'use strict';
const https = require('https');

// ─────────────────────────────────────────── CONFIG (TODO: заполнить)
const CONFIG = {
  ALSTYLE_API_URL: process.env.ALSTYLE_API_URL || 'https://b2bportal.al-style.kz/get-api/PLACEHOLDER', // TODO: реальный метод каталога
  ALSTYLE_API_KEY: process.env.ALSTYLE_API_KEY || 'PUT-YOUR-KEY',                                       // TODO: ключ из кабинета
  SITE_URL:        process.env.SITE_URL        || 'https://servis-com.kz',                              // наш сайт
  IMPORT_TOKEN:    process.env.IMPORT_TOKEN    || 'PUT-IMPORT-TOKEN',                                   // из .env сайта
  MARKUP:          Number(process.env.MARKUP   || 0.25),  // наценка 25% (дилер → розница)
  ROUND_TO:        Number(process.env.ROUND_TO || 100),   // округление розницы вверх до, тг
  FULL_SYNC:       String(process.env.FULL_SYNC || 'false') === 'true',
  BATCH:           1000,
};

// ─────────────────────────────────────────── Карта категорий (TODO: дополнить)
// Ключ — категория Al-Style (или её часть), значение — наша категория (как в админке).
const CATEGORY_MAP = [
  [/видеонаблюд|ip.?видео|hd.?видео|сетевые камеры|видеокамера|видеорегистратор/i, 'Видеонаблюдение'],
  [/контроля доступа|скуд|считыватель|контроллер|домофон|замок/i,                 'СКУД и домофония'],
  [/пожарн|опс|извещатель|оповещател/i,                                            'Пожарная безопасность'],
  [/коммутатор|маршрутизатор|wi.?fi|трансивер|сетевое|роутер|poe/i,                'Сетевое оборудование'],
  [/кабел|витая пара|коннектор|гофр|лоток|оптоволокон/i,                           'Кабельные системы'],
  [/ибп|бесперебойн|ups/i,                                                         'Источники бесперебойного питания (ИБП)'],
  [/хранения данных|hdd|ssd|накопител|схд|сервер/i,                                'Серверное оборудование и СХД'],
];
function mapCategory(alStyleCategory) {
  const s = String(alStyleCategory || '');
  for (const [re, our] of CATEGORY_MAP) if (re.test(s)) return our;
  return ''; // не распознано — товар создастся без категории, назначите вручную
}

// ─────────────────────────────────────────── Цена: дилер → розница (защита маржи)
function retailPrice(dealer) {
  const d = Number(dealer) || 0;
  if (d <= 0) return 0;
  let r = d * (1 + CONFIG.MARKUP);
  r = Math.ceil(r / CONFIG.ROUND_TO) * CONFIG.ROUND_TO; // округление вверх
  if (r < d) r = d;                                     // никогда ниже закупа
  return r;
}

// ─────────────────────────────────────────── Преобразование товара Al-Style → наш формат
// TODO: подтвердить имена полей (p.code/p.id, p.name, p.article, p.brand, p.price,
//       p.quantity/p.count, p.category) по реальному ответу API.
function transform(p) {
  const code   = p.code ?? p.id ?? p.ID ?? p.article_id;          // TODO: код Al-Style
  const article= p.article ?? p.partnumber ?? p.PartNumber ?? '';  // TODO: партномер
  const name   = p.name ?? p.title ?? '';                          // TODO: название
  const brand  = p.brand ?? p.vendor ?? p.manufacturer ?? '';      // TODO: бренд
  const price  = p.price ?? p.price_kzt ?? p.cost ?? 0;            // TODO: дилерская цена
  const stock  = p.quantity ?? p.count ?? p.stock ?? p.balance ?? 0; // TODO: остаток
  const cat    = p.category ?? p.category_name ?? p.section ?? '';  // TODO: категория
  if (!code) return null;

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
    img:   `https://img.al-style.kz/${code}_01.jpg`,
  };
}

// ─────────────────────────────────────────── Запрос к API Al-Style
// TODO: подставить реальный метод и способ авторизации (заголовок/параметр).
function fetchAlStyle() {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.ALSTYLE_API_URL);
    // Пример: многие отдают каталог по GET с ключом в параметре или заголовке.
    // url.searchParams.set('key', CONFIG.ALSTYLE_API_KEY);
    const opts = { method: 'GET', headers: { /* 'Authorization': 'Bearer '+CONFIG.ALSTYLE_API_KEY */ } };
    https.get(url, opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          // TODO: достать массив товаров из ответа (json.elements / json.data / json.products …)
          const list = json.elements || json.data || json.products || json.items || (Array.isArray(json) ? json : []);
          resolve(list);
        } catch (e) { reject(new Error('Не удалось разобрать ответ Al-Style: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

// ─────────────────────────────────────────── Отправка в наш сайт (/api/import)
function pushBatch(products) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ source: 'al-style', products, fullSync: CONFIG.FULL_SYNC });
    const url = new URL(CONFIG.SITE_URL + '/api/import');
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'Bearer ' + CONFIG.IMPORT_TOKEN,
      },
    }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(d || '{}'));
        else reject(new Error('Сайт ответил ' + res.statusCode + ': ' + d));
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// ─────────────────────────────────────────── Главный поток
(async () => {
  try {
    console.log('Запрашиваю каталог Al-Style…');
    const raw = await fetchAlStyle();
    console.log('Получено позиций:', raw.length);

    const products = raw.map(transform).filter(Boolean);
    console.log('Преобразовано:', products.length);
    if (!products.length) { console.log('Нет товаров — проверьте поля в transform().'); return; }

    let created = 0, updated = 0, skipped = 0;
    for (let i = 0; i < products.length; i += CONFIG.BATCH) {
      const chunk = products.slice(i, i + CONFIG.BATCH);
      const r = await pushBatch(chunk);
      created += r.created || 0; updated += r.updated || 0; skipped += r.skipped || 0;
      console.log(`  партия ${i / CONFIG.BATCH + 1}: +${r.created || 0} / ~${r.updated || 0}`);
    }
    console.log(`Готово. Создано: ${created}, обновлено: ${updated}, пропущено: ${skipped}.`);
  } catch (e) {
    console.error('ОШИБКА:', e.message);
    process.exit(1);
  }
})();
