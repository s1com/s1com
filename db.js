// База данных SQLite — схема и подключение
const Database=require('better-sqlite3');
const path=require('path');
const DB_PATH=process.env.DB_PATH||path.join(__dirname,'data.sqlite');
const db=new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000'); // ждём до 5с при конкурентной блокировке (импорт/restore/бэкап) вместо мгновенной ошибки
db.pragma('synchronous = NORMAL'); // безопасно при WAL, заметно быстрее записи (импорт/заявки)

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
  status TEXT DEFAULT 'open',       -- open | resolved | dismissed («это разные товары» — решение навсегда)
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

-- ====== Пользователи сайта (личный кабинет) — аддитивно ======
-- Регистрация: обязательны телефон И email. Вход: телефон ИЛИ email + пароль (scrypt, lib/security.js).
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT UNIQUE,             -- E.164 +7XXXXXXXXXX (нормализованный ключ входа)
  email TEXT UNIQUE,             -- lower-case (ключ входа)
  pass TEXT,                     -- scrypt-хэш (lib/security.js hashPassword)
  name TEXT,
  company TEXT, bin TEXT, address TEXT,  -- B2B-реквизиты (для счетов)
  status TEXT DEFAULT 'active',  -- active | pending (ждёт подтверждения) | blocked
  favorites TEXT,                -- избранное: JSON-массив SKU (синк с localStorage sc_fav)
  created_at TEXT, last_login TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Сохранённые списки/избранное пользователя (для быстрого повтора закупки)
