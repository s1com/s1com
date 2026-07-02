(function(){
'use strict';
var WA='77053541999';
var GROUP_PAGE={'Видеонаблюдение':'/videonablyudenie.html','Сетевое оборудование':'/setevoe.html','Источники бесперебойного питания (ИБП)':'/ibp.html','Пожарная безопасность':'/pozharnaya.html','СКУД и домофония':'/skud.html','Кабельные системы':'/kabelnye.html'};
var GROUP_ICON={'Видеонаблюдение':'🎥','Сетевое оборудование':'🔌','Источники бесперебойного питания (ИБП)':'🔋','Пожарная безопасность':'🔥','СКУД и домофония':'🔐','Кабельные системы':'🧰'};
var BRAND_DESC={
 'Dahua':'Dahua Technology — один из крупнейших мировых производителей систем видеонаблюдения и решений для безопасности.',
 'Hikvision':'Hikvision — мировой лидер в производстве оборудования для видеонаблюдения и систем безопасности.',
 'IMOU':'IMOU — бренд умных камер и решений для дома и малого бизнеса (входит в группу Dahua).',
 'HiLook':'HiLook — линейка доступного видеонаблюдения от Hikvision.',
 'Uniview':'Uniview (UNV) — производитель IP-видеонаблюдения, камер и видеорегистраторов.',
 'Ubiquiti':'Ubiquiti — производитель сетевого оборудования и Wi-Fi-решений (UniFi).',
 'Wi-Tek':'Wi-Tek — производитель сетевого и PoE-оборудования для видеонаблюдения.',
 'ZKTeco':'ZKTeco — производитель систем контроля доступа, биометрии и домофонии.',
 'Болид':'«Болид» — производитель систем пожарной сигнализации, ОПС и контроля доступа.',
 'TP-Link':'TP-Link — производитель сетевого оборудования и Wi-Fi.'
};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function money(n){return Number(n||0).toLocaleString('ru-RU')+' ₸';}
function imgUrl(u){u=String(u||'');if(!u)return '';return /^https?:\/\//i.test(u)?u:'/images/'+u;}
function $(id){return document.getElementById(id);}
function pageFor(g){return GROUP_PAGE[g]||'/';}
function iconFor(g){return GROUP_ICON[g]||'📦';}
function lsGet(k,d){try{return JSON.parse(localStorage.getItem(k))||d;}catch(e){return d;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}

var CART=lsGet('sc_cart',{}), FAV=lsGet('sc_fav',[]), CMP=lsGet('sc_cmp',[]);
var DATA={}, CATS=[], PRODUCTS=[], BRAND='', groupFilter='', sortBy='default';
function dataFor(sku){return DATA[sku]||{b:'',m:sku,p:0,i:''};}

// ---------- карточка ----------
function pcard(p){
  var sku=p.sku||String(p.id), href='/product/'+encodeURIComponent(sku);
  var iu=imgUrl(p.img);
  var img=iu?'<img src="'+esc(iu)+'" loading="lazy" alt="'+esc(p.brand+' '+p.model)+'" onerror="this.onerror=null;this.parentNode.innerHTML=\'<div class=&quot;noimg&quot;>📷</div>\'">':'<div class="noimg">📷</div>';
  var badge=p.inStock?'<span class="badge in">✓ В наличии</span>':'<span class="badge pre">Под заказ</span>';
  var specs=[];if(p.res)specs.push(p.res);if(p.type)specs.push(p.type);
  var sp=specs.length?'<div class="pb-spec">'+specs.slice(0,3).map(function(s){return '<span>'+esc(s)+'</span>';}).join('')+'</div>':'';
  var price=p.price>0?'<b>'+money(p.price)+'</b><small>РРЦ</small>':'<span class="req">Цена по запросу</span>';
  var inCart=!!CART[sku], fav=FAV.indexOf(sku)>=0?' on':'', cmp=CMP.indexOf(sku)>=0?' on':'';
  return '<div class="pcard" data-sku="'+esc(sku)+'"><a class="pimg" href="'+href+'">'+img+badge
    +'<span class="pacts"><button class="fav'+fav+'" data-act="fav">'+(fav?'♥':'♡')+'</button><button class="cmp'+cmp+'" data-act="cmp">⇄</button></span></a>'
    +'<div class="pbody"><div class="pb-brand">'+esc(p.brand||p.cat||'')+'</div><a class="pb-name" href="'+href+'">'+esc(p.model||'')+'</a>'
    +(p.sku?'<div class="pb-art">арт. '+esc(p.sku)+'</div>':'')+sp+'<div class="pb-price">'+price+'</div>'
    +'<div class="pcta"><button class="add'+(inCart?' in':'')+'" data-act="add">'+(inCart?'✓ В заявке':'+ В заявку')+'</button>'
    +'<a class="wa" href="https://wa.me/'+WA+'?text='+encodeURIComponent('Здравствуйте! Интересует: '+(p.brand?p.brand+' ':'')+(p.model||'')+' (арт. '+sku+'). Цена и наличие?')+'" target="_blank" rel="nofollow" title="WhatsApp">✆</a></div></div></div>';
}

// ---------- корзина ----------
function cartCount(){return Object.keys(CART).reduce(function(s,k){return s+CART[k];},0);}
function updateBadge(){var n=cartCount(),b=$('cartCount');if(b){b.textContent=n;b.style.display=n?'grid':'none';}}
function addToCart(sku){CART[sku]=(CART[sku]||0)+1;lsSet('sc_cart',CART);updateBadge();if(BRAND)renderCards();openCart();}
function setQty(sku,d){CART[sku]=(CART[sku]||0)+d;if(CART[sku]<=0)delete CART[sku];lsSet('sc_cart',CART);updateBadge();renderCart();if(BRAND)renderCards();}
function rmCart(sku){delete CART[sku];lsSet('sc_cart',CART);updateBadge();renderCart();if(BRAND)renderCards();}
function renderCart(){
  var keys=Object.keys(CART),body=$('cartBody');
  if(!keys.length){body.innerHTML='<div class="cart-empty">Заявка пуста.<br>Добавьте товары кнопкой «В заявку».</div>';$('cartFoot').style.display='none';return;}
  $('cartFoot').style.display='block';
  body.innerHTML=keys.map(function(sku){var d=dataFor(sku),iu=imgUrl(d.i);
    return '<div class="ci"><div class="cim">'+(iu?'<img src="'+esc(iu)+'" alt="">':'📷')+'</div><div style="flex:1"><div class="cn">'+esc((d.b?d.b+' ':'')+d.m)+'</div><div class="ca">арт. '+esc(sku)+'</div>'+(d.p>0?'<div class="cp">'+money(d.p)+'</div>':'<div class="cp" style="color:#6B7280">по запросу</div>')+'<div class="qty"><button data-q="-" data-sku="'+esc(sku)+'">−</button><b>'+CART[sku]+'</b><button data-q="+" data-sku="'+esc(sku)+'">+</button><button class="rm" data-rm="'+esc(sku)+'">удалить</button></div></div></div>';
  }).join('');
  Array.prototype.forEach.call(body.querySelectorAll('[data-q]'),function(b){b.addEventListener('click',function(){setQty(b.dataset.sku,b.dataset.q==='+'?1:-1);});});
  Array.prototype.forEach.call(body.querySelectorAll('[data-rm]'),function(b){b.addEventListener('click',function(){rmCart(b.dataset.rm);});});
}
function openCart(){renderCart();$('cartOv').classList.add('open');$('cart').classList.add('open');}
function closeCart(){$('cartOv').classList.remove('open');$('cart').classList.remove('open');}
function sendCart(){
  var keys=Object.keys(CART);if(!keys.length)return;
  var name=$('cName').value.trim(),phone=$('cPhone').value.trim(),comment=$('cComment').value.trim();
  if($('cConsent')&&!$('cConsent').checked){alert('Пожалуйста, подтвердите согласие на обработку персональных данных.');return;}
  if(!phone||phone.replace(/\D/g,'').length<7){alert('Укажите телефон — менеджер перезвонит с ценами и наличием.');$('cPhone').focus();return;}
  var items=keys.map(function(sku){return {sku:sku,qty:CART[sku]};});
  var btn=$('cSend');btn.disabled=true;btn.textContent='Отправляем…';
  fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items,name:name,phone:phone,comment:comment,page:location.pathname,ref:document.referrer,utm:location.search})})
    .then(function(r){return r.json();}).then(function(){
      var lines=['Здравствуйте! Прошу посчитать и сообщить наличие:'];keys.forEach(function(sku,i){var d=dataFor(sku);lines.push((i+1)+'. '+(d.b?d.b+' ':'')+d.m+' — '+CART[sku]+' шт');});
      if(name||phone)lines.push('',(name?'Имя: '+name:'')+(phone?'  Тел: '+phone:''));if(comment)lines.push('Комментарий: '+comment);lines.push('г. Усть-Каменогорск.');
      CART={};lsSet('sc_cart',CART);updateBadge();renderCart();if(BRAND)renderCards();btn.disabled=false;btn.textContent='Отправить заявку';
      if(confirm('Заявка отправлена! Менеджер перезвонит по номеру '+phone+'.\n\nПродублировать в WhatsApp сейчас?'))window.open('https://wa.me/'+WA+'?text='+encodeURIComponent(lines.join('\n')),'_blank');
      closeCart();
    }).catch(function(){btn.disabled=false;btn.textContent='Отправить заявку';alert('Не удалось отправить. Попробуйте ещё раз или напишите в WhatsApp.');});
}
function toggleList(arr,key,sku){var i=arr.indexOf(sku);if(i>=0)arr.splice(i,1);else arr.push(sku);lsSet(key,arr);}

