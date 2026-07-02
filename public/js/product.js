(function(){
'use strict';
var WA='77053541999';
var GROUP_PAGE={'Видеонаблюдение':'/videonablyudenie.html','Сетевое оборудование':'/setevoe.html','Источники бесперебойного питания (ИБП)':'/ibp.html','Пожарная безопасность':'/pozharnaya.html','СКУД и домофония':'/skud.html','Кабельные системы':'/kabelnye.html'};
var GROUP_ICON={'Видеонаблюдение':'🎥','Сетевое оборудование':'🔌','Источники бесперебойного питания (ИБП)':'🔋','Пожарная безопасность':'🔥','СКУД и домофония':'🔐','Кабельные системы':'🧰'};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function money(n){return Number(n||0).toLocaleString('ru-RU')+' ₸';}
function imgUrl(u){u=String(u||'');if(!u)return '';return /^https?:\/\//i.test(u)?u:'/images/'+u;}
function $(id){return document.getElementById(id);}
function pageFor(g){return GROUP_PAGE[g]||'/';}
function iconFor(g){return GROUP_ICON[g]||'📦';}
function lsGet(k,d){try{return JSON.parse(localStorage.getItem(k))||d;}catch(e){return d;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}

var CART=lsGet('sc_cart',{});
var DATA=window.CART_DATA||{};
var PRODUCT=window.PRODUCT||null;
var CATS=[];
function dataFor(sku){return DATA[sku]||{b:'',m:sku,p:0,i:''};}

// ---------- корзина (тот же ключ, что и на разделах) ----------
function cartCount(){return Object.keys(CART).reduce(function(s,k){return s+CART[k];},0);}
function updateBadge(){var n=cartCount(),b=$('cartCount');if(b){b.textContent=n;b.style.display=n?'grid':'none';}}
function addToCart(sku){CART[sku]=(CART[sku]||0)+1;lsSet('sc_cart',CART);updateBadge();openCart();markAdded();}
function markAdded(){if(PRODUCT&&$('pdAdd')){var inc=!!CART[PRODUCT.sku];$('pdAdd').classList.toggle('in',inc);$('pdAdd').textContent=inc?'✓ В заявке ('+CART[PRODUCT.sku]+')':'+ В заявку';}}
function setQty(sku,d){CART[sku]=(CART[sku]||0)+d;if(CART[sku]<=0)delete CART[sku];lsSet('sc_cart',CART);updateBadge();renderCart();markAdded();}
function rmCart(sku){delete CART[sku];lsSet('sc_cart',CART);updateBadge();renderCart();markAdded();}
function renderCart(){
  var keys=Object.keys(CART),body=$('cartBody');
  if(!keys.length){body.innerHTML='<div class="cart-empty">Заявка пуста.<br>Добавьте товары кнопкой «В заявку».</div>';$('cartFoot').style.display='none';return;}
  $('cartFoot').style.display='block';
  body.innerHTML=keys.map(function(sku){
    var d=dataFor(sku),iu=imgUrl(d.i);
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
      CART={};lsSet('sc_cart',CART);updateBadge();renderCart();markAdded();btn.disabled=false;btn.textContent='Отправить заявку';
      if(confirm('Заявка отправлена! Менеджер перезвонит по номеру '+phone+'.\n\nПродублировать в WhatsApp сейчас?'))window.open('https://wa.me/'+WA+'?text='+encodeURIComponent(lines.join('\n')),'_blank');
      closeCart();
    }).catch(function(){btn.disabled=false;btn.textContent='Отправить заявку';alert('Не удалось отправить. Попробуйте ещё раз или напишите в WhatsApp.');});
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
updateBadge();markAdded();
// корзина
$('cartOpen').addEventListener('click',openCart);
$('cartClose').addEventListener('click',closeCart);
$('cartOv').addEventListener('click',closeCart);
$('cSend').addEventListener('click',sendCart);
if($('pdAdd')&&PRODUCT)$('pdAdd').addEventListener('click',function(){addToCart(PRODUCT.sku);});
// похожие: кнопки «в заявку»
Array.prototype.forEach.call(document.querySelectorAll('.pcard [data-act="add"]'),function(btn){btn.addEventListener('click',function(){var card=btn.closest('.pcard');if(card)addToCart(card.dataset.sku);});});
// вкладки
Array.prototype.forEach.call(document.querySelectorAll('.pd-tabbar button'),function(b){b.addEventListener('click',function(){
  Array.prototype.forEach.call(document.querySelectorAll('.pd-tabbar button'),function(x){x.classList.remove('on');});
  Array.prototype.forEach.call(document.querySelectorAll('.pd-panel'),function(x){x.classList.remove('on');});
  b.classList.add('on');var t=$('tab-'+b.dataset.tab);if(t)t.classList.add('on');
});});
// галерея
Array.prototype.forEach.call(document.querySelectorAll('.pd-thumb'),function(t){t.addEventListener('click',function(){
  var m=$('pdMain');if(m)m.src=t.dataset.src;
  Array.prototype.forEach.call(document.querySelectorAll('.pd-thumb'),function(x){x.classList.remove('on');});t.classList.add('on');
});});
// мегаменю
var cb=$('catBtn'),mega=$('mega');
cb.addEventListener('click',function(e){e.stopPropagation();var o=mega.classList.toggle('open');cb.setAttribute('aria-expanded',o?'true':'false');if(o)renderMega();});
document.addEventListener('click',function(e){if(!mega.contains(e.target)&&e.target!==cb&&!cb.contains(e.target)){mega.classList.remove('open');cb.setAttribute('aria-expanded','false');cLevel=null;}});
// поиск → на главную
var hs=$('hsearch');if(hs)hs.addEventListener('submit',function(e){e.preventDefault();var q=$('q1').value.trim();if(q)location.href='/?q='+encodeURIComponent(q);});
// категории для мегаменю
fetch('/api/categories').then(function(r){return r.json();}).then(function(d){CATS=Array.isArray(d)?d:[];}).catch(function(){});
})();
