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
const https = require('https');
const crypto = require('crypto');
const { translate: i18nTranslate, clientBootJs: i18nClientBoot } = require('./lib/i18n');
const morgan = require('morgan');
const XLSX = require('xlsx');
const db = require('./db');
const { hashPassword, verifyPassword, safeEqual } = require('./lib/security');
const { renderProductPage } = require('./lib/product-page');
const { renderCategoryPage } = require('./lib/category-page');
const { renderContentPage } = require('./lib/content-page');
const { renderArticleList, renderArticlePage } = require('./lib/article-page');
const { renderBundlePage } = require('./lib/bundle-page');
const { renderQuickOrderPage } = require('./lib/quick-order-page');
const { renderCabinetPage } = require('./lib/cabinet-page');
const { renderFavoritesPage } = require('./lib/favorites-page');
const { pingIndexNow, productUrl, KEY: INDEXNOW_KEY } = require('./lib/indexnow');
const { notifyOrder, sendTest: telegramTest, notify: tgNotify } = require('./lib/telegram');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
// Версия сборки для кэш-бустинга JS/CSS: меняется при деплое (коммит Render) → браузер тянет свежее,
// между деплоями ассеты кэшируются надолго (immutable). Fallback — таймстамп старта процесса.
const BUILD = ((process.env.RENDER_GIT_COMMIT || process.env.BUILD_ID || '').slice(0, 12)) || String(Date.now());
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