// ---------- сетка брендов ----------
function renderGrid(list){
  document.title='Бренды — '+list.length+' производителей | Сервис.com';
  var html='<div class="crumbs"><a href="/">Главная</a> / <b>Бренды</b></div>'
    +'<div class="cat-head"><h1>Бренды</h1><span>'+list.length+' производителей</span></div>'
    +'<p style="max-width:720px;color:#6B7280;font-size:14px;margin:0 0 20px">Официальные бренды систем безопасности и сетевого оборудования. Выберите производителя, чтобы посмотреть товары и оптовые цены.</p>'
    +'<div class="brandgrid">'+list.map(function(b){return '<a class="btile" href="/brands.html?brand='+encodeURIComponent(b.brand)+'"><div class="bn">'+esc(b.brand)+'</div><div class="bc"><b>'+b.c+'</b> товаров</div></a>';}).join('')+'</div>';
  $('brandsContent').innerHTML=html;
}

// ---------- витрина бренда ----------
function renderBrandView(){
  var groups=[];PRODUCTS.forEach(function(p){if(p.group&&groups.indexOf(p.group)<0)groups.push(p.group);});
  var desc=BRAND_DESC[BRAND]?'<p class="brand-desc">'+esc(BRAND_DESC[BRAND])+'</p>':'';
  var chips='<a class="'+(groupFilter?'':'on')+'" data-g="">Все разделы</a>'+groups.map(function(g){return '<a class="'+(groupFilter===g?'on':'')+'" data-g="'+esc(g)+'">'+esc(g)+'</a>';}).join('');
  var html='<div class="crumbs"><a href="/">Главная</a> / <a href="/brands.html">Бренды</a> / <b>'+esc(BRAND)+'</b></div>'
    +'<div class="brand-top"><div class="brand-logo">'+esc(BRAND.charAt(0))+'</div><h1>'+esc(BRAND)+'</h1><span class="bcnt" id="bCnt"></span></div>'
    +desc
    +(groups.length>1?'<div class="gchips" id="gchips">'+chips+'</div>':'')
    +'<div class="bsort"><span class="cnt" id="bShown"></span><select id="bSort"><option value="default">По умолчанию</option><option value="stock">Сначала в наличии</option><option value="price_asc">Сначала дешёвые</option><option value="price_desc">Сначала дорогие</option><option value="name">По названию</option></select></div>'
    +'<div class="prodgrid" id="bGrid"></div>';
  $('brandsContent').innerHTML=html;
  var sel=$('bSort');if(sel)sel.addEventListener('change',function(){sortBy=sel.value;renderCards();});
  var gc=$('gchips');if(gc)Array.prototype.forEach.call(gc.querySelectorAll('[data-g]'),function(a){a.addEventListener('click',function(){groupFilter=a.dataset.g;renderBrandView();});});
  renderCards();
}
function renderCards(){
  var list=PRODUCTS.filter(function(p){return !groupFilter||p.group===groupFilter;});
  if(sortBy==='price_asc')list.sort(function(a,b){return (a.price||1e12)-(b.price||1e12);});
  else if(sortBy==='price_desc')list.sort(function(a,b){return (b.price||0)-(a.price||0);});
  else if(sortBy==='name')list.sort(function(a,b){return (a.model||'').localeCompare(b.model||'');});
  else if(sortBy==='stock')list.sort(function(a,b){return (b.inStock?1:0)-(a.inStock?1:0);});
  var g=$('bGrid');if(!g)return;
  g.innerHTML=list.length?list.map(pcard).join(''):'<div class="empty">Нет товаров в этом разделе.</div>';
  if($('bCnt'))$('bCnt').textContent=PRODUCTS.length+' товаров';
  if($('bShown'))$('bShown').textContent='Показано '+list.length;
  Array.prototype.forEach.call(g.querySelectorAll('.pcard'),function(card){var sku=card.dataset.sku;
    Array.prototype.forEach.call(card.querySelectorAll('[data-act]'),function(btn){btn.addEventListener('click',function(e){
      if(btn.dataset.act==='add'){addToCart(sku);}
      else{e.preventDefault();e.stopPropagation();toggleList(btn.dataset.act==='fav'?FAV:CMP,btn.dataset.act==='fav'?'sc_fav':'sc_cmp',sku);renderCards();}
    });});
  });
}

