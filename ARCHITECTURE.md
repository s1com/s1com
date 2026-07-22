# ARCHITECTURE — S1COM / Сервис.com

Монолит Node.js + Express + SQLite (better-sqlite3). Один процесс отдаёт статику, публичный API, админку и SSR-страницы.

## Слои и файлы
- **server.js** — единая точка входа: все маршруты, middleware безопасности (helmet/CSP, rate-limit, JWT), импорт, админ-API, `applySeo()` (подстановка логотипа/`SITE_CONFIG`/Метрики/canonical в каждый HTML). ~3000 строк (кандидат на модуляризацию — см. FINAL-отчёт, п.20).
- **db.js** — подключение SQLite, прагмы (WAL, foreign_keys, busy_timeout=5000, synchronous=NORMAL), схема (`CREATE TABLE IF NOT EXISTS`), мягкие миграции `ensureColumn(table,col,ddl)`, сиды, запуск версионных миграций (`lib/migrations`). Запускается сайд-эффектом `require('./db')`.
- **lib/** — `product-page.js` (SSR карточки товара, вёрстка B), `category-page.js` (SSR категории/раздела/бренда), `content-page.js` (инфо-страницы), `bundle-page.js`, `quick-order-page.js`, `security.js` (хэш пароля), `indexnow.js`, `telegram.js`, `migrations.js` (раннер версионных миграций).
- **public/** — статика: `index.html` (главная), 7 страниц разделов, `katalog.html` (дерево каталога), `brands.html`, `css/catalog.css`, `js/{home,catalog,catalog-tree,product,brands,quick-order}.js`.
- **admin/index.html** — одностраничная админка (JWT), все CRUD.
- **scripts/** — `alstyle-import.js` (импорт Al-Style), `migrate.js` (CLI миграций), `backup.js`, `seed.js`, `hash-password.js`.
- **migrations/** — версионные SQL-миграции (`*.sql`, применяются один раз).
- **tests/api.test.js** — интеграционные тесты (изолированная временная БД).
- **vendor/xlsx-0.20.3.tgz** — вендоренная зависимость Excel (без CDN).

## Потоки данных
- **Импорт:** `scripts/alstyle-import.js` → Al-Style API (`/elements-pagination`, `/element-info?detailText`, `/images`, `/quantity-price`) → POST `/api/import`, `/api/import/attrs`, `/api/stock`, `/api/import/deactivate`. Cron на Render (остатки 10 мин, каталог раз в сутки).
- **Заявки:** фронт (корзина, `sc_cart`) → POST `/api/order` (или `/api/quick-order` в режиме создания) → хелперы `normalizePhoneKZ`/`buildOrderLines`/`saveOrder` → таблица `orders` → Telegram.
- **SEO:** каждый HTML проходит `applySeo` (домен из `SITE_URL`, `SITE_CONFIG`, Метрика, canonical, меню/подвал из БД).

## Ключевые таблицы
`products, orders, categories, sections, settings, menu_items, pages, faq, reviews, banners, bundles, suppliers, offers, category_map, price_rules, match_queue, import_log, schema_migrations`.

## Расширяемость
Разделы витрины, меню, страницы, категории-карточки, преимущества, блоки главной — управляются из админки как данные (не хардкод). Мультипоставщик: заготовка `suppliers/offers/category_map/price_rules` + адаптер-каркас `scripts/supplier-import.js`.
