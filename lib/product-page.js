// Server-side рендер страницы товара (SEO: свой URL, Product schema, OG)
const SITE_URL = process.env.SITE_URL || 'https://servis-com.kz';
const PHONE = '+77053541999';

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(n){return n? Number(n).toLocaleString('ru-RU')+' \u20B8':'';}
// Безопасная сериализация JSON для вставки в <script>: экранируем <,>,& и разделители строк,
// чтобы данные товара не могли разорвать тег </script> (защита от XSS в JSON-LD/инлайн-данных)
function jsonForHtml(obj){
  return JSON.stringify(obj)
    .replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026')
    .replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
}

const NAV=[["/","Все товары"],["/videonablyudenie.html","Видеонаблюдение"],["/setevoe.html","Сетевое"],["/pozharnaya.html","Пожарная безопасность"],["/skud.html","СКУД"]];
const GROUP_PAGE={'Видеонаблюдение':'/videonablyudenie.html','Сетевое оборудование':'/setevoe.html','Пожарная безопасность':'/pozharnaya.html','СКУД и домофония':'/skud.html'};

function header(){
  const nav=NAV.map(([u,t])=>`<a href="${u}">${t}</a>`).join('');
  return `<header><div class="htop">
    <a class="logo" href="/"><img src="/images/logo.png" alt="Сервис.com"></a>
    <nav class="nav">${nav}</nav>
    <div class="contacts"><div class="ph"><a href="tel:${PHONE}">+7 705 354 1999</a></div>
    <div class="addr">Усть-Каменогорск, пр. Назарбаева 23</div></div>
    <button class="cartbtn" onclick="openCart()">🧾 <span class="lbl">Заявка</span> <span id="cartCount">0</span></button>
  </div></header>`;
}
const CART_HTML=`<div class="cart-overlay" id="cartOverlay" onclick="closeCart()"></div>
<aside class="cart-panel" id="cartPanel">
  <div class="cart-head"><h2>Заявка на просчёт</h2><button class="cart-close" onclick="closeCart()">×</button></div>
  <div class="cart-body" id="cartBody"></div>
  <div class="cart-foot"><div class="cart-fields"><input id="custName" placeholder="Ваше имя" maxlength="100" autocomplete="name"><input id="custPhone" placeholder="Телефон для связи" maxlength="50" autocomplete="tel" inputmode="tel"></div><div class="cart-note">Оставьте имя и телефон — менеджер посчитает и перезвонит.</div><label class="cart-consent"><input type="checkbox" id="custConsent"> Я согласен на обработку <a href="/privacy.html" target="_blank">персональных данных</a></label>
  <button id="cartSend" onclick="sendCart()">Отправить заявку в WhatsApp</button>
  <button id="cartClear" onclick="clearCart()">Очистить заявку</button></div>
</aside>
<a class="floatwa" href="https://wa.me/77053541999" target="_blank" rel="nofollow" title="WhatsApp">✆</a>`;

const FOOTER=`<footer><div class="wrap frow">
  <div><b>Сервис.com</b><br>Оборудование для систем безопасности<br>г. Усть-Каменогорск, пр. Назарбаева 23</div>
  <div style="text-align:right"><div class="ph"><a href="tel:${PHONE}">+7 705 354 1999</a></div>
  <div class="ph"><a href="tel:+77777995542">+7 777 799 5542</a></div></div>
</div></footer>`;

