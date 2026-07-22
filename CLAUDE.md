# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Где лежит код (важно для этой машины)

Проект **распакован прямо в рабочую папку** — правь файлы здесь (`server.js`, `db.js`, `public/`, `admin/`, `lib/`, `scripts/`, `tests/`), а НЕ во временных каталогах. ✅ **С 2026-07-17 папка под локальным git** (ветка `main`; `.gitignore` исключает `node_modules`/`*.zip`/`*.sqlite`/`.env*`) — история есть, работай через ветки+коммиты, а не ручные копии. Деплой на прод по-прежнему через веб-загрузку на GitHub (раздел 3). Архив **`s1com-proekt-polnyy.zip`** держим рядом как свежий бэкап и как готовую пачку для загрузки на GitHub; после правок обновляй его: `zip s1com-proekt-polnyy.zip <изменённые файлы>`. Настоящий репозиторий — `s1com/s1com` на GitHub (деплой через веб-загрузку, см. раздел 3 ниже).

✅ **Node 20.18.1 установлен на этой машине** (nvm, `~/.nvm/versions/node/v20.18.1/bin/node`) — `better-sqlite3` грузится, сервер поднимается, **`node tests/api.test.js` проходит (14/14)**. В неинтерактивном Bash-инструменте `node` по имени может не находиться → зови по полному пути или `zsh -c 'node …'`. Тест изолирован (временная БД `os.tmpdir()/s1com-test.sqlite`, свежая на каждый прогон), можно гонять повторно. jsdom доступен для e2e-проверок клиентского JS. (Раньше здесь было «Node не установлен» — устарело.)

## Команды

```bash
npm start          # запустить сервер (node server.js), порт 3000 (или $PORT)
npm test           # интеграционные тесты API (tests/api.test.js) — поднимает сервер на :3099, коды выхода 0/1
npm run seed       # загрузить стартовый каталог из scripts/seed-products.json в БД
npm run backup     # бэкап SQLite (scripts/backup.js)
npm run hash       # сгенерировать bcrypt-хэш пароля админки (scripts/hash-password.js) → в ADMIN_PASSWORD_HASH
node scripts/alstyle-import.js --plan   # dry-run импорта Al-Style: сколько товаров по группам (без заливки)
node scripts/alstyle-import.js          # боевая заливка каталога Al-Style через POST /api/import
node scripts/alstyle-import.js --stock  # быстрая синхронизация ТОЛЬКО остатков (/quantity-price → /api/stock)
node scripts/alstyle-import.js --props  # залить ТОЛЬКО характеристики (/properties → /api/import/attrs); безопасно, не трогает цены/остатки/названия; по умолчанию лишь у пустых, +--force перезаписать все
node scripts/alstyle-import.js --tree   # разведка: всё дерево категорий Al-Style с ID → categories_full.txt (для расширения BRANCH_MAP)
node scripts/complex-import.js --dry    # поставщик Complex: проверка маппинга БЕЗ записи (что зальётся, по разделам); нужен только COMPLEX_API_KEY
node scripts/complex-import.js          # боевая заливка Complex (source=complex); карта брендов — из админки (🏭 Поставщики → 🏷 Бренды)
```

## Поставщик Complex (complex.com.kz) — второй API-поставщик

Новый API-поставщик (розничная цена как есть, БЕЗ наценки). **Что грузим — решает карта брендов в админке:** 🏭 Поставщики → у поставщика `complex` кнопка «🏷 Бренды» → модалка со списком брендов (живьём из API, с количеством товаров и «сколько с ценой»), у каждого галка «брать» + выпадашка «раздел сайта» + тумблер «пропускать без цены». Сохраняется в `suppliers.config` (JSON `brands:[{brand,section,on}]`).

- **API:** `GET https://complex.com.kz/index.php?route=api/b2b/products_json&api_key=<КЛЮЧ>` — один запрос, весь каталог (~3400 тов). Поля: `name`, `model`(=артикул→`sku`), `brand`, `quantity`, `price_rrc`(розница→`price`), `price_client`(не используем). Нет фото/категории/описания. Ключ — ENV **`COMPLEX_API_KEY`** (секрет; в коде/базе не хранится).
- **Раздел назначается по бренду** (категории в API нет). Разделы **Электротехника**(`elektrotehnika`)/**Светотехника**(`svetotehnika`) засижены в `db.js` (идемпотентно, `page=NULL`→динамический `/section/<slug>`, `in_menu=0` пока пусты — включить в «🧭 Разделы»). Электрика Complex (IEK/Schneider) → туда.
- **Адаптер `scripts/complex-import.js`:** тянет каталог, читает карту брендов с сайта (`GET /api/supplier-config/complex` — публичный, БЕЗ секретов; fallback — встроенный `BRAND_MAP`), берёт только вкл. бренды в назначенные разделы, `sku=model`, дедуп по модели, `source=complex`, `--dry` для проверки без записи.
- **Чистка заголовка (`cleanTitle`):** заголовок карточки = «бренд + model», артикул отдельно. Complex `name` часто «`<артикул> [бренд] <описание>`» (67% начинаются с артикула) → убираем ведущий артикул-код (если с цифрой) и дублирующий бренд, чтобы не задваивать. `descr` = полное `name` (у Complex нет отдельного описания) — для «Описание» и поиска. Пример: `A9F75316 Автоматический выключатель` (Schneider) → заголовок «Schneider Electric · Автоматический выключатель», арт. A9F75316.
- **Выбор поставщика на бренд (защита от задвоения):** у бренда, который есть и в Al-Style, в пикере — галка «убрать из Al-Style» (`exAlstyle`). Отмечено → Complex берёт бренд, а Al-Style его **пропускает**. Механика: пикер помечает `alsoInAlstyle` (сверка с `products` где `source!='complex'`); `GET /api/brand-owners` (публичный) отдаёт `excludeFromAlstyle` (бренды с `on&&exAlstyle` у не-Al-Style поставщиков); `alstyle-import.js` в начале зовёт `loadExcludeBrands()` → `transform()` возвращает `null` для этих брендов (будущие импорты не вернут бренд). **Существующие товары Al-Style по этим брендам прячутся СРАЗУ при сохранении карты** (POST `/api/admin/supplier-brands` делает `UPDATE products SET visible=0 WHERE brand=? AND source!='complex'`, возвращает `hidden`) — не дожидаясь `FULL_SYNC`. `/api/stock` трогает только stock/price (не `visible`), поэтому cron остатков спрятанное не воскрешает. Проверено живьём: Dahou из Al-Style + Complex → отметил «убрать из Al-Style» → `/api/brand-owners`=`["Dahua"]`.
- **Эндпоинты** (`lib/routes/content-admin.js`): `GET/POST /api/admin/supplier-brands` (auth — живые бренды+карта / сохранить), `GET /api/supplier-config/:code` (публичный, для скрипта). Проверено живьём: импорт 1443 тов., разделы показывают товары, сохранение карты персистится.
- **Для прода:** добавить ENV `COMPLEX_API_KEY` на веб-сервис (и на cron-сервис `complex-catalog`; Complex просит не чаще 1 раза/10 мин). Задеплоить `db.js`(!), `lib/routes/content-admin.js`, `admin/index.html`, `scripts/complex-import.js`, `scripts/alstyle-import.js`, `render.yaml`.
- **Cron `complex-catalog`** (`render.yaml`): `node scripts/complex-import.js` каждые 30 мин, `FULL_SYNC=true` (цена+остаток в одном ответе Complex; снимает ушедшие позиции своего источника). `IMPORT_TOKEN` — `fromService` веб-сервиса; `COMPLEX_API_KEY`/`SITE_URL` — `sync:false` (задать в дашборде). Cron на Render — платный план.

- **Линтера нет.** Тесты разбиты: `npm run test:unit` (node:test, `tests/unit/` — чистые функции i18n/security/format/**matching**/**telegram-bot**, покрытие через `test:coverage`), `test:integration` = `tests/api.test.js` (самодостаточный Node-скрипт, поднимает сервер на :3099; правь `setTimeout`-блок в конце) + `tests/integration/supplier.test.js` + **`tests/integration/match-fixes.test.js`** (дефекты склейки из аудита 2026-07-16: спрятанный руками победитель, залипание «это разные товары», «Показать» против импорта, удаление победителя; каждый блок независим — падение одного не скрывает остальные), `test:security` (`tests/security/security.test.js` — поднимает сервер, проверяет auth/секреты/валидацию/CSP/traversal), `test:e2e` (`tests/e2e/run.cjs` — реальный Chromium через Playwright: smoke+order-flow+cabinet+favorites+roles-widths+a11y+corp+perf+conversion+**match-admin**), `test:all` — всё подряд. Зелёный срез на 2026-07-15: unit 62, api 108, supplier 15, security 16, e2e 124.
- **⚠️ E2E-база общая и переживает прогоны** (`os.tmpdir()/s1com-e2e.sqlite`, в отличие от изолированной api-базы). Спек, который создаёт товары, ОБЯЗАН убирать их за собой — иначе мусор копится и роняет чужие проверки (реальный случай: тестовые товары с длинными артикулами в «Видеонаблюдении» ломали `roles-widths` на гориз. скролле). Образец очистки — в конце `tests/e2e/match-admin.cjs` (удаляет весь свой бренд, а не только позиции текущего прогона). Playwright — devDep (не в prod-образе), ставится `npm i -D playwright && npx playwright install chromium`. Тесты сами подставляют ENV.
- **Локальный запуск:** в dev (`NODE_ENV` не `production`) сервер стартует с дефолтными секретами и БД в `./data.sqlite`. В production сервер **не стартует** без `ADMIN_PASSWORD`/`JWT_SECRET`/`IMPORT_TOKEN` (см. раздел 8). Первый запуск с `SEED_ON_EMPTY=true` и пустой БД автозагружает стартовый каталог.
- **Node 20.18.1** (не новее): `better-sqlite3` собирает нативный модуль и на Node ≥26 не собирается.

## Архитектура: как устроен рантайм (то, что не видно из одного файла)

Монолит на Express. Один процесс отдаёт **и** статику, **и** публичный API, **и** админку, **и** SSR-страницы товара.