// ---------- мегаменю ----------
var cLevel=null;
function renderMega(){
  var inner=$('megaInner');if(!inner)return;
  var tiles=CATS.filter(function(g){return GROUP_PAGE[g.name];}).map(function(g){return '<div class="tile" data-g="'+esc(g.name)+'"><span class="ic">'+iconFor(g.name)+'</span><div class="tn">'+esc(g.name)+'</div></div>';}).join('');
  var l2='';
  if(cLevel){var g=CATS.find(function(x){return x.name===cLevel;});var nodes=(g&&g.nodes)||[];
    l2='<div class="cL2 on"><span class="back" id="cBack">‹ Все категории</span><div class="l2h"><span class="ic" style="width:40px;height:40px;font-size:20px">'+iconFor(cLevel)+'</span><h3>'+esc(cLevel)+'</h3></div><div class="chips">'+nodes.map(function(n){return '<a href="'+pageFor(cLevel)+'">'+esc(n.name)+'</a>';}).join('')+'<a href="'+pageFor(cLevel)+'" style="border-color:#14181F;font-weight:600">Все товары раздела →</a></div></div>';
  }
  inner.innerHTML='<div class="mpath"><b>Каталог</b> <span style="color:#c3c9d3">›</span> '+(cLevel?'<b>'+esc(cLevel)+'</b>':'выберите раздел')+'</div><div class="inner"><div class="tiles'+(cLevel?' hide':'')+'">'+tiles+'</div>'+l2+'</div>';
  if(!cLevel)Array.prototype.forEach.call(inner.querySelectorAll('[data-g]'),function(el){el.addEventListener('click',function(){cLevel=el.dataset.g;renderMega();});});
  else inner.querySelector('#cBack').addEventListener('click',function(){cLevel=null;renderMega();});
}

