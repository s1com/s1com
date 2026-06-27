// Сервер: каталог + публичный API + API выгрузки из 1С + админка
// Версия с защитой: rate-limit, CORS, валидация, хэш пароля, логи, health-check.
try { require('dotenv').config(); } catch (e) {}
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const morgan = require('morgan');
const XLSX = require('xlsx');
const db = require('./db');
const { hashPassword, verifyPassword, safeEqual } = require('./lib/security');
const { renderProductPage } = require('./lib/product-page');
const { pingIndexNow, productUrl, KEY: INDEXNOW_KEY } = require('./lib/indexnow');
const { notifyOrder } = require('./lib/telegram');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
// Каталог для фото товаров. На платном Render задаётся IMAGES_DIR=/data/images (постоянный диск),
// иначе используется public/images внутри приложения.
const path_ = require('path');
const IMAGES_DIR = process.env.IMAGES_DIR || path_.join(__dirname, 'public', 'images');
(function ensureImagesDir(){
  try{
    const fsx = require('fs');
    fsx.mkdirSync(IMAGES_DIR, { recursive: true });
    // если задан внешний (персистентный) каталог и он пуст — один раз копируем стартовые фото из репозитория
    const seedImg = path_.join(__dirname, 'public', 'images');
    if (path_.resolve(IMAGES_DIR) !== path_.resolve(seedImg) && fsx.existsSync(seedImg)) {
      const have = fsx.readdirSync(IMAGES_DIR).length;
      if (have === 0) {
        for (const f of fsx.readdirSync(seedImg)) {
          try { fsx.copyFileSync(path_.join(seedImg, f), path_.join(IMAGES_DIR, f)); } catch(e){}
        }
        console.log('[images] стартовые фото скопированы в постоянный каталог');
      }
    }
  }catch(e){ console.warn('[images] не удалось подготовить каталог фото:', e.message); }
})();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'servis2026';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const IMPORT_TOKEN = process.env.IMPORT_TOKEN || 'dev-import-token';
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const YM_ID = (process.env.YM_ID || '').trim(); // ID счётчика Яндекс.Метрики
const YANDEX_VERIFICATION = (process.env.YANDEX_VERIFICATION || '').trim();
const GOOGLE_VERIFICATION = (process.env.GOOGLE_VERIFICATION || '').trim();
// Настройки сайта, редактируемые из админки (Метрика, коды верификации).
// Значения из БД имеют приоритет над переменными окружения; применяются без перезапуска.
const SETTINGS = { ym_id: YM_ID, yandex_verification: YANDEX_VERIFICATION, google_verification: GOOGLE_VERIFICATION };
try { db.prepare('SELECT key,value FROM settings').all().forEach(r => { if (r.value != null && String(r.value).trim() !== '') SETTINGS[r.key] = String(r.value).trim(); }); } catch (e) {}
function seoVerifyTags(){
  let t='';
  if(SETTINGS.yandex_verification) t+=`<meta name="yandex-verification" content="${SETTINGS.yandex_verification}">`;
  if(SETTINGS.google_verification) t+=`<meta name="google-site-verification" content="${SETTINGS.google_verification}">`;
  return t;
}
function applySeo(html){ return html.replace(/__YM_ID__/g, SETTINGS.ym_id || '').replace('<!--SEO_VERIFY-->', seoVerifyTags()); }

// --- Защита от дефолтных секретов в проде ---
if (NODE_ENV === 'production') {
  const bad = [];
  if (!ADMIN_PASSWORD_HASH && ADMIN_PASSWORD === 'servis2026') bad.push('ADMIN_PASSWORD');
  if (JWT_SECRET === 'dev-secret-change-me') bad.push('JWT_SECRET');
  if (IMPORT_TOKEN === 'dev-import-token') bad.push('IMPORT_TOKEN');
  if (bad.length) {
    console.error('ОТКАЗ ЗАПУСКА: в production не заданы безопасные значения: ' + bad.join(', '));
    console.error('Задайте их в переменных окружения (.env). См. README.');
    process.exit(1);
  }
}

// Пароль админки: используем хэш. Если задан только plain — хэшируем в памяти при старте.
const ADMIN_HASH = ADMIN_PASSWORD_HASH || hashPassword(ADMIN_PASSWORD);

const app = express();
app.set('trust proxy', 1); // за реверс-прокси (Render/Nginx) — для корректного rate-limit по IP

// --- Безопасность и производительность ---
// CSP: defense-in-depth. Сайт использует инлайн-стили/скрипты (onclick, Метрика),
// поэтому 'unsafe-inline' оставлен, но источники скриптов/объектов/фреймов ограничены,
// base-uri и frame-ancestors закрыты (защита от подмены base и кликджекинга).
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://mc.yandex.ru", "https://yandex.ru"],
      scriptSrcAttr: ["'unsafe-inline'"],            // сайт использует inline onclick — иначе навигация не работает
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],         // product images may be external (Al-Style/CDN)
      connectSrc: ["'self'", "https://mc.yandex.ru"],
      frameSrc: ["'self'", "https://mc.yandex.ru"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,                  // не ломать сторонние картинки
}));
app.use(compression()); // gzip — ускоряет отдачу каталога
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'tiny')); // access-log
app.use(express.json({ limit: '15mb' }));            // вмещает Excel-импорт (10МБ) в base64; меньше прежних 25МБ

// CORS: публичный каталог открыт; если задан CORS_ORIGINS — ограничиваем
const corsOptions = CORS_ORIGINS.length
  ? { origin: (origin, cb) => (!origin || CORS_ORIGINS.includes(origin)) ? cb(null, true) : cb(new Error('CORS')) }
  : {};
app.use(cors(corsOptions));