- **`server.js` (~1250 строк) — единая точка входа и почти вся логика.** Все маршруты, middleware безопасности, импорт, админ-API — здесь. При старте `require('./db')` создаёт/мигрирует БД.
- **`db.js` запускается как сайд-эффект `require`** — создаёт таблицы (`CREATE TABLE IF NOT EXISTS`) и делает мягкие миграции через `ensureColumn(table,col,ddl)` (добавляет недостающие колонки на живой базе). **Любое изменение схемы — только через `ensureColumn`, и `db.js` обязательно деплоить**, иначе запросы упадут на несуществующей колонке.
- **`applySeo(html)` в server.js — ключевой приём.** Каждый HTML (главная, разделы, SSR-товар) перед отдачей прогоняется через `applySeo`: подставляет логотип, `window.SITE_CONFIG` (иконки/фильтры разделов из таблицы `settings`), коды Метрики/верификации, canonical. Настройки из БД имеют приоритет над ENV и применяются **без перезапуска**. Поэтому статику в `public/` нельзя отдавать «в лоб» — маршрут на `\.html$` (server.js ~1181) читает файл и прогоняет через `applySeo` до `express.static`. ⚠️ **`applySeo` делает `html.replace(/__YM_ID__/g, ym_id)` — глобально.** Поэтому имя переменной счётчика Метрики в шаблонах — `window.ymCounter` (НЕ `window.__YM_ID__`, иначе replace ломал бы и имя), а init идёт по проверке `/^[0-9]+$/`. Не возвращать `__YM_ID__` как идентификатор — раньше это ломало весь инлайн-скрипт Метрики (аудит 2026-07-05).
- **Что откуда отдаётся:** `express.static('public')` — сайт; `/admin` → `admin/index.html` (одностраничная админка, JWT); `/images` → `IMAGES_DIR`; `/product/:sku` → SSR через `lib/product-page.js` (`renderProductPage` → `applySeo`); `/category/:key` → SSR через `lib/category-page.js` (`key` = `slug` или `cat_id`; товары ветки фильтруются по `cat_path`). `lib/category-page.js` переиспользует общие куски из `lib/product-page.js` (`header`, `FOOTER`, `CART_HTML`, `esc`, `fmt`, …) — они экспортируются оттуда.
- **`lib/`:** `security.js` (хэш/сравнение пароля), `product-page.js` (SSR карточки товара), `indexnow.js` (пинг IndexNow при импорте), `telegram.js` (уведомление о заявке в Телеграм).
- **⚠️ CSP НЕ защищает SSR-страницы от XSS — экранирование обязательно** (аудит 2026-07-16, чинили 4 дыры). `applySeo` штампует per-request nonce на **каждый** инлайн-`<script>` уже готового HTML, то есть и на скрипт, внедрённый через данные. Отсюда два правила: **(1)** данные в инлайн-`<script>` — только `JSON.stringify(x).replace(/</g,'\\u003c')`; голый `JSON.stringify` не экранирует `<`, и `</script>` в поле закрывает тег (так были пробиты `window.PRODUCT`, `window.PAGE_GROUP`, `window.PAGE_BRAND`); **(2)** любое значение в HTML-атрибуте — через `esc()`, включая URL (`src="${esc(imgSrc(u))}"`): при `scriptSrcAttr:'unsafe-inline'` кавычка в `img` даёт живой `onerror`. Источник данных — **чужой API** (Al-Style/Complex), а не только админ: одно грязное значение в фиде поставщика = XSS на витрине. `sanitizeProduct` делает лишь `clamp()`, не экранирует.

### ⚠️ Дублирующиеся/легаси-файлы — легко отредактировать не тот

- **Активная витрина — только `public/`.** Корневые легаси (`index.html`, `app.js`, `style.css`) и `public/js/app.js` **удалены** (чистка 2026-07-05). **Активные скрипты разделов — `catalog.js`, `product.js`, `home.js`, `brands.js`**, общий стиль — **`catalog.css`**. Активный ключ корзины в localStorage — **`sc_cart`**. `public/css/style.css` оставлен — его используют `404.html` и `privacy.html`.

### Al-Style API — ответ на «‼️ ЗАПОЛНИТЬ» из раздела 12

Раздел 12 ниже помечен как незаполненный, но рабочий импорт уже документирует API: см. **`scripts/alstyle-import.js`** (шапка + `BRANCH_MAP`). База: `https://api.al-style.kz/api/` (GET, ключ в параметре `access-token`). Товары тянутся по веткам каталога Al-Style (ID раздела), не по нашему SKU. **Набор веток теперь задаётся в админке** (вкладка «🧭 Разделы» → поле «Ветки Al-Style»); импорт берёт их через `/api/sections` (`loadBranchMap()`), а `BRANCH_MAP` в скрипте — только fallback. То есть добавить/убрать раздел и его ветки — из админки, без правки кода (Фаза 5).

---

# CLAUDE.md — паспорт проекта «Сервис.com»

> **Зачем этот файл.** Это краткая «шпаргалка по проекту». Клод между сессиями ничего не помнит.
> Чтобы не пересказывать одно и то же:
> - **В обычном чате** — прикрепи этот файл + свежий архив кода в начале новой сессии.
> - **В Claude Code (терминал)** — положи этот файл в корень проекта, он читается автоматически при каждом запуске.
> - Держи файл **рядом с кодом в GitHub** и обновляй в конце каждой крупной сессии.
>
> **⚠️ Разделы, помеченные `‼️ ЗАПОЛНИТЬ` — заполни один раз** (эти данные есть только у владельца).

---

## 1. Что это за проект

B2B/розничный каталог систем безопасности и сетевого оборудования (ТОО «Сервис.com», Усть-Каменогорск, Казахстан).
Товары приходят от поставщика **Al-Style** по API. Цель сайта — приводить **заявки из поиска** (важен Яндекс).

- **Живой адрес:** https://servis-catalog.onrender.com
- **Рабочий домен — `s1com.kz`** (ещё не подключён). Домен управляется через ENV `SITE_URL`, а не хардкодом: `applySeo` переписывает домен во всей статике (canonical/og/JSON-LD) из `SITE_URL`; **дефолт в коде — `https://servis-catalog.onrender.com`** (живой хост), поэтому без этой переменной сайт работает нормально. Задавать `SITE_URL=https://s1com.kz` — только когда домен реально делегирован (тогда же и на cron-сервисах), без правки кода. ⚠️ Раньше здесь было «дефолт в коде — `https://s1com.kz`» — именно это и уронило прод 2026-07-15 (подробности и механика host-редиректа — в разделе 8). ⚠️ Прежний домен `servis-com.kz` в CLAUDE был ошибочным — правильный `s1com.kz`.
- **GitHub:** `s1com/s1com` (main).

---

## 2. Стек и инфраструктура

- **Backend:** Node.js + Express, база **SQLite** через `better-sqlite3`.
- **Frontend:** статические HTML + ванильный JS (без фреймворков), общий CSS.
- **Хостинг:** Render.
  - **Веб-сервис** `servis-catalog` — сам сайт + админка + API.
  - **Cron-сервисы** (описаны в `render.yaml`): `alstyle-stock` — остатки каждые 10 мин (`--stock`, `*/10 * * * *`); `alstyle-catalog` — полный каталог раз в сутки (`0 3 * * *`, с `FETCH_PROPS`/`FETCH_IMAGES`). `IMPORT_TOKEN` берётся из веб-сервиса через `fromService` (должен совпадать). Cron на Render — платный план.
- **Node:** версия **20.18.1** (важно: `better-sqlite3` собирает нативный модуль).

---

## 3. Как деплоить (без CLI)

1. Скачать архив от Клода → распаковать.
2. GitHub → репозиторий `s1com/s1com` → **Add file → Upload files** → перетащить файлы, **сохраняя структуру папок** (`server.js`, `db.js` в корень; `public/`, `admin/`, `lib/` — папками) → **Commit to main**.
3. Render → сервис `servis-catalog` → **Manual Deploy → Clear build cache & deploy**.
4. Проверить сайт с **жёстким обновлением: Cmd+Shift+R** (иначе кэшируется старый CSS/JS).

**Заметки:**
- **`xlsx` теперь вендорится** (аудит 2026-07-10, P0): tarball лежит в репо `vendor/xlsx-0.20.3.tgz`, package.json ссылается на `file:vendor/xlsx-0.20.3.tgz`, lock обновлён (integrity совпадает) — установка больше НЕ зависит от CDN SheetJS, `npm ci`/`npm install` воспроизводимы offline. ⚠️ **Папку `vendor/` обязательно коммитить** (без неё install упадёт). Прежняя проблема «npm ci спотыкается на CDN» устранена.
- **Если менялся `db.js` — его обязательно деплоить** (он добавляет новые колонки при старте; иначе сервер упадёт на запросах).

---

## 4. Структура кода

| Файл / папка | Что это |
|---|---|
| `server.js` | Express-приложение: все маршруты, SSR, безопасность, подстановка логотипа/конфига (`applySeo`). |
| `db.js` | Схема БД + мягкие миграции (`ensureColumn`) + стартовые данные. Запускается при старте. |
| `admin/index.html` | Админка (одностраничная): товары, массовая цена, заявки, дашборд, категории, разделы, FAQ, настройки, поставщики, SEO-центр, отзывы, баннеры, готовые решения, страницы, меню. **Шапка — 4 выпадающих меню-группы** (📦 Каталог / 💰 Продажи / 📄 Контент / ⚙ Ещё) + отдельные «💾 Сохранить всё», «📋 Заявки» (с бейджем), «Выйти». Дропдауны на `.menu/.menu-pop` (CSS `.menu.open`), логика — `toggleMenu(id)` (взаимное закрытие), `mAct(id,fn)` (закрыть+действие), клик снаружи закрывает; `scrollToTable`/`impClick` — пункты Каталога. Все вкладки — те же `show*()`-функции, изменилась только группировка кнопок. **Таблица товаров — серверная пагинация + фильтры** (масштаб на тысячи позиций): `load()` шлёт `q/group/brand/source/visible/stock/nophoto/nocat/sort/limit/offset` в `GET /api/admin/products` (возвращает `{items,total,brands,sources}`), `DATA`=текущая страница; состояние в `FILTER`/`PAGE`/`PAGESIZE`/`TOTAL`; `onSearch` (debounce 350мс)/`onFilter`→`reload(true)`; `gotoPage`/`setPageSize`; при несохранённых правках переход/фильтр спрашивает сохранить. **Фильтр «без категории»** (`nocat=1`) — товары без `cat_id`/`cat_path` (не видны на `/category`); чекбокс `#fNocat`. **Фильтр «Категория (текст)»** (`cattext`=точное значение поля `cat`; селект `#fCat`): для выбора кластеров сирот в один клик; сервер отдаёт фасет `cats:[{cat,n}]` (distinct `cat` с учётом текущих фильтров, но БЕЗ самого `cattext` — список не схлопывается; пустые `cat` исключены; топ-300 по частоте), `CATFACET` на клиенте. **Колонка «Категория»** в таблице: `rowToAdmin` отдаёт `catId`/`catPath`, клиент резолвит имя листа через `CATMAP` (`catNameOf`), у сирот — красное «— нет —». **Массовое выделение**: чекбокс-колонка + `selAll`, `SEL`(Set id), панель `#bulkBar` → `bulkAction('show'|'hide'|'group'|'category'|'delete')` шлёт `POST /api/admin/products/bulk {ids,action,value}`. **Привязка категорий** (`action:'category'`, `value`=`cat_id`): кнопка «🏷 Назначить категорию…» в `#bulkBar` → **модалка-пикер с поиском** `#catPickOv` (`openCatPick`/`renderCatPick`/`pickCat`): ищет по названию ИЛИ полному пути, каждый пункт показан как хлебные крошки «Раздел › … › Категория (N)» — юзабельно на 167 категорий (плоский `<select>` был неудобен). **Авто-подсказка** (`suggestCats`/`_stems`): при пустом поиске вверху блок «💡 Предлагаемые» — нечёткий матч текстового `cat`+`model` выделенных товаров на дерево (стеммы = первые 5 букв слов ≥4, только в разделе товара), топ-4 по score; при вводе поиска — исчезает. `fillBulkCat()` строит карты `CATMAP`(id→имя) и `CATPATHS`(id→полный путь) из `CATLIST`=`/api/admin/categories`. Сервер строит `cat_path` предков через `catPathFor(cat_id)` (walk `parent_id`), ставит `cat_id`+`cat_path`(+`grp` если у категории задан) — товар появляется на своей и родительских ветках `/category`. Чинит «сирот» прямо из админки. Инлайн-правка (`upd`/`saveAll`/`openEdit` по индексу в `DATA`=странице) работает как прежде. Бренд/раздел/источник для фильтров и bulk-price берутся из фасетов ответа (`fillFilterSelects`). |
| `public/index.html` | Главная (лендинг). Свои инлайн-стили, грузит `js/home.js`. |
| `public/videonablyudenie.html` и ещё 5 | 6 страниц разделов. Грузят `css/catalog.css` + `js/catalog.js`, задают `window.PAGE_GROUP`. |
| `public/brands.html` | Страница брендов. Грузит `js/brands.js`. |
| `public/css/catalog.css` | Общие стили разделов/товара/брендов (карточки, фильтры, корзина, шапка, мегаменю). |
| `public/js/home.js` | Логика главной + мегаменю. Поиск: `doSearch()` (фетч `/api/products?q=`, прячет `#landing`, рендер в `#searchResults`). **Автопоиск из URL** — при заходе на `/?q=…` (шапка НЕ-главных страниц шлёт именно туда) запрос подхватывается из `location.search` и поиск запускается сразу. |
| `public/js/catalog.js` | Логика раздела: фасеты, карточки, пагинация, корзина. **Режимы:** `PAGE_GROUP` (раздел), `PAGE_CAT` (ветка категории), `PAGE_BRAND` (бренд). **Переключатель вида «плитки ⇄ список»** (`VIEW`, localStorage `sc_view`, встраивается рядом с сортировкой через `injectViewToggle()` — HTML-страницы править не нужно): режим `list` рендерит `<table class="ltab">` (арт·характеристики·наличие шт·цена·**поле кол-ва**·заказ), `lrow()`/`bindRows()`; `addToCartQty(sku,n)` кладёт N позиций в `sc_cart`. Стили `.ltab`/`.vtoggle` — в `catalog.css`. |
| `public/js/product.js` | Логика страницы товара: галерея, вкладки, корзина. |
| `public/js/brands.js` | Логика страницы брендов. |
| `lib/product-page.js` | Серверная генерация (SSR) страницы товара `/product/:sku`. Экспортирует общие SSR-хелперы (шапка/подвал/корзина/esc/fmt). **Вёрстка «вариант B» (B2B):** H1-шапка сверху, ниже 3 колонки `.pdb` — галерея `.pdb-gallery` \| вкладки-характеристики `.pdb-center` \| прилипающий блок заказа `.pdb-order/.ord` (цена, наличие, **степпер количества `#pdQty`** + «В заявку», WhatsApp, опт, преимущества). Кол-во кладёт N в заявку через `addToCartN()` в `public/js/product.js` (степпер `#pdQtyMinus/#pdQtyPlus`, `#pdAdd` читает `#pdQty`). Вкладка «Описание» синтезирует текст из категории+характеристик (эвристика `descLooksLikeSpecs` с защитой прозы). |
| `lib/category-page.js` | Серверная генерация (SSR) страницы категории `/category/:key` (и `/section/:slug`). **Полноценный каталог по ветке** (как страница раздела): SSR рендерит первые `MAX_SSR`=60 карточек в `#grid` (для SEO/первого экрана) + структуру раздела (сайдбар `#filters`, `#subchips`, `#sortSel`, `#moreBtn`, `#catCount`), задаёт `window.PAGE_GROUP`=grp и `window.PAGE_CAT`=cat_id и грузит `catalog.js`. Тот в режиме `PAGE_CAT` фетчит `/api/products?cat=<id>&limit=5000` (вся ветка по `cat_path`), строит фасеты (бренд/тип/разрешение/цена/наличие + характеристики) и пагинацию (PER=24 + «Показать ещё»), заменяя SSR-сетку. Раньше был слабый инлайн `catFilter()` над 60 карточками — заменён. `catalog.js` обратно-совместим: без `PAGE_CAT` фетчит по `group=` (страницы разделов не тронуты). |
| `lib/content-page.js` | Серверная генерация (SSR) инфо-страницы `/page/:slug` (доставка/оплата/гарантия/о компании). Переиспользует шапку/подвал/корзину из `product-page.js`. |
| `lib/quick-order-page.js` | SSR-страница `/bystryy-zakaz` — быстрый заказ по списку артикулов (для монтажников/B2B). Textarea со списком SKU (+кол-во) → `POST /api/quick-order` резолвит → таблица найдено/не найдено → «добавить в заявку». Клиент — `public/js/quick-order.js` (вынесен из page, т.к. регэкспы в template literal ломались); использует `window.scAdd(items)` из `product.js`. Пункт меню «Быстрый заказ» в сиде `menu_items`. |
| `lib/bundle-page.js` | SSR-страница готового решения (комплекта) `/bundle/:id`: карточки товаров комплекта, «🧾 Весь комплект в заявку» (кликает `data-act=add` всех карточек → product.js), цена «от», ItemList/BreadcrumbList-микроразметка. |

