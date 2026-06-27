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
  name TEXT UNIQUE,
  parent TEXT DEFAULT '',       -- родительская категория (пусто = верхний уровень)
  visible INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 100,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cat_visible ON categories(visible);
CREATE INDEX IF NOT EXISTS idx_cat_parent ON categories(parent);

CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

// мягкая миграция: добити колонки, если базе уже была создана старой версией
function ensureColumn(table,col,ddl){
  const cols=db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
  if(!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('products','created_at','created_at TEXT');
ensureColumn('import_log','deactivated','deactivated INTEGER DEFAULT 0');
ensureColumn('import_log','skipped','skipped INTEGER DEFAULT 0');
ensureColumn('orders','cust_name','cust_name TEXT');
ensureColumn('orders','cust_phone','cust_phone TEXT');
ensureColumn('orders','done_at','done_at TEXT');
ensureColumn('categories','parent',"parent TEXT DEFAULT ''");

module.exports=db;
