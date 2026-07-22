'use strict';
// Юнит-тесты логики Телеграм-пульта (lib/telegram-bot.js): доступ, команды, кнопки статуса.
// Сети нет: handleUpdate только возвращает, что отправить. База — временная SQLite.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bot = require('../../lib/telegram-bot');

const DB_FILE = path.join(os.tmpdir(), 's1com-tgbot-test.sqlite');
try { fs.unlinkSync(DB_FILE); } catch (e) {}
const db = new Database(DB_FILE);
db.exec(`
  CREATE TABLE orders(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, cust_name TEXT, cust_phone TEXT,
    items_json TEXT, items_count INTEGER, total_qty INTEGER, status TEXT, note TEXT, amount INTEGER,
    service TEXT, comment TEXT, done_at TEXT);
  CREATE TABLE products(id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT, brand TEXT, model TEXT, descr TEXT,
    grp TEXT, price INTEGER, stock INTEGER, visible INTEGER DEFAULT 1, source TEXT, merged_into INTEGER DEFAULT 0, updated_at TEXT);
`);
db.prepare("INSERT INTO orders(id,ts,cust_name,cust_phone,items_json,items_count,total_qty,status) VALUES(1,?,'Иван','+77051112233',?,1,2,'new')")
  .run(new Date().toISOString(), JSON.stringify([{ sku: '57975', brand: 'Dahua', model: 'DH-IPC', qty: 2 }]));
db.prepare("INSERT INTO products(sku,brand,model,descr,grp,price,stock,visible,source) VALUES('57975','Dahua','DH-IPC-HFW1230S','камера уличная','Видеонаблюдение',50000,5,1,'al-style')").run();