// --- Rate limiting ---
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Слишком много попыток входа. Подождите 15 минут.' }, standardHeaders: true, legacyHeaders: false });
const importLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, message: { error: 'Превышен лимит запросов импорта.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300 }); // общий мягкий лимит
app.use('/api/', apiLimiter);

// --- helpers ---
// Полное представление (для админки) — со складом
function rowToAdmin(r) {
  return { id: r.id, sku: r.sku, brand: r.brand || '', model: r.model || '', group: r.grp || '', cat: r.cat || '',
    desc: r.descr || '', res: r.res || '', price: r.price || 0, oldprice: r.oldprice || 0, promo: !!r.promo,
    stock: r.stock || 0, visible: r.visible !== 0, img: r.img || '', mp: r.mp || '',
    conn: (r.conn || '').split(',').filter(Boolean), type: r.type || '' };
}
// Публичное представление — БЕЗ точного остатка (только факт наличия), чтобы не светить склад конкурентам
function rowToPublic(r) {
  const a = rowToAdmin(r);
  const inStock = (r.stock || 0) > 0;
  delete a.stock; delete a.visible;
  a.inStock = inStock;
  return a;
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  try { jwt.verify(t, JWT_SECRET); next(); }
  catch (e) { res.status(401).json({ error: 'Не авторизован' }); }
}
const clamp = (v, n) => String(v == null ? '' : v).slice(0, n);
const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };

// Санитизация одной записи товара из выгрузки
function sanitizeProduct(p) {
  const sku = clamp(p.sku || p.article || '', 100).trim();
  if (!sku) return null;
  return {
    sku,
    brand: clamp(p.brand, 100),
    model: clamp(p.model || p.name, 200),
    grp: clamp(p.group || p.grp, 100),
    cat: clamp(p.cat || p.category, 100),
    descr: clamp(p.desc || p.descr || p.description, 2000),
    res: clamp(p.res, 100),
    price: Math.max(0, toInt(p.price)),
    oldprice: Math.max(0, toInt(p.oldprice)),
    promo: p.promo ? 1 : 0,
    stock: Math.max(0, toInt(p.stock)),
    img: clamp(p.img, 500),
    images: cleanImages(p.images),
    mp: clamp(p.mp, 30),
    conn: Array.isArray(p.conn) ? clamp(p.conn.join(','), 100) : clamp(p.conn, 100),
    type: clamp(p.type, 100)
  };
}
// Нормализуем список фото в JSON-массив ссылок (до 12 шт). Принимаем массив или JSON-строку.
function cleanImages(v) {
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch (e) { arr = v ? [v] : []; } }
  if (!Array.isArray(arr)) return '';
  const out = [];
  for (const u of arr) { const s = clamp(u, 500).trim(); if (s && !out.includes(s)) out.push(s); if (out.length >= 12) break; }
  return out.length ? JSON.stringify(out) : '';
}

const MAX_IMPORT = Number(process.env.MAX_IMPORT || 5000); // защита от гигантских/мусорных выгрузок

// ---------- HEALTH-CHECK ----------
app.get('/health', (req, res) => {
  try {
    const n = db.prepare('SELECT COUNT(*) c FROM products').get().c;
    res.json({ status: 'ok', products: n, uptime: Math.round(process.uptime()), env: NODE_ENV });
  } catch (e) { res.status(500).json({ status: 'error' }); }
});

// ---------- ПУБЛИЧНЫЙ API (каталог) ----------
// Поддерживает необязательную пагинацию ?limit=&offset= (по умолчанию отдаёт всё для клиентского фильтра)
app.get('/api/products', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 0, 5000);
  let sql = 'SELECT * FROM products WHERE visible=1 ORDER BY (price=0), brand, model';
  if (limit) sql += ' LIMIT ' + limit + ' OFFSET ' + (Number(req.query.offset) || 0);
  res.set('Cache-Control', 'public, max-age=120'); // лёгкое кэширование
  res.json(db.prepare(sql).all().map(rowToPublic));
});



// ---------- КАТЕГОРИИ (публично: только видимые) ----------
app.get('/api/categories', (req, res) => {
  res.set('Cache-Control', 'public, max-age=120');
  const all = db.prepare('SELECT name, parent FROM categories WHERE visible=1 ORDER BY sort_order, name').all();
  const tops = all.filter(c => !c.parent);
  // дерево: верхние категории + их видимые подкатегории
  const tree = tops.map(t => ({ name: t.name, subcategories: all.filter(c => c.parent === t.name).map(c => c.name) }));
  res.json(tree);
});

// ---------- ПРИЁМ ЗАЯВКИ (с сайта) ----------
// Сохраняет заявку в базу. Клиент отправляет {items:[{sku,qty}], contact?}
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Слишком много заявок, подождите минуту.' } });
app.post('/api/order', orderLimiter, (req, res) => {
  const { items, contact, name, phone } = req.body || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Пустая заявка' });
  if (items.length > 200) return res.status(413).json({ error: 'Слишком много позиций' });
  // собираем состав по реальным товарам из базы (не доверяем присланным названиям/ценам)
  const get = db.prepare('SELECT sku,brand,model FROM products WHERE id=? OR sku=?');
  const lines = [];
  let totalQty = 0;
  for (const it of items) {
    const qty = Math.max(1, Math.min(100000, Math.round(Number(it.qty) || 1)));
    const row = get.get(it.id != null ? it.id : null, String(it.sku || it.id || ''));
    if (!row) continue;
    lines.push({ sku: row.sku, brand: row.brand || '', model: row.model || '', qty });
    totalQty += qty;
  }
  if (!lines.length) return res.status(400).json({ error: 'Товары не распознаны' });
  const custName = clamp(name, 100);
  const custPhone = clamp(phone, 50);
  const contactStr = clamp(contact, 200) || [custName, custPhone].filter(Boolean).join(', ');
  const now = new Date().toISOString();
  const info = db.prepare(`INSERT INTO orders(ts,contact,cust_name,cust_phone,items_json,items_count,total_qty,status,ip)
    VALUES(?,?,?,?,?,?,?, 'new', ?)`).run(now, contactStr, custName, custPhone, JSON.stringify(lines), lines.length, totalQty, req.ip);
  // мгновенное уведомление в Telegram (если настроено)
  notifyOrder({ id: info.lastInsertRowid, ts: now, cust_name: custName, cust_phone: custPhone, items: lines, total_qty: totalQty });
  res.json({ ok: true, id: info.lastInsertRowid, items: lines.length });
});