**7 разделов (точные строки `grp` / `PAGE_GROUP`):**
`Видеонаблюдение`, `Сетевое оборудование`, `Источники бесперебойного питания (ИБП)`, `Пожарная безопасность`, `СКУД и домофония`, `Кабельные системы`, `Серверное оборудование и СХД`.

**Соответствие раздел → страница:** Видеонаблюдение→`/videonablyudenie.html`, Сетевое→`/setevoe.html`, ИБП→`/ibp.html`, Пожарная→`/pozharnaya.html`, СКУД→`/skud.html`, Кабельные→`/kabelnye.html`, Серверы/СХД→`/servery.html`.

**⚠️ Добавление нового раздела витрины — раздел «зашит» в 8 местах, тронуть ВСЕ:** `GROUP_PAGE` (`lib/product-page.js`, `public/js/{home,catalog,product,brands}.js`), `GROUP_ICON` (`public/js/{home,catalog}.js`), три списка групп в `server.js` (`cleanCatFilters`, `cleanCatIcons`, `order` в `/api/categories`), `serviceFromPage` (server.js), массив `pages` в `sitemap.xml`, новая `public/<slug>.html` (копия существующей страницы раздела с заменой title/desc/JSON-LD/H1/H2/`PAGE_GROUP`), и `BRANCH_MAP` в `scripts/alstyle-import.js` (ветки Al-Style). Значение `grp` должно совпадать во всех местах.

---

## 5. Модель данных (таблица `products`)

`sku, brand, model, grp, cat, descr, res, price, oldprice, promo, stock, img, mp, conn, type, visible, created_at, updated_at, images, cat_id, cat_path, is_hit, is_new, seo_title, seo_desc, h1, slug, source, attrs, merged_into, hidden_manual`

- **⚠️ `visible` сам по себе не «залипает».** `/api/import` при обновлении товара ставит `visible=1`, поэтому скрытие живёт только вместе с причиной: `merged_into>0` (склеен как дубль) или `hidden_manual>0` (`1` — спрятан руками, `2` — правилом «убрать из Al-Style»). Прячете товар из кода — проставляйте причину, иначе ночной импорт вернёт его на витрину.
- **⚠️ Обратное тоже верно: показываете товар — снимайте ОБЕ причины.** Импорт прячет по `merged_into>0 OR hidden_manual>0`, поэтому «Показать», снявшее только `hidden_manual`, живёт лишь до ближайшего импорта (баг, чинён 2026-07-16). Сейчас bulk `show` и галка «Показывать» в PUT снимают и `merged_into` — то есть «Показать» = «это не дубль, верни на витрину». Точечная отмена склейки без изменения `hidden_manual` — только через «📎 Что склеено» → `unmerge`.
- **⚠️ Удаление товара — сначала освободить склеенных в него** (`bulk delete` это делает в транзакции): иначе проигравшие остаются `visible=0, merged_into=<мёртвый id>` навсегда, и импорт их не вернёт (та же CASE-проверка), а в «Что склеено» они висят с пустым победителем.

- `descr` — описание/характеристики **текстом** (Al-Style отдаёт через запятую). Отдельных полей под характеристики (мощность, порты, cat6…) пока НЕТ.
- `promo`/`is_hit`/`is_new` — флаги «акция/хит/новинка».
- `seo_title/seo_desc/h1/slug` — SEO-поля (если пусто — генерируются).
- Другие таблицы: `orders` (заявки), `categories`, `settings`, `suppliers`, `offers`, `category_map`, `price_rules`, `match_queue`, `faq`, `import_log`, **`sections`** (разделы витрины как данные — см. ниже), `reviews`/`banners`/`bundles` (Фаза 3), **`pages`** (инфо-страницы CMS: `slug,title,body(HTML),seo_title,seo_desc,sort_order,visible,in_menu,in_footer`; сид 4 страниц; см. `/page/:slug`), **`menu_items`** (пункты навбара: `label,type,value,css_class,new_tab,sort_order,visible`; Этап B — см. ниже).
- **`sections`** (Фаза 1 «разделы каталога как данные»): `slug, name(=grp), icon, image_url, seo_*, h1, descr, sort_order, visible, in_menu, on_home, alstyle_branches(JSON), page`. Сид 7 текущих разделов в `db.js`. Отдаётся через `GET /api/sections` и прокидывается во фронт как `window.SITE_CONFIG.sections`. Цель — уйти от хардкода разделов в 8 местах (см. чек-лист выше) к единому источнику. **Сделано:** Фаза 1 (таблица+API), Фаза 2 (клиентская навигация — `public/js/{home,catalog,product,brands}.js` берут разделы из `window.SITE_CONFIG.sections` через `sectionsForMenu()`/`pageFor()`/`sectionIcon()`, с fallback на хардкод `GROUP_PAGE`; мегаменю и плитки главной строятся из `sections`), Фаза 3 (динамическая страница `/section/:slug` + редиректы), Фаза 4 (админка «🧭 Разделы»). SSR карточки товара тоже готова: `renderProductPage(p, related, {groupPage})` — server резолвит ссылку на раздел из `sections` (`SELECT ... FROM sections WHERE name=?`), fallback на `groupPageFor` (хардкод). Фаза 5 (импорт берёт ветки из `/api/sections` через `loadBranchMap()`, `BRANCH_MAP` — fallback). **Все 5 фаз готовы — раздел полностью управляется из админки (создать/иконка/SEO/ветки/порядок/показ), появляется в меню/главной/`/section/slug`/sitemap, товары импортируются по веткам.** **Хардкоды `GROUP_PAGE`/`GROUP_ICON` (`public/js/*`, `lib/product-page.js`) и `BRANCH_MAP` (`scripts/alstyle-import.js`) оставлены как fallback — не удалять.**

---

## 6. Основные API

