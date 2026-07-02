'use strict';
const PHONE = '77053541999';
const SITE = process.env.SITE_URL || 'https://servis-com.kz';
const GROUP_PAGE = {'Видеонаблюдение':'/videonablyudenie.html','Сетевое оборудование':'/setevoe.html','Источники бесперебойного питания (ИБП)':'/ibp.html','Пожарная безопасность':'/pozharnaya.html','СКУД и домофония':'/skud.html','Кабельные системы':'/kabelnye.html'};

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(n){return n?Number(n).toLocaleString('ru-RU')+' \u20B8':'';}
function imgSrc(u){u=String(u||'');return /^https?:\/\//i.test(u)?u:'/images/'+u;}
function groupPageFor(g){return GROUP_PAGE[g]||'/';}

function header(){
  return `<div class="util"><div class="container"><span>📍 Усть-Каменогорск, пр. Назарбаева 23</span><div class="r"><span>Доставка по Казахстану</span><span>Опт для монтажников</span><span>Пн–Сб 9:00–18:00</span></div></div></div>
<div class="site">
  <div class="head"><div class="container">
    <a class="logo" href="/">Сервис<b>.com</b></a>
    <form class="search" id="hsearch"><input id="q1" placeholder="Поиск по названию, артикулу или бренду…" aria-label="Поиск"><button type="submit">Найти</button></form>
    <a class="phone" href="tel:+${PHONE}">+7 705 354-19-99<small>Позвонить</small></a>
    <a class="wa" href="https://wa.me/${PHONE}" target="_blank" rel="nofollow">✆ <span>WhatsApp</span></a>
    <div class="icons"><a href="#" title="Избранное">♡</a><a href="#" title="Сравнение">⇄</a><button id="cartOpen" title="Заявка">🛒<span class="bdg" id="cartCount" style="display:none">0</span></button></div>
  </div></div>
  <div class="navbar"><div class="container" style="position:relative">
    <nav class="nav"><button class="cat-btn" id="catBtn" aria-expanded="false">☰ Каталог <span class="chev">▾</span></button><a href="/">Бренды</a><a href="/" class="fire">Акции</a><a href="/">Новинки</a><a href="/">Хиты продаж</a><a href="/#about">О компании</a><a href="tel:+${PHONE}">Контакты</a><span class="r">🚚 Бесплатная консультация · выезд специалиста</span></nav>
    <div class="mega" id="mega"><div id="megaInner"></div></div>
  </div></div>
</div>`;
}
const FOOTER = `<footer class="foot"><div class="container">
  <div><div class="logo">Сервис<b style="color:var(--red)">.com</b></div><p>Системы безопасности и сетевое оборудование оптом и в розницу по Казахстану.</p><p>📍 Усть-Каменогорск, пр. Назарбаева 23<br>☎ <a href="tel:+${PHONE}">+7 705 354-19-99</a></p></div>
  <div><h4>Каталог</h4><a href="/videonablyudenie.html">Видеонаблюдение</a><a href="/setevoe.html">Сетевое оборудование</a><a href="/skud.html">СКУД и домофония</a><a href="/pozharnaya.html">Пожарная безопасность</a><a href="/ibp.html">Электропитание (ИБП)</a><a href="/kabelnye.html">Кабельные системы</a></div>
  <div><h4>Компания</h4><a href="/#about">О нас</a><a href="https://wa.me/${PHONE}" target="_blank" rel="nofollow">Оптовикам</a><a href="tel:+${PHONE}">Контакты</a></div>
  <div><h4>Бренды</h4><a href="/videonablyudenie.html">Dahua</a><a href="/videonablyudenie.html">Hikvision</a><a href="/videonablyudenie.html">IMOU</a><a href="/videonablyudenie.html">HiLook</a></div>
</div><div class="foot-bot">© 2026 ТОО «Сервис.com». Системы безопасности оптом и в розницу по Казахстану.</div></footer>`;

const CART_HTML = `<div class="cart-ov" id="cartOv"></div>
<aside class="cart" id="cart" aria-label="Заявка">
  <div class="cart-h"><b>🧾 Ваша заявка</b><button class="cl" id="cartClose" aria-label="Закрыть">✕</button></div>
  <div class="cart-body" id="cartBody"></div>
  <div class="cart-foot" id="cartFoot" style="display:none">
    <input id="cName" placeholder="Ваше имя" maxlength="100" autocomplete="name">
    <input id="cPhone" placeholder="Телефон для связи" maxlength="50" inputmode="tel" autocomplete="tel">
    <textarea id="cComment" rows="2" placeholder="Комментарий (необязательно): объект, сроки…" maxlength="1000"></textarea>
    <label class="consent"><input type="checkbox" id="cConsent" checked> Согласен на обработку <a href="/privacy.html" target="_blank">персональных данных</a></label>
    <button class="send" id="cSend">Отправить заявку</button>
  </div>
</aside>`;

function renderProductPage(p, related){
  related = related || [];
  const title = `${esc(p.brand?p.brand+' ':'')}${esc(p.model)} — купить в Казахстане, цена и характеристики | Сервис.com`;
  const shortDesc = String(p.desc||'').replace(/\s+/g,' ').trim().slice(0,155);
  const metaDesc = shortDesc || `${p.brand?p.brand+' ':''}${p.model} (арт. ${p.sku}). Цена, наличие, доставка по Казахстану. Опт для монтажников.`;
  const canonical = `${SITE}/product/${encodeURIComponent(p.sku)}`;
  const mainImg = p.img ? imgSrc(p.img) : '';

  // галерея
  let gallery = String(p.images||'').split(/[\n,;|]+/).map(s=>s.trim()).filter(Boolean);
  if(!gallery.length && p.img) gallery = [p.img];
  const galleryHtml = gallery.length
    ? `<div class="pd-main"><img id="pdMain" src="${imgSrc(gallery[0])}" alt="${esc(p.brand+' '+p.model)}" onerror="this.onerror=null;this.src='/images/logo.png'"></div>`
      + (gallery.length>1 ? `<div class="pd-thumbs">`+gallery.slice(0,12).map((u,i)=>`<button type="button" class="pd-thumb${i===0?' on':''}" data-src="${esc(imgSrc(u))}"><img src="${imgSrc(u)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/images/logo.png'"></button>`).join('')+`</div>` : '')
    : `<div class="pd-main"><div class="pd-noimg">📷 Фото по запросу</div></div>`;

  // характеристики из desc (Al-Style — через запятую)
  const parts = String(p.desc||'').split(',').map(s=>s.trim()).filter(Boolean);
  const isSpecs = parts.length>=2;
  const specRows = isSpecs ? parts.map(part=>{
    const i = part.indexOf(':');
    if(i>0) return `<tr><td class="sk">${esc(part.slice(0,i).trim())}</td><td>${esc(part.slice(i+1).trim())}</td></tr>`;
    return `<tr><td colspan="2">${esc(part)}</td></tr>`;
  }).join('') : '';
  const charTab = specRows ? `<table class="pd-spec">${specRows}</table>` : `<p style="color:#6B7280">Характеристики уточняйте у менеджера.</p>`;
  const descTab = (!isSpecs && p.desc) ? `<p>${esc(p.desc)}</p>` : `<p>${esc(p.brand?p.brand+' ':'')}${esc(p.model)} — оборудование для систем безопасности. Официальная гарантия, доставка по Казахстану, оптовые цены для монтажников и организаций. Нужна консультация или подбор под объект — оставьте заявку или напишите в WhatsApp.</p>`;

  // цена/наличие
  const priceBlock = p.price>0
    ? `<div class="pd-price">${p.promo&&p.oldprice?`<span class="old">${fmt(p.oldprice)}</span> `:''}<b>${fmt(p.price)}</b> <small>РРЦ</small></div>
       <div class="pd-stock ${p.inStock?'in':'pre'}">${p.inStock?'✓ В наличии'+(p.stock?': '+p.stock+' шт':''):'Под заказ'} · опт — при заказе</div>`
    : `<div class="pd-price"><span class="req">Цена по запросу</span></div><div class="pd-stock ${p.inStock?'in':'pre'}">${p.inStock?'✓ В наличии':'Под заказ'}</div>`;

  const waText = encodeURIComponent(`Здравствуйте! Интересует: ${p.brand?p.brand+' ':''}${p.model} (арт. ${p.sku}). Подскажите цену и наличие.`);
  const waOpt = encodeURIComponent(`Здравствуйте! Интересует ОПТОВАЯ цена на: ${p.brand?p.brand+' ':''}${p.model} (арт. ${p.sku}).`);

  // похожие (карточки как в каталоге)
  const relCards = related.slice(0,4).map(r=>{
    const iu = r.img ? imgSrc(r.img) : '';
    const img = iu ? `<img src="${esc(iu)}" loading="lazy" alt="${esc(r.brand+' '+r.model)}" onerror="this.onerror=null;this.parentNode.innerHTML='<div class=&quot;noimg&quot;>📷</div>'">` : `<div class="noimg">📷</div>`;
    const badge = r.inStock ? `<span class="badge in">✓ В наличии</span>` : `<span class="badge pre">Под заказ</span>`;
    const rp = r.price>0 ? `<b>${fmt(r.price)}</b><small>РРЦ</small>` : `<span class="req">по запросу</span>`;
    const href = `/product/${encodeURIComponent(r.sku)}`;
    return `<div class="pcard" data-sku="${esc(r.sku)}"><a class="pimg" href="${href}">${img}${badge}</a><div class="pbody"><div class="pb-brand">${esc(r.brand||'')}</div><a class="pb-name" href="${href}">${esc(r.model)}</a><div class="pb-art">арт. ${esc(r.sku)}</div><div class="pb-price">${rp}</div><div class="pcta"><button class="add" data-act="add">+ В заявку</button><a class="wa" href="https://wa.me/${PHONE}?text=${encodeURIComponent('Здравствуйте! Интересует: '+(r.brand?r.brand+' ':'')+r.model+' (арт. '+r.sku+'). Цена и наличие?')}" target="_blank" rel="nofollow" title="WhatsApp">✆</a></div></div></div>`;
  }).join('');

  // JSON-LD Product
  const ld = {'@context':'https://schema.org','@type':'Product','name':((p.brand?p.brand+' ':'')+p.model).trim(),'sku':p.sku,'category':p.group||''};
  if(p.brand) ld.brand={'@type':'Brand','name':p.brand};
  if(mainImg) ld.image = mainImg;
  if(metaDesc) ld.description = metaDesc;
  if(p.price>0) ld.offers={'@type':'Offer','price':p.price,'priceCurrency':'KZT','availability':'https://schema.org/'+(p.inStock?'InStock':'PreOrder'),'url':canonical};

  // данные для корзины/похожих на клиенте
  const cartData = {};
  [p].concat(related).forEach(x=>{cartData[x.sku]={b:x.brand||'',m:x.model||'',p:x.price||0,i:x.img||''};});

  return `<!DOCTYPE html><html lang="ru"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="product"><meta property="og:url" content="${canonical}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(metaDesc)}">
${mainImg?`<meta property="og:image" content="${esc(mainImg)}">`:''}
<link rel="icon" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/catalog.css">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g,'\\u003c')}</script>
<script>window.__YM_ID__="__YM_ID__";</script>
<script type="text/javascript">(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");if(window.__YM_ID__&&window.__YM_ID__!=="__YM_ID__"){ym(window.__YM_ID__,"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});}</script>
<style>
.pd{display:grid;grid-template-columns:1fr 1fr;gap:40px;padding:8px 0 36px;align-items:start}
.pd-main{border:1px solid var(--line);border-radius:16px;background:#fff;aspect-ratio:1/1;display:grid;place-items:center;overflow:hidden}
.pd-main img{width:100%;height:100%;object-fit:contain;padding:22px}
.pd-noimg{color:#9aa2ae;font-size:16px}
.pd-thumbs{display:flex;gap:9px;margin-top:12px;flex-wrap:wrap}
.pd-thumb{width:66px;height:66px;border:1.5px solid var(--line);border-radius:10px;background:#fff;padding:5px;cursor:pointer;overflow:hidden}
.pd-thumb.on{border-color:var(--red)}.pd-thumb img{width:100%;height:100%;object-fit:contain}
.pd-brand{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.pd-info h1{font-size:27px;font-weight:800;letter-spacing:-.025em;margin:6px 0 8px;line-height:1.15}
.pd-art{font-family:var(--mono);font-size:12.5px;color:#9aa2ae;margin-bottom:16px}
.pd-price{font-size:15px;color:var(--muted);margin-top:8px}.pd-price b{font-size:30px;font-weight:900;letter-spacing:-.03em;color:var(--ink)}.pd-price .old{text-decoration:line-through;color:#b9c0ca;font-size:16px;font-weight:600}.pd-price .req{font-size:20px;font-weight:800;color:var(--muted)}
.pd-stock{font-size:13.5px;margin-top:8px;font-weight:600}.pd-stock.in{color:var(--green)}.pd-stock.pre{color:#9a5b00}
.pd-cta{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 8px}
.pd-cta .add{background:var(--ink);color:#fff;border:0;border-radius:12px;padding:15px 26px;font-weight:700;font-size:15px;cursor:pointer}.pd-cta .add:hover{background:#000}.pd-cta .add.in{background:var(--green)}
.pd-cta .wa{background:#eafaf1;color:var(--green);border:1px solid #d7f0e0;border-radius:12px;padding:15px 22px;font-weight:600;font-size:14.5px}
.pd-cta .opt{background:#fff;color:var(--ink);border:1.5px solid var(--line);border-radius:12px;padding:15px 22px;font-weight:600;font-size:14px}.pd-cta .opt:hover{border-color:var(--red);color:var(--red)}
.pd-adv{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:22px}
.pd-adv .a{display:flex;gap:11px;align-items:flex-start;font-size:13px}.pd-adv .a .e{font-size:19px}.pd-adv .a b{display:block;font-size:13.5px}.pd-adv .a span{color:var(--muted)}
.pd-tabs{border-top:1px solid var(--line);padding-top:8px;margin-bottom:36px}
.pd-tabbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;border-bottom:1px solid var(--line)}
.pd-tabbar button{background:none;border:0;border-bottom:2px solid transparent;padding:14px 16px;font-size:14.5px;font-weight:600;color:var(--muted);cursor:pointer;margin-bottom:-1px}
.pd-tabbar button.on{color:var(--ink);border-bottom-color:var(--red)}
.pd-panel{display:none;max-width:840px;font-size:14.5px;line-height:1.7;color:#333}.pd-panel.on{display:block}
.pd-spec{width:100%;border-collapse:collapse;max-width:640px}.pd-spec td{padding:9px 12px;border-bottom:1px solid var(--line);font-size:13.5px;vertical-align:top}.pd-spec td.sk{color:var(--muted);width:44%}.pd-spec tr:nth-child(even){background:var(--surface)}
@media(max-width:820px){.pd{grid-template-columns:1fr;gap:22px}.pd-adv{grid-template-columns:1fr}}
</style>
</head><body>
${header()}
<div class="container">
  <div class="crumbs"><a href="/">Главная</a> / <a href="${groupPageFor(p.group)}">${esc(p.group||'Каталог')}</a> / <b>${esc(p.model)}</b></div>
  <div class="pd">
    <div class="pd-gallery">${galleryHtml}</div>
    <div class="pd-info">
      <div class="pd-brand">${esc(p.brand||'')}</div>
      <h1>${esc(p.model)}</h1>
      <div class="pd-art">Артикул: ${esc(p.sku)}${p.cat?' · '+esc(p.cat):''}</div>
      ${priceBlock}
      <div class="pd-cta">
        <button class="add" id="pdAdd">+ В заявку</button>
        <a class="wa" href="https://wa.me/${PHONE}?text=${waText}" target="_blank" rel="nofollow">✆ Спросить в WhatsApp</a>
        <a class="opt" href="https://wa.me/${PHONE}?text=${waOpt}" target="_blank" rel="nofollow">Запросить оптовую цену</a>
      </div>
      <div class="pd-adv">
        <div class="a"><span class="e">🛡️</span><span><b>Гарантия</b><span>производителя на оборудование</span></span></div>
        <div class="a"><span class="e">🚚</span><span><b>Доставка по РК</b><span>во все города, самовывоз</span></span></div>
        <div class="a"><span class="e">🤝</span><span><b>Опт для монтажников</b><span>спеццены при заказе</span></span></div>
        <div class="a"><span class="e">📞</span><span><b>Консультация</b><span>подбор под объект бесплатно</span></span></div>
      </div>
    </div>
  </div>

  <div class="pd-tabs">
    <div class="pd-tabbar">
      <button class="on" data-tab="char">Характеристики</button>
      <button data-tab="desc">Описание</button>
      <button data-tab="delivery">Доставка и оплата</button>
    </div>
    <div class="pd-panel on" id="tab-char">${charTab}</div>
    <div class="pd-panel" id="tab-desc">${descTab}</div>
    <div class="pd-panel" id="tab-delivery"><p>Доставка по всему Казахстану транспортными компаниями, самовывоз со склада в Усть-Каменогорске (пр. Назарбаева 23). Оплата для организаций — по счёту, безнал с НДС. Для монтажников и оптовиков — специальные цены при заказе. Точные сроки и условия подскажет менеджер.</p></div>
  </div>

  ${relCards?`<div class="sec-h" style="display:flex;align-items:baseline;justify-content:space-between;margin:0 0 18px"><h2 style="font-size:22px;font-weight:800;letter-spacing:-.02em;margin:0">Похожие товары</h2><a href="${groupPageFor(p.group)}" style="font-size:13.5px;font-weight:600;color:var(--red)">Все в разделе →</a></div><div class="prodgrid" style="padding-bottom:44px">${relCards}</div>`:''}
</div>

${FOOTER}
${CART_HTML}
<script>window.PAGE_GROUP=${JSON.stringify(p.group||'')};window.PRODUCT=${JSON.stringify({sku:p.sku,b:p.brand||'',m:p.model||'',p:p.price||0,i:p.img||''})};window.CART_DATA=${JSON.stringify(cartData).replace(/</g,'\\u003c')};</script>
<script src="/js/product.js"></script>
</body></html>`;
}

module.exports = { renderProductPage };