// ====== Бэкапы БД (авто по расписанию + управление из админки) ======
// Каталог бэкапов — рядом с базой (на Render это постоянный диск /data), чтобы переживали деплой.
const DB_FILE = process.env.DB_PATH || path_.join(__dirname, 'data.sqlite');
const BACKUP_DIR = process.env.BACKUP_DIR || path_.join(path_.dirname(DB_FILE), 'backups');
const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 14);
const BACKUP_RE = /^data-[0-9A-Za-z\-]+\.sqlite$/;
function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter(f => BACKUP_RE.test(f))
      .map(f => { const st = fs.statSync(path_.join(BACKUP_DIR, f)); return { name: f, size: st.size, ts: st.mtime.toISOString() }; })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch (e) { return []; }
}
async function makeBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = 'data-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite';
  await db.backup(path_.join(BACKUP_DIR, name)); // онлайн-бэкап better-sqlite3 (безопасно на живой базе)
  // ротация: оставляем последние BACKUP_KEEP
  const files = fs.readdirSync(BACKUP_DIR).filter(f => BACKUP_RE.test(f)).sort();
  while (files.length > BACKUP_KEEP) { try { fs.unlinkSync(path_.join(BACKUP_DIR, files.shift())); } catch (e) {} }
  return { name, size: fs.statSync(path_.join(BACKUP_DIR, name)).size };
}
function scheduleBackups() {
  if (process.env.BACKUP_DISABLE === '1') return;
  const DAY = 864e5;
  const tick = async () => {
    try {
      const bs = listBackups();
      const newest = bs.length ? new Date(bs[0].ts).getTime() : 0;
      if (Date.now() - newest >= DAY) { const r = await makeBackup(); console.log('[backup] авто-бэкап создан:', r.name); }
    } catch (e) { console.warn('[backup] ошибка авто-бэкапа:', e.message); }
  };
  setInterval(tick, 60 * 60 * 1000); // проверяем раз в час
  setTimeout(tick, 30 * 1000);       // и через 30с после старта (создаст первый, если сегодня не было)
}
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
// Конфиг Telegram: из настроек админки, иначе lib подхватит ENV.
const tgCfg = () => ({ token: SETTINGS.tg_token || '', chatId: SETTINGS.tg_chat_id || '' });
// Сохранить настройку и сразу применить (без перезапуска) — нужен пульту для секрета вебхука.
function saveSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
  SETTINGS[key] = String(value);
}
function seoVerifyTags(){
  let t='';
  if(SETTINGS.yandex_verification) t+=`<meta name="yandex-verification" content="${SETTINGS.yandex_verification}">`;
  if(SETTINGS.google_verification) t+=`<meta name="google-site-verification" content="${SETTINGS.google_verification}">`;
  return t;
}
function esc2(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function logoInner(){
  const url=String(SETTINGS.logo_url||'').trim();
  if(url && /^(https?:\/\/|\/)/.test(url)) return `<img src="${esc2(url)}" alt="${esc2(SETTINGS.company_name||'Сервис.com')}" style="max-height:36px;width:auto;display:block">`;
  const txt=String(SETTINGS.logo_text||'').trim();
  return txt ? esc2(txt) : 'Сервис<b>.com</b>';
}
function siteConfigScript(){
  let icons={}; try{ icons=JSON.parse(SETTINGS.cat_icons||'{}')||{}; }catch(e){}
  let filters={}; try{ filters=JSON.parse(SETTINGS.cat_filters||'{}')||{}; }catch(e){}
  let sections=[]; try{ sections=db.prepare('SELECT slug,name,icon,page,in_menu,on_home FROM sections WHERE visible=1 ORDER BY sort_order,name').all()
    .map(r=>({slug:r.slug,name:r.name,icon:r.icon||'',page:r.page||('/section/'+r.slug),in_menu:r.in_menu==null?1:r.in_menu,on_home:r.on_home})); }catch(e){}
  let usps=[]; try{ usps=JSON.parse(SETTINGS.home_usps||'[]'); if(!Array.isArray(usps))usps=[]; }catch(e){}
  let homeBlocks=[]; try{ homeBlocks=JSON.parse(SETTINGS.home_blocks||'[]'); if(!Array.isArray(homeBlocks))homeBlocks=[]; }catch(e){}
  const phoneRaw=String(SETTINGS.org_phone||'+77053541999');
  const wa=phoneRaw.replace(/\D/g,'')||'77053541999'; // цифры для wa.me
  // единый трекер конверсий: Яндекс.Метрика reachGoal + задел под GA4 (dataLayer). Без персональных данных.
  const track = `window.track=function(ev,p){try{var id=window.ymCounter;if(window.ym&&/^[0-9]+$/.test(id))ym(id,'reachGoal',ev,p||{});(window.dataLayer=window.dataLayer||[]).push(Object.assign({event:ev},p||{}));}catch(e){}};document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href')||'';if(h.indexOf('wa.me')>=0||h.indexOf('whatsapp')>=0)track('click_whatsapp');else if(h.indexOf('tel:')===0)track('click_phone');},true);`;
  // Клавиатурная доступность (единый источник, все страницы): Escape закрывает корзину/мегаменю/моб.фильтры;
  // onclick-элементы без href/кнопки становятся фокусируемыми и активируются Enter/Space.
  const a11y = `(function(){document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;var closed=false;['#cart.open','#cartOv.open','#mega.open','.filters.open','.cart.open','.mega.open'].forEach(function(s){var el=document.querySelector(s);if(el){el.classList.remove('open');closed=true;}});var cb=document.getElementById('catBtn');if(cb&&cb.getAttribute('aria-expanded')==='true')cb.setAttribute('aria-expanded','false');},true);function kb(){var els=document.querySelectorAll('a[onclick]:not([href]),[onclick]:not(a):not(button):not(input):not(select):not(textarea):not([tabindex])');Array.prototype.forEach.call(els,function(el){if(el._kb)return;el._kb=1;el.setAttribute('tabindex','0');if(!el.getAttribute('role'))el.setAttribute('role','button');el.style.cursor='pointer';el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}});});}if(document.readyState!=='loading')kb();else document.addEventListener('DOMContentLoaded',kb);setTimeout(kb,1600);})();`;
  // Индикатор «вы вошли» на иконке кабинета (a.acc) во всех шапках: зелёная точка + имя в подсказке.
  // Имя — из кэша localStorage.sc_user_name (пишется кабинетом при входе), без запросов к серверу.
  const acc = `(function(){function upd(){try{var on=!!localStorage.getItem('sc_user_token');var nm=localStorage.getItem('sc_user_name')||'';document.querySelectorAll('a.acc').forEach(function(a){var dot=a.querySelector('.acc-dot');if(on){a.title=nm?('Личный кабинет — '+nm):'Личный кабинет';if(getComputedStyle(a).position==='static')a.style.position='relative';if(!dot){dot=document.createElement('span');dot.className='acc-dot';dot.style.cssText='position:absolute;top:-3px;right:-3px;width:11px;height:11px;border-radius:50%;background:#1a9e4b;border:2px solid #fff;box-sizing:border-box';a.appendChild(dot);}}else if(dot){dot.remove();a.title='Войти в личный кабинет';}});}catch(e){}}if(document.readyState!=='loading')upd();else document.addEventListener('DOMContentLoaded',upd);})();`;
  // Избранное (глобально, все страницы): единый API window.scFav — localStorage sc_fav + синк с аккаунтом + бейдж в шапке.
  const fav = `window.scFav=(function(){var KEY='sc_fav';function get(){try{var a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[];}catch(e){return[];}}function save(a){var u=[];a.forEach(function(s){s=String(s||'').slice(0,100).trim();if(s&&u.indexOf(s)<0)u.push(s);});localStorage.setItem(KEY,JSON.stringify(u.slice(0,300)));badge();return u;}function has(s){return get().indexOf(s)>=0;}function toggle(s){var a=get(),i=a.indexOf(s);if(i>=0)a.splice(i,1);else a.push(s);save(a);push();return i<0;}function tok(){return localStorage.getItem('sc_user_token')||'';}var pt;function push(){var t=tok();if(!t)return;clearTimeout(pt);pt=setTimeout(function(){fetch('/api/user/favorites',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+t},body:JSON.stringify({skus:get()})}).catch(function(){});},500);}function pull(cb){var t=tok();if(!t){cb&&cb();return;}fetch('/api/user/favorites',{headers:{'Authorization':'Bearer '+t}}).then(function(r){return r.ok?r.json():null;}).then(function(d){if(d&&d.skus){var m=get();d.skus.forEach(function(s){if(m.indexOf(s)<0)m.push(s);});var before=get().length;save(m);if(m.length!==d.skus.length)push();}cb&&cb();}).catch(function(){cb&&cb();});}function badge(){var n=get().length;document.querySelectorAll('[data-fav-badge]').forEach(function(b){b.textContent=n;b.style.display=n?'':'none';});}function init(){badge();pull(badge);}if(document.readyState!=='loading')init();else document.addEventListener('DOMContentLoaded',init);return {get:get,save:save,has:has,toggle:toggle,badge:badge,push:push,pull:pull};})();`;
  return `<script>window.SITE_CONFIG=${JSON.stringify({cat_icons:icons,cat_filters:filters,sections:sections,usps:usps,home_blocks:homeBlocks,wa:wa,phone:phoneRaw}).replace(/</g,'\\u003c')};${track}${a11y}${acc}${fav}</script>`;
}
// JSON-LD LocalBusiness (магазин безопасности) — для локального/картового поиска. Вставляется на главную.
function localBusinessLd(){
  const S = SETTINGS;
  const site = process.env.SITE_URL || 'https://servis-catalog.onrender.com';
  const ld = {
    '@context': 'https://schema.org', '@type': 'ElectronicsStore',
    name: (S.company_name || 'Сервис.com').replace(/["<>]/g, ''),
    url: site,
    telephone: S.org_phone || '+77053541999',
    address: { '@type': 'PostalAddress', streetAddress: S.org_address || 'пр. Назарбаева 23', addressLocality: S.org_city || 'Усть-Каменогорск', addressCountry: 'KZ' },
    openingHours: S.org_hours || 'Mo-Sa 09:00-18:00',
    priceRange: '₸₸',
    areaServed: { '@type': 'Country', name: 'Казахстан' }
  };
  const logo = String(S.logo_url || '').trim(); if (logo) ld.image = /^https?:/i.test(logo) ? logo : (site + (logo[0] === '/' ? '' : '/') + logo);
  const email = String(S.org_email || '').trim(); if (email) ld.email = email;
  const lat = parseFloat(S.org_lat), lng = parseFloat(S.org_lng);
  if (isFinite(lat) && isFinite(lng)) ld.geo = { '@type': 'GeoCoordinates', latitude: lat, longitude: lng };
  const sameAs = String(S.org_social || '').split(/[\s,]+/).filter(u => /^https?:\/\//i.test(u));
  if (sameAs.length) ld.sameAs = sameAs;
  // WebSite + SearchAction — право на sitelinks-поиск в Google (строка поиска в выдаче). Модель: /?q=<запрос> (главная ловит автопоиск).
  const base = site.replace(/\/$/, '');
  const web = {
    '@context': 'https://schema.org', '@type': 'WebSite',
    name: (S.company_name || 'Сервис.com').replace(/["<>]/g, ''), url: base + '/',
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: base + '/?q={search_term_string}' }, 'query-input': 'required name=search_term_string' },
  };
  const j = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
  return j(ld) + j(web);
}
function cleanCatFilters(v){
  let o={}; try{ o=(typeof v==='string')?JSON.parse(v):v; }catch(e){ return ''; }
  if(!o||typeof o!=='object') return '';
  const groups=['Видеонаблюдение','Сетевое оборудование','Источники бесперебойного питания (ИБП)','Пожарная безопасность','СКУД и домофония','Кабельные системы','Серверное оборудование и СХД'];
  const facets=['brand','type','res','price','stock','attr'];
  const out={};
  groups.forEach(g=>{ if(o[g] && typeof o[g]==='object'){ const gg={}; facets.forEach(f=>{ gg[f]=(o[g][f]!==false); }); out[g]=gg; } });
  return JSON.stringify(out);
}
function cleanCatIcons(v){
  let o={}; try{ o = (typeof v==='string') ? JSON.parse(v) : v; }catch(e){ return ''; }
  if(!o || typeof o!=='object') return '';
  const allow=['Видеонаблюдение','Сетевое оборудование','Источники бесперебойного питания (ИБП)','Пожарная безопасность','СКУД и домофония','Кабельные системы','Серверное оборудование и СХД'];
  const out={};
  allow.forEach(g=>{ if(o[g]!=null && String(o[g]).trim()) out[g]=String(o[g]).replace(/["'<>]/g,'').trim().slice(0,300); });
  return JSON.stringify(out);
}
// Ссылки на инфо-страницы (доставка/оплата/…) для подвала. Подставляются в колонку «Компания»
// во всех подвалах (SSR и статика) — единый источник, без правки html-файлов.
// Кэш ссылок подвала и пунктов меню: applySeo дёргает их на КАЖДЫЙ запрос (SSR и статику).
// undefined = не вычислено. Сбрасываем при CRUD pages/menu/sections (invalidateNavCache).
let _footerCache, _menuCache;
function invalidateNavCache(){ _footerCache = undefined; _menuCache = undefined; }
function pageFooterLinks(){
  if (_footerCache !== undefined) return _footerCache;
  let rows = [];
  try { rows = db.prepare('SELECT slug,title FROM pages WHERE visible=1 AND in_footer=1 ORDER BY sort_order,id').all(); }
  catch (e) { return ''; } // ошибку не кэшируем
  _footerCache = rows.map(p => `<a href="/page/${encodeURIComponent(p.slug)}">${escHtml(p.title)}</a>`).join('');
  return _footerCache;
}
// Меню сайта (Этап B): резолв ссылки пункта по типу и рендер пунктов верхнего навбара.
function menuHref(it){
  const v = String(it.value || '').trim();
  switch (it.type) {
    case 'page': return '/page/' + encodeURIComponent(v);
    case 'category': return '/category/' + encodeURIComponent(v);
    case 'brand': return '/brand/' + encodeURIComponent(v);
    case 'bundle': return '/bundle/' + encodeURIComponent(v);
    case 'section': {
      let s = null;
      try { s = db.prepare('SELECT page,slug FROM sections WHERE slug=? OR name=?').get(v, v); } catch (e) {}
      return s ? (s.page || ('/section/' + s.slug)) : ('/section/' + encodeURIComponent(v));
    }
    default: return v || '/'; // link — сырой URL/tel/anchor
  }
}
function menuLinkA(it){
  const cls = it.css_class ? ` class="${escHtml(it.css_class)}"` : '';
  const tab = it.new_tab ? ' target="_blank" rel="nofollow"' : '';
  return `<a href="${escHtml(menuHref(it))}"${cls}${tab}>${escHtml(it.label)}</a>`;
}
function menuLinks(){
  if (_menuCache !== undefined) return _menuCache;
  let rows = [];
  try { rows = db.prepare('SELECT * FROM menu_items WHERE visible=1 ORDER BY sort_order,id').all(); }
  catch (e) { return null; } // ошибку не кэшируем
  if (!rows.length) { _menuCache = null; return null; }
  const tops = rows.filter(r => !r.parent_id);
  const kidsBy = {};
  rows.forEach(r => { if (r.parent_id) (kidsBy[r.parent_id] = kidsBy[r.parent_id] || []).push(r); });
  let out = tops.map(it => {
    const kids = kidsBy[it.id];
    if (!kids || !kids.length) return menuLinkA(it);
    // родитель с детьми → дропдаун (раскрытие на hover, CSS вставляет applySeo)
    const cls = it.css_class ? ` class="${escHtml(it.css_class)}"` : '';
    const tab = it.new_tab ? ' target="_blank" rel="nofollow"' : '';
    return `<span class="mi-drop"><a href="${escHtml(menuHref(it))}"${cls}${tab}>${escHtml(it.label)}<i class="mi-caret">▾</i></a><span class="mi-sub">${kids.map(menuLinkA).join('')}</span></span>`;
  }).join('');
  // авто-вывод инфо-страниц с флагом in_menu, для которых нет ручного пункта type=page
  try {
    const manual = new Set(rows.filter(r => r.type === 'page').map(r => String(r.value || '').trim()));
    const autos = db.prepare("SELECT slug,title FROM pages WHERE visible=1 AND in_menu=1 ORDER BY sort_order,id").all()
      .filter(p => !manual.has(String(p.slug)));
    out += autos.map(p => `<a href="/page/${encodeURIComponent(p.slug)}">${escHtml(p.title)}</a>`).join('');
  } catch (e) {}
  _menuCache = out;
  return _menuCache;
}
function applySeo(html, nonce, lang, ruPath){
  // Единый источник домена: canonical/og/JSON-LD в статике зашиты на старый домен —
  // переписываем на актуальный из SITE_URL (на неделю до подключения s1com.kz ставим onrender-URL).
  const site = (process.env.SITE_URL || 'https://servis-catalog.onrender.com').replace(/\/$/, '');
  if (site !== 'https://servis-com.kz') html = html.split('https://servis-com.kz').join(site);
  // Единый телефон/WhatsApp: захардкоженный в статике номер (tel:/wa.me/текст) переписываем из настроек
  // (org_phone) → смена телефона в админке применяется ко ВСЕМ шапкам/подвалам/ссылкам без правки HTML.
  const phoneRaw = String(SETTINGS.org_phone || '+7 705 354-19-99').trim();
  const phoneDigits = phoneRaw.replace(/\D/g, '') || '77053541999';
  if (phoneDigits !== '77053541999') html = html.split('77053541999').join(phoneDigits); // tel:+7… и wa.me/7…
  if (phoneRaw !== '+7 705 354-19-99') html = html.split('+7 705 354-19-99').join(phoneRaw); // отображаемый текст
  html = html.replace(/__YM_ID__/g, SETTINGS.ym_id || '').replace('<!--SEO_VERIFY-->', seoVerifyTags());
  html = html.replace(/(<a class="logo" href="\/">)[\s\S]*?(<\/a>)/, (m,a,b)=>a+logoInner()+b);
  // ссылки на инфо-страницы — в конец колонки «Компания» любого подвала
  const links = pageFooterLinks();
  if (links) html = html.replace(/(<h4>Компания<\/h4>[\s\S]*?)(<\/div>)/, (m,a,b)=>a+links+b);
  // пункты меню из базы — между кнопкой «Каталог» и правым промо-текстом навбара (SSR и статика)
  const menu = menuLinks();
  if (menu != null) html = html.replace(/(<span class="chev">▾<\/span><\/button>)[\s\S]*?(<span class="r">)/, (m,a,b)=>a+menu+b);
  // LocalBusiness JSON-LD — только там, где есть маркер (главная)
  if (html.indexOf('<!--LOCALBIZ-->') >= 0) html = html.replace('<!--LOCALBIZ-->', localBusinessLd());
  // CSS вложенных дропдаунов меню — единый источник для всех шапок (только если есть дропдаун)
  const menuCss = (menu && menu.indexOf('mi-drop') >= 0)
    ? '<style>.mi-drop{position:relative;display:inline-block}.mi-drop>a .mi-caret{font-style:normal;font-size:9px;margin-left:3px;opacity:.65}.mi-sub{display:none;position:absolute;top:100%;left:0;background:#fff;border:1px solid #e8e8e8;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.12);min-width:190px;padding:6px 0;z-index:70}.mi-sub a{display:block;padding:9px 16px;white-space:nowrap;color:#1a1a1a;font-weight:600}.mi-sub a:hover{background:#f2f7f4;color:var(--red,#e11d2a)}.mi-drop:hover>.mi-sub{display:block}@media(max-width:900px){.mi-drop{display:block}.mi-sub{position:static;display:block;box-shadow:none;border:none;padding:2px 0 2px 14px;min-width:0}.mi-drop>a .mi-caret{display:none}}</style>'
    : '';
  // кэш-бустинг локальных JS/CSS: добавляем ?v=BUILD → можно кэшировать надолго (immutable), обновляется при деплое
  html = html.replace(/((?:href|src)="\/(?:js|css)\/[a-zA-Z0-9_\-\/]+\.(?:js|css))"/g, `$1?v=${BUILD}"`);
  // неблокирующая загрузка Google Fonts: media=print+onload убирает шрифты из критического пути рендера
  // (preconnect уже есть в шаблонах); noscript — fallback для клиентов без JS. FOUT минимален (есть системный fallback).
  html = html.replace(/<link href="(https:\/\/fonts\.googleapis\.com\/[^"]*)" rel="stylesheet">/g,
    '<link rel="stylesheet" href="$1" media="print" onload="this.media=\'all\'"><noscript><link rel="stylesheet" href="$1"></noscript>');
  // ускорение внешних картинок товаров (Al-Style CDN): ранняя установка соединения
  html = html.replace('</head>', '<link rel="preconnect" href="https://al-style.kz" crossorigin><link rel="dns-prefetch" href="https://al-style.kz">' + siteConfigScript() + menuCss + '</head>');
  // ---------- ЯЗЫК (казахская версия /kk/ + hreflang) ----------
  {
    const site = (process.env.SITE_URL || 'https://servis-catalog.onrender.com').replace(/\/$/, '');
    const rp = (ruPath || '/').split('#')[0]; // путь RU-версии (без /kk), с query
    const ruUrl = site + rp;
    const kkUrl = site + '/kk' + (rp === '/' ? '/' : rp);
    // hreflang во всех страницах: связываем ru↔kk, x-default=ru (для не-казахских/не-русских)
    const alt = `<link rel="alternate" hreflang="ru" href="${ruUrl}"><link rel="alternate" hreflang="kk" href="${kkUrl}"><link rel="alternate" hreflang="x-default" href="${ruUrl}">`;
    // переключатель языка в шапке (перед блоком иконок — он есть во всех хедерах). Инлайн-стиль — без правки CSS.
    const rlink = (l, u, t) => `<a href="${u}" hreflang="${l}" style="text-decoration:none;font-weight:700;color:${lang === l ? 'var(--red,#E02128)' : '#8a9099'}">${t}</a>`;
    const sw = `<div class="langsw" style="display:flex;gap:5px;align-items:center;font-size:13px;margin-right:6px">${rlink('ru', rp === '/' ? '/' : rp, 'RU')}<span style="color:#ccc">·</span>${rlink('kk', kkUrl.replace(site, ''), 'ҚАЗ')}</div>`;
    if (lang === 'kk') {
      // внутренние ссылки на /kk-странице ведут в /kk-версию (иначе юзер выпадает в RU). Ассеты/API/админку/якоря — не трогаем.
      // Делаем ДО вставки переключателя, чтобы его RU-ссылка осталась русской.
      html = html.replace(/href="(\/(?!kk\/|api\/|images\/|js\/|css\/|admin|cabinet|izbrannoe|favicon|robots|sitemap)[^"]*)"/g, 'href="/kk$1"');
    }
    html = html.replace('</head>', alt + '</head>');
    html = html.replace('<div class="icons">', sw + '<div class="icons">');
    // Ссылка «Личный кабинет» в шапке (первой иконкой в .icons) — во ВСЕХ шапках, без правки HTML-файлов.
    // Лейбл универсальный (вход/профиль разруливает сама страница /cabinet по наличию токена).
    html = html.replace('<div class="icons">', '<div class="icons"><a class="acc" href="/cabinet" title="Личный кабинет — заказы и повтор" aria-label="Личный кабинет">👤</a>');
    // «мёртвую» ♡ в шапке делаем ссылкой на страницу избранного + бейдж-счётчик (обновляет window.scFav)
    html = html.replace('<a href="#" title="Избранное">♡</a>', '<a href="/izbrannoe" class="fav-link" title="Избранное" aria-label="Избранное">♡<span class="bdg" data-fav-badge style="display:none">0</span></a>');
    if (lang === 'kk') {
      html = html.replace(/<html([^>]*)\slang="ru"/i, '<html$1 lang="kk"').replace(/<html(?![^>]*\blang=)/i, '<html lang="kk"');
      // canonical + og:url на казахской версии → /kk-URL (self-canonical, без дубля с RU)
      html = html.replace(new RegExp('(<link rel="canonical" href=")' + ruUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'), `$1${kkUrl}"`);
      html = html.replace(new RegExp('(<meta property="og:url" content=")' + ruUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'), `$1${kkUrl}"`);
      html = i18nTranslate(html, 'kk'); // перевод чрома ВНЕ <script>/<style>
      // Фаза 2: клиентский бут — переводит динамический UI (карточки/фильтры/корзина), рендеримый JS.
      // Инжектим в <head> (до page-JS) и ДО nonce-прохода, чтобы скрипт получил nonce.
      html = html.replace('</head>', `<script>${i18nClientBoot('kk')}</script></head>`);
    }
  }
  // Липкая мобильная панель действий (конверсия): Звонок / WhatsApp / Заявка. Показ только <768px (CSS).
  // Телефон/WA — из настроек (org_phone). «Заявка» открывает корзину (#cartOpen) или ведёт на быстрый заказ.
  if (html.indexOf('</body>') >= 0 && html.indexOf('class="mcta"') < 0) {
    const mctaCss = '<style>.mcta,.wafab{display:none}@media(max-width:768px){body{padding-bottom:62px}.mcta{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:900;background:#fff;border-top:1px solid #E7E9EE;box-shadow:0 -6px 18px -8px rgba(20,24,31,.2)}.mcta-b{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;font:600 11px/1.15 system-ui,sans-serif;color:#14181F;text-decoration:none;background:none;border:0;padding:9px 4px calc(9px + env(safe-area-inset-bottom));cursor:pointer}.mcta-b b{font-size:16px;line-height:1}.mcta-b.wa{color:#0f9d58}.mcta-b.cart{color:#E02128}.mcta-b:active{background:#F6F7F9}}@media(min-width:769px){.wafab{display:flex;position:fixed;right:22px;bottom:22px;z-index:850;width:56px;height:56px;border-radius:50%;background:#25D366;color:#fff;align-items:center;justify-content:center;font-size:26px;box-shadow:0 10px 26px -8px rgba(0,0,0,.4);text-decoration:none;transition:transform .15s}.wafab:hover{transform:scale(1.08)}}</style>';
    const mctaWa = encodeURIComponent('Здравствуйте! Пишу с сайта — интересует оборудование. Подскажите цену и наличие.');
    const waHref = 'https://wa.me/' + phoneDigits + '?text=' + mctaWa;
    const mcta = '<div class="mcta" role="navigation" aria-label="Быстрые действия"><a class="mcta-b" href="tel:+' + phoneDigits + '"><b>📞</b>Звонок</a><a class="mcta-b wa" href="' + waHref + '" target="_blank" rel="nofollow"><b>✆</b>WhatsApp</a><button class="mcta-b cart" type="button" onclick="var c=document.getElementById(\'cartOpen\');if(c){c.click();}else{location.href=\'/bystryy-zakaz\';}"><b>🧾</b>Заявка</button></div>';
    const wafab = '<a class="wafab" href="' + waHref + '" target="_blank" rel="nofollow" aria-label="Написать в WhatsApp" title="Написать в WhatsApp">✆</a>';
    html = html.replace('</head>', mctaCss + '</head>').replace('</body>', mcta + wafab + '</body>');
  }
  // NONCE: помечаем КАЖДЫЙ инлайн-<script> (без src) — иначе strict-CSP (script-src без 'unsafe-inline')
  // заблокирует их выполнение. Проход последним, после всех инъекций (SITE_CONFIG/Метрика/SSR/JSON-LD).
  // Внешние <script src=…> пропускаем (их покрывает 'self'/allowlist хостов). type="application/ld+json" тоже
  // получит nonce — безвредно. onclick-обработчики сюда не входят (их регулирует script-src-attr).
  if (nonce) html = html.replace(/<script(?![^>]*\bsrc=)/gi, `<script nonce="${nonce}"`);
  return html;
}

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
// CSP: defense-in-depth. Инъекция <script> закрыта через per-request NONCE (убрали 'unsafe-inline'
// из script-src — главный XSS-вектор). applySeo проставляет этот nonce каждому инлайн-<script> публичной
// отдачи (статика/SSR/Метрика/SITE_CONFIG). scriptSrcAttr ('unsafe-inline') оставлен: сайт/админка активно
// используют inline onclick (перевод на addEventListener — отдельный крупный рефактор). styleSrc — inline
// стили (style="" не noncible), риск CSS-инъекции низкий. Админка (/admin, за JWT) получает свой relaxed-CSP.
// nonce на каждый запрос — ДО helmet, чтобы директива script-src его увидела, а applySeo взял тот же из res.locals.
app.use((req, res, next) => { res.locals.nonce = crypto.randomBytes(16).toString('base64'); next(); });

// Язык: префикс /kk/ = казахская версия. Снимаем префикс, ставим req.lang/res.locals — маршруты работают как обычно,
// а applySeo локализует чром + добавляет hreflang. RU-путь (без /kk) храним для hreflang/переключателя/canonical.
app.use((req, res, next) => {
  if (req.path === '/kk') return res.redirect(301, '/kk/');
  if (req.url === '/kk/' || req.url.indexOf('/kk/') === 0) {
    res.locals.lang = 'kk';
    res.locals.ruPath = req.url.slice(3) || '/';   // '/kk/foo?x' → '/foo?x'
    req.url = res.locals.ruPath;                    // downstream-роутинг не знает о языке
  } else {
    res.locals.lang = 'ru';
    res.locals.ruPath = req.url;
  }
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`, "https://mc.yandex.ru", "https://yandex.ru"],
      scriptSrcAttr: ["'unsafe-inline'"],            // сайт использует inline onclick — иначе навигация не работает
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https:"],         // product images may be external (Al-Style/CDN)
      connectSrc: ["'self'", "https://mc.yandex.ru"],
      frameSrc: ["'self'", "https://mc.yandex.ru"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
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
// Секрет вебхука Телеграм-пульта лежит в пути (/api/telegram/webhook/<secret>), а access-log на Render
// хранится в открытом виде — маскируем, иначе кто прочитал логи, тот прошёл оба рубежа защиты вебхука.
morgan.token('url', (req) => String(req.originalUrl || req.url || '').replace(/(\/api\/telegram\/webhook\/)[^/?]+/, '$1***'));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'tiny')); // access-log

// Каноникализация хоста (для подключения домена s1com.kz ~2026-07-14). Когда SITE_URL станет
// https://s1com.kz, запросы на СТАРЫЙ хост (*.onrender.com) и на www.<домен> получают 301 на канонический
// домен — чтобы Яндекс/Google консолидировали ранжирование на одном хосте, а не делили между двумя.
// Спит, пока SITE_URL указывает на текущий хост (host совпадает с каноном → редиректа нет). Безопасно:
// только production, только GET/HEAD, НЕ трогаем /health (healthcheck Render) и /api/ (cron/клиенты),
// редиректим лишь известные неканонические хосты (не произвольные). Отключается NO_HOST_REDIRECT=1.
// ⚠️ Редирект включается ТОЛЬКО при явно заданном SITE_URL. Раньше он брал дефолт из кода —
// и на проде без этой переменной весь сайт ушёл в 301 на ещё не подключённый домен (живыми остались
// только /health и /api/, поэтому со стороны API всё выглядело здоровым). Молчаливый дефолт не должен
// уводить трафик: нет явного SITE_URL → канонизировать нечего → не редиректим.
if (NODE_ENV === 'production' && process.env.NO_HOST_REDIRECT !== '1' && process.env.SITE_URL) {
  let canonHost = '';
  try { canonHost = new URL(process.env.SITE_URL).host.toLowerCase(); } catch (e) {}
  app.use((req, res, next) => {
    if (!canonHost || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
    if (req.path === '/health' || req.path.indexOf('/api/') === 0) return next();
    const h = String(req.headers.host || '').toLowerCase();
    if (!h || h === canonHost) return next();
    if (!/\.onrender\.com$/.test(h) && h !== 'www.' + canonHost) return next(); // только старый хост и www
    return res.redirect(301, 'https://' + canonHost + req.originalUrl);
  });
}

app.use(express.json({ limit: '15mb' }));            // вмещает Excel-импорт (10МБ) в base64; меньше прежних 25МБ

// CORS: публичный каталог открыт; если задан CORS_ORIGINS — ограничиваем
const corsOptions = CORS_ORIGINS.length
  ? { origin: (origin, cb) => (!origin || CORS_ORIGINS.includes(origin)) ? cb(null, true) : cb(new Error('CORS')) }
  : {};
app.use(cors(corsOptions));

// --- Rate limiting ---
// вход: считаем ТОЛЬКО неудачные попытки (skipSuccessfulRequests) — защита от брутфорса, при этом
// успешные входы (в т.ч. клиентов за общим IP) не приближают блокировку.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Слишком много неудачных попыток входа. Подождите 15 минут.' }, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true });
const importLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, message: { error: 'Превышен лимит запросов импорта.' } });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 300 }); // общий мягкий лимит
// регистрация: 20 УСПЕШНЫХ/час на IP. skipFailedRequests — неудачные (400/409) не жрут квоту,
// иначе клиенты за общим корпоративным IP (или опечатки) блокировали бы друг друга.
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'Слишком много попыток регистрации. Попробуйте позже.' }, standardHeaders: true, legacyHeaders: false, skipFailedRequests: true });
app.use('/api/', apiLimiter);

// SEO: единый адрес главной — /index.html и /index.htm → / (убираем дубль страницы)
app.get(['/index.html', '/index.htm'], (req, res) => res.redirect(301, '/'));

// --- helpers ---
// Полное представление (для админки) — со складом
function rowToAdmin(r) {
  return { id: r.id, sku: r.sku, brand: r.brand || '', model: r.model || '', group: r.grp || '', cat: r.cat || '',
    desc: r.descr || '', res: r.res || '', price: r.price || 0, oldprice: r.oldprice || 0, promo: !!r.promo,
    hit: !!r.is_hit, new: !!r.is_new,
    seoTitle: r.seo_title || '', seoDesc: r.seo_desc || '', h1: r.h1 || '', slug: r.slug || '',
    stock: r.stock || 0, visible: r.visible !== 0, img: r.img || '', mp: r.mp || '',
    conn: (r.conn || '').split(',').filter(Boolean), type: r.type || '', attrs: parseAttrs(r.attrs), source: r.source || '',
    catId: r.cat_id || 0, catPath: (() => { try { return JSON.parse(r.cat_path || '[]'); } catch (e) { return []; } })() };
}
// Публичное представление: показываем остаток и факт наличия
function rowToPublic(r) {
  const a = rowToAdmin(r);
  delete a.visible;
  a.inStock = (a.stock || 0) > 0;
  a.catId = r.cat_id || 0;
  try { a.catPath = JSON.parse(r.cat_path || '[]'); } catch (e) { a.catPath = []; }
  return a;
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  // Требуем issuer 's1com' И role 'admin' (defense-in-depth): пользовательские токены
  // (issuer 's1com-user', role 'user') сюда НЕ пройдут даже при том же JWT_SECRET.
  try { const p = jwt.verify(t, JWT_SECRET, { algorithms: ['HS256'], issuer: 's1com' }); if (p.role !== 'admin') throw new Error('role'); next(); }
  catch (e) { res.status(401).json({ error: 'Не авторизован' }); }
}
const clamp = (v, n) => String(v == null ? '' : v).slice(0, n);
const toInt = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
// Разбор списка артикулов для подборок (bundles): массив | JSON | строка через запятую/перенос/точку с запятой → ≤20 SKU.
// Общий: используется в content-admin.js (bundles CRUD) и в SSR /bundle/:id.
function parseSkus(v) {
  if (Array.isArray(v)) return v.map(s => clamp(s, 100).trim()).filter(Boolean).slice(0, 20);
  const s = clamp(v, 3000).trim();
  if (!s) return [];
  let arr;
  try { arr = JSON.parse(s); } catch (e) { arr = null; }
  if (!Array.isArray(arr)) arr = s.split(/[,\n;]+/);
  return arr.map(x => clamp(x, 100).trim()).filter(Boolean).slice(0, 20);
}

// Служебные свойства Al-Style, которые не показываем в характеристиках (мусор/дубли артикула)
const ATTR_STOP = new Set(['артикул','код','базовая единица','в упаковке','штрихкод','вес','гарантия',
  'код тнвэд','тнвэд','кратность','единица','единица измерения','ндс','бренд','торговая марка','страна',
  'страна происхождения','наименование','полное наименование','категория',
  'код тн вэд','код нкт','объём','объем','вес брутто','вес нетто','упаковка']);
// Нормализует характеристики из /properties ([{name,value,sort}]) или готового [{name,value}] в JSON-строку.
function cleanAttrs(v) {
  let arr = v;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch (e) { return ''; } }
  if (!Array.isArray(arr)) return '';
  const out = [];
  const seen = new Set();
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const name = clamp(it.name, 80).trim();
    let val = it.value;
    val = clamp(Array.isArray(val) ? val.join(', ') : val, 300).trim();
    if (!name || !val) continue;
    const key = name.toLowerCase();
    if (ATTR_STOP.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, value: val });
    if (out.length >= 40) break;
  }
  return out.length ? JSON.stringify(out) : '';
}
function parseAttrs(s) { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

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
    descr: clamp(p.desc || p.descr || p.description, 6000),
    res: clamp(p.res, 100),
    price: Math.max(0, toInt(p.price)),
    oldprice: Math.max(0, toInt(p.oldprice)),
    promo: p.promo ? 1 : 0,
    is_hit: (p.is_hit || p.hit) ? 1 : 0,
    is_new: (p.is_new || p.new) ? 1 : 0,
    seo_title: clamp(p.seo_title || p.seoTitle, 200),
    seo_desc: clamp(p.seo_desc || p.seoDesc, 400),
    h1: clamp(p.h1, 200),
    slug: clamp(p.slug, 120).toLowerCase().replace(/[^a-z0-9\-]+/g, '-').replace(/^-+|-+$/g, ''),
    stock: Math.max(0, toInt(p.stock)),
    img: clamp(p.img, 500),
    images: cleanImages(p.images),
    mp: clamp(p.mp, 30),
    conn: Array.isArray(p.conn) ? clamp(p.conn.join(','), 100) : clamp(p.conn, 100),
    type: clamp(p.type, 100),
    cat_id: Math.max(0, toInt(p.cat_id || p.catId)),
    cat_path: normPath(p.cat_path || p.catPath),
    attrs: cleanAttrs(p.attrs || p.properties),
    price_buy: Math.max(0, toInt(p.price_buy || p.buy)) // закуп (для наценки при applyMarkup); в products не пишется
  };
}
// Путь категорий → JSON-массив положительных ID (до 12 уровней). Принимаем массив или JSON-строку.
function normPath(v) {
  let arr = [];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') { try { const j = JSON.parse(v); if (Array.isArray(j)) arr = j; } catch (e) {} }
  arr = arr.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n) && n > 0).slice(0, 12);
  return JSON.stringify(arr);
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
// Безопасный парсинг состава заявки: одна битая запись items_json не должна ронять список/экспорт (500).
function safeItems(json) { try { const a = JSON.parse(json || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
// Санитайзер тела CMS-страниц (defense-in-depth): режет исполняемое, оставляет вёрстку и iframe (карты/видео).
// Убирает <script>, on*-обработчики, javascript:-схему и iframe srcdoc. Владелец пишет доверенный HTML за JWT,
// но так скомпрометированная сессия/ошибочная вставка не приводят к stored XSS у посетителей.
function sanitizeCmsHtml(html) {
  let s = String(html == null ? '' : html);
  let prev; // цикл — против обфускации вида <scr<script>ipt>
  do { prev = s; s = s.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*>/gi, ''); } while (s !== prev);
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')   // on*="…"
       .replace(/\son\w+\s*=\s*'[^']*'/gi, '')   // on*='…'
       .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')   // on*=… без кавычек
       .replace(/\ssrcdoc\s*=\s*"[^"]*"/gi, '')  // iframe srcdoc (может нести script)
       .replace(/\ssrcdoc\s*=\s*'[^']*'/gi, '')
       .replace(/javascript\s*:/gi, '');          // javascript: в href/src
  return s;
}

const MAX_IMPORT = Number(process.env.MAX_IMPORT || 5000); // защита от гигантских/мусорных выгрузок

// ---------- HEALTH-CHECK ----------
// SEO/ops-роуты (/health, /robots.txt, /sitemap.xml) вынесены в модуль (контролируемая декомпозиция server.js).
require('./lib/routes/seo-ops')(app, db, NODE_ENV);

// ---------- ПУБЛИЧНЫЙ API (каталог) ----------
// Поддерживает необязательную пагинацию ?limit=&offset= (по умолчанию отдаёт всё для клиентского фильтра)
app.get('/api/products', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 0, 5000);
  const q = clamp(req.query.q, 60).trim();
  const grp = clamp(req.query.group, 100).trim();
  const brand = clamp(req.query.brand, 100).trim();
  const cat = Number(req.query.cat) || 0; // фильтр по категории (cat_id ветки, включая подкатегории)
  const args = [];
  let where = 'visible=1';
  if (q) { const like = '%' + q.replace(/[%_]/g, '') + '%'; where += ' AND (brand LIKE ? OR model LIKE ? OR sku LIKE ? OR cat LIKE ?)'; args.push(like, like, like, like); }
  if (grp) { where += ' AND grp=?'; args.push(grp); }
  if (brand) { where += ' AND brand=?'; args.push(brand); }
  if (cat) {
    // товары ветки = cat_id ∈ поддерево(cat); индексируемо (idx_cat_id), без перебора всего каталога
    const ids = subtreeCatIds(cat);
    if (!ids.length) return res.json([]);
    where += ' AND cat_id IN (' + ids.map(() => '?').join(',') + ')';
    args.push(...ids);
  }
  let sql = 'SELECT * FROM products WHERE ' + where + ' ORDER BY (price=0), brand, model';
  const off = Number(req.query.offset) || 0;
  if (limit) sql += ' LIMIT ' + limit + ' OFFSET ' + off;
  res.set('Cache-Control', 'public, max-age=120'); // лёгкое кэширование
  res.json(db.prepare(sql).all(...args).map(rowToPublic));
});

// Данные для главной страницы: категории со счётчиками, топ-бренды, хиты, новинки
app.get('/api/home', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  try {
    const groups = db.prepare("SELECT grp, COUNT(*) c FROM products WHERE visible=1 AND grp!='' GROUP BY grp").all();
    const gmap = {}; groups.forEach(r => gmap[r.grp] = r.c);
    const brands = db.prepare("SELECT brand, COUNT(*) c FROM products WHERE visible=1 AND brand!='' GROUP BY brand ORDER BY c DESC LIMIT 12").all();
    const hits = db.prepare("SELECT * FROM products WHERE visible=1 AND price>0 AND stock>0 ORDER BY (is_hit=0), (promo=0), stock DESC, id DESC LIMIT 8").all().map(rowToPublic);
    const newest = db.prepare("SELECT * FROM products WHERE visible=1 ORDER BY (is_new=0), id DESC LIMIT 8").all().map(rowToPublic);
    // Избранные категории на главной (флаг on_home из карточки категории)
    const onhome = db.prepare("SELECT cat_id,name,grp,icon,image_url,slug FROM categories WHERE on_home=1 AND visible=1 ORDER BY sort_order, name LIMIT 12").all();
    let cats = [];
    if (onhome.length) {
      const cnt = {};
      for (const r of db.prepare('SELECT cat_path FROM products WHERE visible=1').all()) {
        let pth = []; try { pth = JSON.parse(r.cat_path || '[]'); } catch (e) {}
        for (const id of pth) cnt[id] = (cnt[id] || 0) + 1;
      }
      cats = onhome.map(c => ({ catId: c.cat_id, name: c.name, grp: c.grp || '', icon: c.icon || '', image: c.image_url || '', slug: c.slug || '', count: cnt[c.cat_id] || 0 }));
    }
    // Статьи «Полезное» для блока на главной: входящие ссылки на статьи (иначе они сироты для поиска).
    let articles = [];
    try { articles = db.prepare('SELECT slug,title,excerpt,grp,image_url FROM articles WHERE visible=1 ORDER BY sort_order,id LIMIT 3').all(); }
    catch (e) { articles = []; } // таблицы ещё нет (БД до миграции) — блок просто не покажется
    res.json({ groups: gmap, brands, hits, newest, cats, articles });
  } catch (e) { console.error('[home]', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

// Все бренды со счётчиками (для страницы брендов)
// Публичный конфиг сайта — единый источник контактов/домена (БЕЗ секретов: tg_token и т.п. не отдаём).
app.get('/api/site-config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=120');
  const phoneRaw = String(SETTINGS.org_phone || '+77053541999');
  res.json({
    company_name: SETTINGS.company_name || 'Сервис.com',
    phone: phoneRaw,
    wa: phoneRaw.replace(/\D/g, '') || '77053541999',
    email: SETTINGS.org_email || '',
    city: SETTINGS.org_city || '',
    address: SETTINGS.org_address || '',
    hours: SETTINGS.org_hours || '',
    social: SETTINGS.org_social || '',
    site_url: (process.env.SITE_URL || 'https://servis-catalog.onrender.com').replace(/\/$/, '')
  });
});

app.get('/api/brands', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  try {
    const rows = db.prepare("SELECT brand, COUNT(*) c FROM products WHERE visible=1 AND brand!='' GROUP BY brand ORDER BY c DESC, brand").all();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// Разделы каталога (Фаза 1) — единый источник для фронта и импорта (вместо хардкода GROUP_PAGE)
app.get('/api/sections', (req, res) => {
  res.set('Cache-Control', 'public, max-age=120');
  try {
    const rows = db.prepare('SELECT slug,name,icon,image_url,seo_title,seo_desc,h1,descr,sort_order,in_menu,on_home,page,alstyle_branches FROM sections WHERE visible=1 ORDER BY sort_order, name').all();
    res.json(rows.map(r => ({
      slug: r.slug, name: r.name, icon: r.icon || '', image: r.image_url || '',
      page: r.page || ('/section/' + r.slug),
      seo_title: r.seo_title || '', seo_desc: r.seo_desc || '', h1: r.h1 || '', descr: r.descr || '',
      sort_order: r.sort_order, in_menu: r.in_menu == null ? true : !!r.in_menu, on_home: !!r.on_home,
      branches: (() => { try { return JSON.parse(r.alstyle_branches || '[]'); } catch (e) { return []; } })()
    })));
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});



// ---------- КАТЕГОРИИ (публично: только видимые) ----------
// Счётчики товаров по категориям (прямое присвоение cat_id): {cat_id:{t:всего, s:в наличии}} — для дерева каталога; клиент суммирует поддеревья.
app.get('/api/category-counts', (req, res) => {
  res.set('Cache-Control', 'public, max-age=180');
  const rows = db.prepare('SELECT cat_id, COUNT(*) t, SUM(CASE WHEN stock>0 THEN 1 ELSE 0 END) s FROM products WHERE visible=1 AND cat_id>0 GROUP BY cat_id').all();
  const m = {};
  for (const r of rows) m[r.cat_id] = { t: r.t, s: r.s || 0 };
  res.json(m);
});

app.get('/api/categories', (req, res) => {
  res.set('Cache-Control', 'public, max-age=120');
  const all = db.prepare('SELECT cat_id, parent_id, grp, name, depth, icon FROM categories WHERE visible=1 AND (in_menu=1 OR in_menu IS NULL) ORDER BY sort_order, name').all();
  // строим вложенное дерево внутри каждой группы (произвольная глубина)
  const byParent = new Map(); // parent_id → [узлы]
  for (const c of all) {
    const k = c.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }
  const build = (parentId) => (byParent.get(parentId) || []).map(c => {
    const node = { id: c.cat_id, name: c.name };
    if (c.icon) node.icon = c.icon;
    const kids = build(c.cat_id);
    if (kids.length) node.children = kids;
    return node;
  });
  // группы в фиксированном порядке; верхний уровень группы — узлы с parent_id=0 и этой группой
  const order = ['Видеонаблюдение', 'Сетевое оборудование', 'Источники бесперебойного питания (ИБП)', 'Пожарная безопасность', 'СКУД и домофония', 'Кабельные системы', 'Серверное оборудование и СХД'];
  const groupsPresent = [...new Set(all.map(c => c.grp).filter(Boolean))];
  const ordered = [...order.filter(g => groupsPresent.includes(g)), ...groupsPresent.filter(g => !order.includes(g))];
  const tree = ordered.map(g => {
    const tops = (byParent.get(0) || []).filter(c => c.grp === g).map(c => {
      const node = { id: c.cat_id, name: c.name };
      if (c.icon) node.icon = c.icon;
      const kids = build(c.cat_id);
      if (kids.length) node.children = kids;
      return node;
    });
    return { name: g, nodes: tops };
  });
  res.json(tree);
});

// ---------- ПРИЁМ ЗАЯВКИ (с сайта) ----------
// Сохраняет заявку в базу. Клиент отправляет {items:[{sku,qty}], contact?}
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, message: { error: 'Слишком много заявок, подождите минуту.' } });
// услуга по странице-источнику заявки
function serviceFromPage(p) {
  p = String(p || '').toLowerCase();
  if (p.includes('videonablyudenie')) return 'Видеонаблюдение';
  if (p.includes('setevoe')) return 'Сетевое оборудование';
  if (p.includes('skud')) return 'СКУД и домофония';
  if (p.includes('pozharnaya')) return 'Пожарная безопасность';
  if (p.includes('ibp')) return 'Источники бесперебойного питания (ИБП)';
  if (p.includes('kabelnye')) return 'Кабельные системы';
  if (p.includes('servery')) return 'Серверное оборудование и СХД';
  if (p.includes('/product/')) return 'Каталог (карточка товара)';
  return 'Главная / каталог';
}

// ---------- ПОЛЬЗОВАТЕЛИ (личный кабинет: регистрация/вход/профиль/заказы/списки + админ-управление) ----------
// Регистрируется ДО заявок — отдаёт optionalUserId для привязки заявок к аккаунту.
const { optionalUserId } = require('./lib/routes/users')(app, {
  db, clamp, jwt, JWT_SECRET, hashPassword, verifyPassword,
  loginLimiter, registerLimiter, adminAuth: auth, SETTINGS, tgCfg, tgNotify, safeItems,
});

// ---------- ЗАЯВКИ (приём + админ-управление + экспорт) вынесены в lib/routes/orders.js ----------
require('./lib/routes/orders')(app, { db, auth, clamp, orderLimiter, serviceFromPage, tgCfg, notifyOrder, safeItems, XLSX, optionalUserId });

// ---------- ИМПОРТ/СИНХРОНИЗАЦИЯ (import/stock/attrs/categories-sync/offers-sync) ----------
// вынесены в lib/routes/import.js (контролируемая декомпозиция).
require('./lib/routes/import')(app, { db, importLimiter, safeEqual, IMPORT_TOKEN, MAX_IMPORT, clamp, toInt, sanitizeProduct, cleanAttrs, pingIndexNow, productUrl });

// CMS/контент-CRUD (поставщики, FAQ, отзывы, баннеры, подборки, страницы, меню, пересортировки)
// вынесены в lib/routes/content-admin.js (контролируемая декомпозиция).
require('./lib/routes/content-admin')(app, { db, auth, clamp, toInt, menuHref, sanitizeCmsHtml, invalidateNavCache, parseSkus });

// Склейка дублей между поставщиками (Этап E): предпросмотр/запуск/очередь конфликтов/отмена.
require('./lib/routes/match-admin')(app, { db, auth, toInt, safeEqual, IMPORT_TOKEN });

// Телеграм-пульт: вебхук команд/кнопок + подключение из админки.
require('./lib/routes/telegram-bot')(app, {
  db, auth, SETTINGS, tgCfg, safeItems, saveSetting,
  SITE_URL: (process.env.SITE_URL || 'https://servis-catalog.onrender.com'),
});

// ---------- АДМИНКА: авторизация ----------
app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!verifyPassword((req.body || {}).password || '', ADMIN_HASH)) {
    console.warn(`[auth] неудачный вход в админку с IP ${req.ip} в ${new Date().toISOString()}`);
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h', algorithm: 'HS256', issuer: 's1com' }) });
});

// ---------- АДМИНКА: CRUD товаров ----------
// Хелперы каталога (subtreeCatIds — нужен и в public /api/products?cat= и в SSR категорий; _catById/catPathFor —
// в bulk-привязке) остаются здесь; сами роуты вынесены в lib/routes/products-admin.js.
// путь предков категории (root→leaf) по parent_id — для массовой привязки товаров к ветке
const _catById = db.prepare('SELECT cat_id,parent_id,name,grp FROM categories WHERE cat_id=?');
const _catChildren = db.prepare('SELECT cat_id FROM categories WHERE parent_id=?');
// Все ID ветки категории: сама категория + все потомки. Для фильтра товаров через cat_id IN (…)
// с индексом idx_cat_id — вместо перебора всего каталога и парсинга cat_path в JS.
function subtreeCatIds(catId) {
  const root = Number(catId) || 0;
  if (!root) return [];
  const ids = [root]; const seen = new Set([root]);
  for (let i = 0; i < ids.length; i++) {
    for (const r of _catChildren.all(ids[i])) {
      const cid = Number(r.cat_id) || 0;
      if (cid && !seen.has(cid)) { seen.add(cid); ids.push(cid); }
    }
  }
  return ids;
}
function catPathFor(catId) {
  const path = []; const seen = new Set(); let cur = Number(catId) || 0;
  while (cur && !seen.has(cur)) { seen.add(cur); path.unshift(cur); const row = _catById.get(cur); cur = row ? (Number(row.parent_id) || 0) : 0; }
  return path;
}
// ---------- АДМИНКА: товары (список/bulk/CRUD/цена/загрузка/импорт-файл) вынесены в lib/routes/products-admin.js ----------
require('./lib/routes/products-admin')(app, { db, auth, clamp, toInt, rowToAdmin, sanitizeProduct, catPathFor, _catById, pingIndexNow, productUrl, fs, path, IMAGES_DIR, XLSX });

// ---------- АДМИНКА: заявки ----------
// ---------- АНАЛИТИКА (дашборд + продажи) вынесена в lib/routes/stats.js ----------
require('./lib/routes/stats')(app, { db, auth, clamp });
// ---------- АДМИНКА: управление категориями ----------
// Админ-CRUD категорий и разделов витрины вынесены в lib/routes/catalog-admin.js (декомпозиция).
require('./lib/routes/catalog-admin')(app, { db, auth, clamp, invalidateNavCache });



// ---------- НАСТРОЙКИ САЙТА + журнал импорта вынесены в lib/routes/settings.js ----------
require('./lib/routes/settings')(app, { db, auth, clamp, SETTINGS, cleanCatIcons, cleanCatFilters });
// ---------- БЭКАПЫ БД + тест Telegram вынесены в lib/routes/backups.js (декомпозиция) ----------
require('./lib/routes/backups')(app, { db, auth, path_, fs, BACKUP_DIR, BACKUP_KEEP, BACKUP_RE, listBackups, makeBackup, SETTINGS, telegramTest });

// ---------- SEO-ЦЕНТР (аудит/массовое-заполнение/диагностика Al-Style) вынесены в lib/routes/seo-center.js ----------
require('./lib/routes/seo-center')(app, { db, auth, clamp, fs, https, publicDir: path.join(__dirname, 'public') });

// ---------- СТРАНИЦА ТОВАРА (SEO) ----------
// Умный подбор похожих товаров (тирами): та же категория → тот же бренд в разделе → раздел по близости цены.
function relatedFor(row) {
  const seen = new Set([row.sku]); const out = [];
  const price = row.price || 0;
  const add = (rows) => { for (const r of rows) { if (out.length >= 4) break; if (seen.has(r.sku)) continue; seen.add(r.sku); out.push(r); } };
  if (row.cat_id) add(db.prepare('SELECT * FROM products WHERE cat_id=? AND sku<>? AND visible=1 ORDER BY (stock>0) DESC, (price=0), ABS(price-?) LIMIT 8').all(row.cat_id, row.sku, price));
  if (out.length < 4 && row.brand) add(db.prepare('SELECT * FROM products WHERE grp=? AND brand=? AND sku<>? AND visible=1 ORDER BY (stock>0) DESC, (price=0), ABS(price-?) LIMIT 8').all(row.grp, row.brand, row.sku, price));
  if (out.length < 4) add(db.prepare('SELECT * FROM products WHERE grp=? AND sku<>? AND visible=1 ORDER BY (stock>0) DESC, (price=0), ABS(price-?) LIMIT 12').all(row.grp, row.sku, price));
  return out.slice(0, 4);
}
app.get('/product/:sku', (req, res) => {
  const row = db.prepare('SELECT * FROM products WHERE sku=? AND visible=1').get(req.params.sku);
  if (!row) {
    return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  }
  const p = rowToPublic(row);
  p.id = row.id; p.images = row.images || ''; // галерея фото для страницы товара
  const related = relatedFor(row).map(rowToPublic);
  res.set('Cache-Control', 'public, max-age=300');
  const sec = db.prepare('SELECT page, slug FROM sections WHERE name=? AND visible=1').get(p.group);
  const groupPage = sec ? (sec.page || ('/section/' + sec.slug)) : undefined;
  res.send(applySeo(renderProductPage(p, related, { groupPage }), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});

// ---------- СТРАНИЦА РАЗДЕЛА (динамическая, из таблицы sections) ----------
app.get('/section/:slug', (req, res) => {
  const s = db.prepare('SELECT * FROM sections WHERE slug=? AND visible=1').get(String(req.params.slug || '').trim());
  if (!s) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  if (s.page) return res.redirect(301, s.page); // у раздела есть своя статическая страница — не плодим дубль
  const rows = db.prepare('SELECT * FROM products WHERE grp=? AND visible=1 ORDER BY (price=0), stock DESC, brand, model').all(s.name).map(rowToPublic);
  const catLike = { name: s.name, grp: '', descr: s.descr || '', seo_title: s.seo_title || '', seo_desc: s.seo_desc || '', h1: s.h1 || '', image_url: s.image_url || '', slug: s.slug, cat_id: 0 };
  const siblings = db.prepare("SELECT slug, name FROM sections WHERE slug<>? AND visible=1 AND (in_menu=1 OR in_menu IS NULL) ORDER BY sort_order, name LIMIT 12").all(s.slug);
  res.set('Cache-Control', 'public, max-age=300');
  res.send(applySeo(renderCategoryPage(catLike, rows, siblings, { urlPrefix: '/section/', siblingsTitle: 'Другие разделы' }), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});

// ---------- СТРАНИЦА БРЕНДА (полный каталог с фасетами через catalog.js) ----------
app.get('/brand/:name', (req, res) => {
  let raw = '';
  try { raw = decodeURIComponent(String(req.params.name || '')); } catch (e) { raw = String(req.params.name || ''); }
  const brand = clamp(raw, 100).trim();
  if (!brand) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  // канонический регистр бренда — как хранится в products (без учёта регистра во входе)
  const row0 = db.prepare("SELECT brand FROM products WHERE LOWER(brand)=LOWER(?) AND visible=1 AND brand<>'' LIMIT 1").get(brand);
  if (!row0) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  const realBrand = row0.brand;
  const rows = db.prepare('SELECT * FROM products WHERE brand=? AND visible=1 ORDER BY (price=0), stock DESC, grp, model LIMIT 2000').all(realBrand).map(rowToPublic);
  const catLike = { name: realBrand, grp: '', descr: '', seo_title: '', seo_desc: '', h1: realBrand, image_url: '', slug: realBrand, cat_id: 0 };
  const siblings = db.prepare("SELECT brand FROM products WHERE visible=1 AND brand<>'' AND brand<>? GROUP BY brand ORDER BY COUNT(*) DESC LIMIT 12").all(realBrand)
    .map(r => ({ slug: r.brand, name: r.brand, cat_id: r.brand }));
  res.set('Cache-Control', 'public, max-age=300');
  res.send(applySeo(renderCategoryPage(catLike, rows, siblings, { urlPrefix: '/brand/', brand: realBrand, siblingsTitle: 'Другие бренды' }), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});

// ---------- БЫСТРЫЙ ЗАКАЗ ПО СПИСКУ АРТИКУЛОВ (для монтажников/B2B) ----------
app.get('/bystryy-zakaz', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.send(applySeo(renderQuickOrderPage(), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});
// ---------- ЛИЧНЫЙ КАБИНЕТ /cabinet (SSR-оболочка; вся логика — клиентская cabinet.js) ----------
app.get('/cabinet', (req, res) => {
  res.set('Cache-Control', 'no-store'); // приватная страница, не кэшируем
  res.send(applySeo(renderCabinetPage(), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});
// ---------- ИЗБРАННОЕ /izbrannoe (клиентское, sc_fav + синк с аккаунтом) ----------
app.get('/izbrannoe', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(applySeo(renderFavoritesPage(), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});
// ---------- ГОТОВОЕ РЕШЕНИЕ (комплект) /bundle/:id ----------
app.get('/bundle/:id', (req, res) => {
  const b = db.prepare('SELECT * FROM bundles WHERE id=? AND visible=1').get(Number(req.params.id));
  if (!b) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  const findP = db.prepare('SELECT * FROM products WHERE sku=? AND visible=1');
  const items = [];
  for (const s of parseSkus(b.skus)) { const p = findP.get(String(s)); if (p) items.push(rowToPublic(p)); }
  res.set('Cache-Control', 'public, max-age=300');
  res.send(applySeo(renderBundlePage(b, items), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});

// ---------- ИНФО-СТРАНИЦА (доставка/оплата/гарантия/о компании…) ----------
app.get('/page/:slug', (req, res) => {
  const page = db.prepare('SELECT * FROM pages WHERE slug=? AND visible=1').get(String(req.params.slug || '').trim());
  if (!page) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  res.set('Cache-Control', 'public, max-age=300');
  res.send(applySeo(renderContentPage(page), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});

// ---------- «ПОЛЕЗНОЕ»: СПИСОК СТАТЕЙ И СТАТЬЯ (SEO-трафик по НЧ-запросам) ----------
// Смысл раздела — не «блог ради блога», а посадочные под запросы монтажников/заказчиков.
// Поэтому статья всегда ведёт в каталог: под текстом — товары раздела (grp) или точечные (skus).
app.get('/poleznoe', (req, res) => {
  let rows = [];
  try { rows = db.prepare('SELECT slug,title,excerpt,grp,image_url FROM articles WHERE visible=1 ORDER BY sort_order,id').all(); }
  catch (e) { rows = []; } // таблицы ещё нет (старая БД) — отдаём пустой список, а не 500
  res.set('Cache-Control', 'public, max-age=300');
  res.send(applySeo(renderArticleList(rows), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});
app.get('/poleznoe/:slug', (req, res) => {
  let a;
  try { a = db.prepare('SELECT * FROM articles WHERE slug=? AND visible=1').get(String(req.params.slug || '').trim()); }
  catch (e) { a = null; }
  if (!a) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));

  // Товары под статью: сперва точечные (skus), иначе — витрина раздела (в наличии и с ценой вперёд).
  let goods = [];
  try {
    const skus = parseSkus(a.skus);
    if (skus.length) {
      const ph = skus.map(() => '?').join(',');
      goods = db.prepare(`SELECT sku,brand,model,price,stock,img FROM products WHERE sku IN (${ph}) AND visible=1`).all(...skus);
    } else if (a.grp) {
      goods = db.prepare(`SELECT sku,brand,model,price,stock,img FROM products
        WHERE grp=? AND visible=1 ORDER BY (stock>0) DESC, (price>0) DESC, is_hit DESC, id DESC LIMIT 4`).all(a.grp);
    }
  } catch (e) { goods = []; } // товары — украшение статьи, из-за них страница падать не должна

  // Ссылка на раздел витрины — из данных (sections), как в SSR карточки товара (см. /product/:sku).
  let sectionUrl = '';
  if (a.grp) {
    try {
      const s = db.prepare('SELECT page, slug FROM sections WHERE name=? AND visible=1').get(a.grp);
      if (s) sectionUrl = s.page || ('/section/' + s.slug);
    } catch (e) {}
  }

  let others = [];
  try { others = db.prepare('SELECT slug,title FROM articles WHERE visible=1 AND slug<>? ORDER BY sort_order,id LIMIT 3').all(a.slug); }
  catch (e) {}

  // Телефон для WhatsApp — из настроек (единый источник org_phone, как в applySeo).
  const wa = String(SETTINGS.org_phone || '+77053541999').replace(/\D/g, '') || '77053541999';
  res.set('Cache-Control', 'public, max-age=300');
  res.send(applySeo(renderArticlePage(a, goods, sectionUrl, others, wa), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});

// ---------- СТРАНИЦА КАТЕГОРИИ (SEO, посадочная) ----------
app.get('/category/:key', (req, res) => {
  const key = String(req.params.key || '').trim();
  if (!key) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  // ищем сперва по slug (ЧПУ), затем по cat_id
  let cat = db.prepare('SELECT * FROM categories WHERE slug=? AND slug<>\'\' AND visible=1').get(key);
  if (!cat && /^\d+$/.test(key)) cat = db.prepare('SELECT * FROM categories WHERE cat_id=? AND visible=1').get(Number(key));
  if (!cat) return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  const catId = cat.cat_id;
  // товары ветки = cat_id ∈ поддерево(catId); по индексу idx_cat_id, без перебора всего каталога.
  // LIMIT 2000 — предохранитель для SSR (клиент catalog.js догружает и пересчитывает точно).
  const subIds = subtreeCatIds(catId);
  const rows = subIds.length
    ? db.prepare('SELECT * FROM products WHERE visible=1 AND cat_id IN (' + subIds.map(() => '?').join(',') + ') ORDER BY (price=0), stock DESC, brand, model LIMIT 2000').all(...subIds).map(rowToPublic)
    : [];
  // прямые дочерние категории (+ счётчики всего/в наличии по поддереву) — для «проваливания» вглубь дерева
  const children = db.prepare("SELECT cat_id, name, slug FROM categories WHERE parent_id=? AND visible=1 AND (in_menu=1 OR in_menu IS NULL) ORDER BY sort_order, name").all(catId)
    .map(c => {
      const ids = subtreeCatIds(c.cat_id);
      let t = 0, s = 0;
      if (ids.length) {
        const r = db.prepare('SELECT COUNT(*) t, SUM(CASE WHEN stock>0 THEN 1 ELSE 0 END) s FROM products WHERE visible=1 AND cat_id IN (' + ids.map(() => '?').join(',') + ')').get(...ids);
        t = r.t || 0; s = r.s || 0;
      }
      return { cat_id: c.cat_id, name: c.name, slug: c.slug, count: t, inStock: s };
    });
  // цепочка родителей — для хлебных крошек по всей ветке
  const parents = [];
  let pid = cat.parent_id || 0, guard = 0;
  while (pid && guard++ < 12) {
    const par = db.prepare('SELECT cat_id, name, slug, parent_id FROM categories WHERE cat_id=? AND visible=1').get(pid);
    if (!par) break;
    parents.unshift({ cat_id: par.cat_id, name: par.name, slug: par.slug });
    pid = par.parent_id;
  }
  // соседние категории (того же родителя, а если корень — того же раздела) — для перелинковки
  const siblings = (cat.parent_id
    ? db.prepare("SELECT cat_id, name, slug FROM categories WHERE parent_id=? AND cat_id<>? AND visible=1 AND (in_menu=1 OR in_menu IS NULL) ORDER BY sort_order, name LIMIT 16").all(cat.parent_id, catId)
    : (cat.grp ? db.prepare("SELECT cat_id, name, slug FROM categories WHERE grp=? AND (parent_id=0 OR parent_id IS NULL) AND cat_id<>? AND visible=1 AND (in_menu=1 OR in_menu IS NULL) ORDER BY sort_order, name LIMIT 16").all(cat.grp, catId) : []));
  res.set('Cache-Control', 'public, max-age=300');
  res.send(applySeo(renderCategoryPage(cat, rows, siblings, { children, parents }), res.locals.nonce, res.locals.lang, res.locals.ruPath));
});


// /robots.txt и /sitemap.xml вынесены в lib/routes/seo-ops.js (зарегистрированы выше).

// IndexNow: файл-ключ (поисковик проверяет владение)
app.get('/:key.txt', (req, res, next) => {
  if (INDEXNOW_KEY && req.params.key === INDEXNOW_KEY) return res.type('text/plain').send(INDEXNOW_KEY);
  next();
});


// ---------- статика ----------
// Админка (одностраничная SPA за JWT) активно использует инлайн-<script> и ~175 inline-обработчиков.
// Отдаётся статикой (мимо applySeo → nonce не проставить), поэтому переводить её на strict-CSP пришлось бы
// переписыванием всех обработчиков — отдельный крупный рефактор. Пока даём админке свой relaxed-CSP
// ('unsafe-inline' для script). Поверхность XSS мала: доступ только после входа, единственный пользователь.
app.use('/admin', (req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; script-src-attr 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; " +
    "connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'; " +
    "base-uri 'self'; frame-ancestors 'self'; form-action 'self'");
  next();
});
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.use('/images', express.static(IMAGES_DIR, { maxAge: '7d', immutable: false }));

// --- SSR товаров раздела: для краулеров и без-JS список карточек-ссылок;
//     app.js при загрузке заменяет #grid интерактивной сеткой (дублирования нет) ---
const SECTION_GROUPS = {
  'videonablyudenie.html': 'Видеонаблюдение',
  'setevoe.html': 'Сетевое оборудование',
  'pozharnaya.html': 'Пожарная безопасность',
  'skud.html': 'СКУД и домофония',
  'ibp.html': 'Источники бесперебойного питания (ИБП)',
  'kabelnye.html': 'Кабельные системы',
  'servery.html': 'Серверное оборудование и СХД',
};
const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtKzt = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20B8';
function ssrGrid(grp) {
  let rows = [];
  try { rows = db.prepare('SELECT sku,brand,model,cat,res,price,stock,img FROM products WHERE grp=? AND visible=1 ORDER BY (stock>0) DESC, (price>0) DESC, id DESC LIMIT 48').all(grp); }
  catch (e) { return ''; }
  if (!rows.length) return '';
  return rows.map(r => {
    const href = '/product/' + encodeURIComponent(r.sku);
    const imgSrc = r.img ? escHtml(/^https?:\/\//i.test(r.img) ? r.img : '/images/' + r.img) : '';
    const badge = (r.stock > 0) ? `<span class="badge in">\u2713 \u0412 \u043D\u0430\u043B\u0438\u0447\u0438\u0438</span>` : `<span class="badge pre">\u041F\u043E\u0434 \u0437\u0430\u043A\u0430\u0437</span>`;
    const imgHtml = imgSrc
      ? `<a class="pimg" href="${href}"><img src="${imgSrc}" loading="lazy" alt="${escHtml((r.brand || '') + ' ' + (r.model || ''))}">${badge}</a>`
      : `<a class="pimg" href="${href}"><div class="noimg">\uD83D\uDCF7</div>${badge}</a>`;
    const specs = r.res ? `<div class="pb-spec"><span>${escHtml(r.res)}</span></div>` : '';
    const price = r.price ? `<b>${fmtKzt(r.price)}</b><small>\u0420\u0420\u0426</small>` : `<span class="req">\u0426\u0435\u043D\u0430 \u043F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443</span>`;
    return `<div class="pcard">${imgHtml}<div class="pbody"><div class="pb-brand">${escHtml(r.brand || r.cat || '')}</div><a class="pb-name" href="${href}">${escHtml(r.model || '')}</a>${r.sku ? `<div class="pb-art">\u0430\u0440\u0442. ${escHtml(r.sku)}</div>` : ''}${specs}<div class="pb-price">${price}</div></div></div>`;
  }).join('');
}
// FAQ \u0440\u0430\u0437\u0434\u0435\u043b\u0430 \u0434\u043b\u044f SSR: \u0431\u043b\u043e\u043a + FAQPage JSON-LD \u043f\u0440\u044f\u043c\u043e \u0432 HTML (\u043a\u0440\u0430\u0443\u043b\u0435\u0440\u044b \u0431\u0435\u0437 JS \u0432\u0438\u0434\u044f\u0442 \u0440\u0430\u0437\u043c\u0435\u0442\u043a\u0443 \u0438 \u043a\u043e\u043d\u0442\u0435\u043d\u0442).
// \u041f\u043e\u043a\u0440\u044b\u0432\u0430\u0435\u0442 \u0432\u0441\u0435 7 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432; faqKey \u0434\u043e\u043b\u0436\u0435\u043d \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u0442\u044c \u0441 \u043f\u043e\u043b\u0435\u043c faq.page (\u0441\u0438\u0434/\u0430\u0434\u043c\u0438\u043d\u043a\u0430).
const FAQ_PAGE_KEY = {
  'videonablyudenie.html': 'video', 'setevoe.html': 'setevoe', 'skud.html': 'skud',
  'pozharnaya.html': 'pozharnaya', 'ibp.html': 'ibp', 'kabelnye.html': 'kabelnye', 'servery.html': 'servery'
};
function faqBlockHtml(faqKey) {
  if (!faqKey) return '';
  let rows = [];
  try { rows = db.prepare('SELECT q,a FROM faq WHERE page=? AND visible=1 ORDER BY sort_order,id').all(faqKey); }
  catch (e) { return ''; }
  if (!rows.length) return '';
  const items = rows.map(f => `<details><summary>${escHtml(f.q)}</summary><div class="fa-a">${escHtml(f.a)}</div></details>`).join('');
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: rows.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
  return `<div class="container"><div class="faq-ssr" style="max-width:840px;margin:6px 0 44px"><h2 style="font-size:20px;color:var(--ink);letter-spacing:-.02em;margin:0 0 14px">\u0427\u0430\u0441\u0442\u044b\u0435 \u0432\u043e\u043f\u0440\u043e\u0441\u044b</h2><div class="faq">${items}</div></div></div>`
    + `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}

// Подстановка ID Яндекс.Метрики + SSR товаров раздела в HTML-страницы каталога
app.get(/\.html$|^\/$/, (req, res, next) => {
  let file = req.path === '/' ? 'index.html' : req.path.replace(/^\//, '');
  const publicDir = path.join(__dirname, 'public');
  const fp = path.join(publicDir, file);
  if (fp !== publicDir && !fp.startsWith(publicDir + path.sep)) return next(); // защита от path traversal (../)
  fs.readFile(fp, 'utf8', (err, html) => {
    if (err) return next();
    const grp = SECTION_GROUPS[file];
    if (grp) {
      const ssr = ssrGrid(grp);
      if (ssr) html = html.replace('<div class="prodgrid" id="grid"></div>', '<div class="prodgrid" id="grid">' + ssr + '</div>');
    }
    // FAQ раздела — в SSR (перед подвалом), чтобы разметку FAQPage видели краулеры без JS
    const faq = faqBlockHtml(FAQ_PAGE_KEY[file]);
    if (faq) html = html.replace('<footer', faq + '<footer');
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(applySeo(html, res.locals.nonce, res.locals.lang, res.locals.ruPath));
  });
});

app.use('/', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => {
    if (/\.(js|css)$/.test(p)) {
      // с ?v=<build> (ссылки из applySeo) кэшируем надолго; прямой запрос без версии — сверяем свежесть
      if (res.req && res.req.query && res.req.query.v) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      else res.set('Cache-Control', 'no-cache');
    }
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
    // Категории больше не сидим из файла — дерево формируется из импорта Al-Style (по ID).
  } catch (e) { console.warn('[seed] автозагрузка пропущена:', e.message); }
}

scheduleBackups();
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