CREATE TABLE IF NOT EXISTS user_lists(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT,
  items_json TEXT,               -- JSON: [{sku,qty}]
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_lists_user ON user_lists(user_id);
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
ensureColumn('products','is_hit','is_hit INTEGER DEFAULT 0'); // «хит продаж» (флаг из админки)
ensureColumn('products','is_new','is_new INTEGER DEFAULT 0'); // «новинка» (флаг из админки)
ensureColumn('products','seo_title','seo_title TEXT'); // SEO title карточки (если пусто — генерируется)
ensureColumn('products','seo_desc','seo_desc TEXT');   // SEO description (если пусто — генерируется)
ensureColumn('products','h1','h1 TEXT');               // заголовок H1 (если пусто — модель)
ensureColumn('products','slug','slug TEXT');           // ЧПУ (задел на будущее; сейчас URL по артикулу)
ensureColumn('products','attrs','attrs TEXT');         // характеристики из Al-Style /properties: JSON [{name,value}]
ensureColumn('products','source','source TEXT');       // источник товара: al-style | excel | <поставщик> (для FULL_SYNC по источнику)
// Склейка дублей между поставщиками (Этап E): id товара-победителя, в который склеен этот дубль (0 = не склеен).
// «Залипающее» скрытие: /api/import ставит visible=1 при каждом обновлении, поэтому обычный visible=0 живёт
// только до ближайшего полного импорта. Импорт читает merged_into и не воскрешает склеенные позиции.
ensureColumn('products','merged_into','merged_into INTEGER DEFAULT 0');
// Почему товар скрыт: 0 — не скрыт, 1 — руками в админке («Скрыть» / галка «Показывать»),
// 2 — правилом «убрать из Al-Style» (снимается вместе с галкой у бренда).
// Та же беда, что и со склейкой: /api/import ставит visible=1, поэтому без этого флага ручное скрытие
// жило только до ближайшего полного импорта (ночью товар возвращался на витрину сам).
// Причину различаем, чтобы откат брендового правила не воскрешал то, что спрятали руками.
ensureColumn('products','hidden_manual','hidden_manual INTEGER DEFAULT 0');
try { db.exec('CREATE INDEX IF NOT EXISTS idx_prod_merged ON products(merged_into)'); } catch (e) { console.error('[db] idx_prod_merged:', e.message); }
// Добиваем NULL от строк, созданных до миграции: иначе запросы вынуждены писать COALESCE(merged_into,0),
// а COALESCE вокруг колонки отключает idx_prod_merged (SCAN вместо SEARCH).
try { db.prepare('UPDATE products SET merged_into=0 WHERE merged_into IS NULL').run(); } catch (e) {}
try { db.prepare('UPDATE products SET hidden_manual=0 WHERE hidden_manual IS NULL').run(); } catch (e) {}
// Ключ группы (ean | бренд+mpn) рядом с решением по ней. Без него отказ «это разные товары» негде
// запомнить: дедуп очереди смотрел только на status='open', и следующий прогон импорта вставлял
// ту же группу заново — очередь наполнялась одними и теми же ложными срабатываниями бесконечно.
ensureColumn('match_queue','match_key','match_key TEXT');
try { db.prepare("UPDATE match_queue SET match_key=json_extract(candidates,'$.key') WHERE match_key IS NULL AND candidates IS NOT NULL").run(); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_mq_key ON match_queue(match_key,status)'); } catch (e) { console.error('[db] idx_mq_key:', e.message); }
db.exec('CREATE INDEX IF NOT EXISTS idx_cat_id ON products(cat_id)'); // фильтр товаров по ветке категории (cat_id IN поддерево)
ensureColumn('import_log','deactivated','deactivated INTEGER DEFAULT 0');
ensureColumn('import_log','skipped','skipped INTEGER DEFAULT 0');
ensureColumn('orders','cust_name','cust_name TEXT');
ensureColumn('orders','cust_phone','cust_phone TEXT');
ensureColumn('orders','done_at','done_at TEXT');
ensureColumn('orders','amount','amount REAL DEFAULT 0'); // сумма продажи (ставится при статусе «Заказ»)
ensureColumn('orders','service','service TEXT');   // услуга (по странице-источнику)
ensureColumn('orders','src_page','src_page TEXT'); // страница, с которой пришла заявка
ensureColumn('orders','referer','referer TEXT');   // откуда перешёл на сайт
ensureColumn('orders','utm','utm TEXT');           // UTM-метки (сырые)
ensureColumn('orders','comment','comment TEXT');   // комментарий клиента
ensureColumn('orders','user_id','user_id INTEGER DEFAULT 0'); // аккаунт клиента (0 = гость), для истории в кабинете
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)');
ensureColumn('users','favorites','favorites TEXT'); // избранное аккаунта (JSON-массив SKU)

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

// Категория как карточка CMS (Этап A). Всё аддитивно и с DEFAULT — categories-sync эти
// поля НЕ трогает (updC перечисляет колонки явно), поэтому ручные настройки переживают импорт.
ensureColumn('categories','icon','icon TEXT');            // иконка ветки в меню: эмодзи или URL
ensureColumn('categories','image_url','image_url TEXT');  // картинка категории (плитки/страница)
ensureColumn('categories','descr','descr TEXT');          // SEO-текст/описание категории
ensureColumn('categories','seo_title','seo_title TEXT');  // SEO title (если пусто — генерируется)
ensureColumn('categories','seo_desc','seo_desc TEXT');    // SEO description (если пусто — генерируется)
ensureColumn('categories','h1','h1 TEXT');                // заголовок H1 (если пусто — имя)
ensureColumn('categories','slug','slug TEXT');            // ЧПУ (задел под страницы категорий)
ensureColumn('categories','in_menu','in_menu INTEGER DEFAULT 1');  // показывать в мегаменю
ensureColumn('categories','on_home','on_home INTEGER DEFAULT 0');  // показывать блоком на главной

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
  // Complex (complex.com.kz) — API-поставщик. Карта брендов (бренд→раздел+вкл) редактируется в админке (🏭 Поставщики → 🏷 Бренды).
  ins.run({ code:'complex', name:'Complex', kind:'api', priority:110, markup_pct:0, active:1,
    config: JSON.stringify({
      base: 'https://complex.com.kz/index.php?route=api/b2b/products_json',
      tokenEnv: 'COMPLEX_API_KEY', rateMs: 600000, skipNoPrice: true,
      brands: [
        { brand:'Dahua', section:'Видеонаблюдение', on:true },
        { brand:'Hikvision', section:'Видеонаблюдение', on:true },
        { brand:'Uniview', section:'Видеонаблюдение', on:true },
        { brand:'IMOU', section:'Видеонаблюдение', on:true },
        { brand:'Uniarch', section:'Видеонаблюдение', on:true },
        { brand:'EVO', section:'Видеонаблюдение', on:true },
        { brand:'Wi-Tek', section:'Сетевое оборудование', on:true },
        { brand:'Ubiquiti', section:'Сетевое оборудование', on:true },
        { brand:'Akuvox', section:'СКУД и домофония', on:true },
        { brand:'ZKTeco', section:'СКУД и домофония', on:true },
        { brand:'Ajax', section:'Пожарная безопасность', on:true },
        { brand:'Seagate', section:'Серверное оборудование и СХД', on:true },
        { brand:'Western Digital', section:'Серверное оборудование и СХД', on:true },
        { brand:'Schneider Electric', section:'Электротехника', on:true },
        { brand:'IEK', section:'Электротехника', on:true },
        { brand:'ITK', section:'Кабельные системы', on:true },
        { brand:'Yealink', section:'', on:false },
        { brand:'Yeastar', section:'', on:false },
        { brand:'SHIP', section:'Кабельные системы', on:false },
      ],
    }), ts:now });
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

// Досид FAQ для разделов ИБП/Кабельные/Серверы: у них ключи были пусты → SSR-блок «Частые вопросы»
// не рендерился (faqBlockHtml возвращает '' на пустом списке). Основной сид выше срабатывает только
// на ПУСТОЙ таблице, поэтому на живой базе он бы эти страницы не добрал — отсюда отдельный проход.
// Флаг в settings + проверка «нет записей у страницы»: не дублирует и не воскрешает удалённое админом.
try {
  const done = db.prepare("SELECT value FROM settings WHERE key='faq_seed_ibp_kab_serv'").get();
  if (!done) {
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO faq(page,q,a,sort_order,visible,updated_at) VALUES(?,?,?,?,1,?)');
    const cntFor = db.prepare('SELECT COUNT(*) c FROM faq WHERE page=?');
    const MORE = {
      ibp: [
        ['Как подобрать ИБП по мощности?', 'Сложите мощность подключаемого оборудования и возьмите запас 20–30% — так ИБП не работает на пределе и батареи служат дольше. Опишите, что нужно защитить, и менеджер подберёт модель.'],
        ['Сколько ИБП продержит оборудование без света?', 'Время автономии зависит от нагрузки и ёмкости батарей: чем меньше нагрузка, тем дольше работа. Если нужны часы, а не минуты, берут модели с подключением внешних батарейных блоков — рассчитаем под вашу задачу.'],
        ['Чем линейно-интерактивный ИБП отличается от онлайн?', 'Линейно-интерактивный дешевле и подходит для компьютеров, касс, роутеров. Онлайн (двойное преобразование) держит стабильное напряжение постоянно — его берут для серверов и чувствительной техники, особенно при плохой сети.'],
        ['Нужен ИБП для видеонаблюдения — что взять?', 'Для регистратора и камер обычно достаточно линейно-интерактивной модели с запасом по мощности. Пришлите состав системы — подберём ИБП и, если нужно, батареи.'],
      ],
      kabelnye: [
        ['Cat5e или Cat6 — что выбрать?', 'Cat5e уверенно держит 1 Гбит/с и его хватает для большинства камер и рабочих мест. Cat6 берут с запасом на будущее и под 10 Гбит/с на коротких линиях. Если объект строится надолго — разумнее Cat6.'],
        ['Чем UTP отличается от FTP?', 'UTP — без экрана, обычный вариант для офисов и жилых объектов. FTP экранирован и нужен там, где рядом силовые линии, электродвигатели и прочие источники помех — на производстве и в щитовых.'],
        ['Можно брать кабель CCA (омеднённый алюминий) под PoE?', 'Для PoE — не рекомендуем. У CCA выше сопротивление: он греется и просаживает напряжение, камера на дальнем конце может уходить в перезагрузку. Под питание по кабелю берите цельномедный кабель.'],
        ['Какой кабель нужен для улицы?', 'Для наружной прокладки берут кабель в оболочке для внешних работ, для подвеса между зданиями — с несущим тросом, для земли — с усиленной защитой. Опишите трассу — подскажем, что подойдёт.'],
      ],
      servery: [
        ['Поможете подобрать сервер под задачу?', 'Да. Подбор зависит от задачи: видеоархив, 1С, виртуализация или файловое хранилище требуют разной конфигурации по дискам, памяти и процессору. Опишите задачу и число пользователей — предложим вариант.'],
        ['Какие диски брать под видеонаблюдение?', 'Специализированные диски для систем видеонаблюдения: они рассчитаны на круглосуточную непрерывную запись. Обычные десктопные в таком режиме выходят из строя заметно быстрее.'],
        ['Какой RAID выбрать?', 'RAID 1 (зеркало) — для двух дисков и простой защиты. RAID 5 — компромисс объёма и надёжности, переживает отказ одного диска. RAID 10 — когда нужны скорость и надёжность. ⚠️ RAID — это не бэкап: он спасает от отказа диска, но не от удаления данных.'],
        ['Сколько дисков нужно под видеоархив?', 'Объём считается от числа камер, битрейта, глубины архива и режима записи — запись по движению экономит место. Пришлите параметры системы — рассчитаем объём и подберём диски.'],
      ],
    };
    let added = 0;
    for (const [page, list] of Object.entries(MORE)) {
      if (cntFor.get(page).c) continue; // на странице уже есть вопросы — не трогаем
      list.forEach((r, i) => { ins.run(page, r[0], r[1], i, now); added++; });
    }
    db.prepare("INSERT INTO settings(key,value) VALUES('faq_seed_ibp_kab_serv','done') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    if (added) console.log(`[db] FAQ досижен для ИБП/Кабельные/Серверы: +${added}`);
  }
} catch (e) { console.error('[db] seed faq extra:', e.message); }

// ====== Разделы каталога как данные (Фаза 1: убрать хардкод разделов из кода) ======
// Единый источник правды о разделах витрины: имя(=grp), slug, иконка, SEO, ветки Al-Style.
db.exec(`CREATE TABLE IF NOT EXISTS sections(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  name TEXT,                       -- строка grp (совпадает с products.grp)
  icon TEXT, image_url TEXT,
  seo_title TEXT, seo_desc TEXT, h1 TEXT, descr TEXT,
  sort_order INTEGER DEFAULT 100,
  visible INTEGER DEFAULT 1,
  in_menu INTEGER DEFAULT 1,
  on_home INTEGER DEFAULT 0,
  alstyle_branches TEXT,           -- JSON: [id веток Al-Style для импорта]
  page TEXT,                       -- существующая статическая страница (/setevoe.html); пусто = динамическая /section/<slug>
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sections_sort ON sections(sort_order);`);
// Сид 7 текущих разделов — только если таблица пуста (не перетираем ручные правки)
try {
  const cnt = db.prepare('SELECT COUNT(*) c FROM sections').get().c;
  if (!cnt) {
    const now = new Date().toISOString();
    const ins = db.prepare(`INSERT OR IGNORE INTO sections(slug,name,icon,sort_order,visible,in_menu,on_home,alstyle_branches,page,updated_at)
      VALUES(@slug,@name,@icon,@sort,1,1,0,@branches,@page,@now)`);
    const SEED = [
      ['videonablyudenie', 'Видеонаблюдение', '🎥', [3732,3745]],
      ['setevoe', 'Сетевое оборудование', '🔌', [3458,3459,3455,3454,3465]],
      ['ibp', 'Источники бесперебойного питания (ИБП)', '🔋', [3539,3423]],
      ['pozharnaya', 'Пожарная безопасность', '🔥', [5652]],
      ['skud', 'СКУД и домофония', '🔐', [5650]],
      ['kabelnye', 'Кабельные системы', '🧰', [3708,3707,3710,3595]],
      ['servery', 'Серверное оборудование и СХД', '🖥', [5739,21689,21788]],
    ];
    SEED.forEach((s, i) => ins.run({ slug: s[0], name: s[1], icon: s[2], sort: i + 1,
      branches: JSON.stringify(s[3]), page: '/' + s[0] + '.html', now }));
    console.log('[db] sections засижены (7 разделов)');
  }
} catch (e) { console.error('[db] seed sections:', e.message); }

// Идемпотентно добавить разделы Электротехника/Светотехника (поставщик Complex) — на любой базе, один раз.
// page=NULL → динамический рендер /section/<slug>; visible=1, in_menu=0 (пока пусты — не засоряют навбар; включить в админке).
try {
  const now = new Date().toISOString();
  const insS = db.prepare(`INSERT OR IGNORE INTO sections(slug,name,icon,sort_order,visible,in_menu,on_home,alstyle_branches,page,seo_title,seo_desc,h1,descr,updated_at)
    VALUES(@slug,@name,@icon,@sort,1,0,0,'[]',NULL,@seo_title,@seo_desc,@h1,@descr,@now)`);
  insS.run({ slug:'elektrotehnika', name:'Электротехника', icon:'⚡', sort:8, now,
    seo_title:'Электротехника — автоматы, УЗО, дифавтоматы, щитовое оборудование | Сервис.com',
    seo_desc:'Электротехническое и модульное оборудование в Казахстане: автоматические выключатели, УЗО, дифавтоматы, щитки. Бренды Schneider Electric, IEK. Цены, наличие, доставка по РК, опт для монтажников.',
    h1:'Электротехника',
    descr:'Модульное и щитовое электрооборудование для монтажа и комплектации объектов: автоматические выключатели, УЗО, дифавтоматы и аксессуары. В наличии продукция Schneider Electric и IEK — с ценами и остатками, доставкой по Казахстану и оптовыми условиями для электромонтажных бригад.' });
  insS.run({ slug:'svetotehnika', name:'Светотехника', icon:'💡', sort:9, now,
    seo_title:'Светотехника — светодиодные светильники, прожекторы, освещение | Сервис.com',
    seo_desc:'Светотехника и освещение в Казахстане: светодиодные светильники, прожекторы, лампы для дома, офиса и производства. Цены, наличие, доставка по РК, опт для монтажников.',
    h1:'Светотехника',
    descr:'Светотехническое оборудование для освещения объектов: светодиодные светильники, прожекторы и лампы. Цены и наличие, доставка по Казахстану, оптовые условия для монтажа и комплектации.' });
} catch (e) { console.error('[db] seed complex sections:', e.message); }

// ====== Отзывы (Фаза 3: конверсия/доверие) ======
db.exec(`CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author TEXT, role TEXT, text TEXT,
  rating INTEGER DEFAULT 5,
  sort_order INTEGER DEFAULT 100,
  visible INTEGER DEFAULT 1,
  created_at TEXT
);`);
// Сид примеров — только если пусто (замените на реальные в админке)
try {
  if (!db.prepare('SELECT COUNT(*) c FROM reviews').get().c) {
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO reviews(author,role,text,rating,sort_order,visible,created_at) VALUES(?,?,?,?,?,1,?)');
    const SEED = [
      ['Алексей', 'монтажная организация', 'Берём оборудование для видеонаблюдения оптом. Всегда есть в наличии, цены для монтажников адекватные, отгружают быстро. Работаем не первый год.', 5, 1],
      ['ТОО «СтройКомплект»', 'корпоративный клиент', 'Оснащали склад системой контроля доступа и видеонаблюдением. Помогли с подбором, выставили счёт с НДС, доставили в срок.', 5, 2],
      ['Марат', 'частный дом', 'Заказывал комплект камер для дома. Подсказали, что взять под мою задачу, всё подошло. Спасибо за консультацию.', 5, 3],
    ];
    SEED.forEach(r => ins.run(r[0], r[1], r[2], r[3], r[4], now));
    console.log('[db] reviews засижены (примеры)');
  }
} catch (e) { console.error('[db] seed reviews:', e.message); }

// ====== Баннеры/акции (Фаза 3) — управляемый промо-блок на главной ======
db.exec(`CREATE TABLE IF NOT EXISTS banners(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, subtitle TEXT, image_url TEXT, link TEXT, btn_text TEXT,
  sort_order INTEGER DEFAULT 100, visible INTEGER DEFAULT 1, created_at TEXT
);`);
try {
  if (!db.prepare('SELECT COUNT(*) c FROM banners').get().c) {
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO banners(title,subtitle,image_url,link,btn_text,sort_order,visible,created_at) VALUES(?,?,?,?,?,?,1,?)');
    ins.run('Оптовым покупателям — специальные цены', 'Монтажникам и организациям: прайс, отсрочка, доставка по Казахстану', '', 'https://wa.me/77053541999', 'Запросить прайс', 1, now);
    ins.run('Видеонаблюдение под ключ', 'Подберём комплект под ваш объект — дом, офис, склад. Бесплатная консультация.', '', '/videonablyudenie.html', 'В каталог', 2, now);
    console.log('[db] banners засижены (примеры)');
  }
} catch (e) { console.error('[db] seed banners:', e.message); }

// ====== Готовые решения (Фаза 3) — подборки товаров (комплекты) ======
db.exec(`CREATE TABLE IF NOT EXISTS bundles(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, subtitle TEXT, image_url TEXT, skus TEXT, price INTEGER DEFAULT 0,
  link TEXT, btn_text TEXT, sort_order INTEGER DEFAULT 100, visible INTEGER DEFAULT 1, created_at TEXT
);`);
try {
  if (!db.prepare('SELECT COUNT(*) c FROM bundles').get().c) {
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO bundles(title,subtitle,image_url,skus,price,link,btn_text,sort_order,visible,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)');
    ins.run('Видеонаблюдение для дома', 'Комплект на 4 камеры: регистратор, камеры, блок питания и кабель — всё для самостоятельного монтажа.', '', '[]', 0, '/videonablyudenie.html', 'Рассчитать комплект', 1, now);
    ins.run('Видеонаблюдение для офиса', 'IP-камеры высокого разрешения, PoE-коммутатор и сетевой видеорегистратор для офиса или магазина.', '', '[]', 0, '/videonablyudenie.html', 'Рассчитать комплект', 2, now);
    ins.run('Контроль доступа на дверь', 'Электромагнитный замок, контроллер, считыватель и кнопка выхода — базовый комплект СКУД.', '', '[]', 0, '/skud.html', 'Рассчитать комплект', 3, now);
    console.log('[db] bundles засижены (примеры)');
  }
} catch (e) { console.error('[db] seed bundles:', e.message); }

// ====== Информационные страницы (CMS) — доставка/оплата/гарантия/о компании ======
db.exec(`CREATE TABLE IF NOT EXISTS pages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE, title TEXT, body TEXT,
  seo_title TEXT, seo_desc TEXT,
  sort_order INTEGER DEFAULT 100, visible INTEGER DEFAULT 1, in_menu INTEGER DEFAULT 0, in_footer INTEGER DEFAULT 1,
  created_at TEXT, updated_at TEXT
);`);
try {
  if (!db.prepare('SELECT COUNT(*) c FROM pages').get().c) {
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO pages(slug,title,body,seo_title,seo_desc,sort_order,visible,in_menu,in_footer,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,1,?,?)');
    const P = [
      ['dostavka', 'Доставка', '<h2>Доставка по Казахстану</h2><p>Отгружаем оборудование со склада в Усть-Каменогорске во все города Казахстана. Работаем с транспортными компаниями (СДЭК, PONY EXPRESS, Казпочта и др.) и попутными грузоперевозчиками.</p><ul><li><b>Самовывоз</b> — бесплатно со склада, пр. Назарбаева 23, Усть-Каменогорск. Пн–Сб 9:00–18:00.</li><li><b>Доставка по городу</b> — курьером, стоимость и сроки уточняйте у менеджера.</li><li><b>По Казахстану</b> — транспортной компанией, обычно 2–5 рабочих дней в зависимости от региона.</li></ul><p>Отправка в день оплаты при наличии товара на складе. Трек-номер сообщаем после отгрузки.</p>', 'Доставка оборудования по Казахстану — Сервис.com', 'Доставка систем безопасности и сетевого оборудования по всему Казахстану со склада в Усть-Каменогорске. Самовывоз, курьер, транспортные компании.', 1, 1],
      ['oplata', 'Оплата', '<h2>Способы оплаты</h2><p>Работаем с физическими и юридическими лицами. Выбирайте удобный способ оплаты:</p><ul><li><b>Безналичный расчёт</b> — для ТОО, ИП и организаций. Выставляем счёт с НДС, работаем по договору.</li><li><b>Оплата картой</b> — Visa / Mastercard.</li><li><b>Наличными</b> — при самовывозе со склада.</li><li><b>Перевод (Kaspi и др.)</b> — по договорённости с менеджером.</li></ul><p>Для монтажных организаций и оптовых клиентов — специальные цены и возможность отсрочки платежа. <a href="https://wa.me/77053541999" target="_blank" rel="nofollow">Запросить прайс в WhatsApp</a>.</p>', 'Оплата — способы оплаты для физлиц и организаций | Сервис.com', 'Оплата систем безопасности: безналичный расчёт с НДС для организаций, карта, наличные, Kaspi. Спеццены и отсрочка для монтажников.', 2, 1],
      ['garantiya', 'Гарантия', '<h2>Гарантия и возврат</h2><p>На всё оборудование действует официальная гарантия производителя. Срок гарантии зависит от бренда и категории товара (обычно от 12 до 36 месяцев).</p><ul><li>Гарантийное обслуживание — по правилам производителя.</li><li>При обнаружении заводского брака заменим товар или вернём деньги в соответствии с законодательством РК «О защите прав потребителей».</li><li>Сохраняйте упаковку и документы на покупку — они нужны для гарантийного случая.</li></ul><p>По вопросам гарантии и сервиса свяжитесь с нами: <a href="tel:+77053541999">+7 705 354-19-99</a>.</p>', 'Гарантия на оборудование — Сервис.com', 'Официальная гарантия производителя на системы безопасности и сетевое оборудование. Условия гарантии, возврата и сервисного обслуживания.', 3, 1],
      ['o-kompanii', 'О компании', '<h2>ТОО «Сервис.com»</h2><p>Мы — поставщик систем безопасности и сетевого оборудования в Усть-Каменогорске и по всему Казахстану. Более 12 лет помогаем частным клиентам, бизнесу и монтажным организациям подбирать и приобретать оборудование под конкретные задачи.</p><h3>Что мы предлагаем</h3><ul><li>Видеонаблюдение, СКУД и домофонию, пожарную безопасность;</li><li>Сетевое и серверное оборудование, ИБП, кабельные системы;</li><li>Оборудование ведущих брендов: Dahua, Hikvision, Imou, HiLook и других;</li><li>Проектирование и монтаж под ключ, консультацию специалиста.</li></ul><p>Работаем с физическими и юридическими лицами, предоставляем спеццены для монтажников и опта. Приезжайте на склад или оставьте заявку — подберём решение под ваш объект.</p><p>📍 Усть-Каменогорск, пр. Назарбаева 23 · ☎ <a href="tel:+77053541999">+7 705 354-19-99</a></p>', 'О компании — ТОО «Сервис.com», Усть-Каменогорск', 'Сервис.com — поставщик систем безопасности и сетевого оборудования в Усть-Каменогорске и по Казахстану. Более 12 лет на рынке, опт и розница.', 4, 1],
    ];
    P.forEach(p => ins.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], now, now));
    console.log('[db] pages засижены (примеры)');
  }
} catch (e) { console.error('[db] seed pages:', e.message); }