const safeItems = (j) => { try { const a = JSON.parse(j); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const SETTINGS = { tg_chat_id: '111', tg_admins: '222, 333' };
const ctx = { db, safeItems, settings: SETTINGS };
const msg = (text, chatId, userId) => ({ message: { text, chat: { id: chatId == null ? 111 : chatId }, from: { id: userId == null ? 111 : userId } } });

test('доступ: белый список — основной чат и доп. админы', () => {
  assert.ok(bot.isAllowed(111, SETTINGS, 111));
  assert.ok(bot.isAllowed('222', SETTINGS, 222));
  assert.ok(bot.isAllowed(333, SETTINGS, 333));
  assert.ok(!bot.isAllowed(999, SETTINGS, 999));
});

test('доступ: пустые настройки не открывают бота всем', () => {
  assert.ok(!bot.isAllowed(111, {}, 111));
  assert.ok(!bot.isAllowed(111, { tg_chat_id: '' }, 111));
});

// Группа уведомлений о заявках обычно общая (менеджеры, бухгалтер, «просто посмотреть»).
// Пускать в пульт всех её участников нельзя: там телефоны клиентов и запись цен.
test('доступ: в группе командует только тот, кто в списке админов', () => {
  const S = { tg_chat_id: '-1001234', tg_admins: '555' };
  assert.ok(bot.isAllowed(-1001234, S, 555), 'админ группы — можно');
  assert.ok(!bot.isAllowed(-1001234, S, 777), 'посторонний участник той же группы — нельзя');
});

test('доступ: группа без списка админов не принимает команды', () => {
  const S = { tg_chat_id: '-1001234', tg_admins: '' };
  assert.ok(!bot.isAllowed(-1001234, S, 777));
});

test('доступ: в личке достаточно самого chat_id', () => {
  assert.ok(bot.isAllowed(111, { tg_chat_id: '111' }, 111));
});

test('чужой чат получает отказ и не видит данных', () => {
  const r = bot.handleUpdate(msg('/orders', 999), ctx);
  assert.match(r.text, /Нет доступа/);
  assert.ok(!/Иван/.test(r.text));
});

test('чужой чат не может нажать кнопку статуса', () => {
  const r = bot.handleUpdate({ callback_query: { id: 'q1', data: 'st:1:order', from: { id: 999 }, message: { chat: { id: 999 }, message_id: 5 } } }, ctx);
  assert.equal(r.answer, 'Нет доступа');
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'new'); // не изменился
});

test('/help и /start отдают справку', () => {
  assert.match(bot.handleUpdate(msg('/help'), ctx).text, /Пульт/);
  assert.match(bot.handleUpdate(msg('/start'), ctx).text, /Пульт/);
});

test('/orders показывает заявки', () => {
  const r = bot.handleUpdate(msg('/orders'), ctx);
  assert.match(r.text, /#1/);
  assert.match(r.text, /Иван/);
});

test('/order показывает состав и кнопки статуса', () => {
  const r = bot.handleUpdate(msg('/order 1'), ctx);
  assert.match(r.text, /Заявка #1/);
  assert.match(r.text, /Dahua DH-IPC/);
  assert.ok(r.buttons && r.buttons[0].length === 3);
});

test('/order с несуществующим номером — понятный ответ', () => {
  assert.match(bot.handleUpdate(msg('/order 4242'), ctx).text, /не найдена/);
});

test('/find ищет по бренду и названию', () => {
  const r = bot.handleUpdate(msg('/find dahua'), ctx);
  assert.match(r.text, /57975/);
  assert.match(bot.handleUpdate(msg('/find нетакого'), ctx).text, /ничего не нашлось/);
});

test('/sku показывает карточку', () => {
  const r = bot.handleUpdate(msg('/sku 57975'), ctx);
  assert.match(r.text, /DH-IPC-HFW1230S/);
  assert.match(r.text, /Видеонаблюдение/);
});

test('/price меняет цену в базе', () => {
  const r = bot.handleUpdate(msg('/price 57975 45000'), ctx);
  assert.match(r.text, /Цена обновлена/);
  assert.equal(db.prepare("SELECT price FROM products WHERE sku='57975'").get().price, 45000);
});

test('/price предупреждает, что импорт перезапишет', () => {
  assert.match(bot.handleUpdate(msg('/price 57975 46000'), ctx).text, /Импорт поставщика перезапишет/);
});

test('/price с мусором не портит данные', () => {
  const before = db.prepare("SELECT price FROM products WHERE sku='57975'").get().price;
  assert.match(bot.handleUpdate(msg('/price 57975 абв'), ctx).text, /Формат/);
  assert.match(bot.handleUpdate(msg('/price'), ctx).text, /Формат/);
  assert.equal(db.prepare("SELECT price FROM products WHERE sku='57975'").get().price, before);
});

// Number('') === 0: «/price 57975» (забыли цену) молча ставил товару цену 0 и отвечал «✅ обновлено».
test('/price без цены не обнуляет товар', () => {
  const before = db.prepare("SELECT price FROM products WHERE sku='57975'").get().price;
  assert.match(bot.handleUpdate(msg('/price 57975'), ctx).text, /Формат/);
  assert.equal(db.prepare("SELECT price FROM products WHERE sku='57975'").get().price, before);
});

test('/stock без количества не обнуляет остаток', () => {
  const before = db.prepare("SELECT stock FROM products WHERE sku='57975'").get().stock;
  assert.match(bot.handleUpdate(msg('/stock 57975'), ctx).text, /Формат/);
  assert.equal(db.prepare("SELECT stock FROM products WHERE sku='57975'").get().stock, before);
});

test('/price 0 — законная операция («цена по запросу»)', () => {
  assert.match(bot.handleUpdate(msg('/price 57975 0'), ctx).text, /Цена обновлена/);
  assert.equal(db.prepare("SELECT price FROM products WHERE sku='57975'").get().price, 0);
  bot.handleUpdate(msg('/price 57975 45000'), ctx); // вернуть для остальных тестов
});

test('/stock меняет остаток', () => {
  bot.handleUpdate(msg('/stock 57975 12'), ctx);
  assert.equal(db.prepare("SELECT stock FROM products WHERE sku='57975'").get().stock, 12);
});

test('/stats считает сводку', () => {
  const r = bot.handleUpdate(msg('/stats'), ctx);
  assert.match(r.text, /Сводка/);
  assert.match(r.text, /Заявки/);
});

test('неизвестная команда — подсказка, обычный текст — молчание', () => {
  assert.match(bot.handleUpdate(msg('/nonsense'), ctx).text, /Не знаю такой команды/);
  assert.equal(bot.handleUpdate(msg('привет'), ctx), null);
});

test('кнопка статуса меняет заявку и перерисовывает сообщение', () => {
  const r = bot.handleUpdate({ callback_query: { id: 'q2', data: 'st:1:in_work', from: { id: 111 }, message: { chat: { id: 111 }, message_id: 7 } } }, ctx);
  assert.match(r.answer, /в работе/);
  assert.equal(db.prepare('SELECT status FROM orders WHERE id=1').get().status, 'in_work');
  assert.ok(r.edit && /в работе/.test(r.edit.text));
  assert.equal(r.messageId, 7);
});

test('закрывающий статус проставляет done_at, возврат в работу — снимает', () => {
  bot.handleUpdate({ callback_query: { id: 'q3', data: 'st:1:order', from: { id: 111 }, message: { chat: { id: 111 }, message_id: 7 } } }, ctx);
  assert.ok(db.prepare('SELECT done_at FROM orders WHERE id=1').get().done_at);
  bot.handleUpdate({ callback_query: { id: 'q4', data: 'st:1:in_work', from: { id: 111 }, message: { chat: { id: 111 }, message_id: 7 } } }, ctx);
  assert.equal(db.prepare('SELECT done_at FROM orders WHERE id=1').get().done_at, null);
});

test('кнопка с чужим статусом ничего не ломает', () => {
  const r = bot.runCallback('st:1:НЕВЕРНЫЙ', ctx);
  assert.equal(r, null); // не подошло под формат — игнор
  const r2 = bot.runCallback('st:1:hacked', ctx);
  assert.match(r2.answer, /Неизвестный статус/);
});

test('команда с упоминанием бота (/orders@mybot) распознаётся', () => {
  assert.match(bot.handleUpdate(msg('/orders@servisbot'), ctx).text, /Последние заявки/);
});