- `GET /api/products` — `?q=` поиск, `?group=` раздел, `?brand=` бренд, `limit/offset`.
- `GET /api/home` — данные главной (`groups`, `brands`, `hits`, `newest`).
- `GET /api/brands` — все бренды со счётчиками.
- `GET /api/categories` — дерево категорий (для мегаменю). Глубокое (до 5 уровней): секции = `{name, nodes}`, вложенность в ключе `children`, у узлов `id`(=cat_id). **Мегаменю — раскладка «B2B-портал» (2026-07-11, по просьбе — «как в портале Al-Style»):** `renderMega` в `public/js/{home,catalog,brands,product}.js` рисует **рельс разделов слева + flyout справа с подкатегориями колонками** (вместо прежнего drill по одному уровню). Состояние — `megaActive` (индекс активного раздела; было `megaPath`-стек). Наведение/фокус/клик по строке рельса `.crow[data-sec]` → `megaActive=i` + перерисовка flyout. Flyout: `sec.nodes` (уровень-1) = группы `.fgrp` с заголовком-ссылкой `.fgt` → `/category/<id>`, под ним `g.children` (уровень-2) списком-ссылками. Источник дерева читается через `typeof`-гарды — `STATE.cats`/`STATE.groups` (home, со счётчиками) или `CATS` (catalog/brands/product, без счётчиков — graceful). «Все товары (N) →» → страница раздела (`pageFor`), «🗂 Весь каталог деревом →» → `/katalog.html`. Стили `.cport/.crail/.crow/.cfly/.fcols/.fgrp/.fgt` — в `catalog.css` и inline `index.html` (light-only, моб. `<820px` — рельс горизонтальным скроллом, `columns:1`). Открытие/закрытие по `#catBtn` — как было. Правится в 4 файлах (дублируется); универсальный `renderMega` идентичен во всех. Старый `megaKids` остался объявлен, но не вызывается (мёртвый код). Проверено jsdom (15 проверок, оба контекста).
- `GET /product/:sku` — SSR-страница товара.
- `GET /category/:key` — SSR-страница категории (`key` = `slug` или `cat_id`); в sitemap попадают только категории с товарами. **Проваливание по дереву (как в портале вендора):** маршрут отдаёт прямых детей (`parent_id=catId`) со **счётчиками всего/в наличии** по поддереву (`subtreeCatIds`+COUNT) → блок «Подкатегории» (клик → глубже, чип показывает «t / s») и цепочку родителей (`parent_id` вверх) → хлебные крошки по всей ветке; `renderCategoryPage(..., {children, parents})`. `siblings` теперь = соседи того же родителя (а не всего раздела). Стили `.subcats/.subcat` — в inline-`<style>` `category-page.js`.
- **`/katalog.html` — страница «весь каталог деревом» (как в портале Al-Style):** развёрнутое дерево категорий (аккордеон, произвольная глубина), у листовой категории клик разворачивает **список товаров прямо на месте** (`.ltab` с наличием/ценой/количеством → в заявку). Оболочка `public/katalog.html` (шапка/корзина как у разделов) + самодостаточный `public/js/catalog-tree.js` (свои helpers+корзина+мегаменю+дерево, т.к. `catalog.js` завязан на grid). Счётчики **всего/в наличии** — `GET /api/category-counts` (`{cat_id:{t,s}}`), клиент суммирует поддеревья (`rollup`→`{t,s}`), выводит «t / s» (в наличии зелёным). Первый раздел авто-раскрыт. При раскрытии листа — **фасеты**: бренд + «только в наличии» + сортировка (`renderLeaf`, фильтрация клиентом над загруженным списком). **Фильтр категорий по названию** (поле `#treeFilter`): `renderTree(q)`+`nodeMatches` показывают только совпавшие ветки (родительская цепочка), подсветка `<mark>`, авто-раскрытие; очистка → полное дерево + авто-раскрытие первого раздела. Ссылка «🗂 Весь каталог деревом →» добавлена в мегаменю (уровень разделов) во всех 5 меню-файлах; страница в sitemap. Junk-поля скрыты (`isJunk`). **Пункт «Весь каталог» → /katalog.html добавляется в навбар автоматически** — идемпотентная вставка в `menu_items` при старте (`db.js`, срабатывает и на уже засиженной базе, один раз; не дублирует «☰ Каталог» — это дропдаун-кнопка).
- **Пересортировка категорий/подкатегорий:** кнопки ↑/↓ в админке (вкладка «🗂 Категории», `catMove(id,dir)` меняет местами соседей одного родителя) → `POST /api/admin/categories/reorder {order:[db-id…]}` (присваивает `sort_order=(i+1)*10`). Соседи — тот же `parent_id`+`grp`.
- `GET /brand/:name` — SSR-страница бренда с полным каталогом и фасетами (тот же `catalog.js`, режим `window.PAGE_BRAND`): фетч `/api/products?brand=<name>`, фасет «Раздел» вместо «Бренд» (бренд охватывает разделы) + тип/разрешение/цена/наличие/характеристики + пагинация. Плитки на `brands.html` ведут сюда; старый `?brand=` редиректится на `/brand/`. Реализовано через `renderCategoryPage(catLike, rows, siblings, {urlPrefix:'/brand/', brand})` — общий шаблон с категориями/разделами.
- `GET /page/:slug` — SSR инфо-страница (доставка/оплата/гарантия/о компании) из таблицы `pages` через `lib/content-page.js` (`renderContentPage`). `body` — доверенный HTML из админки. Скрытая/несуществующая → 404. **Ссылки на страницы (`in_footer=1`) внедряются во ВСЕ подвалы** (SSR и статику) через `applySeo` — regex дописывает `<a href="/page/slug">` в конец колонки `<h4>Компания</h4>…</div>`, поэтому править 9 html-подвалов не нужно. `pages` в sitemap. Публичный `GET /api/pages` (slug/title/in_menu/in_footer), админ CRUD `/api/admin/pages` (slugify + проверка коллизии slug → 409). Вкладка админки «📄 Страницы» (title/slug/HTML-body/SEO/порядок/показ/в подвал/в меню). Сид 4 страниц в `db.js`. **Флаг `in_menu` пока хранится, но в шапку-меню не выводится — задел под конструктор меню (Этап B).**
- **Меню сайта (Этап B, конструктор):** таблица `menu_items` (`label,type,value,css_class,new_tab,sort_order,visible`), сид повторяет текущий навбар один-в-один. `type` ∈ {link,page,section,category}; `menuHref()` в `server.js` резолвит href (link→сырой URL/tel/anchor, page→`/page/slug`, section→page или `/section/slug`, category→`/category/slug`). **Рендер во ВСЕ навбары** (SSR и статика) через `applySeo`: `menuLinks()` строит `<a>`, regex заменяет содержимое между `<span class="chev">▾</span></button>` и `<span class="r">` — кнопка «☰ Каталог» (мегаменю, завязана на `#catBtn`), поиск и правый промо-текст сохраняются. Класс `fire` = красная подсветка пункта. Публичный `GET /api/menu` (label/href/css_class/new_tab), админ CRUD `/api/admin/menu`, вкладка «☰ Меню». **Хардкод-навбар в html/`header()` — fallback: если таблица пуста, `applySeo` не трогает навбар.** _Осталось (по желанию):_ drag-drop сортировка (сейчас порядок числом), вложенные пункты/дропдауны, вывод пунктов `in_menu` со страниц автоматически.
- `GET /api/sections` — разделы витрины из таблицы `sections` (Фаза 1).
- `GET /section/:slug` — динамическая SSR-страница раздела (Фаза 3). Если у раздела задан `page` (статическая страница) → **301 на неё** (без дубль-контента); иначе рендерит через `lib/category-page.js` с `urlPrefix='/section/'`. `renderCategoryPage(cat, products, siblings, opts)` теперь принимает `opts.urlPrefix`/`opts.siblingsTitle` — общий шаблон для категорий и разделов.
- `GET /api/products` — доп. фильтр `?cat=<cat_id>` (товары ветки категории, включая подкатегории, по `cat_path`).
- `GET /api/home` — доп. поле `cats` (категории с флагом `on_home`, для блока «Популярные подборки» на главной).
- `POST /api/order` — приём заявки (honeypot-антиспам; состав перепроверяется по БД; сохраняет услугу/страницу/UTM/комментарий).
- **Импорт (с токеном `IMPORT_TOKEN`):** `POST /api/import`, `/api/stock`, `/api/import/attrs` (только характеристики: `{items:[{sku,attrs}],onlyEmpty}` — пишет ТОЛЬКО колонку `attrs`, не трогает цену/остаток/название/фото; `onlyEmpty:true` не затирает уже заполненные), `/api/categories-sync`, `/api/offers-sync`.
- **Админка (JWT):** `/api/admin/login`, `/api/admin/products` (GET — пагинация+фильтры `q/group/brand/source/visible/stock/nophoto/nocat/sort/limit/offset`, отдаёт `{items,total,brands,sources}`; POST/PUT/DELETE), `/api/admin/products/bulk` (POST — массово `{ids,action:show/hide/group/category/delete,value}`; `category` привязывает к ветке: `cat_id`+`cat_path` предков via `catPathFor`), `/api/admin/stats` (дашборд: здоровье каталога, KPI заявок, динамика по дням 30д, пайплайн, топ-спрос/бренды/категории, неудовлетворённый спрос, **`sources`** — атрибуция заявок: `byService`/`bySrcPage`/`byReferer`(классификация referrer→Яндекс/Google/WhatsApp/Прямой/…)/`byUtm`(парсинг `utm_source`); рендер в `showDash`), `/api/admin/sales-stats` (сделки/конверсия по периодам, `loadSales`), `/api/admin/seo-audit`, `/api/admin/settings`, `/api/admin/suppliers`, `/api/admin/categories`, `/api/admin/sections` (GET/POST/PUT/DELETE — разделы витрины; PUT каскадно переносит `products.grp` при переименовании), `/api/admin/orders`, `/api/admin/alstyle-raw` (диагностика), `/api/admin/upload` (фото).

---

## Личный кабинет пользователей (сделано — сессия 2026-07-14, ЖДЁТ ДЕПЛОЯ)

Регистрация/вход клиентов + личный кабинет для B2B-монтажников (повтор закупки в один клик). **Аддитивно, гостевой поток заявок не тронут.**