function renderProductPage(p, related){
  // заголовок = полное название; бренд не дублируем, если он уже есть в названии
  const ttl = (p.brand && String(p.model||'').toLowerCase().includes(String(p.brand).toLowerCase())) ? String(p.model||'') : `${p.brand?p.brand+' ':''}${p.model||''}`;
  const title=`${esc(ttl)} — купить в Усть-Каменогорске | Сервис.com`;
  const descr=`${esc(ttl)}. ${esc(p.res?p.res+'. ':'')}${esc((p.desc||'').slice(0,140))} Оптовые цены, доставка по Казахстану.`;
  const url=`${SITE_URL}/product/${encodeURIComponent(p.sku)}`;
  const img=p.img && !p.img.startsWith('http')?`${SITE_URL}/images/${p.img}`:(p.img||`${SITE_URL}/images/logo.png`);
  const imgTag=p.img?`<img src="${p.img.startsWith('http')?p.img:'/images/'+esc(p.img)}" alt="${esc(p.brand+' '+p.model)}">`:`<div class="noimg">📷 фото по запросу</div>`;
  // галерея: несколько фото из Al-Style (поле images), с запасным вариантом — одиночное img
  const imgSrc=u=>/^https?:\/\//i.test(u)?u:'/images/'+esc(u);
  let gallery=[]; try{gallery=JSON.parse(p.images||'[]');}catch(e){}
  if(!Array.isArray(gallery)) gallery=[];
  gallery=gallery.filter(Boolean);
  if(!gallery.length && p.img) gallery=[p.img];
  const galleryHtml = gallery.length
    ? `<div class="pd-gallery"><div class="pd-img"><img id="pdMainImg" src="${imgSrc(gallery[0])}" alt="${esc(p.brand+' '+p.model)}" onerror="this.onerror=null;this.src='/images/logo.png'"></div>`
      + (gallery.length>1 ? `<div class="pd-thumbs">`+gallery.slice(0,12).map((u,i)=>`<button type="button" class="pd-thumb${i===0?' active':''}" onclick="pdSwap(this,'${imgSrc(u).replace(/'/g,"\\'")}')"><img src="${imgSrc(u)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/images/logo.png'"></button>`).join('')+`</div>` : '')
      + `</div>`
    : `<div class="pd-img"><div class="noimg">📷 фото по запросу</div></div>`;
  const groupPage=GROUP_PAGE[p.group]||'/';

  // JSON-LD Product (rich snippets)
  const ld={"@context":"https://schema.org/","@type":"Product","name":ttl,
    "description":(p.desc||'').slice(0,300),"sku":p.sku,"mpn":p.model||p.sku,"brand":{"@type":"Brand","name":p.brand||'Сервис.com'},
    "category":p.group, "image":img};
  if(p.price) ld.offers={"@type":"Offer","price":p.price,"priceCurrency":"KZT","itemCondition":"https://schema.org/NewCondition","availability":p.inStock?"https://schema.org/InStock":"https://schema.org/PreOrder","priceValidUntil":new Date(Date.now()+365*864e5).toISOString().slice(0,10),"url":url,"seller":{"@type":"Organization","name":"Сервис.com"}};
  const ldBread={"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
    {"@type":"ListItem","position":1,"name":"Главная","item":SITE_URL+"/"},
    {"@type":"ListItem","position":2,"name":p.group||'Каталог',"item":SITE_URL+groupPage},
    {"@type":"ListItem","position":3,"name":ttl,"item":url}]};

  const specs=[['Бренд',p.brand],['Направление',p.group],['Тип',p.type],['Разрешение',p.mp],['Подключение',(p.conn||[]).join(', ')]]
    .filter(([k,v])=>v).map(([k,v])=>`<tr><td class="sk">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');

  // Описание/характеристики: Al-Style отдаёт характеристики сплошным текстом через запятую.
  // Если это похоже на перечень характеристик — выводим списком; иначе абзацем.
  let descBlock='';
  if(p.desc){
    const parts=String(p.desc).split(/[;\n•·]|,(?![^()]*\))/).map(s=>s.trim().replace(/\s+/g,' ')).filter(s=>s.length>=2);
    const b=(p.brand||'').toLowerCase(), m=(p.model||'').toLowerCase();
    const items=[]; const seen=new Set();
    for(const s of parts){ const l=s.toLowerCase(); if(l===b||l===m||seen.has(l)) continue; seen.add(l); items.push(s); }
    const isSpecs = items.length>=4 && (items.join('').length/items.length)<=46;
    descBlock = isSpecs
      ? `<div class="pd-desc"><h2>Характеристики</h2><ul class="pd-charlist">${items.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div>`
      : `<div class="pd-desc"><h2>Описание</h2><p>${esc(p.desc)}</p></div>`;
  }

  const priceBlock = p.price
    ? `<div class="pd-price">${p.promo&&p.oldprice?`<span class="old">${fmt(p.oldprice)}</span> `:''}${fmt(p.price)} <small>РРЦ</small></div>
       <div class="pd-stock">${p.inStock?'✓ В наличии'+(p.stock?': '+p.stock+' шт':''):'Под заказ'} · опт — при заказе</div>`
    : `<div class="pd-ondemand">Цена по запросу</div>`;

  const rel = (related||[]).slice(0,4).map(r=>{
    const ri=r.img?`<img src="${r.img.startsWith('http')?r.img:'/images/'+esc(r.img)}" alt="${esc(r.model)}">`:`<div class="noimg">📷</div>`;
    return `<a class="rel-card" href="/product/${encodeURIComponent(r.sku)}"><div class="rel-img">${ri}</div>
      <div class="rel-b">${esc(r.brand||'')}</div><div class="rel-m">${esc(r.model)}</div>
      <div class="rel-p">${r.price?fmt(r.price):'по запросу'}</div></a>`;
  }).join('');

  return `<!DOCTYPE html><html lang="ru"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<!--SEO_VERIFY-->
<title>${title}</title>
<meta name="description" content="${descr}">
<link rel="canonical" href="${url}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${descr}">
<meta property="og:type" content="product"><meta property="og:image" content="${img}"><meta property="og:url" content="${url}">
${p.price?`<meta property="product:price:amount" content="${p.price}"><meta property="product:price:currency" content="KZT">`:''}
<link rel="stylesheet" href="/css/style.css">
<script type="application/ld+json">${jsonForHtml(ld)}</script>
<script type="application/ld+json">${jsonForHtml(ldBread)}</script>
<script>window.__YM_ID__="__YM_ID__";</script>
<!-- Yandex.Metrika -->
<script type="text/javascript">
(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
if(window.__YM_ID__&&window.__YM_ID__!=="__YM_ID__"){ym(window.__YM_ID__,"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});}
</script>
<!-- /Yandex.Metrika -->
<style>
.pd-wrap{max-width:1000px;margin:0 auto;padding:18px 16px 50px}
.crumbs{font-size:13px;color:var(--grey);margin:14px 0}
.crumbs a{color:var(--grey);text-decoration:none}.crumbs a:hover{color:var(--red)}
.pd{display:grid;grid-template-columns:minmax(0,420px) 1fr;gap:28px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:24px}
.pd-img{display:flex;align-items:center;justify-content:center;background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px;min-height:300px}
.pd-img img{max-width:100%;max-height:380px;object-fit:contain}
.pd-img .noimg{color:#c5c5c5}
.pd-info h1{font-size:23px;font-weight:800;line-height:1.25}
.pd-brand{font-size:12px;font-weight:800;text-transform:uppercase;color:var(--red);letter-spacing:.5px}
.pd-price{font-size:30px;font-weight:800;margin-top:16px}.pd-price small{font-size:13px;color:var(--grey);font-weight:600}
.pd-price .old{font-size:18px;color:#aaa;text-decoration:line-through;font-weight:600}
.pd-ondemand{font-size:20px;color:var(--grey);font-style:italic;margin-top:16px}
.pd-stock{font-size:13px;color:#1a9e4b;font-weight:600;margin-top:4px}
.pd-actions{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
.pd-add{background:var(--red);color:#fff;border:none;font-weight:700;padding:14px 26px;border-radius:11px;font-size:15px;cursor:pointer}
.pd-add.added{background:#1a9e4b}
.pd-call{background:#fff;border:1.5px solid var(--line);padding:14px 22px;border-radius:11px;font-weight:700;text-decoration:none;font-size:15px}
.pd-specs{margin-top:24px;width:100%;border-collapse:collapse;font-size:14px}
.pd-specs td{padding:9px 10px;border-bottom:1px solid var(--line)}.pd-specs .sk{color:var(--grey);width:180px}
.pd-desc{margin-top:18px;background:#fff;border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.pd-desc h2{font-size:17px;margin-bottom:8px}.pd-desc p{font-size:14px;color:#444;line-height:1.7}
.pd-charlist{margin:0;padding:0;list-style:none;columns:2;column-gap:28px}
.pd-charlist li{font-size:14px;color:#333;padding:6px 0;border-bottom:1px solid var(--line);break-inside:avoid;line-height:1.45}
.pd-charlist li::before{content:"— ";color:var(--grey)}
@media(max-width:720px){.pd-charlist{columns:1}}
.rel{margin-top:26px}.rel h2{font-size:18px;margin-bottom:12px}
.rel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px}
.rel-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;text-decoration:none;display:flex;flex-direction:column}
.rel-card:hover{box-shadow:0 6px 18px rgba(0,0,0,.08)}
.rel-img{height:120px;display:flex;align-items:center;justify-content:center;margin-bottom:8px}.rel-img img{max-width:100%;max-height:100%;object-fit:contain}
.rel-b{font-size:10px;font-weight:800;color:var(--red);text-transform:uppercase}.rel-m{font-size:13px;font-weight:700}.rel-p{font-size:14px;font-weight:800;margin-top:4px}
.pd-gallery{display:flex;flex-direction:column;gap:10px}
.pd-thumbs{display:flex;gap:8px;flex-wrap:wrap}
.pd-thumb{width:64px;height:64px;border:1.5px solid var(--line);border-radius:9px;background:#fff;padding:4px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.pd-thumb.active{border-color:#e8101b}
.pd-thumb img{max-width:100%;max-height:100%;object-fit:contain}
@media(max-width:720px){.pd{grid-template-columns:1fr;padding:16px}.pd-img{min-height:220px}.pd-info h1{font-size:19px}.pd-price{font-size:24px}}
</style>
</head><body>
${header()}
<div class="pd-wrap">
  <div class="crumbs"><a href="/">Главная</a> › <a href="${groupPage}">${esc(p.group||'Каталог')}</a> › ${esc(p.model)}</div>
  <div class="pd">
    ${galleryHtml}
    <div class="pd-info">
      <div class="pd-brand">${esc(p.brand||p.cat||'')}</div>
      <h1>${esc(ttl)}</h1>
      ${priceBlock}
      <div class="pd-actions">
        <button class="pd-add" id="addBtn" onclick="addProduct()">+ В заявку</button>
        <a class="pd-call" href="tel:${PHONE}">Позвонить</a>
      </div>
      <table class="pd-specs">${specs}</table>
    </div>
  </div>
  ${descBlock}
  ${rel?`<div class="rel"><h2>Похожие товары</h2><div class="rel-grid">${rel}</div></div>`:''}
</div>
${FOOTER}
${CART_HTML}
<script>
const PROD=${jsonForHtml({id:p.id,sku:p.sku,brand:p.brand,model:p.model,cat:p.cat})};
function pdSwap(btn,src){var m=document.getElementById('pdMainImg');if(m)m.src=src;document.querySelectorAll('.pd-thumb').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');}
</script>
<script src="/js/product.js"></script>
</body></html>`;
}

module.exports={renderProductPage};