// ---------- init ----------
updateBadge();
$('cartOpen').addEventListener('click',openCart);
$('cartClose').addEventListener('click',closeCart);
$('cartOv').addEventListener('click',closeCart);
$('cSend').addEventListener('click',sendCart);
var cb=$('catBtn'),mega=$('mega');
cb.addEventListener('click',function(e){e.stopPropagation();var o=mega.classList.toggle('open');cb.setAttribute('aria-expanded',o?'true':'false');if(o)renderMega();});
document.addEventListener('click',function(e){if(!mega.contains(e.target)&&e.target!==cb&&!cb.contains(e.target)){mega.classList.remove('open');cb.setAttribute('aria-expanded','false');cLevel=null;}});
var hs=$('hsearch');if(hs)hs.addEventListener('submit',function(e){e.preventDefault();var q=$('q1').value.trim();if(q)location.href='/?q='+encodeURIComponent(q);});
fetch('/api/categories').then(function(r){return r.json();}).then(function(d){CATS=Array.isArray(d)?d:[];}).catch(function(){});

BRAND=decodeURIComponent((location.search.match(/[?&]brand=([^&]*)/)||[])[1]||'').trim();
if(BRAND){
  document.title=BRAND+' — купить оптом в Казахстане | Сервис.com';
  fetch('/api/products?brand='+encodeURIComponent(BRAND)+'&limit=5000').then(function(r){return r.json();}).then(function(list){
    PRODUCTS=Array.isArray(list)?list:[];DATA={};PRODUCTS.forEach(function(p){DATA[p.sku||p.id]={b:p.brand||'',m:p.model||'',p:p.price||0,i:p.img||''};});
    if(!PRODUCTS.length){$('brandsContent').innerHTML='<div class="crumbs"><a href="/">Главная</a> / <a href="/brands.html">Бренды</a> / <b>'+esc(BRAND)+'</b></div><div class="empty" style="margin-top:20px">По бренду «'+esc(BRAND)+'» товары не найдены. <a href="/brands.html" style="color:var(--red)">Все бренды</a></div>';return;}
    renderBrandView();
  }).catch(function(){$('brandsContent').innerHTML='<div class="empty">Не удалось загрузить. Обновите страницу.</div>';});
}else{
  fetch('/api/brands').then(function(r){return r.json();}).then(function(list){renderGrid(Array.isArray(list)?list:[]);}).catch(function(){$('brandsContent').innerHTML='<div class="empty">Не удалось загрузить бренды.</div>';});
}
})();