- **Модель данных (`db.js`):** таблица `users` (`phone` UNIQUE=E.164, `email` UNIQUE=lower, `pass`=scrypt, `name`, `company/bin/address`=B2B-реквизиты, `status`=active|pending|blocked, `created_at/last_login`); `user_lists` (`user_id,name,items_json[{sku,qty}]`) — сохранённые списки; `ensureColumn('orders','user_id')` — привязка заявок. Сид `settings.registration_mode='open'`.
- **⚠️ ИЗОЛЯЦИЯ ТОКЕНОВ (критично):** админский `auth()` (server.js) проверял только валидность JWT — теперь требует **issuer `s1com` И `role==='admin'`**. Пользовательские токены подписываются **issuer `s1com-user` + `role:'user'`** (`~30 дней`) → в админку НЕ проходят. Проверено тестами (`user-токен на /api/admin/* → 401`).
- **Пароли — `lib/security.js` (scrypt)**, БЕЗ bcrypt (нет нативных зависимостей).
- **Бэкенд `lib/routes/users.js`** (регистрируется в server.js ДО orders, отдаёт `optionalUserId` для привязки заявок): публичные `POST /api/user/register` (обязательны телефон+email; `registerLimiter` 10/час; дубль→409; при `registration_mode='approval'`→`pending` без токена + Telegram-уведомление админу), `POST /api/user/login` (логин=телефон ИЛИ email; `loginLimiter`; pending/blocked→403). Защищённые (`userAuth`): `GET/PUT /api/user/me`, `POST /api/user/password`, `GET /api/user/orders` (обогащены brand/model/price/img для повтора), `GET/POST/PUT/DELETE /api/user/lists` (IDOR-защита `WHERE user_id=?`, лимит 50). Админские: `GET /api/admin/users` (+counts+orders_count), `POST /api/admin/users/:id/status`.
- **Привязка заявок:** `orders.js` `/api/order` и `/api/quick-order` зовут `optionalUserId(req)` → пишут `orders.user_id` (гость=0). Клиент (`product.js`/`catalog.js`) добавляет `Authorization: Bearer <sc_user_token>` при отправке заявки, если залогинен.
- **Фронт:** SSR-роут `/cabinet` (`lib/cabinet-page.js`, `noindex`, переиспользует `header/FOOTER/CART_HTML` + `product.js` → `window.scAdd` и выезжающая корзина). Логика — `public/js/cabinet.js` (SPA): токен в **localStorage `sc_user_token`**; вход/регистрация; вкладки Заказы (с «🔁 Повторить»→scAdd)/Списки (сохранить корзину, в корзину, переименовать/удалить)/Профиль (смена пароля)/Реквизиты. **Ссылка «👤 Кабинет» в шапке** — во всех страницах через `applySeo` (вставка в `.icons`, рядом с langsw); на главной (`index.html`, шапка без `.icons`) — вручную добавлен `.head .acc`.
- **Админка:** ⚙ Ещё → **«👥 Пользователи»** (`showUsers`/`renderUsers`: фильтр по статусу, подтвердить/заблокировать/разблокировать); ⚙ Настройки → селект **«Режим регистрации»** (`registration_mode`: open|approval).
- **Предзаполнение контактов:** залогинен → при открытии корзины `#cName`/`#cPhone` подставляются из профиля (`prefillContact()` в `product.js`/`catalog.js`, ленивый фетч `/api/user/me` при первом открытии; пустые поля не перетирают ввод).
- **Индикатор «вы вошли» в шапке (все страницы):** зелёная точка на иконке `a.acc` + имя в подсказке, когда есть `sc_user_token`. Сниппет — в `siteConfigScript()` (server.js, под nonce); имя берётся из кэша **`localStorage.sc_user_name`** (пишет `cabinet.js` при входе/смене профиля через `cacheName()`, чистит при выходе) — без запросов к серверу.
- **Избранное (♡):** карточки/строки каталога и брендов уже писали `localStorage.sc_fav` — теперь оно **работает целиком**. Глобальный `window.scFav` (в `siteConfigScript`, под nonce): localStorage-хранилище + бейдж-счётчик на ♡ в шапке (`[data-fav-badge]`) + **синк с аккаунтом** (`GET/PUT /api/user/favorites`, колонка `users.favorites`=JSON-массив SKU; при входе `scFav.pull()` мержит гостевое избранное в аккаунт). «Мёртвая» ♡ в шапке → ссылка `/izbrannoe` (переписывает `applySeo` во всех шапках; на главной — вручную). **Страница `/izbrannoe`** (`lib/favorites-page.js` + `public/js/favpage.js`, `noindex`): резолвит SKU через `/api/quick-order`, рендерит карточки, «в заявку»/«все в заявку»/«убрать». Сердечко добавлено: в **строки списка** каталога (`lfav`, дефолтный вид), на плитки (было), на **страницу товара** (`#pdFav` в `lib/product-page.js`+`product.js`). Синк — через `toggleList()` (catalog/brands) и `scFav.toggle()` (product/favpage), которые зовут `scFav.push()` (debounce 500мс).
- **Восстановление пароля (без почты/SMS):** менеджерский сброс — кнопка «🔑 Пароль» в 👥 Пользователи → `POST /api/admin/users/:id/password` генерирует временный пароль (10 симв., без похожих 0/O/1/l), отдаёт админу для передачи клиенту (статус не трогает); клиент меняет его в кабинете. На форме входа — ссылка «Забыли пароль?» с подсказкой связаться с менеджером (тел/WhatsApp из `SITE_CONFIG`).
- **Тесты (полное покрытие):** `tests/api.test.js` — **92/92** (регистрация+валидация полей, дубль-409, вход тел/email, изоляция токенов, привязка заявок, списки+IDOR, избранное+IDOR, сброс пароля, смена пароля, обновление профиля/реквизитов, полный цикл approval-режима pending→подтверждение→блокировка, битый токен=гость). E2E (реальный Chromium, `run.cjs`): **`cabinet.cjs` 12/12** (регистрация→кабинет→индикатор→предзаполнение→заказ→повтор) и **`favorites.cjs` 9/9** (♡ в строке→бейдж→/izbrannoe→синк с аккаунтом). Весь `npm run test:all` зелёный (unit 23, api 92, supplier 15, security 16, e2e все спеки).
- **⚠️ Семантика лимитеров (исправлено при тестировании, реальный фикс):** `loginLimiter` — `skipSuccessfulRequests:true` (считаем только НЕудачные входы = защита от брутфорса; успешные входы клиентов за общим IP не блокируют друг друга). `registerLimiter` — `max:20`, `skipFailedRequests:true` (неудачные регистрации 400/409 не жрут квоту — иначе опечатки/дубли за корпоративным NAT блокировали бы легитимных).
- **Для деплоя:** `db.js`(!), `server.js`, `lib/routes/users.js`(новый), `lib/routes/orders.js`, `lib/routes/settings.js`, `lib/cabinet-page.js`(новый), `lib/favorites-page.js`(новый), `lib/product-page.js`, `public/js/cabinet.js`(новый), `public/js/favpage.js`(новый), `public/js/product.js`, `public/js/catalog.js`, `public/js/brands.js`, `public/index.html`, `admin/index.html`. Новых ENV не требуется (JWT_SECRET уже есть). Telegram-уведомления о регистрации — используют существующий `tg_token/tg_chat_id`.

## 7. Безопасность (сделано)

JWT-авторизация (**HS256 + issuer='s1com'** зафиксированы в sign/verify — защита от alg-подмены); rate-limit (вход 10/15мин, импорт, общий, заявки 20/мин); проверка дефолтных секретов в проде (сервер не стартует с паролём по умолчанию); санитизация ввода; helmet + CSP (Google Fonts разрешены). Заявки: honeypot + состав пересобирается по базе (клиентским ценам/названиям не доверяет) + **телефон обязателен и валидируется** (Казахстан: нормализация 8→7, 11 цифр с 7; иначе 400). SQLite: WAL + foreign_keys + **busy_timeout=5000** (конкурентные import/restore/бэкап). Аудит 2026-07-10: P0 телефон закрыт, P1 JWT/busy_timeout закрыты; «быстрый заказ» — не баг (резолвер, заявка идёт через корзину→/api/order).

---

## 6a. Конверсия и Schema.org (аудит 2026-07-14)

- **Липкая мобильная панель + плавающая WhatsApp** — инжектятся в `applySeo` (все публичные страницы): `.mcta` (Звонок/WhatsApp/Заявка, только `<768px`, «Заявка»→`#cartOpen`), `.wafab` (плавающая WhatsApp только `≥769px`). Телефон/WA из `org_phone`. Клики трекаются `track()`. Проверка — `tests/e2e/conversion.cjs`.
- **`WebSite`+`SearchAction` JSON-LD** на главной (в `localBusinessLd`) — sitelinks-поиск в Google, модель `/?q={search_term_string}`.
- **Детектор дублей между поставщиками** — `GET /api/admin/duplicates` (auth): группы «бренд+модель в разных `source`» (Al-Style ⇄ Complex/Excel), read-only; админка 🏭 Поставщики → «🔁 Найти дубли», скрытие лишнего через bulk-hide (без авто-мёрджа). Тест — `supplier.test.js`.
- **Порог качества attrs Al-Style** — `enrichDetail` использует характеристики только при `≥ MIN_ATTRS` (ENV, деф.3) пар (иначе мусорный разбор detailText → падаем на descr).

## 7a. Клавиатурная доступность (a11y)

Единый a11y-скрипт инжектится через `siteConfigScript()` (server.js) во все страницы (под nonce): **Escape** закрывает корзину/мегаменю/моб.фильтры (`.open`-классы + сброс `aria-expanded` у `#catBtn`); **onclick-элементы без href/не-кнопки** (напр. `.hq a` «Популярное») автоматически получают `tabindex=0`/`role=button` и активируются Enter/Space. Видимый фокус — `:focus-visible{outline}` в `catalog.css` и `index.html`. Проверка — `tests/e2e/a11y-keyboard.cjs` (в наборе `npm run test:e2e`).

## 8. ENV-переменные

Обязательные в production (иначе сервер не стартует):
- `ADMIN_PASSWORD` (или `ADMIN_PASSWORD_HASH`)
- `JWT_SECRET`
- `IMPORT_TOKEN`

Важные:
- `DB_PATH` — **должен вести на постоянный диск Render**, напр. `/data/data.sqlite` (иначе данные могут теряться при деплое). ⚠️ **Проверить: Render → сервис → Disks.**
- `IMAGES_DIR` — напр. `/data/images`.
- `SITE_URL` — рабочий домен. **Дефолт в коде = `https://servis-catalog.onrender.com`** (живой хост), поэтому без этой переменной сайт работает нормально. Задавать `https://s1com.kz` — только когда домен реально делегирован (тогда же и на cron-сервисах). Единый источник домена для canonical/sitemap/robots/og/JSON-LD. **Каноникализация хоста (server.js):** старый `*.onrender.com` и `www.` → 301 на канон — включается **ТОЛЬКО при явно заданном `SITE_URL`** (production, GET/HEAD; `/health` и `/api/` не трогает; отключается `NO_HOST_REDIRECT=1`). ⚠️ Урок 2026-07-15: раньше редирект брал дефолт `s1com.kz` из кода и **уронил прод** — весь сайт ушёл в 301 на неподключённый домен, а `/health`+`/api/` отвечали 200, поэтому проблема была не видна со стороны API. Молчаливый дефолт домена не должен уводить трафик.
- `ALSTYLE_API_KEY` — ключ Al-Style (для импорта и диагностики). На веб-сервисе добавлен.
- `NODE_VERSION` — `20.18.1`.
- `YM_ID`, `YANDEX_VERIFICATION`, `GOOGLE_VERIFICATION` — можно и через админку (Настройки).
- `CORS_ORIGINS` — при необходимости ограничить API.

### ‼️ ЗАПОЛНИТЬ: какие ENV фактически заданы
_(перечисли ключи, которые уже стоят на веб-сервисе и на Cron-сервисе; значения писать НЕ нужно)_
- Веб-сервис `servis-catalog`: `ADMIN_PASSWORD`, `DB_PATH`, `IMAGES_DIR`, `IMPORT_TOKEN`, `JWT_SECRET`, `NODE_ENV`, `NODE_VERSION`, `SEED_ON_EMPTY`, `ALSTYLE_API_KEY`, …
- Cron-сервис импорта: …

---

## 9. Настройки сайта (управляются из админки → ⚙ Настройки)

Хранятся в таблице `settings`, применяются на весь сайт через `applySeo`:
- `logo_url` (картинка) / `logo_text` / `company_name` — логотип.
- `cat_icons` (JSON) — иконки 6 разделов (эмодзи или URL).
- `cat_filters` (JSON) — какие фильтры показывать в каждом разделе (Бренд/Тип/Разрешение/Цена/Наличие).
- `ym_id`, `yandex_verification`, `google_verification` — Метрика и коды подтверждения.

На фронт конфиг прилетает как `window.SITE_CONFIG = { cat_icons, cat_filters, sections, usps, home_blocks, wa, phone }`. **Контакт — единый источник:** `wa` (цифры для `wa.me`) и `phone` берутся из `settings.org_phone` (`siteConfigScript`); фронт-файлы (`public/js/*`) читают `WA` из `SITE_CONFIG.wa` с fallback на хардкод — номер меняется в одном месте (⚙ Настройки → Организация). **Телефон в статических шапках/подвалах html (`tel:`/`wa.me`/текст) тоже переписывается `applySeo` из `org_phone`** (аудит 2026-07-13): подставляет цифры в `77053541999` и текст `+7 705 354-19-99` → смена телефона в админке применяется ко ВСЕЙ статике (проверено E2E). Прежняя заметка «пока хардкод» устарела.

---

## 10. Что уже сделано

- **Редизайн всего сайта:** главная-лендинг, 6 разделов с фильтрами-фасетами, страница товара (галерея/вкладки/похожие), страница брендов, единая шапка + мегаменю + корзина.
- **Заявки:** корзина (localStorage `sc_cart`) → `/api/order` с услугой/страницей/UTM; в админке — статусы + экспорт в Excel; атрибуция источника.
- **SEO:** SSR-товары в HTML (для Яндекса/Google), sitemap, Schema.org, canonical.
- **Флаги** хит/новинка/акция → блоки «Хиты/Новинки» на главной + бейджи на карточках.
- **Форма редактирования товара** («✎») со всеми полями + **SEO-поля** (title/desc/H1/slug).
- **SEO-центр** (вкладка 🔍): товары без фото/описания/цены/бренда, короткие описания, дубли.
- **FAQ на витрине** (2026-07): блок «Частые вопросы» на главной (`home.js`, ключ `home`) и на страницах разделов (`catalog.js`, маппинг `FAQ_KEY`: Видеонаблюдение→`video`, Сетевое→`setevoe`, СКУД→`skud`, Пожарная→`pozharnaya`) — аккордеон из таблицы `faq` (`/api/faq?page=`) + **FAQPage-микроразметка** (rich-сниппеты). Стили `.faq` в `index.html` и `catalog.css`.
- **Фаза 3 (конверсия главной) — ЗАВЕРШЕНА.** Управляемые из админки: **Отзывы** (таблица `reviews`, `/api/reviews`, вкладка «⭐ Отзывы», блок на главной + Review/AggregateRating-микроразметка), **Баннеры/акции** (таблица `banners`, `/api/banners`, вкладка «🎯 Баннеры», промо-блок вверху главной), **Готовые решения** (таблица `bundles`, `/api/bundles` + `/api/admin/bundles` CRUD, вкладка «📦 Решения», блок «Готовые решения» на главной между «Популярными подборками» и «Хитами»). Все три — полный срез (БД+API+витрина+админка), рендер в `home.js` (`renderReviews`/`renderBanners`/`renderBundles`), стили `.reviews`/`.banner`/`.bundle` в `index.html`. **Bundles:** `skus` хранится как JSON-массив артикулов; публичный `/api/bundles` резолвит SKU в товары (`{sku,brand,model,price,img,slug}`, только `visible=1`) и считает цену «Комплект от N ₸» (сумма товаров, либо ручное поле `price` если задано); `parseSkus()` в `server.js` принимает массив/строку через запятую/JSON, режет до 20; карточка на главной = картинка/📦 + заголовок + описание + чипы-ссылки на товары + цена + кнопка (ссылка или WhatsApp с названием комплекта). Проверено реальным запуском: резолв 3 SKU → цена=сумма, jsdom-рендер главной (3 карточки, товары-ссылки, авто-цена, 0 JS-ошибок), админ-CRUD.
- **Настройки:** логотип, иконки разделов, **фильтры по разделам**.
- **Компактные карточки** (адаптивная сетка, фото 4:3).
- **Исправлено:** CSP-шрифты, услуга заявки для ИБП/Кабельных, зависание дашборда, тихое «+ Товар».

