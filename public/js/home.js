(function(){
'use strict';
var WA='77053541999';
var GROUP_PAGE={
 'Видеонаблюдение':'/videonablyudenie.html',
 'Сетевое оборудование':'/setevoe.html',
 'Источники бесперебойного питания (ИБП)':'/ibp.html',
 'Пожарная безопасность':'/pozharnaya.html',
 'СКУД и домофония':'/skud.html',
 'Кабельные системы':'/kabelnye.html'
};
var GROUP_ICON={
 'Видеонаблюдение':'🎥','Сетевое оборудование':'🔌','Источники бесперебойного питания (ИБП)':'🔋',
 'Пожарная безопасность':'🔥','СКУД и домофония':'🔐','Кабельные системы':'🧰'
};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function pageFor(g){return GROUP_PAGE[g]||'/';}
function iconFor(g){return GROUP_ICON[g]||'📦';}
function money(n){return Number(n||0).toLocaleString('ru-RU')+' ₸';}
function imgUrl(p){if(!p.img)return '';return /^https?:\/\//i.test(p.img)?p.img:'/images/'+p.img;}
function $(id){return document.getElementById(id);}

var STATE={groups:{},cats:[]};

// ---- product card ----
function pcard(p){
  var href='/product/'+encodeURIComponent(p.sku||p.id);
  var iu=imgUrl(p);
  var img=iu?'<img src="'+esc(iu)+'" loading="lazy" alt="'+esc((p.brand||'')+' '+(p.model||''))+'" onerror="this.onerror=null;this.parentNode.innerHTML=\'<div class=&quot;noimg&quot;>📷</div>\'">':'<div class="noimg">📷</div>';
  var badge=p.inStock?'<span class="badge in">✓ В наличии'+(p.stock?': '+p.stock+' шт':'')+'</span>':'<span class="badge pre">Под заказ</span>';
  var specs=[];if(p.res)specs.push(p.res);if(p.type)specs.push(p.type);
  var specHtml=specs.length?'<div class="pb-spec">'+specs.slice(0,3).map(function(s){return '<span>'+esc(s)+'</span>';}).join('')+'</div>':'';
  var price=p.price>0?'<b>'+money(p.price)+'</b><small>РРЦ</small>':'<span class="req">Цена по запросу</span>';
  var wa='https://wa.me/'+WA+'?text='+encodeURIComponent('Здравствуйте! Интересует: '+(p.brand?p.brand+' ':'')+(p.model||'')+' (арт. '+(p.sku||'')+'). Подскажите цену и наличие.');
  return '<div class="pcard">'
    +'<a class="pimg" href="'+href+'">'+img+badge+'</a>'
    +'<div class="pbody">'
    +'<div class="pb-brand">'+esc(p.brand||p.cat||'')+'</div>'
    +'<a class="pb-name" href="'+href+'">'+esc(p.model||'')+'</a>'
    +(p.sku?'<div class="pb-art">арт. '+esc(p.sku)+'</div>':'')
    +specHtml
    +'<div class="pb-price">'+price+'</div>'
    +'<div class="pcta"><a class="add" href="'+href+'">Подробнее</a><a class="wa" href="'+wa+'" target="_blank" rel="nofollow" title="Спросить в WhatsApp">✆</a></div>'
    +'</div></div>';
}

// ---- segments ----
function renderSegs(){
  var segs=[
   ['🏠','Для дома','Камеры, домофоны, готовые комплекты','/videonablyudenie.html'],
   ['🏢','Для бизнеса','Офис, магазин, склад под ключ','/videonablyudenie.html'],
   ['🏗','Для объекта','Проекты, монтаж, проектирование','https://wa.me/'+WA],
   ['📦','Оптовикам','Цены для монтажных организаций','https://wa.me/'+WA]
  ];
  $('segs').innerHTML=segs.map(function(s){
    var ext=s[3].indexOf('http')===0?' target="_blank" rel="nofollow"':'';
    return '<a class="seg-card" href="'+s[3]+'"'+ext+'><div class="e">'+s[0]+'</div><h3>'+s[1]+'</h3><p>'+s[2]+'</p></a>';
  }).join('');
}

// ---- home data ----
function renderHome(d){
  STATE.groups=d.groups||{};
  // категории-карточки (по группам из дерева, со счётчиками)
  var order=STATE.cats.length?STATE.cats.map(function(g){return g.name;}):Object.keys(STATE.groups);
  var cards=order.filter(function(g){return GROUP_PAGE[g];}).map(function(g){
    var c=STATE.groups[g]||0;
    return '<a class="catcard" href="'+pageFor(g)+'"><span class="ic">'+iconFor(g)+'</span><div class="nm">'+esc(g)+'</div><div class="ct"><b>'+c+'</b> товаров</div></a>';
  }).join('');
  $('homeCats').innerHTML=cards||'<p style="color:#9aa2ae">Категории загружаются…</p>';
  $('homeHits').innerHTML=(d.hits||[]).map(pcard).join('')||'<p style="color:#9aa2ae">—</p>';
  $('homeNew').innerHTML=(d.newest||[]).map(pcard).join('')||'<p style="color:#9aa2ae">—</p>';
  var br=d.brands||[];
  $('homeBrands').innerHTML=br.length?br.map(function(b){return '<a class="brand" href="/videonablyudenie.html">'+esc(b.brand)+'</a>';}).join(''):'';
}

// ---- mega menu (вариант C: плитки → подкатегории) ----
var cLevel=null;
function renderMega(){
  var inner=$('megaInner');
  var tiles=STATE.cats.filter(function(g){return GROUP_PAGE[g.name];}).map(function(g){
    var c=STATE.groups[g.name]||0;
    return '<div class="tile" data-g="'+esc(g.name)+'"><span class="ic">'+iconFor(g.name)+'</span><div class="tn">'+esc(g.name)+'</div><div class="tc"><b>'+c+'</b> товаров</div></div>';
  }).join('');
  var l2='';
  if(cLevel){
    var g=STATE.cats.find(function(x){return x.name===cLevel;});
    var nodes=(g&&g.nodes)||[];
    var chips=nodes.map(function(n){return '<a href="'+pageFor(cLevel)+'">'+esc(n.name)+'</a>';}).join('');
    l2='<div class="cL2 on"><span class="back" id="cBack">‹ Все категории</span>'
      +'<div class="l2h"><span class="ic" style="width:40px;height:40px;font-size:20px">'+iconFor(cLevel)+'</span><h3>'+esc(cLevel)+'</h3><span style="color:#6B7280;font-size:13px">'+(STATE.groups[cLevel]||0)+' товаров</span></div>'
      +'<div class="chips">'+chips+'<a href="'+pageFor(cLevel)+'" style="border-color:#14181F;font-weight:600">Все товары раздела →</a></div></div>';
  }
  var path=cLevel?'<b>'+esc(cLevel)+'</b>':'выберите раздел';
  inner.innerHTML='<div class="mpath"><b>Каталог</b> <span style="color:#c3c9d3">›</span> '+path+'<span style="margin-left:auto;color:#9aa2ae">путь: 2–3 клика</span></div>'
    +'<div class="inner"><div class="tiles'+(cLevel?' hide':'')+'">'+tiles+'</div>'+l2+'</div>';
  if(!cLevel){
    Array.prototype.forEach.call(inner.querySelectorAll('[data-g]'),function(el){el.addEventListener('click',function(){cLevel=el.dataset.g;renderMega();});});
  }else{
    inner.querySelector('#cBack').addEventListener('click',function(){cLevel=null;renderMega();});
  }
}
var mega=$('mega'),catBtn=$('catBtn');
function openMega(){mega.classList.add('open');catBtn.setAttribute('aria-expanded','true');renderMega();}
function closeMega(){mega.classList.remove('open');catBtn.setAttribute('aria-expanded','false');cLevel=null;}
catBtn.addEventListener('click',function(e){e.stopPropagation();mega.classList.contains('open')?closeMega():openMega();});
document.addEventListener('click',function(e){if(!mega.contains(e.target)&&e.target!==catBtn&&!catBtn.contains(e.target))closeMega();});
window.openCat=function(){openMega();return false;};

// ---- поиск ----
function doSearch(q){
  q=(q||'').trim();if(!q)return;
  $('q1').value=q;$('q2').value=q;
  $('sTitle').textContent='Поиск: «'+q+'»';
  $('searchResults').innerHTML='<p style="color:#9aa2ae">Ищем…</p>';
  $('searchWrap').classList.add('on');$('landing').style.display='none';
  window.scrollTo({top:0,behavior:'smooth'});
  fetch('/api/products?q='+encodeURIComponent(q)+'&limit=48').then(function(r){return r.json();}).then(function(list){
    $('sTitle').textContent='Поиск: «'+q+'» — '+list.length+(list.length%10===1&&list.length%100!==11?' товар':' товаров');
    $('searchResults').innerHTML=list.length?list.map(pcard).join(''):'<p style="color:#6B7280;padding:8px">Ничего не нашли. Попробуйте другой запрос или напишите в <a href="https://wa.me/'+WA+'" target="_blank" style="color:var(--red)">WhatsApp</a> — подберём.</p>';
  }).catch(function(){$('searchResults').innerHTML='<p style="color:#6B7280">Не удалось выполнить поиск. Обновите страницу.</p>';});
}
window.doSearch=doSearch;
window.clearSearch=function(){$('searchWrap').classList.remove('on');$('landing').style.display='';$('q1').value='';$('q2').value='';};
$('hsearch').addEventListener('submit',function(e){e.preventDefault();doSearch($('q1').value);});
$('hsearch2').addEventListener('submit',function(e){e.preventDefault();doSearch($('q2').value);});

// ---- init ----
renderSegs();
Promise.all([
  fetch('/api/categories').then(function(r){return r.json();}).catch(function(){return [];}),
  fetch('/api/home').then(function(r){return r.json();}).catch(function(){return {};})
]).then(function(res){
  STATE.cats=Array.isArray(res[0])?res[0]:[];
  renderHome(res[1]||{});
});
})();