// ---------- API ВЫГРУЗКИ ИЗ 1С ----------
app.post('/api/import', importLimiter, (req, res) => {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!safeEqual(t, IMPORT_TOKEN)) return res.status(401).json({ error: 'Неверный токен выгрузки' });

  const { products, source, fullSync } = req.body || {};
  if (!Array.isArray(products)) return res.status(400).json({ error: 'products должен быть массивом' });
  if (products.length > MAX_IMPORT) return res.status(413).json({ error: `Слишком много товаров за раз (макс ${MAX_IMPORT})` });

  const findBySku = db.prepare('SELECT id FROM products WHERE sku=?');
  const ins = db.prepare(`INSERT INTO products(sku,brand,model,grp,cat,descr,res,price,oldprice,promo,stock,img,images,mp,conn,type,created_at,updated_at)
    VALUES(@sku,@brand,@model,@grp,@cat,@descr,@res,@price,@oldprice,@promo,@stock,@img,@images,@mp,@conn,@type,@now,@now)`);
  const upd = db.prepare(`UPDATE products SET brand=@brand,model=@model,grp=@grp,cat=@cat,descr=@descr,res=@res,
    price=@price,stock=@stock,img=COALESCE(NULLIF(@img,''),img),images=COALESCE(NULLIF(@images,''),images),visible=1,updated_at=@now WHERE sku=@sku`);

  let created = 0, updated = 0, skipped = 0, deactivated = 0;
  const now = new Date().toISOString();
  const seenSkus = [];

  const tx = db.transaction(list => {
    for (const raw of list) {
      const rec = sanitizeProduct(raw);
      if (!rec) { skipped++; continue; }
      rec.now = now;
      seenSkus.push(rec.sku);
      if (findBySku.get(rec.sku)) { upd.run(rec); updated++; }
      else { ins.run(rec); created++; }
    }
    // fullSync: товары, которых НЕ было в этой полной выгрузке, снимаем с показа
    if (fullSync === true && seenSkus.length) {
      const placeholders = seenSkus.map(() => '?').join(',');
      const r = db.prepare(`UPDATE products SET visible=0, updated_at=? WHERE visible=1 AND sku NOT IN (${placeholders})`)
        .run(now, ...seenSkus);
      deactivated = r.changes;
    }
  });
  try {
    tx(products);
  } catch (e) {
    console.error('[import] ошибка транзакции:', e.message);
    return res.status(500).json({ error: 'Ошибка обработки выгрузки' });
  }

  db.prepare('INSERT INTO import_log(ts,source,received,created,updated,deactivated,skipped,note) VALUES(?,?,?,?,?,?,?,?)')
    .run(now, clamp(source || 'api', 100), products.length, created, updated, deactivated, skipped, fullSync ? 'fullSync' : '');
  // IndexNow: сообщаем поисковикам об изменённых товарах (ускоряет индексацию)
  if (seenSkus.length) pingIndexNow(seenSkus.map(productUrl));
  res.json({ ok: true, received: products.length, created, updated, deactivated, skipped });
});

// ---------- API БЫСТРОГО ОБНОВЛЕНИЯ ОСТАТКОВ (и опц. цены) ----------
// Только обновляет существующие товары по sku. НИЧЕГО не создаёт. Для частой (ежечасной) синхронизации.
// Тело: { items: [ { sku, stock, price? } ... ] }. price обновляется лишь если задан положительным числом.
app.post('/api/stock', importLimiter, (req, res) => {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!safeEqual(t, IMPORT_TOKEN)) return res.status(401).json({ error: 'Неверный токен выгрузки' });

  const { items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items должен быть массивом' });
  if (items.length > MAX_IMPORT) return res.status(413).json({ error: `Слишком много позиций за раз (макс ${MAX_IMPORT})` });

  const now = new Date().toISOString();
  const updStock      = db.prepare('UPDATE products SET stock=@stock, updated_at=@now WHERE sku=@sku');
  const updStockPrice = db.prepare('UPDATE products SET stock=@stock, price=@price, updated_at=@now WHERE sku=@sku');
  let updated = 0, missing = 0;

  const tx = db.transaction(list => {
    for (const raw of list) {
      const sku = clamp((raw || {}).sku || '', 100).trim();
      if (!sku) { missing++; continue; }
      const stock = Math.max(0, toInt(raw.stock));
      const price = toInt(raw.price);
      const r = (price > 0)
        ? updStockPrice.run({ sku, stock, price, now })
        : updStock.run({ sku, stock, now });
      if (r.changes > 0) updated++; else missing++;
    }
  });
  try { tx(items); }
  catch (e) { console.error('[stock] ошибка транзакции:', e.message); return res.status(500).json({ error: 'Ошибка обработки остатков' }); }

  db.prepare('INSERT INTO import_log(ts,source,received,created,updated,deactivated,skipped,note) VALUES(?,?,?,?,?,?,?,?)')
    .run(now, 'al-style-stock', items.length, 0, updated, 0, missing, 'stock');
  res.json({ ok: true, received: items.length, updated, missing });
});

