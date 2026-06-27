// IndexNow — мгновенное уведомление поисковиков (Яндекс, Bing) о новых/изменённых URL.
// Ускоряет индексацию: вместо ожидания робота сайт сам сообщает об изменениях.
const https = require('https');

const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const KEY = (process.env.INDEXNOW_KEY || '').trim();

function host() {
  try { return new URL(SITE_URL).host; } catch (e) { return ''; }
}

// Отправляет список URL в IndexNow (api.indexnow.org раздаёт всем поисковикам-участникам).
// Не блокирует основной поток, ошибки не валят сервер.
function pingIndexNow(urls) {
  if (!KEY || !SITE_URL || !urls || !urls.length) return;
  const list = urls.slice(0, 10000);
  const body = JSON.stringify({
    host: host(),
    key: KEY,
    keyLocation: `${SITE_URL}/${KEY}.txt`,
    urlList: list
  });
  const req = https.request({
    hostname: 'api.indexnow.org', path: '/indexnow', method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
    timeout: 8000
  }, (res) => {
    res.on('data', () => {});
    res.on('end', () => console.log(`[indexnow] отправлено URL: ${list.length}, ответ: ${res.statusCode}`));
  });
  req.on('error', (e) => console.warn('[indexnow] ошибка пинга:', e.message));
  req.on('timeout', () => req.destroy());
  req.write(body); req.end();
}

function productUrl(sku) { return `${SITE_URL}/product/${encodeURIComponent(sku)}`; }

module.exports = { pingIndexNow, productUrl, KEY, SITE_URL };