---

## 11. План развития (этапы)

- **A. Товары и категории как CMS.** _Сделано:_ SEO-поля и флаги товара; **карточка категории** — в `categories` добавлены `icon, image_url, descr, seo_title, seo_desc, h1, slug, in_menu, on_home` (аддитивно, `categories-sync` их не затирает); редактор «✎» в админке (вкладка «Категории»); `/api/categories` учитывает `in_menu` и отдаёт `icon`; иконка выводится в мегаменю. Сортировка/вложенность были и раньше. **Страницы категорий** (`/category/:key`, SSR с `descr`/SEO/картинкой + сетка товаров ветки) и блок `on_home` на главной («Популярные подборки») — _сделано_. Категории добавлены в `sitemap.xml`. _Сделано:_ **фильтры-фасеты на странице категории** (бренд/наличие/сортировка над SSR-карточками, `lib/category-page.js`), **массовое заполнение SEO категорий** (`POST /api/admin/seo-fill-cats` + панель «🗂 Массовое заполнение SEO категорий» в SEO-центре, счётчики `cats.fillable` в аудите; шаблоны title/desc/h1/вводный descr), **умный подбор похожих товаров** (`relatedFor()` в server.js: тирами — та же категория по `cat_id` (в наличии + близкая цена) → тот же бренд в разделе → раздел по близости цены; заменил случайный `RANDOM()`).
- **B. Конструктор меню** — _Сделано:_ верхний навбар из базы (`menu_items`), рендер во все шапки через `applySeo`, типы link/page/section/category/**brand**/**bundle** (аудит 2026-07-13: brand→`/brand/<name>`, bundle→`/bundle/<id>` в `menuHref`+`MENU_TYPES`+админ-лейблы/подсказки), класс-подсветка, показ/порядок, drag-drop, вложенные дропдауны, авто-вывод страниц с `in_menu`, вкладка «☰ Меню». **B закрыт.**
- **C. Блоки продаж и главная** — _Сделано:_ баннеры, отзывы, FAQ, «готовые решения» (блок на главной + **SSR-страницы `/bundle/:id`** с «весь комплект в заявку»), **управляемые преимущества** (⚙ Настройки → «🌟 Преимущества», `settings.home_usps` JSON → `SITE_CONFIG.usps`, рендер в `home.js` с хардкод-fallback), **управление заявками** (статусы new/in_work/order/rejected, сумма, заметка менеджера, кнопки WhatsApp/звонок с нормализацией телефона 8→7, экспорт в Excel, атрибуция). **Конструктор главной** (⚙ Настройки → «🧩 Блоки главной»): `settings.home_blocks` JSON `[{key,on}]` → `SITE_CONFIG.home_blocks`; блоки главной помечены `data-block` (banners/categories/subcats/bundles/hits/newest/brands/about/reviews/faq/cta) внутри `<div id="landing">`; `applyHomeBlocks()` в `home.js` переставляет (`appendChild` по порядку конфига) и скрывает (класс `.blk-off{display:none!important}`) блоки; админ-редактор с чекбоксами и ↑↓ (`hbRowHtml`/`hbMove`/`collectHomeBlocks`, всегда шлёт все 11). **Блок C полностью готов.**
- **D. SEO-центр — расширение** — _Сделано:_ проверка длины SEO title (>60) / description (>160), дубли slug (товары и категории), категории-посадочные без SEO-текста — всё в `/api/admin/seo-audit` + вкладка «🔍 SEO»; перелинковка (блок «Другие категории раздела» на `/category/:key`); **массовое заполнение SEO по шаблонам** — панель «🪄 Массовое заполнение SEO» в SEO-центре + `POST /api/admin/seo-fill` (`{fields:{title,desc,h1}, onlyEmpty, group}`): Title `Бренд Модель — купить в Казахстане, цена и характеристики | Сервис.com`, H1 `Бренд Модель`, Description из `descr` товара (или generic с арт.); по умолчанию `onlyEmpty=true` (не затирает ручные), опц. фильтр по разделу, товары без модели пропускаются; `seo-audit` отдаёт `seoFillable{noTitle,noDesc,noH1}` (сколько пустых). **Проверка битых внутренних ссылок** — `seo-audit` отдаёт `brokenLinks[]` (`{where,label,detail}`): пункты меню (page/section/category/link), подборки (`bundles.skus` → нет в каталоге/скрыты), баннеры (внутр. `link`) и разделы (`sections.page`-файл), ведущие на несуществующие/скрытые страницы/разделы/категории/товары/файлы; `checkInternal()` резолвит `/page/`·`/section/`·`/category/`·`/product/`·`*.html` по БД и `public/` (внешние http/tel — пропускает); карточка «🔗 Битые внутренние ссылки» в SEO-центре. **D закрыт.**
- **E. Мультипоставщик + 1С** — фундамент в базе есть (`suppliers`, `offers`, `category_map`, `price_rules`, `match_queue`; 1С как поставщик). _Сделано:_ **защита источников** — колонка `products.source` (`al-style`/`excel`/`<поставщик>`); `FULL_SYNC` в `/api/import` снимает с показа **только товары своего источника** (`WHERE source=? AND sku NOT IN …`), поэтому полный импорт Al-Style не трогает чужой ассортимент; Excel-загрузка (`/api/admin/import-file`) помечает `source='excel'`. Контекст: часть каталога (Wi-Tek, Imou — ~130 позиций) **не из Al-Style**, залита Excel; в будущем — по API другого поставщика (тогда подключать через `/api/offers-sync`). **Склейка дублей — _сделано_ (сессия 2026-07-15), см. раздел «Склейка дублей» ниже.** _Осталось (не нужно для текущего сценария):_ UI маппинга категорий (`category_map`) и правил наценки (`price_rules`) — обе таблицы в рантайме сейчас НЕ используются (категории ставит импорт, цена берётся как розница поставщика), поэтому UI к ним = мёртвый код; делать, когда появится поставщик, отдающий только закуп и свои категории.

## Склейка дублей между поставщиками (Этап E) — сделано 2026-07-15

Один товар приходит от Al-Style и Complex под разными артикулами → на витрине двоится. Теперь есть конвейер, который оставляет одну карточку.

- **Где смотреть:** админка → 🏭 Поставщики → блок «🔗 Склейка дублей (по офферам)»: «🔎 Предпросмотр» (dry-run), «🔗 Склеить надёжные (EAN)», «📋 Очередь спорных», «📎 Что склеено».
- **Как решает:** ключ склейки — **EAN** (надёжно → авто-склейка) или **бренд + нормализованный MPN** (спорно → очередь `match_queue`, решает человек). Логика — `lib/matching.js` (чистая, покрыта юнит-тестами), API — `lib/routes/match-admin.js` (`/api/admin/match/preview|run|queue|resolve|unmerge|merged`).
- **Победитель** = меньший `suppliers.priority`, при равенстве — в наличии → дешевле → меньший id. Проигравшие: `products.merged_into=<id победителя>` + `visible=0`.
- **⚠️ Ключевой момент — `merged_into` и `hidden_manual`.** `/api/import` при каждом обновлении ставит `visible=1`, поэтому «просто скрытый» товар воскресал ночным импортом. Теперь UPDATE импорта: `visible=CASE WHEN merged_into>0 OR hidden_manual>0 THEN 0 ELSE 1 END`. **Это же чинит старый баг:** ручное «Скрыть» в админке раньше отменялось ночным импортом (совет «прятать дубли через bulk-hide» не работал дольше суток). `hidden_manual`: `1` — скрыто руками (админка/форма), `2` — правилом «убрать из Al-Style» (снимается вместе с галкой бренда). Склейка не трогает скрытое руками и не делает такой товар победителем.
- **Офферы шлют оба импорта:** `alstyle-import.js` (`mpn`=`article_pn`, `ean`=`barcode`) и `complex-import.js` (`mpn`=`model`, EAN у Complex нет → его дубли идут через очередь). Без офферов склейке нечего сверять: сначала импорт, потом склейка.
- **⚠️ EAN приходит, только если его запросили.** `barcode` — это `additional_fields` (в `CFG.ADDITIONAL` у `alstyle-import.js`), и раньше его там не было → `offers.ean` всегда пуст → автосклейка не срабатывала НИКОГДА. `article_pn` — базовое поле, запрашивать не нужно. Al-Style отдаёт **500** на неизвестное `additional_fields`: аварийный откат — ENV `ALSTYLE_ADDITIONAL` (без правки кода). Импорт **сам печатает здоровье ключей** («EAN у N (%), артикул производителя у M (%)») и предупреждает, если ключ мёртв — смотреть в логах cron после прогона.
- **Авто-склейка после импорта:** `POST /api/match/auto` (авторизация — `IMPORT_TOKEN`, как у `/api/import`; зовут оба скрипта в конце). Включается ENV **`AUTO_MERGE=true`** на cron-сервисе, по умолчанию **выключена** — витрину нельзя менять молча, пока владелец не посмотрел предпросмотр. Склеивает только надёжные (EAN); спорные всегда идут в очередь и без человека не скрываются.
- **⚠️ При нынешней паре поставщиков надёжных склеек не бывает ВООБЩЕ — `AUTO_MERGE` включать бессмысленно** (проверено 2026-07-16). Надёжная группа требует совпавший EAN у **двух разных поставщиков** (`matching.js`, `finish()`: `suppliers.size < 2` → группа отбрасывается), а у API Complex штрихкода нет вовсе — `complex-import.js` шлёт `_ean: ''` жёстко. Значит в EAN-группу попадают только офферы Al-Style → один поставщик → отбраковка. Итог: «🔗 Склеить надёжные (EAN)» и `AUTO_MERGE=true` не склеят ни одной позиции, всё уходит в очередь спорных на ручной разбор. Запрос `barcode` у Al-Style (и вся EAN-ветка) окупится только с третьим поставщиком, который отдаёт EAN. Это НЕ баг — так задумано; ошибочно было ожидание в DEPLOY_NOW.
- **«Это разные товары» — решение навсегда** (`status='dismissed'`, дедуп по `match_queue.match_key` = ключ группы, а не по `offer_id`: оффер победителя меняется после переимпорта). `doRun` такие группы пропускает и считает в `dismissed`. Отменить — админка → 🏭 Поставщики → «🚫 Не дубли» → «Вернуть в очередь» (`GET /api/admin/match/dismissed`, `POST /api/admin/match/undismiss`). Раньше отказ писался как `resolved`, а дедуп смотрел только `status='open'` → та же группа возвращалась в очередь каждый прогон (с `AUTO_MERGE` — ~48 раз в сутки).
- **Масштаб:** `loadRows` двухпроходный (сначала ключи, потом полные строки только для кандидатов) — 50k офферов ≈ 385мс вместо ~1.1с; потолок `MATCH_MAX_OFFERS` (деф. 80000) → 413 вместо OOM. better-sqlite3 синхронный: тяжёлый запрос морозит сайт целиком, потолок не убирать бездумно.
- **Тесты:** `tests/unit/matching.test.js` (13), `tests/e2e/match-admin.cjs` (15, реальный браузер), блок в `tests/api.test.js`.

