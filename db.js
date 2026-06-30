// База данных SQLite — схема и подключение
const Database=require('better-sqlite3');
const path=require('path');
const DB_PATH=process.env.DB_PATH||path.join(__dirname,'data.sqlite');
const db=new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  brand TEXT, model TEXT, grp TEXT, cat TEXT,
  descr TEXT, res TEXT,
  price INTEGER DEFAULT 0,
  oldprice INTEGER DEFAULT 0,
  promo INTEGER DEFAULT 0,
  stock INTEGER DEFAULT 0,
  img TEXT, mp TEXT, conn TEXT, type TEXT,
  visible INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_grp     ON products(grp);
CREATE INDEX IF NOT EXISTS idx_brand   ON products(brand);
CREATE INDEX IF NOT EXISTS idx_visible ON products(visible);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku ON products(sku);

CREATE TABLE IF NOT EXISTS import_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT, source TEXT, received INTEGER, created INTEGER,
  updated INTEGER, deactivated INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0, note TEXT
);

CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,                       -- когда оставлена
  contact TEXT,                  -- имя/телефон одной строкой (совместимость)
  cust_name TEXT,                -- имя клиента
  cust_phone TEXT,               -- телефон клиента
  items_json TEXT,               -- состав заявки (JSON: [{sku,brand,model,qty}])
  items_count INTEGER DEFAULT 0, -- сколько позиций
  total_qty INTEGER DEFAULT 0,   -- сколько штук всего
  status TEXT DEFAULT 'new',     -- new | done
  note TEXT,                     -- заметка менеджера
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_ts ON orders(ts);

CREATE TABLE IF NOT EXISTS categories(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cat_id INTEGER UNIQUE,          -- ID категории Al-Style (стабильный ключ; имена могут повторяться)
  parent_id INTEGER DEFAULT 0,    -- ID родителя в дереве (0 = верхний уровень внутри группы)
  grp TEXT DEFAULT '',            -- наша группа-раздел (Видеонаблюдение и т.п.)
  name TEXT,
  depth INTEGER DEFAULT 0,
  visible INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 100,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cat_visible ON categories(visible);

CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT
);

-- ====== Мультипоставщик (Этап 1: фундамент) — всё аддитивно ======
-- Поставщики (включая 1С). 1С заводится как поставщик kind='1c'.
CREATE TABLE IF NOT EXISTS suppliers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,                 -- 'alstyle','1c','supplier2'…
  name TEXT,
  kind TEXT DEFAULT 'api',          -- api | file | 1c
  priority INTEGER DEFAULT 100,     -- меньше = приоритетнее (1С обычно 0)
  markup_pct REAL DEFAULT 40,       -- наценка по умолчанию, процент (40 = +40%)
  active INTEGER DEFAULT 1,
  config TEXT,                      -- JSON: база API, имя env с токеном, формат и т.п.
  updated_at TEXT
);