// ====== Меню сайта (конструктор, Этап B) — пункты верхнего навбара из базы ======
db.exec(`CREATE TABLE IF NOT EXISTS menu_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT, type TEXT DEFAULT 'link', value TEXT,
  css_class TEXT, new_tab INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 100, visible INTEGER DEFAULT 1, created_at TEXT
);`);
try {
  if (!db.prepare('SELECT COUNT(*) c FROM menu_items').get().c) {
    const now = new Date().toISOString();
    const ins = db.prepare('INSERT INTO menu_items(label,type,value,css_class,new_tab,sort_order,visible,created_at) VALUES(?,?,?,?,?,?,1,?)');
    // повторяет текущий навбар один-в-один (визуально без изменений до правки в админке)
    const M = [
      ['Быстрый заказ', 'link', '/bystryy-zakaz', 'fire', 0, 1],
      ['Бренды', 'link', '/brands.html', '', 0, 2],
      ['Акции', 'link', '/', '', 0, 3],
      ['Новинки', 'link', '/', '', 0, 4],
      ['Хиты продаж', 'link', '/', '', 0, 5],
      ['О компании', 'link', '/#about', '', 0, 6],
      ['Контакты', 'link', 'tel:+77053541999', '', 0, 7],
    ];
    M.forEach(m => ins.run(m[0], m[1], m[2], m[3], m[4], m[5], now));
    console.log('[db] menu_items засижены (текущий навбар)');
  }
} catch (e) { console.error('[db] seed menu_items:', e.message); }
ensureColumn('menu_items','parent_id','parent_id INTEGER DEFAULT 0'); // вложенные пункты (дропдаун): 0 = верхний уровень