// ---------- API СИНХРОНИЗАЦИИ ДЕРЕВА КАТЕГОРИЙ (бережное слияние) ----------
// Тело: { groups: [ { name, subs: [ ... ] } ] }.
// Новые категории добавляются (видимы), ушедшие из выгрузки — удаляются.
// Видимость, порядок и родитель уже существующих категорий НЕ перезаписываются —
// чтобы ручные настройки фильтров в админке не сбрасывались при каждом импорте.
app.post('/api/categories-sync', importLimiter, (req, res) => {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!safeEqual(t, IMPORT_TOKEN)) return res.status(401).json({ error: 'Неверный токен выгрузки' });

  const { groups } = req.body || {};
  if (!Array.isArray(groups)) return res.status(400).json({ error: 'groups должен быть массивом' });

  const now = new Date().toISOString();
  const ins = db.prepare('INSERT OR IGNORE INTO categories(name,parent,visible,sort_order,created_at) VALUES(?,?,1,?,?)');
  const has = db.prepare('SELECT id FROM categories WHERE name=?');
  let added = 0, kept = 0, removed = 0;
  const incoming = new Set();

  const tx = db.transaction(() => {
    let sg = 1;
    for (const g of groups) {
      const name = clamp((g || {}).name || '', 100).trim();
      if (!name) continue;
      incoming.add(name);
      if (has.get(name)) kept++; else { ins.run(name, '', sg, now); added++; }
      sg++;
      let ss = 1;
      for (const s of (g.subs || [])) {
        const sub = clamp(s || '', 100).trim();
        if (!sub || sub === name) continue;
        incoming.add(sub);
        if (has.get(sub)) kept++; else { ins.run(sub, name, ss, now); added++; }
        ss++;
      }
    }
    // убираем только то, чего больше нет в выгрузке (ручные настройки оставшихся сохраняются)
    if (incoming.size) {
      const names = [...incoming];
      const ph = names.map(() => '?').join(',');
      removed = db.prepare(`DELETE FROM categories WHERE name NOT IN (${ph})`).run(...names).changes;
    }
  });
  try { tx(); }
  catch (e) { console.error('[categories-sync] ошибка:', e.message); return res.status(500).json({ error: 'Ошибка обновления категорий' }); }
  res.json({ ok: true, added, kept, removed });
});

// ---------- АДМИНКА: авторизация ----------
app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!verifyPassword((req.body || {}).password || '', ADMIN_HASH)) {
    console.warn(`[auth] неудачный вход в админку с IP ${req.ip} в ${new Date().toISOString()}`);
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' }) });
});

// ---------- АДМИНКА: CRUD ----------
app.get('/api/admin/products', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY brand,model').all().map(rowToAdmin));
});
app.post('/api/admin/products', auth, (req, res) => {
  const rec = sanitizeProduct({ ...req.body, sku: req.body.sku || ('new-' + Date.now()) });
  if (!rec) return res.status(400).json({ error: 'Некорректные данные' });
  const now = new Date().toISOString(); rec.now = now;
  try {
    const info = db.prepare(`INSERT INTO products(sku,brand,model,grp,cat,descr,res,price,oldprice,promo,stock,img,mp,conn,type,created_at,updated_at)
      VALUES(@sku,@brand,@model,@grp,@cat,@descr,@res,@price,@oldprice,@promo,@stock,@img,@mp,@conn,@type,@now,@now)`).run(rec);
    pingIndexNow([productUrl(rec.sku)]);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Товар с таким артикулом уже есть' });
    throw e;
  }
});
app.put('/api/admin/products/:id', auth, (req, res) => {
  const rec = sanitizeProduct(req.body);
  if (!rec) return res.status(400).json({ error: 'Некорректные данные' });
  rec.id = Number(req.params.id);
  rec.visible = req.body.visible === false ? 0 : 1;
  rec.now = new Date().toISOString();
  const r = db.prepare(`UPDATE products SET brand=@brand,model=@model,grp=@grp,cat=@cat,descr=@descr,res=@res,
    price=@price,oldprice=@oldprice,promo=@promo,stock=@stock,img=@img,mp=@mp,conn=@conn,type=@type,visible=@visible,updated_at=@now WHERE id=@id`).run(rec);
  if (!r.changes) return res.status(404).json({ error: 'Товар не найден' });
  const skuRow = db.prepare('SELECT sku FROM products WHERE id=?').get(rec.id);
  if (skuRow) pingIndexNow([productUrl(skuRow.sku)]);
  res.json({ ok: true });
});
app.delete('/api/admin/products/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM products WHERE id=?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'Товар не найден' });
  res.json({ ok: true });
});

// массовое изменение цен — округление применяется к ТОЙ ЖЕ выборке (исправлен баг)
app.post('/api/admin/bulk-price', auth, (req, res) => {
  const { pct, brand, group, round } = req.body || {};
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return res.status(400).json({ error: 'pct обязателен (число)' });
  let where = ' WHERE price>0';
  const args = [];
  if (brand) { where += ' AND brand=?'; args.push(brand); }
  if (group) { where += ' AND grp=?'; args.push(group); }
  const info = db.prepare('UPDATE products SET price=CAST(price*(1+?/100.0) AS INTEGER)' + where).run(pct, ...args);
  if (round && Number(round) > 0) {
    db.prepare('UPDATE products SET price=ROUND(price/?)*?' + where).run(Number(round), Number(round), ...args);
  }
  res.json({ ok: true, changed: info.changes });
});
app.get('/api/admin/import-log', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM import_log ORDER BY id DESC LIMIT 30').all());
});


// ---------- АДМИНКА: загрузка фото (base64, без сторонних модулей) ----------
app.post('/api/admin/upload', auth, (req, res) => {
  const { filename, data } = req.body || {};
  if (!filename || !data) return res.status(400).json({ error: 'filename и data обязательны' });
  const safe = String(filename).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  if (!/\.(png|jpe?g|webp)$/i.test(safe)) return res.status(400).json({ error: 'Только png, jpg или webp' });
  const b64 = String(data).replace(/^data:image\/[a-zA-Z]+;base64,/, '');
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return res.status(400).json({ error: 'Некорректные данные изображения' }); }
  if (buf.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'Файл больше 3 МБ' });
  // Проверка сигнатуры (magic bytes): реально ли это изображение, а не переименованный файл
  const isPNG = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  const isJPG = buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
  const isWEBP = buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if (!isPNG && !isJPG && !isWEBP) return res.status(400).json({ error: 'Файл не является изображением (png/jpg/webp)' });
  try {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMAGES_DIR, safe), buf);
    res.json({ ok: true, img: safe });
  } catch (e) { console.error('[upload]', e.message); res.status(500).json({ error: 'Не удалось сохранить файл' }); }
});