-- Офферы: одна строка = товар у конкретного поставщика (сырьё)
CREATE TABLE IF NOT EXISTS offers(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  ext_id TEXT NOT NULL,             -- SKU/id у поставщика
  ext_category TEXT,                -- категория у поставщика (id или путь)
  brand TEXT, mpn TEXT, mpn_norm TEXT, ean TEXT,
  name TEXT,
  price_buy REAL DEFAULT 0,         -- закуп
  price_rrp REAL DEFAULT 0,         -- РРЦ поставщика (если есть)
  stock INTEGER DEFAULT 0,          -- остаток у поставщика
  currency TEXT DEFAULT 'KZT',
  raw TEXT,                         -- JSON исходника
  product_id INTEGER DEFAULT 0,     -- к какому товару привязан (после склейки)
  seen_at TEXT,                     -- когда последний раз пришёл в выгрузке
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_off_uni   ON offers(supplier_id, ext_id);
CREATE INDEX IF NOT EXISTS idx_off_match ON offers(brand, mpn_norm);
CREATE INDEX IF NOT EXISTS idx_off_ean   ON offers(ean);
CREATE INDEX IF NOT EXISTS idx_off_prod  ON offers(product_id);
CREATE INDEX IF NOT EXISTS idx_off_sup   ON offers(supplier_id);

-- Маппинг: категория поставщика → твоя категория (cat_id из categories)
CREATE TABLE IF NOT EXISTS category_map(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  ext_category TEXT NOT NULL,
  cat_id INTEGER DEFAULT 0,         -- твоя категория (0 = ещё не размечено)
  auto INTEGER DEFAULT 0,           -- 1 = подсказано автоматически
  confirmed INTEGER DEFAULT 0,      -- 1 = подтверждено вручную
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmap_uni ON category_map(supplier_id, ext_category);

-- Правила наценки (приоритетнее markup поставщика)
CREATE TABLE IF NOT EXISTS price_rules(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT,                       -- category | brand | supplier | global
  key TEXT,                         -- cat_id / бренд / supplier_id / ''
  markup_pct REAL DEFAULT 40,
  priority INTEGER DEFAULT 100,
  active INTEGER DEFAULT 1
);

-- Очередь конфликтов склейки (ручная проверка)
CREATE TABLE IF NOT EXISTS match_queue(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER,
  reason TEXT,                      -- conflict | ambiguous
  candidates TEXT,                  -- JSON: id товаров-кандидатов
  status TEXT DEFAULT 'open',       -- open | resolved
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mq_status ON match_queue(status);

-- FAQ (управляется из админки), по страницам: home|video|setevoe|skud|pozharnaya
CREATE TABLE IF NOT EXISTS faq(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page TEXT DEFAULT 'home',
  q TEXT, a TEXT,
  sort_order INTEGER DEFAULT 0,
  visible INTEGER DEFAULT 1,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_faq_page ON faq(page, sort_order);
`);

// мягкая миграция: добити колонки, если базе уже была создана старой версией
function ensureColumn(table,col,ddl){
  const cols=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
  if(!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('products','created_at','created_at TEXT');
ensureColumn('products','images','images TEXT');
ensureColumn('products','cat_id','cat_id INTEGER DEFAULT 0'); // ID листовой категории Al-Style
ensureColumn('products','cat_path','cat_path TEXT'); // путь категорий (JSON: [id верхнего..id листа])
ensureColumn('import_log','deactivated','deactivated INTEGER DEFAULT 0');
ensureColumn('import_log','skipped','skipped INTEGER DEFAULT 0');
ensureColumn('orders','cust_name','cust_name TEXT');
ensureColumn('orders','cust_phone','cust_phone TEXT');
ensureColumn('orders','done_at','done_at TEXT');
ensureColumn('orders','amount','amount REAL DEFAULT 0'); // сумма продажи (ставится при статусе «Заказ»)

// Миграция categories на дерево по ID Al-Style: если таблица старого вида (без cat_id) —
// пересоздаём (категории всё равно восстанавливаются при следующем импорте).
try {
  const cols = db.prepare("PRAGMA table_info(categories)").all();
  if (cols.length && !cols.some(c => c.name === 'cat_id')) {
    db.exec('DROP TABLE IF EXISTS categories');
    db.exec(`CREATE TABLE categories(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cat_id INTEGER UNIQUE, parent_id INTEGER DEFAULT 0, grp TEXT DEFAULT '',
      name TEXT, depth INTEGER DEFAULT 0, visible INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 100, created_at TEXT)`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_cat_visible ON categories(visible)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cat_parentid ON categories(parent_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cat_grp ON categories(grp)');
    console.log('[db] categories мигрирована на дерево по ID Al-Style (перезаполнится при импорте)');
  }
} catch (e) { console.error('[db] миграция categories:', e.message); }
// Индексы дерева создаём ПОСЛЕ миграции — здесь таблица уже гарантированно нового вида.
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_cat_parentid ON categories(parent_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_cat_grp ON categories(grp)');
} catch (e) { console.error('[db] индексы categories:', e.message); }

ensureColumn('import_log','supplier_id','supplier_id INTEGER DEFAULT 0'); // какой поставщик импортировался

// Завести поставщиков по умолчанию (Этап 1): Al-Style (API, активен) и 1С (свой склад, пока выключен)
try {
  const now = new Date().toISOString();
  const ins = db.prepare(`INSERT OR IGNORE INTO suppliers(code,name,kind,priority,markup_pct,active,config,updated_at)
    VALUES(@code,@name,@kind,@priority,@markup_pct,@active,@config,@ts)`);
  ins.run({ code:'alstyle', name:'Al-Style', kind:'api', priority:100, markup_pct:40, active:1,
    config: JSON.stringify({ base:'https://api.al-style.kz/api', tokenEnv:'ALSTYLE_API_KEY', rateMs:5000 }), ts:now });
  ins.run({ code:'1c', name:'Свой склад (1С)', kind:'1c', priority:0, markup_pct:40, active:0,
    config: JSON.stringify({ format:'csv' }), ts:now });
} catch (e) { console.error('[db] seed suppliers:', e.message); }

// Сид FAQ текущим содержимым сайта (только если таблица пуста — чтобы не плодить дубли)
try {
  const cnt = db.prepare('SELECT COUNT(*) c FROM faq').get().c;
  if (!cnt) {
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO faq(page,q,a,sort_order,visible,updated_at) VALUES(?,?,?,?,1,?)');
    const SEED = [
      ['home','Доставляете по Казахстану?','Да, отгружаем и доставляем во все города Казахстана — Алматы, Астану, Шымкент, Караганду и другие. Самовывоз со склада в Усть-Каменогорске, пр. Назарбаева 23.'],
      ['home','Работаете оптом?','Да. Оптовые цены для монтажников, установщиков и оптовиков — чем больше объём, тем выгоднее условия.'],
      ['home','Даёте гарантию на оборудование?','Да, действует гарантия производителя. Поможем с обменом или ремонтом по гарантии.'],
      ['home','Как узнать оптовую цену и наличие?','Оставьте заявку на сайте или позвоните — менеджер пришлёт прайс, актуальные цены и наличие на складе.'],
      ['video','Сколько камер нужно для объекта?','Зависит от площади и задач. Опишите объект — поможем рассчитать количество и тип камер, места размещения камер и объём архива.'],
      ['video','Можно смотреть видео с телефона?','Да, оборудование поддерживает удалённый просмотр со смартфона и компьютера через бесплатные приложения производителя.'],
      ['video','Чем отличаются IP и Wi-Fi камеры?','IP-камеры подключаются по кабелю с питанием PoE и стабильнее для крупных систем; Wi-Fi-камеры проще ставить там, где нет кабеля.'],
      ['setevoe','Что такое PoE и зачем он нужен?','PoE — это питание устройства по сетевому кабелю. Удобно для IP-камер и точек доступа: не нужен отдельный блок питания у каждого устройства.'],
      ['setevoe','Поможете подобрать коммутатор?','Да. По числу камер и устройств и требуемой мощности PoE подберём подходящий коммутатор.'],
      ['setevoe','Есть кабель и аксессуары?','Да, в наличии кабельно-проводниковая продукция, патч-панели и сопутствующие материалы.'],
      ['skud','Что входит в систему контроля доступа?','Контроллер, считыватель, замок (электромагнитный или электромеханический), идентификаторы (карты или брелоки), кнопка выхода, доводчик. Состав зависит от объекта.'],
      ['skud','Делаете домофоны для дома и подъезда?','Да, поставляем вызывные панели и мониторы видеодомофонов для частных домов и многоквартирных объектов.'],
      ['skud','Подберёте оборудование под объект?','Да, подберём комплект под офис, ЖК, предприятие или частный дом.'],
      ['pozharnaya','Какое оборудование нужно для пожарной сигнализации?','Обычно приёмно-контрольный прибор, извещатели (дымовые или тепловые), оповещатели и резервное питание. Точный состав зависит от объекта.'],
      ['pozharnaya','Поможете подобрать комплект под объект?','Да, подберём оборудование под тип и площадь объекта и требования.'],
      ['pozharnaya','Есть продукция Болид?','Да, в каталоге есть оборудование Болид и других производителей.'],
    ];
    SEED.forEach((r, i) => ins.run(r[0], r[1], r[2], i, now));
  }
} catch (e) { console.error('[db] seed faq:', e.message); }

module.exports=db;