## Раздел «Полезное» (SEO-контент) — сделано 2026-07-15

Статьи-посадочные под НЧ-запросы монтажников/заказчиков — прямая работа на цель сайта (трафик из Яндекса → заявки).

- **Витрина:** `/poleznoe` (список) и `/poleznoe/:slug` (статья) — SSR через `lib/article-page.js` (переиспользует `header/FOOTER/CART_HTML` из `product-page.js`). Пункт «Полезное» добавляется в навбар идемпотентно (`db.js`, флаг `poleznoe_menu`).
- **Статья ведёт в каталог — в этом весь смысл.** У статьи есть `grp` (раздел витрины) → под текстом автоматически показываются 4 товара этого раздела + ссылка «Все товары раздела»; либо точечные товары через `skus` (JSON-массив артикулов). Ссылка на раздел рендерится, **даже если товаров не нашлось** — иначе статья была бы тупиком. Плюс CTA «Оставить заявку» (открывает корзину) и WhatsApp.
- **Таблица `articles`:** `slug,title,excerpt,body(HTML),grp,skus,image_url,seo_title,seo_desc,h1,published_at,sort_order,visible`. Сид 5 статей — `scripts/seed-articles.js` (тексты отдельно от схемы), подключается по флагу `articles_seeded`: не воскрешает удалённое и не перетирает правки в админке.
- **Админка:** 📄 Контент → «📚 Полезное» (CRUD, выбор раздела, товары, SEO). `body` чистится `sanitizeCmsHtml`, как у инфо-страниц.
- **SEO:** `Article` + `BreadcrumbList` JSON-LD, canonical, og:image; список — `ItemList`. Статьи и `/poleznoe` в `sitemap.xml`. Публичный `GET /api/articles` (`?grp=` — статьи раздела, `?limit=`), админ CRUD `/api/admin/articles`.
- **Перелинковка двусторонняя** (иначе статьи — сироты для поиска, на них вёл бы только пункт меню): блок «Полезное» на главной (`data-block="articles"` в конструкторе главной, данные — в `/api/home`, рендер `renderArticles()` в `home.js`) + блок «Полезное по теме» на страницах разделов (`loadArticles()` в `catalog.js` → `/api/articles?grp=<PAGE_GROUP>`, вставляется над FAQ; если статей раздела нет — блок не появляется).
- **⚠️ Грабли (уже ловили):** плейсхолдер фото внутри `onerror="…"` обязан использовать `&quot;`, иначе двойная кавычка закрывает атрибут и страница валится с `Invalid or unexpected token` — но только там, где есть карточки товаров. Образец — `lib/product-page.js`. Проверка — `tests/e2e/articles.cjs` (18 проверок, следит и за JS-ошибками).

## Телеграм-пульт (управление из чата) — сделано 2026-07-15

Тот же бот, что шлёт уведомления о заявках, принимает команды. Подключение: ⚙ Настройки → блок «🎛 Телеграм-пульт» → «Подключить пульт» (нужен публичный HTTPS — на localhost Telegram вебхуки не шлёт).

- **Команды:** `/orders`, `/order 12` (+ кнопки статуса), `/find камера`, `/sku 57975`, `/price 57975 45000`, `/stock 57975 12`, `/stats`, `/help`. В **уведомлении о новой заявке** теперь есть кнопки «🔧 В работу / ✅ Заказ / ✖️ Отказ» — статус меняется из чата.
- **Файлы:** `lib/telegram-bot.js` (логика команд — чистая, без сети, тестируемая), `lib/routes/telegram-bot.js` (вебхук + connect/disconnect), `lib/telegram.js` (+`api/sendMessage/editMessage/answerCallback/setWebhook`).
- **⚠️ Доступ:** вебхук `/api/telegram/webhook/<secret>` — публичная точка. Три рубежа: секрет в пути + заголовок `X-Telegram-Bot-Api-Secret-Token` (оба обязательны, сравнение через `safeEqual`) + белый список чатов. Секрет (`settings.tg_webhook_secret`) **маскируется в access-log** (morgan token `url`) — иначе из логов Render его можно было бы прочитать и подделать апдейт. **В группе** (chat.id<0) команды принимаются только от id из «Кому ещё разрешён пульт» (`settings.tg_admins`) — иначе пульт получал бы каждый участник чата уведомлений. В личке достаточно `tg_chat_id`.
- **Тесты:** `tests/unit/telegram-bot.test.js` (25).

**LocalBusiness-микроразметка (сделано):** JSON-LD `ElectronicsStore` на главной для локального/картового поиска (Яндекс.Бизнес/Карты). `localBusinessLd()` в server.js собирает из настроек (`org_address/org_city/org_phone/org_email/org_hours/org_lat/org_lng/org_social` + `company_name`/`logo_url`) с дефолтами (Усть-Каменогорск, пр. Назарбаева 23, +77053541999, Mo-Sa 09:00-18:00); geo/email/sameAs добавляются, только если заданы. `applySeo` подставляет по маркеру `<!--LOCALBIZ-->` (есть только в `public/index.html`) → микроразметка только на главной. Редактор — ⚙ Настройки → «🏢 Организация». Прежний статичный `Store`-LD в index.html заменён на маркер.

**Идеи вне этапов:** ~~Телеграм-уведомления о заявках~~ (_сделано_); Телеграм-бот-пульт (импорт/остатки/заявки/цены); подключение домена; ~~оптимизация картинок (webp)~~ (_сделано_); ~~бэкапы БД по расписанию~~ (_сделано_ — см. ниже).

**Расширенная аналитика заявок (сделано):** `/api/admin/stats` доп. поля — `funnel{new,in_work,order,rejected,total}` (воронка по статусам), `revenueDaily[{d,s}]` (выручка по дням 30д — сумма `amount` заявок-заказов), `revenue{month,prevMonth,won,lost,conversion,avgCheck}`. На дашборде: график выручки по дням (с ▲/▼ к пред. месяцу, конверсия, ср. чек) + блок «Воронка заявок» (бары new/in_work/order/rejected).

**Аналитика спроса по клиентам (сделано — сессия 2026-07-14, ждёт деплоя):** `/api/admin/stats` доп. поля — **`customers{total,active,pending,blocked,new30,withOrders,conversion}`** (метрика зарегистрированных клиентов кабинета; `conversion`=клиенты с ≥1 заказом ÷ всего) и **`topFavorites[{sku,name,count,inStock,price,ordered}]`** — агрегат `users.favorites` по всем клиентам (топ-10 по числу добавивших в ♡). Флаг **`ordered`** (заказывали ли этот SKU хоть раз) даёт чистый сигнал спроса: `count` большой + `ordered=false` = хотят, но не купили → повод для акции/предложения. `orderedSkus` собирается в общем цикле по заявкам. Рендер в `showDash`: блок «Клиенты» (KPI) + «❤️ Самое желаемое» (с меткой «не заказывали»). Оба поля с дефолтами в fallback-ветке (безопасно на ещё не мигрированной БД без таблицы `users`). Тесты: api.test.js (customers.total/withOrders/conversion, topFavorites+ordered) — **96/96**; jsdom-рендер дашборда.

**Восстановление из бэкапа в один клик (сделано):** `POST /api/admin/backups/:name/restore` — **логическое** восстановление без перезапуска: сначала авто-страховочный бэкап текущего состояния, затем `ATTACH` бэкапа + перенос данных всех таблиц (`DELETE`+`INSERT SELECT` по пересечению колонок — устойчиво к дрейфу схемы) в транзакции, `foreign_keys=OFF`, перечитка `SETTINGS`. Кнопка «↻ Восстановить» в списке бэкапов (⚙ Ещё → Бэкапы) с подтверждением. Проверено: удаление товаров/заявок → restore → данные вернулись, страховочная копия создана.

**Бэкапы БД (сделано):** авто-бэкап раз в сутки **в самом процессе сервера** (`scheduleBackups()` в server.js — тик раз в час, создаёт копию если последней нет ≥24ч; первый тик через 30с после старта; отключается `BACKUP_DISABLE=1`) — отдельный cron не нужен. `makeBackup()` использует онлайн-бэкап better-sqlite3 (`db.backup()` — безопасно на живой базе). Каталог `BACKUP_DIR` (по умолчанию `<dir DB_PATH>/backups` → на Render постоянный диск `/data/backups`, переживает деплой), ротация последних `BACKUP_KEEP` (14). Управление из админки (⚙ Ещё → «💾 Бэкапы БД»): список, «создать сейчас», скачать, удалить — `GET/POST /api/admin/backups`, `GET /api/admin/backups/:name/download`, `DELETE /api/admin/backups/:name` (имя валидируется `BACKUP_RE`, `path.basename` — защита от traversal). Восстановление — вручную: скачать → заменить файл на `DB_PATH` → перезапустить. Ручной скрипт `scripts/backup.js` (`npm run backup`) остаётся.

**Telegram-уведомления о заявках (сделано):** `lib/telegram.js` — `notifyOrder(order, cfg)` / `sendTest(cfg)` / `send()`. Конфиг `cfg={token,chatId}` берётся из **настроек админки** (`SETTINGS.tg_token`/`tg_chat_id`, хелпер `tgCfg()` в server.js), fallback — ENV `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`. Уведомление обогащено: услуга, комментарий, страница-источник. Настройки: поля в ⚙ Настройки + кнопка «📨 Отправить тест» (`POST /api/admin/telegram-test`, инструкция по @BotFather/@userinfobot прямо в UI). Отправка — fire-and-forget с таймаутом 8с, ошибка не ломает приём заявки.

**Webp-оптимизация картинок (сделано):** при загрузке фото в админке (`toWebp()` в `admin/index.html`) изображение конвертируется в **WebP через canvas на клиенте** (без серверных зависимостей вроде sharp), ужимается до 1600px, качество 0.82; при отсутствии поддержки/ошибке/таймауте (6с) — fallback на оригинал. Сервер `/api/admin/upload` уже принимал webp. Плюс `applySeo` добавляет `<link rel="preconnect"/dns-prefetch href="https://al-style.kz">` во все страницы — ускоряет загрузку внешних фото товаров с CDN Al-Style.

---

## 12. Al-Style API (для модуля атрибутов и импорта)

### Параметры Al-Style API (из документации ЛК, 2026-07)