// ====== Статьи «Полезное» (SEO-контент под поисковые запросы) ======
// Отдельно от pages: у статьи есть анонс, дата, картинка и привязка к разделу витрины (grp) —
// под текстом автоматически показываются товары этого раздела, поэтому статья ведёт в каталог,
// а не просто «читается». skus — точечная привязка конкретных товаров (JSON-массив артикулов).
db.exec(`CREATE TABLE IF NOT EXISTS articles(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE, title TEXT, excerpt TEXT, body TEXT,
  grp TEXT,                       -- раздел витрины для перелинковки (products.grp / sections.name)
  skus TEXT,                      -- JSON-массив артикулов: «товары из статьи»
  image_url TEXT,
  seo_title TEXT, seo_desc TEXT, h1 TEXT,
  published_at TEXT,              -- дата публикации (для Article-разметки и сортировки)
  sort_order INTEGER DEFAULT 100, visible INTEGER DEFAULT 1,
  created_at TEXT, updated_at TEXT
);`);
db.exec('CREATE INDEX IF NOT EXISTS idx_articles_vis ON articles(visible, sort_order)');
// Сид статей: по флагу в settings + проверке slug — не плодит дубли, не воскрешает удалённое,
// не перетирает правки в админке. Тексты — в scripts/seed-articles.js (длинные, правятся отдельно).
try {
  if (!db.prepare("SELECT 1 FROM settings WHERE key='articles_seeded'").get()) {
    const list = require('./scripts/seed-articles');
    const now = new Date().toISOString();
    const has = db.prepare('SELECT 1 FROM articles WHERE slug=?');
    const ins = db.prepare(`INSERT INTO articles(slug,title,excerpt,body,grp,skus,image_url,seo_title,seo_desc,h1,published_at,sort_order,visible,created_at,updated_at)
      VALUES(@slug,@title,@excerpt,@body,@grp,'[]','',@seo_title,@seo_desc,@h1,@now,@sort,1,@now,@now)`);
    let n = 0;
    list.forEach((a, i) => {
      if (has.get(a.slug)) return;
      ins.run({
        slug: a.slug, title: a.title, excerpt: a.excerpt, body: String(a.body || '').trim(), grp: a.grp || '',
        seo_title: a.seo_title || '', seo_desc: a.seo_desc || '', h1: a.title, sort: (i + 1) * 10, now,
      });
      n++;
    });
    db.prepare("INSERT INTO settings(key,value) VALUES('articles_seeded','done') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    if (n) console.log(`[db] статьи «Полезное» засижены: ${n}`);
  }
} catch (e) { console.error('[db] seed articles:', e.message); }
// Пункт «Полезное» в навбар — один раз (как «Весь каталог»): если пункта нет и флага нет, добавляем.
try {
  if (!db.prepare("SELECT 1 FROM settings WHERE key='poleznoe_menu'").get()) {
    if (!db.prepare("SELECT 1 FROM menu_items WHERE value='/poleznoe'").get()) {
      db.prepare("INSERT INTO menu_items(label,type,value,css_class,new_tab,sort_order,visible,created_at) VALUES('Полезное','link','/poleznoe','',0,8,1,?)").run(new Date().toISOString());
      console.log('[db] menu_items: добавлен пункт «Полезное»');
    }
    db.prepare("INSERT INTO settings(key,value) VALUES('poleznoe_menu','done') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  }
} catch (e) { console.error('[db] poleznoe menu:', e.message); }
// Одноразово убираем авто-пункт «Весь каталог» — он дублировал кнопку-дропдаун «☰ Каталог» в навбаре.
// Страница /katalog.html доступна из дропдауна («🗂 Весь каталог деревом →»). Флаг в settings — меню больше не трогаем.
try {
  const cleaned = db.prepare("SELECT value FROM settings WHERE key='katalog_menu_cleanup'").get();
  if (!cleaned) {
    db.prepare("DELETE FROM menu_items WHERE value='/katalog.html' AND (parent_id=0 OR parent_id IS NULL) AND label IN ('Весь каталог','Каталог')").run();
    db.prepare("INSERT INTO settings(key,value) VALUES('katalog_menu_cleanup','done') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    console.log('[db] menu_items: авто-пункт «Весь каталог» убран (дублировал ☰ Каталог)');
  }
} catch (e) { console.error('[db] katalog menu cleanup:', e.message); }

// ====== Дефолтные «преимущества» на главной (управляются из ⚙ Настройки) ======
try {
  const has = db.prepare("SELECT 1 FROM settings WHERE key='home_usps'").get();
  if (!has) {
    const usps = [
      { icon: '🛡️', title: 'Гарантия', text: 'Гарантия производителя на оборудование и на работы' },
      { icon: '🚚', title: 'Доставка по РК', text: 'Во все города Казахстана, самовывоз со склада' },
      { icon: '🧰', title: 'Монтаж под ключ', text: 'Проектирование, монтаж, обслуживание объектов' },
      { icon: '🤝', title: 'Опт и B2B', text: 'Специальные цены для монтажников и организаций' },
    ];
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('home_usps', JSON.stringify(usps));
    console.log('[db] home_usps засижены (преимущества)');
  }
} catch (e) { console.error('[db] seed home_usps:', e.message); }

// ====== Конструктор главной: порядок и показ блоков (⚙ Настройки → «🧩 Блоки главной») ======
try {
  if (!db.prepare("SELECT 1 FROM settings WHERE key='home_blocks'").get()) {
    const blocks = ['banners', 'categories', 'subcats', 'bundles', 'hits', 'newest', 'brands', 'about', 'reviews', 'articles', 'faq', 'cta'].map(k => ({ key: k, on: true }));
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('home_blocks', JSON.stringify(blocks));
    console.log('[db] home_blocks засижены (конструктор главной)');
  }
} catch (e) { console.error('[db] seed home_blocks:', e.message); }

// ====== Режим регистрации пользователей (⚙ Настройки → тумблер) ======
// open = клиент регистрируется и сразу пользуется; approval = менеджер подтверждает в админке.
try {
  if (!db.prepare("SELECT 1 FROM settings WHERE key='registration_mode'").get()) {
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('registration_mode', 'open');
    console.log('[db] registration_mode=open засижен');
  }
} catch (e) { console.error('[db] seed registration_mode:', e.message); }

// Версионные миграции: applied один раз, по порядку, в транзакции (migrations/*.sql). Основная схема — выше (ensureColumn).
try { require('./lib/migrations').runMigrations(db, path.join(__dirname, 'migrations')); }
catch (e) { console.error('[db] migrations:', e.message); }

module.exports=db;
