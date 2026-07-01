(function(){
'use strict';
var WA='77053541999', PER=24;
var GROUP=window.PAGE_GROUP||'';
var GROUP_PAGE={'Видеонаблюдение':'/videonablyudenie.html','Сетевое оборудование':'/setevoe.html','Источники бесперебойного питания (ИБП)':'/ibp.html','Пожарная безопасность':'/pozharnaya.html','СКУД и домофония':'/skud.html','Кабельные системы':'/kabelnye.html'};
var GROUP_ICON={'Видеонаблюдение':'🎥','Сетевое оборудование':'🔌','Источники бесперебойного питания (ИБП)':'🔋','Пожарная безопасность':'🔥','СКУД и домофония':'🔐','Кабельные системы':'🧰'};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function money(n){return Number(n||0).toLocaleString('ru-RU')+' ₸';}
function imgUrl(p){if(!p.img)return '';return /^https?:\/\//i.test(p.img)?p.img:'/images/'+p.img;}
function $(id){return document.getElementById(id);}
function pageFor(g){return GROUP_PAGE[g]||'/';}
function iconFor(g){return GROUP_ICON[g]||'📦';}
function lsGet(k,def){try{return JSON.parse(localStorage.getItem(k))||def;}catch(e){return def;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}

var PRODUCTS=[], CATS=[];
var F={brand:{},type:{},res:{},inStock:false,pmin:0,pmax:0,sub:''};
var sortBy='default', shown=PER;
var CART=lsGet('sc_cart',{}), FAV=lsGet('sc_fav',[]), CMP=lsGet('sc_cmp',[]);

// ---------- фильтрация ----------
function match(p,except){
  if(except!=='sub'&&F.sub&&p.cat!==F.sub)return false;
  if(except!=='brand'){var b=Object.keys(F.brand).filter(function(k){return F.brand[k];});if(b.length&&b.indexOf(p.brand)<0)return false;}
  if(except!=='type'){var t=Object.keys(F.type).filter(function(k){return F.type[k];});if(t.length&&t.indexOf(p.type)<0)return false;}
  if(except!=='res'){var r=Object.keys(F.res).filter(function(k){return F.res[k];});if(r.length&&r.indexOf(p.res)<0)return false;}
  if(except!=='price'){if(F.pmin&&(!p.price||p.price<F.pmin))return false;if(F.pmax&&p.price>F.pmax)return false;}
  if(except!=='stock'&&F.inStock&&!p.inStock)return false;
  return true;
}
function counts(key,field){
  var m={};PRODUCTS.forEach(function(p){if(!match(p,key))return;var v=p[field];if(!v)return;m[v]=(m[v]||0)+1;});
  return Object.keys(m).sort(function(a,b){return m[b]-m[a]||a.localeCompare(b);}).map(function(k){return [k,m[k]];});
}
function subCounts(){var m={};PRODUCTS.forEach(function(p){if(!match(p,'sub'))return;if(!p.cat)return;m[p.cat]=(m[p.cat]||0)+1;});return Object.keys(m).sort(function(a,b){return m[b]-m[a];}).map(function(k){return [k,m[k]];});}
function display(){
  var list=PRODUCTS.filter(function(p){return match(p,null);});
  if(sortBy==='price_asc')list.sort(function(a,b){return (a.price||1e12)-(b.price||1e12);});
  else if(sortBy==='price_desc')list.sort(function(a,b){return (b.price||0)-(a.price||0);});
  else if(sortBy==='name')list.sort(function(a,b){return (a.brand+a.model).localeCompare(b.brand+b.model);});
  else if(sortBy==='stock')list.sort(function(a,b){return (b.inStock?1:0)-(a.inStock?1:0);});
  else if(sortBy==='new')list.sort(function(a,b){return (b.id||0)-(a.id||0);});
  return list;
}

// ---------- карточка ----------
function pcard(p){
  var href='/product/'+encodeURIComponent(p.sku||p.id);
  var iu=imgUrl(p);
  var img=iu?'<img src="'+esc(iu)+'" loading="lazy" alt="'+esc(p.brand+' '+p.model)+'" onerror="this.onerror=null;this.parentNode.innerHTML=\'<div class=&quot;noimg&quot;>📷</div>\'">':'<div class="noimg">📷</div>';
  var badge=p.inStock?'<span class="badge in">✓ В наличии</span>':'<span class="badge pre">Под заказ</span>';
  var specs=[];if(p.res)specs.push(p.res);if(p.type)specs.push(p.type);
  var sp=specs.length?'<div class="pb-spec">'+specs.slice(0,3).map(function(s){return '<span>'+esc(s)+'</span>';}).join('')+'</div>':'';
  var price=p.price>0?'<b>'+money(p.price)+'</b><small>РРЦ</small>':'<span class="req">Цена по запросу</span>';
  var sku=p.sku||String(p.id);
  var inCart=!!CART[sku];
  var fav=FAV.indexOf(sku)>=0?' on':'', cmp=CMP.indexOf(sku)>=0?' on':'';
  return '<div class="pcard" data-sku="'+esc(sku)+'">'
    +'<a class="pimg" href="'+href+'">'+img+badge
    +'<span class="pacts"><button class="fav'+fav+'" data-act="fav" title="В избранное">'+(fav?'♥':'♡')+'</button><button class="cmp'+cmp+'" data-act="cmp" title="Сравнить">⇄</button></span></a>'
    +'<div class="pbody"><div class="pb-brand">'+esc(p.brand||p.cat||'')+'</div>'
    +'<a class="pb-name" href="'+href+'">'+esc(p.model||'')+'</a>'
    +(p.sku?'<div class="pb-art">арт. '+esc(p.sku)+'</div>':'')+sp
    +'<div class="pb-price">'+price+'</div>'
    +'<div class="pcta"><button class="add'+(inCart?' in':'')+'" data-act="add">'+(inCart?'✓ В заявке':'+ В заявку')+'</button>'
    +'<a class="wa" href="https://wa.me/'+WA+'?text='+encodeURIComponent('Здравствуйте! Интересует: '+(p.brand?p.brand+' ':'')+(p.model||'')+' (арт. '+sku+'). Цена и наличие?')+'" target="_blank" rel="nofollow" title="WhatsApp">✆</a></div>'
    +'</div></div>';
}

// ---------- рендер фильтров ----------
function optHtml(list,setName){
  return list.map(function(o){var checked=F[setName][o[0]]?' checked':'';return '<label class="fopt"><input type="checkbox"'+checked+' data-set="'+setName+'" data-val="'+esc(o[0])+'"><span class="nm">'+esc(o[0])+'</span><span class="c">'+o[1]+'</span></label>';}).join('');
}
function renderFilters(){
  var brands=counts('brand','brand'), types=counts('type','type'), rez=counts('res','res');
  var html='<div class="fhead"><b>Фильтры</b><a id="fReset">Сбросить</a></div>';
  if(brands.length){html+='<div class="fgroup"><h4>Бренд <span class="x">▾</span></h4><div class="fbody"><input class="fsearch" id="brandSearch" placeholder="Поиск бренда…"><div class="foptwrap" id="brandOpts">'+optHtml(brands,'brand')+'</div></div></div>';}
  if(types.length>1){html+='<div class="fgroup"><h4>Тип <span class="x">▾</span></h4><div class="fbody"><div class="foptwrap">'+optHtml(types,'type')+'</div></div></div>';}
  if(rez.length>1){html+='<div class="fgroup"><h4>Разрешение <span class="x">▾</span></h4><div class="fbody"><div class="foptwrap">'+optHtml(rez,'res')+'</div></div></div>';}
  html+='<div class="fgroup"><h4>Цена, ₸ <span class="x">▾</span></h4><div class="fbody"><div class="price-row"><input id="pmin" inputmode="numeric" placeholder="от" value="'+(F.pmin||'')+'"><input id="pmax" inputmode="numeric" placeholder="до" value="'+(F.pmax||'')+'"></div></div></div>';
  html+='<div class="fgroup"><label class="fopt" style="font-weight:600"><input type="checkbox" id="fStock"'+(F.inStock?' checked':'')+'>Только в наличии</label></div>';
  $('filters').innerHTML=html;
  // события
  Array.prototype.forEach.call($('filters').querySelectorAll('input[data-set]'),function(cb){cb.addEventListener('change',function(){F[cb.dataset.set][cb.dataset.val]=cb.checked;shown=PER;renderFilters();renderList();});});
  Array.prototype.forEach.call($('filters').querySelectorAll('.fgroup h4'),function(h){h.addEventListener('click',function(){h.parentNode.classList.toggle('closed');});});
  var bs=$('brandSearch');if(bs)bs.addEventListener('input',function(){var q=bs.value.toLowerCase();$('brandOpts').innerHTML=optHtml(counts('brand','brand').filter(function(o){return o[0].toLowerCase().indexOf(q)>=0;}),'brand');bindOpts();});
  var pm=$('pmin'),px=$('pmax');
  if(pm)pm.addEventListener('change',function(){F.pmin=+pm.value.replace(/\D/g,'')||0;shown=PER;renderList();});
  if(px)px.addEventListener('change',function(){F.pmax=+px.value.replace(/\D/g,'')||0;shown=PER;renderList();});
  var st=$('fStock');if(st)st.addEventListener('change',function(){F.inStock=st.checked;shown=PER;renderFilters();renderList();});
  $('fReset').addEventListener('click',function(){F={brand:{},type:{},res:{},inStock:false,pmin:0,pmax:0,sub:F.sub};shown=PER;renderFilters();renderSubs();renderList();});
}
function bindOpts(){Array.prototype.forEach.call($('brandOpts').querySelectorAll('input[data-set]'),function(cb){cb.addEventListener('change',function(){F.brand[cb.dataset.val]=cb.checked;shown=PER;renderFilters();renderList();});});}

// ---------- подкатегории ----------
function renderSubs(){
  var subs=subCounts();
  var html='<a class="'+(F.sub?'':'on')+'" data-sub="">Все '+esc(GROUP.replace(/\s*\(.*\)/,'').toLowerCase())+'</a>';
  html+=subs.slice(0,10).map(function(s){return '<a class="'+(F.sub===s[0]?'on':'')+'" data-sub="'+esc(s[0])+'">'+esc(s[0])+' <span style="color:#aaa">'+s[1]+'</span></a>';}).join('');
  $('subchips').innerHTML=html;
  Array.prototype.forEach.call($('subchips').querySelectorAll('[data-sub]'),function(a){a.addEventListener('click',function(){F.sub=a.dataset.sub;shown=PER;renderSubs();renderFilters();renderList();});});
}

// ---------- список ----------
function renderList(){
  var list=display();
  $('catCount').textContent=list.length+' '+plural(list.length,'товар','товара','товаров');
  var slice=list.slice(0,shown);
  $('grid').innerHTML=slice.length?slice.map(pcard).join(''):'<div class="empty">По выбранным фильтрам ничего не найдено. <a onclick="document.getElementById(\'fReset\').click()" style="color:var(--red);cursor:pointer">Сбросить фильтры</a></div>';
  $('shownInfo').textContent='Показано '+slice.length+' из '+list.length;
  $('moreBtn').style.display=list.length>shown?'block':'none';
  bindCards();
}
function plural(n,a,b,c){var x=n%100;if(x>=11&&x<=14)return c;x=n%10;return x===1?a:(x>=2&&x<=4?b:c);}
function bindCards(){
  Array.prototype.forEach.call($('grid').querySelectorAll('.pcard'),function(card){
    var sku=card.dataset.sku;
    Array.prototype.forEach.call(card.querySelectorAll('[data-act]'),function(btn){
      btn.addEventListener('click',function(e){
        if(btn.dataset.act==='fav'||btn.dataset.act==='cmp'){e.preventDefault();e.stopPropagation();toggleList(btn.dataset.act==='fav'?FAV:CMP,btn.dataset.act==='fav'?'sc_fav':'sc_cmp',sku);renderList();}
        else if(btn.dataset.act==='add'){addToCart(sku);}
      });
    });
  });
}
function toggleList(arr,key,sku){var i=arr.indexOf(sku);if(i>=0)arr.splice(i,1);else arr.push(sku);lsSet(key,arr);}

// ---------- корзина ----------
function findP(sku){return PRODUCTS.find(function(p){return (p.sku||String(p.id))===sku;});}
function cartCount(){return Object.keys(CART).reduce(function(s,k){return s+CART[k];},0);}
function updateCartBadge(){var n=cartCount(),b=$('cartCount');if(b){b.textContent=n;b.style.display=n?'grid':'none';}}
function addToCart(sku){CART[sku]=(CART[sku]||0)+1;lsSet('sc_cart',CART);updateCartBadge();renderList();openCart();}
function setQty(sku,d){CART[sku]=(CART[sku]||0)+d;if(CART[sku]<=0)delete CART[sku];lsSet('sc_cart',CART);updateCartBadge();renderCart();renderList();}
function rmCart(sku){delete CART[sku];lsSet('sc_cart',CART);updateCartBadge();renderCart();renderList();}
function renderCart(){
  var keys=Object.keys(CART);var body=$('cartBody');
  if(!keys.length){body.innerHTML='<div class="cart-empty">Заявка пуста.<br>Добавьте товары кнопкой «В заявку».</div>';$('cartFoot').style.display='none';return;}
  $('cartFoot').style.display='block';
  body.innerHTML=keys.map(function(sku){
    var p=findP(sku)||{model:sku,brand:''};var iu=imgUrl(p);
    return '<div class="ci"><div class="cim">'+(iu?'<img src="'+esc(iu)+'" alt="">':'📷')+'</div><div style="flex:1"><div class="cn">'+esc((p.brand?p.brand+' ':'')+p.model)+'</div><div class="ca">арт. '+esc(sku)+'</div>'+(p.price>0?'<div class="cp">'+money(p.price)+'</div>':'<div class="cp" style="color:#6B7280">по запросу</div>')+'<div class="qty"><button data-q="-" data-sku="'+esc(sku)+'">−</button><b>'+CART[sku]+'</b><button data-q="+" data-sku="'+esc(sku)+'">+</button><button class="rm" data-rm="'+esc(sku)+'">удалить</button></div></div></div>';
  }).join('');
  Array.prototype.forEach.call(body.querySelectorAll('[data-q]'),function(b){b.addEventListener('click',function(){setQty(b.dataset.sku,b.dataset.q==='+'?1:-1);});});
  Array.prototype.forEach.call(body.querySelectorAll('[data-rm]'),function(b){b.addEventListener('click',function(){rmCart(b.dataset.rm);});});
}
function openCart(){renderCart();$('cartOv').classList.add('open');$('cart').classList.add('open');}
function closeCart(){$('cartOv').classList.remove('open');$('cart').classList.remove('open');}
function sendCart(){
  var keys=Object.keys(CART);if(!keys.length)return;
  var name=$('cName').value.trim(), phone=$('cPhone').value.trim(), comment=$('cComment').value.trim();
  if($('cConsent')&&!$('cConsent').checked){alert('Пожалуйста, подтвердите согласие на обработку персональных данных.');return;}
  if(!phone||phone.replace(/\D/g,'').length<7){alert('Укажите телефон — менеджер перезвонит с ценами и наличием.');$('cPhone').focus();return;}
  var items=keys.map(function(sku){return {sku:sku,qty:CART[sku]};});
  var btn=$('cSend');btn.disabled=true;btn.textContent='Отправляем…';
  fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:items,name:name,phone:phone,comment:comment,page:location.pathname,ref:document.referrer,utm:location.search})})
    .then(function(r){return r.json();}).then(function(){
      var lines=['Здравствуйте! Прошу посчитать и сообщить наличие:'];keys.forEach(function(sku,i){var p=findP(sku)||{model:sku,brand:''};lines.push((i+1)+'. '+(p.brand?p.brand+' ':'')+p.model+' — '+CART[sku]+' шт');});
      if(name||phone)lines.push('',(name?'Имя: '+name:'')+(phone?'  Тел: '+phone:''));if(comment)lines.push('Комментарий: '+comment);lines.push('г. Усть-Каменогорск.');
      CART={};lsSet('sc_cart',CART);updateCartBadge();renderCart();renderList();btn.disabled=false;btn.textContent='Отправить заявку';
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
function bindStatic(){
  var cb=$('catBtn'),mega=$('mega');
  cb.addEventListener('click',function(e){e.stopPropagation();var o=mega.classList.toggle('open');cb.setAttribute('aria-expanded',o?'true':'false');if(o)renderMega();});
  document.addEventListener('click',function(e){if(!mega.contains(e.target)&&e.target!==cb&&!cb.contains(e.target)){mega.classList.remove('open');cb.setAttribute('aria-expanded','false');cLevel=null;}});
  $('cartOpen').addEventListener('click',openCart);
  $('cartClose').addEventListener('click',closeCart);
  $('cartOv').addEventListener('click',closeCart);
  $('cSend').addEventListener('click',sendCart);
  $('moreBtn').addEventListener('click',function(){shown+=PER;renderList();});
  $('sortSel').addEventListener('change',function(){sortBy=$('sortSel').value;renderList();});
  $('filtBtn').addEventListener('click',function(){$('filters').classList.toggle('open');});
  var hs=$('hsearch');if(hs)hs.addEventListener('submit',function(e){e.preventDefault();var q=$('q1').value.trim();if(q)location.href='/?q='+encodeURIComponent(q);});
}
updateCartBadge();
bindStatic();
Promise.all([
  fetch('/api/products?group='+encodeURIComponent(GROUP)+'&limit=5000').then(function(r){return r.json();}).catch(function(){return [];}),
  fetch('/api/categories').then(function(r){return r.json();}).catch(function(){return [];})
]).then(function(res){
  PRODUCTS=Array.isArray(res[0])?res[0]:[];
  CATS=Array.isArray(res[1])?res[1]:[];
  renderSubs();renderFilters();renderList();
});
})();
