// Уведомления в Telegram о новых заявках.
// Включается переменными окружения TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
// Без них — молчит (не мешает работе сайта).
const https = require('https');

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Отправляет сообщение. Не блокирует поток, ошибки гасит.
function notify(text) {
  if (!TOKEN || !CHAT_ID) return;
  const body = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true });
  const req = https.request({
    hostname: 'api.telegram.org', path: `/bot${TOKEN}/sendMessage`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 8000,
  }, (res) => { res.on('data', () => {}); res.on('end', () => {}); });
  req.on('error', (e) => console.warn('[telegram] ошибка:', e.message));
  req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}

// Готовит и шлёт уведомление о новой заявке.
function notifyOrder(order) {
  if (!TOKEN || !CHAT_ID) return;
  const lines = (order.items || []).map((i, n) =>
    `${n + 1}. ${escapeHtml((i.brand ? i.brand + ' ' : '') + i.model)} — <b>${i.qty} шт</b>`).join('\n');
  const who = [order.cust_name, order.cust_phone].filter(Boolean).map(escapeHtml).join(', ');
  const txt = `🔔 <b>Новая заявка #${order.id}</b>\n` +
    (who ? `👤 ${who}\n` : '👤 контакт не указан\n') +
    `\n${lines}\n\n📦 позиций: ${order.items.length}, всего: ${order.total_qty} шт` +
    `\n🕐 ${new Date(order.ts).toLocaleString('ru-RU')}`;
  notify(txt);
}

module.exports = { notify, notifyOrder, enabled: !!(TOKEN && CHAT_ID) };