// ---------- АДМИНКА: импорт каталога из Excel/CSV ----------
// Принимает файл (base64), парсит, сопоставляет колонки, обновляет каталог (upsert по артикулу).
const COLMAP = {
  sku:['sku','артикул','код','код товара','sku/артикул'],
  brand:['brand','бренд','производитель','марка'],
  model:['model','модель','название','наименование','товар'],
  group:['group','направление','раздел','категория товара'],
  cat:['cat','категория','тип','подкатегория'],
  desc:['desc','описание','характеристики'],
  res:['res','разрешение','хар-ки'],
  price:['price','цена','цена ррц','ррц','розница','стоимость'],
  stock:['stock','остаток','наличие','кол-во','количество'],
  img:['img','фото','изображение','картинка','image']
};
function detectCol(headers){
  const map={};
  headers.forEach((h,i)=>{
    const low=String(h||'').trim().toLowerCase();
    for(const field in COLMAP){ if(COLMAP[field].includes(low)){ map[field]=i; break; } }
  });
  return map;
}
app.post('/api/admin/import-file', auth, (req, res) => {
  const { filename, data } = req.body || {};
  if (!data) return res.status(400).json({ error: 'Файл не передан' });
  let rows;
  try {
    const b64 = String(data).replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ error: 'Файл больше 10 МБ' });
    const wb = XLSX.read(buf, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
  } catch (e) { console.error('[import-file]', e.message); return res.status(400).json({ error: 'Не удалось прочитать файл (нужен .xlsx или .csv)' }); }
  if (!rows || rows.length < 2) return res.status(400).json({ error: 'В файле нет данных (нужна строка заголовков + товары)' });

  const headers = rows[0];
  const col = detectCol(headers);
  if (col.sku === undefined && col.model === undefined)
    return res.status(400).json({ error: 'Не найдены колонки. Нужны хотя бы «Артикул» или «Модель». Заголовки: ' + headers.join(', ') });

  const findBySku = db.prepare('SELECT id FROM products WHERE sku=?');
  const ins = db.prepare(`INSERT INTO products(sku,brand,model,grp,cat,descr,res,price,oldprice,promo,stock,img,mp,conn,type,created_at,updated_at)
    VALUES(@sku,@brand,@model,@grp,@cat,@descr,@res,@price,0,0,@stock,@img,'','','',@now,@now)`);
  const upd = db.prepare(`UPDATE products SET brand=@brand,model=@model,grp=COALESCE(NULLIF(@grp,''),grp),cat=@cat,descr=@descr,res=@res,
    price=@price,stock=@stock,img=COALESCE(NULLIF(@img,''),img),updated_at=@now WHERE sku=@sku`);
  const get = (r, f) => col[f] !== undefined ? r[col[f]] : '';
  let created = 0, updated = 0, skipped = 0;
  const now = new Date().toISOString();
  const changed = [];
  const tx = db.transaction(list => {
    for (let i = 1; i < list.length; i++) {
      const r = list[i]; if (!r || !r.length) { continue; }
      let sku = clamp(get(r, 'sku'), 100).trim();
      const model = clamp(get(r, 'model'), 200);
      if (!sku && model) sku = 'imp-' + model.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').slice(0, 50);
      if (!sku) { skipped++; continue; }
      const rec = { sku, brand: clamp(get(r,'brand'),100), model, grp: clamp(get(r,'group'),100),
        cat: clamp(get(r,'cat'),100), descr: clamp(get(r,'desc'),2000), res: clamp(get(r,'res'),100),
        price: Math.max(0, Math.round(Number(String(get(r,'price')).replace(/[^\d.]/g,'')) || 0)),
        stock: Math.max(0, Math.round(Number(String(get(r,'stock')).replace(/[^\d.]/g,'')) || 0)),
        img: clamp(get(r,'img'),500), now };
      if (findBySku.get(sku)) { upd.run(rec); updated++; } else { ins.run(rec); created++; }
      changed.push(sku);
    }
  });
  try { tx(rows); } catch (e) { console.error('[import-file] tx', e.message); return res.status(500).json({ error: 'Ошибка записи в базу' }); }
  db.prepare('INSERT INTO import_log(ts,source,received,created,updated,deactivated,skipped,note) VALUES(?,?,?,?,?,0,?,?)')
    .run(now, 'файл: ' + clamp(filename || '', 80), rows.length - 1, created, updated, skipped, 'admin upload');
  if (changed.length) pingIndexNow(changed.map(productUrl));
  res.json({ ok: true, created, updated, skipped, total: rows.length - 1 });
});