- **База:** `https://api.al-style.kz/api/` — GET (некоторые POST), ключ в параметре `access-token`. Ответ — JSON.
- **Наш `sku` = `article` Al-Style** (в импорте `sku: String(el.article)`). `article_pn` — это Part Number (не наш ключ).
- **Списки товаров:** `/elements` и `/elements-pagination` — **ищут по `category`/`brand`, НЕ по коду**. Параметры: `category`, `limit` (≤250), `offset`, `exclude_missing`, `brand`, `additional_fields`. Импорт тянет каталог через `/elements-pagination` по веткам (см. `scripts/alstyle-import.js`, `BRANCH_MAP`).
- **Один товар по коду:** `/element-info?article=<код>` (несколько — через запятую). Поддерживает `additional_fields`, включая `properties` и `detailText`.
- **Характеристики (главное):** метод **`/api/properties?article=<код>`** (или `?category=`). Ответ: `{ elements:[ { id, article, properties:[ {id, name, value, sort} ] } ], pagination:{...} }`. Т.е. атрибуты — массив `{name, value}`. ⚠️ В списке есть служебные (`Артикул`, `Код`, `Базовая единица`, `В упаковке`) — их надо отфильтровывать; полезные — типа `Частота процессора`, `Bluetooth`, `Разрешение` и т.п.
- **`additional_fields` для `/elements*` и `/element-info`:** `description, brand, weight, warranty, images, url, barcode, rrp, dimensions, tnved, multiplicity, warehouses…` (+ для `/element-info` ещё `detailText`, `properties`). **Полей `characteristics/params/specification/attributes` НЕ существует** — запрос с ними даёт 500.
- **Остатки/цены:** `/quantity` (только остатки), `/quantity-price` (остаток + `price1` дилерская + `price2` розничная + `discountPrice`). `price1==1` → «цена по запросу».
- **Прочее:** `/images?article=`, `/categories`, `/brands`, корзина/заказы `cart-api/*` (для будущей интеграции заказов в Al-Style).
- **Диагностика в админке** (Настройки → «🔌 Диагностика API Al-Style») теперь шлёт `?article=` в `/element-info` по умолчанию с `additional_fields=properties,detailText,…`; метод и поля настраиваются. Прошлый баг: слала `id_elements` в `/elements` (который по коду не ищет) → 500.

### Характеристики (attrs) — _реализовано (веб-часть)_
- `products.attrs` — JSON `[{name,value}]` (`ensureColumn` в `db.js`).
- `/api/import` (`sanitizeProduct`) принимает `attrs` **или** `properties`; `cleanAttrs()` в `server.js` фильтрует служебные поля (стоп-лист `ATTR_STOP`), режет до 40 пар. UPDATE обновляет `attrs` только если пришло непустое (обычный импорт без свойств не стирает).
- `rowToAdmin`/`rowToPublic` отдают `attrs` (массив); `lib/product-page.js` строит таблицу характеристик из `attrs`, fallback — парсинг `descr` по запятым.
- **Наполнение (cron):** ⚠️ **`/properties` отдаёт ЛОГИСТИКУ, а не ТТХ** (Код ТН ВЭД/НКТ/Объём/Штрихкод…) — проверено на реальных данных 2026-07-09. Настоящие характеристики лежат в **`detailText`** (`<li>Название; Значение`, ~60 пунктов у камер/сетевого). Поэтому источник переключён на **`enrichDetail()`** (`alstyle-import.js`): дозапрашивает `element-info?article=&additional_fields=detailText` пачками по 25 (с ретраями на сетевые сбои), парсит `parseDetailAttrs()` → `attrs`. Включается `FETCH_PROPS=true` **или** `FETCH_DETAIL=true` (cron с `FETCH_PROPS` подхватит detailText автоматически). `enrichAttrs()` (/properties) оставлен, но не вызывается. **Только ~15% товаров имеют detailText** (у 57975 — 40 ТТХ); у остальных характеристики берутся из `descr`. **Мусорные attrs из первого прогона `/properties` прячутся при показе** через `JUNK_ATTR` (в `lib/product-page.js` и `public/js/catalog.js` — фасеты/чипы/таблица), поэтому junk-only товары падают на разбор `descr`. Разовая перезаливка ТТХ: `node scripts/alstyle-import.js --props --force`.

### Фото товаров
- Импорт формирует URL из поля `images` Al-Style (http→https). Если `images` нет — угадывается шаблон `…/<code5>_1.jpg` (суффикс `_1`, как в методе `/images`; раньше был ошибочный `_01`). Проверка прода (2026-07): ~92% фото грузятся (HTTP 200), «дыры» — там, где у Al-Style **нет файла** (404), в основном у новинок.
- **Плейсхолдер вместо логотипа:** при ошибке загрузки фото карточка/страница товара показывает 📷 (на странице товара — «📷 Фото уточняется»), а НЕ `logo.png`. Единый вид во всех шаблонах (`lib/product-page.js`, `catalog.js`, `home.js`, `brands.js`, `category-page.js`).
- **Точные фото (cron):** `enrichImages()` дозапрашивает `/images?article=` пачками по 100, матчит URL на товар по коду в имени файла, ставит только реально существующие файлы. **Флаг `FETCH_IMAGES=true`** (по умолчанию выключено).
- **Фильтры-фасеты по характеристикам** — _сделано_ в `public/js/catalog.js`: `keyAttrs()` выбирает ключевые атрибуты раздела (покрытие ≥ max(3, 15% товаров), 2..15 значений, топ-6), рендерит их как фасет-группы; `match()`/`attrCounts()` фильтруют и считают динамически. Показываются автоматически, когда у товаров есть `attrs` (иначе скрыты). **Тумблер фасета характеристик В НАСТРОЙКАХ ЕСТЬ** (обновлено 2026-07-12): `cleanCatFilters` (server.js) хранит ключ `attr`; catalog.js гейтит через `facetOn('attr')`; админка — чекбокс «Характеристики» в редакторе фильтров разделов (`FACETS` включает `['attr','Характеристики']`). Ранее заметка «тумблера нет» устарела.
- **Правка характеристик в форме товара** — _сделано:_ в модалке «✎» блок `#e_attrs` — редактируемые пары «название/значение» (`attrRowHtml`/`addAttrRow`/`collectAttrs`), кнопка «+ добавить характеристику»; `saveEdit` шлёт `attrs` (массив) в PUT; **админский `PUT /api/admin/products/:id` теперь пишет `attrs=@attrs`** (раньше не писал — это был баг: `sanitizeProduct` их считал, но UPDATE не включал). `cleanAttrs` нормализует (фильтр `ATTR_STOP`, дедуп, ≤40). Правки идут в SSR-таблицу карточки и в фасеты каталога. _Осталось (по желанию):_ уточнить `ATTR_STOP`/`JUNK_ATTR` по реальным данным (стоп-листы `JUNK_ATTR` в catalog.js и product-page.js синхронны — 28/28, проверено 2026-07-12).

### ‼️ ЗАПОЛНИТЬ: примеры характеристик товаров
_(в админке открой 5–10 РАЗНЫХ товаров через «✎» → поле «Описание и характеристики» → вставь сюда текст: пара камер, коммутатор, кабель, ИБП, домофон)_
```
1. (камера) ...
2. (камера) ...
3. (коммутатор) ...
4. (кабель) ...
5. (ИБП) ...
6. (домофон) ...
```

---

## 13. Полезные привычки при работе

- Меняли `db.js` → деплоить обязательно.
- После любой правки CSS/JS — на сайте **Cmd+Shift+R**.
- Одна сессия = один связный проверенный архив; не «всё сразу» (чтобы не ломать рабочий сайт).
- Не хранить секреты (ключи, пароли) в коде и в этом файле — только в ENV на Render.

---

## Сессия 2026-07-08 — ревизия + доработки (ждёт деплоя)

Крупный проход по ревизии и доработкам. Все правки проверены статически (Node на машине нет).

**Исправленные баги (потеря данных):**
- **Импорт `FULL_SYNC` схлопывал каталог.** `pushBatch` слал `fullSync` в каждой пачке → деактивировалось всё, кроме текущей пачки. Теперь: пачки шлют `fullSync:false`, деактивация ушедших — один раз в конце через новый **`POST /api/import/deactivate`** (`{source, keepSkus}`, через temp-таблицу, пустой `keepSkus` отклоняется). В `alstyle-import.js` — `deactivateMissing()` после всех пачек.
- **Создание товара** (`POST /api/admin/products`) не писал `cat_id/cat_path/images/attrs/is_hit/is_new/seo_*/slug` — добавлены в INSERT.
- **Правка товара** (`PUT`) не писала `cat_id/cat_path/images` — добавлены с защитой «только если пришло непустым» (форма их не редактирует; привязка — bulk-пикером, галерея — импортом).
- **Экспорт заявок** падал 500 на битом `items_json` — хелпер `safeItems()` в экспорте и `GET /api/admin/orders`.

**SEO:**
- Домен через `SITE_URL` (см. раздел 1) вместо хардкода. `BreadcrumbList` JSON-LD на странице товара. H1 на `brands.html`. **SSR-FAQ** на все 7 разделов (`faqBlockHtml()` + `FAQ_PAGE_KEY` в маршруте `*.html`; клиентский `catalog.js` не дублирует — guard по `.faq-ssr`; ключи `ibp/kabelnye/servery` в БД пока пусты — наполнить в админке). `servery.html` добавлен в `SECTION_GROUPS` (был без SSR-грида). `privacy.html` — canonical.

**Производительность:**
- Индекс **`idx_cat_id`** (`db.js`). Фильтр `?cat=` и SSR `/category/:key` — по поддереву `cat_id IN (…)` через `subtreeCatIds()` вместо перебора всего каталога. Кэш footer/menu в `applySeo` (`_footerCache/_menuCache`, сброс `invalidateNavCache()` при CRUD pages/menu/sections). **Версионирование JS/CSS**: `applySeo` дописывает `?v=BUILD`, статик отдаёт с `immutable` (const `BUILD` = коммит Render / таймстамп). **Неблокирующие шрифты**: `media="print" onload` + `<noscript>`.

**Безопасность:**
- `sanitizeCmsHtml()` чистит тело CMS-страниц при сохранении (режет `<script>`, `on*`, `javascript:`, `srcdoc`; iframe/вёрстка остаются). `tg_token` не отдаётся в GET settings (только `tg_token_set`), POST не затирает пустым. Path-traversal containment в маршруте `*.html`.

**Меню (Этап B закрыт):**
- Drag-drop сортировка (`POST /api/admin/menu/reorder`). **Вложенные дропдауны**: `menu_items.parent_id`, `menuLinks()` строит 2 уровня, CSS дропдауна — через `applySeo` (класс `.mi-drop/.mi-sub`, hover; мобилка — инлайн). Валидация `validMenuParent` (без 3-го уровня). При удалении родителя дети → верх. Авто-вывод инфо-страниц с `in_menu` в меню (если нет ручного пункта).

**Мультипоставщик (Этап E, фаза «новый API-поставщик, новые товары»):**
- Сценарий: 2-й поставщик по API даёт **новые** товары (не пересекаются с Al-Style) → склейка/`match_queue`/выбор цены НЕ нужны. Показываем **розничную цену поставщика как есть**.
- `/api/import` принимает `applyMarkup` + `price_buy`: если `applyMarkup:true` и розница пустая — `price = закуп × (1+markup_pct/100)` (наценка из `suppliers` по `code=source`). Al-Style не затронут. Сейчас наценка НЕ используется (розница как есть).
- Suppliers CRUD: **`POST /api/admin/suppliers`** (создание, код неизменяем), расширенный PUT (name/kind). Форма «Новый поставщик» в админке (🏭 Поставщики).
- **`scripts/supplier-import.js`** — каркас адаптера (по образцу Al-Style): 2 TODO (`fetchRawCatalog`, `mapProduct`), льёт в `/api/import` с `source=<код>`, финальная деактивация по своему источнику. Заполнить под реальный API, когда появятся доки/ключ.

**Осталось от полного E** (не нужно для текущего сценария): склейка дублей по бренд+MPN/EAN, очередь конфликтов (`match_queue`), UI `price_rules`/`category_map` — понадобится только при поставщике с пересекающимся ассортиментом.

---

_Последнее обновление файла: 2026-07-08 — ревизия (баги/SEO/скорость/безопасность), меню (drag-drop+дропдауны), домен через SITE_URL (s1com.kz), инфраструктура 2-го поставщика. Предыдущее: 2026-07 — флаги, форма товара, SEO-поля, фильтры разделов, SEO-центр._