// ---------- АДМИНКА: заявки ----------
app.get('/api/admin/orders', auth, (req, res) => {
  const status = req.query.status;
  let sql = 'SELECT * FROM orders';
  const args = [];
  if (status === 'new' || status === 'done') { sql += ' WHERE status=?'; args.push(status); }
  sql += ' ORDER BY id DESC LIMIT 200';
  const rows = db.prepare(sql).all(...args).map(o => ({
    id: o.id, ts: o.ts, contact: o.contact || '', name: o.cust_name || '', phone: o.cust_phone || '',
    items: JSON.parse(o.items_json || '[]'),
    items_count: o.items_count, total_qty: o.total_qty, status: o.status, note: o.note || ''
  }));
  const counts = { new: db.prepare("SELECT COUNT(*) c FROM orders WHERE status='new'").get().c,
                   total: db.prepare('SELECT COUNT(*) c FROM orders').get().c };
  res.json({ orders: rows, counts });
});
app.put('/api/admin/orders/:id', auth, (req, res) => {
  const { status, note } = req.body || {};
  const st = status === 'new' || status === 'done' ? status : null;
  // done_at: ставим при переходе в «обработана», снимаем при возврате в «новая»
  const doneAt = st === 'done' ? new Date().toISOString() : (st === 'new' ? null : undefined);
  const r = db.prepare(`UPDATE orders SET status=COALESCE(?,status), note=COALESCE(?,note)${doneAt !== undefined ? ', done_at=?' : ''} WHERE id=?`)
    .run(...(doneAt !== undefined
      ? [st, note != null ? clamp(note, 1000) : null, doneAt, Number(req.params.id)]
      : [st, note != null ? clamp(note, 1000) : null, Number(req.params.id)]));
  if (!r.changes) return res.status(404).json({ error: 'Заявка не найдена' });
  res.json({ ok: true });
});
app.delete('/api/admin/orders/:id', auth, (req, res) => {
  db.prepare('DELETE FROM orders WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});



// ---------- АДМИНКА: управление категориями ----------
app.get('/api/admin/categories', auth, (req, res) => {
  // отдаём категории + счётчик товаров в каждой (для удобства)
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  const counts = {};
  db.prepare('SELECT grp, COUNT(*) c FROM products WHERE visible=1 GROUP BY grp').all().forEach(r => { counts[r.grp] = r.c; });
  const catCounts = {};
  db.prepare('SELECT cat, COUNT(*) c FROM products WHERE visible=1 GROUP BY cat').all().forEach(r => { catCounts[r.cat] = r.c; });
  res.json(cats.map(c => ({ id: c.id, name: c.name, parent: c.parent || '', visible: !!c.visible, sort_order: c.sort_order, products: (counts[c.name] || 0) + (c.parent ? (catCounts[c.name] || 0) : 0) })));
});
app.post('/api/admin/categories', auth, (req, res) => {
  const name = clamp((req.body || {}).name, 100).trim();
  if (!name) return res.status(400).json({ error: 'Название обязательно' });
  try {
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM categories').get().m;
    const info = db.prepare('INSERT INTO categories(name,parent,visible,sort_order,created_at) VALUES(?,?,?,?,?)')
      .run(name, clamp(req.body.parent, 100), req.body.visible === false ? 0 : 1, maxSort + 1, new Date().toISOString());
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Такая категория уже есть' });
    throw e;
  }
});
app.put('/api/admin/categories/:id', auth, (req, res) => {
  const b = req.body || {};
  const cur = db.prepare('SELECT * FROM categories WHERE id=?').get(Number(req.params.id));
  if (!cur) return res.status(404).json({ error: 'Категория не найдена' });
  const newName = b.name != null ? clamp(b.name, 100).trim() : cur.name;
  const visible = b.visible != null ? (b.visible ? 1 : 0) : cur.visible;
  const sort = b.sort_order != null ? Number(b.sort_order) : cur.sort_order;
  try {
    db.prepare('UPDATE categories SET name=?, visible=?, sort_order=? WHERE id=?').run(newName, visible, sort, cur.id);
    // если переименовали — переносим связь у товаров: подкатегория связана через cat, раздел — через grp
    if (newName !== cur.name) {
      if (cur.parent) db.prepare('UPDATE products SET cat=? WHERE cat=?').run(newName, cur.name);
      else db.prepare('UPDATE products SET grp=? WHERE grp=?').run(newName, cur.name);
    }
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Категория с таким названием уже есть' });
    throw e;
  }
});
app.delete('/api/admin/categories/:id', auth, (req, res) => {
  const cur = db.prepare('SELECT name, parent FROM categories WHERE id=?').get(Number(req.params.id));
  if (!cur) return res.status(404).json({ error: 'Категория не найдена' });
  const col = cur.parent ? 'cat' : 'grp';
  const cnt = db.prepare(`SELECT COUNT(*) c FROM products WHERE ${col}=?`).get(cur.name).c;
  if (cnt > 0 && !req.query.force) return res.status(409).json({ error: `В категории ${cnt} товаров. Удаление переместит их в «без категории». Повторите с подтверждением.`, count: cnt });
  db.prepare('DELETE FROM categories WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});


// ---------- АДМИНКА: экспорт заявок в Excel ----------
app.get('/api/admin/orders/export', auth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  // плоская таблица: одна строка на позицию заявки
  const rows = [['№ заявки', 'Дата', 'Статус', 'Имя', 'Телефон', 'Бренд', 'Модель', 'Артикул', 'Кол-во', 'Заметка']];
  orders.forEach(o => {
    const items = JSON.parse(o.items_json || '[]');
    const d = new Date(o.ts).toLocaleString('ru-RU');
    const st = o.status === 'done' ? 'обработана' : 'новая';
    if (!items.length) { rows.push([o.id, d, st, o.cust_name || '', o.cust_phone || '', '', '', '', '', o.note || '']); return; }
    items.forEach((it, idx) => {
      rows.push([idx === 0 ? o.id : '', idx === 0 ? d : '', idx === 0 ? st : '',
        idx === 0 ? (o.cust_name || '') : '', idx === 0 ? (o.cust_phone || '') : '',
        it.brand || '', it.model || '', it.sku || '', it.qty, idx === 0 ? (o.note || '') : '']);
    });
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 9 }, { wch: 18 }, { wch: 11 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 26 }, { wch: 16 }, { wch: 8 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Заявки');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fname = `zayavki_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
  res.send(buf);
});

// ---------- АДМИНКА: дашборд (статистика) ----------
app.get('/api/admin/stats', auth, (req, res) => {
  const now = Date.now(); const day = 864e5; const iso = ms => new Date(ms).toISOString();

  // ---------- ТОВАРЫ (здоровье каталога) ----------
  const total     = db.prepare('SELECT COUNT(*) c FROM products WHERE visible=1').get().c;
  const inStock   = db.prepare('SELECT COUNT(*) c FROM products WHERE visible=1 AND stock>0').get().c;
  const promo     = db.prepare('SELECT COUNT(*) c FROM products WHERE visible=1 AND promo=1').get().c;
  const noPrice   = db.prepare('SELECT COUNT(*) c FROM products WHERE visible=1 AND (price=0 OR price IS NULL)').get().c;
  const withPhoto = db.prepare("SELECT COUNT(*) c FROM products WHERE visible=1 AND img IS NOT NULL AND img<>''").get().c;
  const hidden    = db.prepare('SELECT COUNT(*) c FROM products WHERE visible=0').get().c;
  const stale7d   = db.prepare('SELECT COUNT(*) c FROM products WHERE visible=1 AND (updated_at IS NULL OR updated_at < ?)').get(iso(now - 7 * day)).c;
  const byGroup   = db.prepare('SELECT grp, COUNT(*) c FROM products WHERE visible=1 GROUP BY grp ORDER BY c DESC').all();
  const categoriesVisible = db.prepare('SELECT COUNT(*) c FROM categories WHERE visible=1').get().c;

  // карта товаров для анализа состава заявок (sku -> цена/склад/видимость/раздел)
  const prodMap = new Map();
  db.prepare('SELECT sku, grp, price, stock, visible FROM products').all().forEach(p => prodMap.set(String(p.sku), p));

  // ---------- ЗАЯВКИ ----------
  const oNew   = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='new'").get().c;
  const oDone  = db.prepare("SELECT COUNT(*) c FROM orders WHERE status='done'").get().c;
  const oTotal = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  const o24h   = db.prepare('SELECT COUNT(*) c FROM orders WHERE ts >= ?').get(iso(now - day)).c;
  const oWeek  = db.prepare('SELECT COUNT(*) c FROM orders WHERE ts >= ?').get(iso(now - 7 * day)).c;
  const oMonth = db.prepare('SELECT COUNT(*) c FROM orders WHERE ts >= ?').get(iso(now - 30 * day)).c;
  const oPrev  = db.prepare('SELECT COUNT(*) c FROM orders WHERE ts >= ? AND ts < ?').get(iso(now - 60 * day), iso(now - 30 * day)).c;
  const growthPct = oPrev ? Math.round((oMonth - oPrev) / oPrev * 100) : (oMonth ? 100 : 0);
  const avgItems = oTotal ? +((db.prepare('SELECT AVG(items_count) a FROM orders').get().a) || 0).toFixed(1) : 0;
  const oldestT = db.prepare("SELECT MIN(ts) t FROM orders WHERE status='new'").get().t;
  const oldestNewDays = oldestT ? Math.floor((now - new Date(oldestT).getTime()) / day) : null;
  const respRow = db.prepare("SELECT AVG(julianday(done_at)-julianday(ts)) a FROM orders WHERE status='done' AND done_at IS NOT NULL").get();
  const avgResponseDays = respRow && respRow.a != null ? +respRow.a.toFixed(1) : null;

  // динамика заявок по дням за 30 дней (для графика)
  const dailyRows = db.prepare("SELECT substr(ts,1,10) d, COUNT(*) c FROM orders WHERE ts>=? GROUP BY d").all(iso(now - 30 * day));
  const dmap = {}; dailyRows.forEach(r => dmap[r.d] = r.c);
  const ordersDaily = [];
  for (let i = 29; i >= 0; i--) { const ds = iso(now - i * day).slice(0, 10); ordersDaily.push({ d: ds, c: dmap[ds] || 0 }); }

  // один проход по заявкам: спрос (товары/бренды/категории) + пайплайн + неудовлетворённый спрос
  const allOrders = db.prepare('SELECT items_json, status FROM orders').all();
  const dProd = {}, dBrand = {}, dCat = {}, unmet = {};
  let pipeline = 0;
  allOrders.forEach(o => {
    let items = []; try { items = JSON.parse(o.items_json || '[]'); } catch (e) {}
    items.forEach(it => {
      const qty = Math.max(1, Number(it.qty) || 1);
      const name = ((it.brand ? it.brand + ' ' : '') + (it.model || '')).trim() || String(it.sku || '—');
      dProd[name] = (dProd[name] || 0) + qty;
      if (it.brand) dBrand[it.brand] = (dBrand[it.brand] || 0) + qty;
      const p = prodMap.get(String(it.sku));
      if (p) {
        if (p.grp) dCat[p.grp] = (dCat[p.grp] || 0) + qty;
        if (o.status === 'new') pipeline += (p.price || 0) * qty;
        let reason = '';
        if (p.visible === 0) reason = 'скрыт';
        else if (!p.price) reason = 'без цены';
        else if (!(p.stock > 0)) reason = 'нет в наличии';
        if (reason) { const k = name + '|' + reason; (unmet[k] = unmet[k] || { name, reason, qty: 0 }).qty += qty; }
      } else {
        const k = name + '|нет в каталоге'; (unmet[k] = unmet[k] || { name, reason: 'нет в каталоге', qty: 0 }).qty += qty;
      }
    });
  });
  const topN = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, qty]) => ({ name, qty }));
  const topDemand = topN(dProd, 8);
  const topBrands = topN(dBrand, 6);
  const topCats   = topN(dCat, 6);
  const unmetDemand = Object.values(unmet).sort((a, b) => b.qty - a.qty).slice(0, 8);

  // ---------- СВЕЖЕСТЬ СИНХРОНИЗАЦИИ ----------
  const lastImport = db.prepare('SELECT ts, source, created, updated, deactivated, skipped, note FROM import_log ORDER BY id DESC LIMIT 1').get() || null;
  const importAgeHours = lastImport && lastImport.ts ? Math.round((now - new Date(lastImport.ts).getTime()) / 36e5) : null;

  res.json({
    products: { total, inStock, outStock: total - inStock, promo, noPrice, withPhoto, noPhoto: total - withPhoto, hidden, stale7d },
    orders: { new: oNew, done: oDone, total: oTotal, last24h: o24h, week: oWeek, month: oMonth, prevMonth: oPrev, growthPct, avgItems, oldestNewDays, avgResponseDays, pipeline },
    ordersDaily, byGroup, categoriesVisible,
    topDemand, topBrands, topCats, unmetDemand,
    sync: { lastImport, importAgeHours }
  });
});

// ---------- АДМИНКА: настройки сайта (Метрика, верификация поисковиков) ----------
app.get('/api/admin/settings', auth, (req, res) => {
  res.json({
    ym_id: SETTINGS.ym_id || '',
    yandex_verification: SETTINGS.yandex_verification || '',
    google_verification: SETTINGS.google_verification || ''
  });
});
app.post('/api/admin/settings', auth, (req, res) => {
  const b = req.body || {};
  const clean = {
    ym_id: String(b.ym_id || '').replace(/[^0-9]/g, '').slice(0, 20),
    yandex_verification: String(b.yandex_verification || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 100),
    google_verification: String(b.google_verification || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 120)
  };
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction(() => { for (const k in clean) up.run(k, clean[k]); });
  try { tx(); } catch (e) { console.error('[settings]', e.message); return res.status(500).json({ error: 'Не удалось сохранить настройки' }); }
  Object.assign(SETTINGS, clean); // применяем сразу, без перезапуска сервера
  res.json({ ok: true });
});

// ---------- СТРАНИЦА ТОВАРА (SEO) ----------
app.get('/product/:sku', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE sku=? AND visible=1').get(req.params.sku);
  if (!row) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  const p = rowToPublic(row);
  p.id = row.id; p.images = row.images || ''; // галерея фото для страницы товара
  // похожие: тот же раздел, другие товары
  const related = db.prepare('SELECT * FROM products WHERE grp=? AND sku<>? AND visible=1 ORDER BY (price=0), RANDOM() LIMIT 4')
    .all(row.grp, row.sku).map(rowToPublic);
  res.set('Cache-Control', 'public, max-age=300');
  res.send(applySeo(renderProductPage(p, related)));
});


// robots.txt — динамически, с правильным доменом
app.get('/robots.txt', (req, res) => {
  const SITE = process.env.SITE_URL || 'https://servis-com.kz';
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`);
});

// ---------- ДИНАМИЧЕСКИЙ SITEMAP (с товарами) ----------
app.get('/sitemap.xml', (req, res) => {
  const SITE = process.env.SITE_URL || 'https://servis-com.kz';
  const pages = ['/', '/videonablyudenie.html', '/setevoe.html', '/pozharnaya.html', '/skud.html'];
  const prods = db.prepare('SELECT sku, updated_at, img FROM products WHERE visible=1').all();
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';
  pages.forEach(u => xml += `<url><loc>${SITE}${u}</loc><changefreq>weekly</changefreq><priority>${u==='/'?'1.0':'0.8'}</priority></url>\n`);
  prods.forEach(p => {
    const lm = p.updated_at ? `<lastmod>${String(p.updated_at).slice(0,10)}</lastmod>` : '';
    let imgTag = '';
    if (p.img) { const src = /^https?:\/\//i.test(p.img) ? p.img : `${SITE}/images/${p.img}`; imgTag = `<image:image><image:loc>${src.replace(/&/g,'&amp;')}</image:loc></image:image>`; }
    xml += `<url><loc>${SITE}/product/${encodeURIComponent(p.sku)}</loc>${lm}${imgTag}<changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
  });
  xml += '</urlset>';
  res.type('application/xml').send(xml);
});

// IndexNow: файл-ключ (поисковик проверяет владение)
app.get('/:key.txt', (req, res, next) => {
  if (INDEXNOW_KEY && req.params.key === INDEXNOW_KEY) return res.type('text/plain').send(INDEXNOW_KEY);
  next();
});


// ---------- статика ----------
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/images', express.static(IMAGES_DIR, { maxAge: '7d', immutable: false }));

// Подстановка ID Яндекс.Метрики в статические HTML-страницы каталога
app.get(/\.html$|^\/$/, (req, res, next) => {
  let file = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  const fp = path.join(__dirname, 'public', file);
  fs.readFile(fp, 'utf8', (err, html) => {
    if (err) return next();
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(applySeo(html));
  });
});

app.use('/', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => {
    if (/\.(js|css)$/.test(p)) res.set('Cache-Control', 'no-cache'); // всегда сверять свежесть JS/CSS после деплоя (нет старого кеша)
  }
}));

// ---------- обработка ошибок ----------
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Не найдено' });
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html')); // фирменная страница 404
});
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (err.message === 'CORS') return res.status(403).json({ error: 'CORS: источник не разрешён' });
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});


// Автозагрузка стартового каталога при первом запуске (если база пуста и SEED_ON_EMPTY=true)
if (String(process.env.SEED_ON_EMPTY).toLowerCase() === 'true') {
  try {
    const cnt = db.prepare('SELECT COUNT(*) c FROM products').get().c;
    if (cnt === 0) {
      const fs2 = require('fs'); const seedFile = path.join(__dirname, 'scripts', 'seed-products.json');
      if (fs2.existsSync(seedFile)) {
        const items = JSON.parse(fs2.readFileSync(seedFile, 'utf8'));
        const now = new Date().toISOString();
        const ins = db.prepare(`INSERT OR IGNORE INTO products(sku,brand,model,grp,cat,descr,res,price,oldprice,promo,stock,img,mp,conn,type,created_at,updated_at)
          VALUES(@sku,@brand,@model,@grp,@cat,@descr,@res,@price,@oldprice,@promo,0,@img,@mp,@conn,@type,@now,@now)`);
        const tx = db.transaction(list => { for (const p of list) ins.run({ sku: p.id, brand: p.brand||'', model: p.model||'', grp: p.group||'', cat: p.cat||'', descr: p.desc||'', res: p.res||'', price: Math.round(+p.price||0), oldprice: Math.round(+p.oldprice||0), promo: p.promo?1:0, img: p.img||'', mp: p.mp||'', conn: Array.isArray(p.conn)?p.conn.join(','):(p.conn||''), type: p.type||'', now }); });
        tx(items);
        console.log('[seed] стартовый каталог загружен:', items.length, 'товаров');
      }
    }
    // категории
    const catCnt = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
    if (catCnt === 0) {
      const fs3 = require('fs'); const catFile = path.join(__dirname, 'scripts', 'seed-categories.json');
      if (fs3.existsSync(catFile)) {
        const cats = JSON.parse(fs3.readFileSync(catFile, 'utf8'));
        const now2 = new Date().toISOString();
        const insC = db.prepare('INSERT OR IGNORE INTO categories(name,parent,visible,sort_order,created_at) VALUES(?,?,?,?,?)');
        const txC = db.transaction(list => { for (const c of list) insC.run(c.name, c.parent || '', c.visible ? 1 : 0, c.sort_order || 100, now2); });
        txC(cats);
        console.log('[seed] категории загружены:', cats.length);
      }
    }
  } catch (e) { console.warn('[seed] автозагрузка пропущена:', e.message); }
}

const server = app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT} (${NODE_ENV})`));

// Корректное завершение: закрываем приём соединений и базу
function shutdown(sig) {
  console.log(`[${sig}] завершение работы...`);
  server.close(() => {
    try { db.close(); } catch (e) {}
    console.log('Сервер остановлен корректно.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref(); // форс-выход, если зависло
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
