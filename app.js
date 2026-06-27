// Каталог Сервис.com — фасетные фильтры, сортировка, корзина-заявка
const WA_NUMBER='77053541999';
function ymGoal(name){try{if(window.ym&&window.__YM_ID__&&window.__YM_ID__!=='__YM_ID__')ym(window.__YM_ID__,'reachGoal',name);}catch(e){}}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
let PRODUCTS=[], POOL=[];
let curGroup=window.PAGE_GROUP||'Все';
let F={brand:new Set(),type:new Set(),mp:new Set(),conn:new Set(),pmin:null,pmax:null,sort:'default',promoOnly:false};
let CART={};

function fmt(n){return n? n.toLocaleString('ru-RU')+' \u20B8':'';}
function plural(n,a,b,c){const m=n%10,d=n%100;return d>=11&&d<=14?c:m===1?a:m>=2&&m<=4?b:c;}

/* ---- CART ---- */
function loadCart(){try{CART=JSON.parse(localStorage.getItem('servis_cart')||'{}');}catch(e){CART={};}}
function saveCart(){try{localStorage.setItem('servis_cart',JSON.stringify(CART));}catch(e){}}
function cartCount(){return Object.values(CART).reduce((a,b)=>a+b,0);}
function addToCart(id){CART[id]=(CART[id]||0)+1;saveCart();updateCartUI();flashBtn(id);ymGoal('add_to_cart');}
function setQty(id,q){q=Math.max(0,q);if(q===0)delete CART[id];else CART[id]=q;saveCart();updateCartUI();}
function clearCart(){CART={};saveCart();updateCartUI();}
function flashBtn(id){const b=document.querySelector('[data-add="'+id+'"]');if(b){b.textContent='\u2713 \u0414\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u043E';b.classList.add('added');setTimeout(()=>{b.textContent='+ \u0412 \u0437\u0430\u044F\u0432\u043A\u0443';b.classList.remove('added');},900);}}
function updateCartUI(){
  const c=cartCount(),badge=document.getElementById('cartCount');
  if(badge){badge.textContent=c;badge.style.display=c?'flex':'none';}
  const body=document.getElementById('cartBody');if(!body)return;
  const ids=Object.keys(CART);
  if(!ids.length){body.innerHTML='<div class="cart-empty">\u0417\u0430\u044F\u0432\u043A\u0430 \u043F\u0443\u0441\u0442\u0430.<br>\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0439\u0442\u0435 \u0442\u043E\u0432\u0430\u0440\u044B \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \u00AB+ \u0412 \u0437\u0430\u044F\u0432\u043A\u0443\u00BB.</div>';
    document.getElementById('cartSend').style.display='none';document.getElementById('cartClear').style.display='none';return;}
  body.innerHTML=ids.map(id=>{const p=PRODUCTS.find(x=>String(x.id)===String(id));if(!p)return'';
    return '<div class="cart-row"><div class="cart-info"><b>'+(p.brand?p.brand+' ':'')+p.model+'</b><span>'+(p.cat||'')+'</span></div>'+
      '<div class="cart-qty"><button onclick="setQty(\''+id+'\','+(CART[id]-1)+')">\u2212</button>'+
      '<input type="number" min="0" value="'+CART[id]+'" onchange="setQty(\''+id+'\',parseInt(this.value)||0)">'+
      '<button onclick="setQty(\''+id+'\','+(CART[id]+1)+')">+</button></div>'+
      '<button class="cart-del" onclick="setQty(\''+id+'\',0)">\u00D7</button></div>';}).join('');
  document.getElementById('cartSend').style.display='block';document.getElementById('cartClear').style.display='block';
}
function openCart(){document.getElementById('cartPanel').classList.add('open');document.getElementById('cartOverlay').classList.add('open');}
function closeCart(){document.getElementById('cartPanel').classList.remove('open');document.getElementById('cartOverlay').classList.remove('open');}
function sendCart(){const ids=Object.keys(CART);if(!ids.length)return;
  const nameEl=document.getElementById('custName'),phoneEl=document.getElementById('custPhone');
  const cName=nameEl?nameEl.value.trim():'',cPhone=phoneEl?phoneEl.value.trim():'';
  const consentEl=document.getElementById('custConsent'); if(consentEl&&!consentEl.checked){alert('\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0441\u043E\u0433\u043B\u0430\u0441\u0438\u0435 \u043D\u0430 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0443 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0445 \u0434\u0430\u043D\u043D\u044B\u0445.');return;}
  if(!cPhone||cPhone.replace(/\D/g,'').length<7){alert('Укажите телефон — менеджер перезвонит вам с ценами и наличием.');if(phoneEl)phoneEl.focus();return;}
  let lines=['Здравствуйте! Прошу посчитать и сообщить наличие:'];
  const payload=[];
  ids.forEach((id,i)=>{const p=PRODUCTS.find(x=>String(x.id)===String(id));if(p){lines.push((i+1)+'. '+(p.brand?p.brand+' ':'')+p.model+' — '+CART[id]+' шт');payload.push({sku:p.sku||p.id,qty:CART[id]});}});
  if(cName||cPhone)lines.push('',(cName?'Имя: '+cName:'')+(cPhone?'  Тел: '+cPhone:''));
  lines.push('г. Усть-Каменогорск.');
  const wa='https://wa.me/'+WA_NUMBER+'?text='+encodeURIComponent(lines.join('\n'));
  ymGoal('order_sent');
  try{fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:payload,name:cName,phone:cPhone})}).catch(()=>{});}catch(e){}
  if(confirm('Заявка отправлена! Менеджер перезвонит по номеру '+cPhone+'.\n\nПродублировать заявку в WhatsApp прямо сейчас?')){window.open(wa,'_blank');}
  CART={};saveCart();updateCartUI();closeCart();}

/* ---- FILTERS ---- */
function facetCounts(field){ // counts within current pool ignoring this field's own selection
  const c={};POOL.forEach(p=>{
    const vals=Array.isArray(p[field])?p[field]:[p[field]];
    vals.forEach(v=>{if(v)c[v]=(c[v]||0)+1;});});return c;}
function buildFacet(title,field,values){
  const counts=facetCounts(field);
  const opts=values.filter(v=>counts[v]).map(v=>
    '<label class="opt"><input type="checkbox" '+(F[field].has(v)?'checked':'')+' onchange="toggleF(\''+field+'\',\''+v+'\')"> '+v+'<span class="n">'+counts[v]+'</span></label>').join('');
  if(!opts)return'';
  return '<div class="facet"><h3 onclick="this.parentNode.classList.toggle(\'collapsed\')">'+title+'</h3><div class="opts">'+opts+'</div></div>';
}
function toggleF(field,v){F[field].has(v)?F[field].delete(v):F[field].add(v);render();renderActiveTags();}
function renderSidebar(){
  const brands=[...new Set(POOL.map(p=>p.brand).filter(Boolean))].sort();
  const types=[...new Set(POOL.map(p=>p.type).filter(t=>t&&t!=='\u041F\u0440\u043E\u0447\u0435\u0435'))].sort();
  const mps=['2 \u041C\u041F','3 \u041C\u041F','4 \u041C\u041F','5 \u041C\u041F','6 \u041C\u041F','8 \u041C\u041F'];
  const conns=['PoE','Wi-Fi'];
  let h='';
  h+=buildFacet('\u0411\u0440\u0435\u043D\u0434','brand',brands);
  h+=buildFacet('\u0422\u0438\u043F','type',types);
  h+=buildFacet('\u0420\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435','mp',mps);
  h+=buildFacet('\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435','conn',conns);
  h+='<div class="facet"><h3 onclick="this.parentNode.classList.toggle(\'collapsed\')">\u0426\u0435\u043D\u0430, \u20B8</h3><div class="opts"><div class="price-row">'+
     '<input type="number" id="pmin" placeholder="\u043E\u0442" oninput="F.pmin=this.value?+this.value:null;render()">'+
     '<input type="number" id="pmax" placeholder="\u0434\u043E" oninput="F.pmax=this.value?+this.value:null;render()"></div></div></div>';
  h+='<div class="sidebtns"><button class="btn-clear" onclick="clearFilters()">\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u0444\u0438\u043B\u044C\u0442\u0440\u044B</button></div>';
  document.getElementById('facets').innerHTML=h;
}
function clearFilters(){F={brand:new Set(),type:new Set(),mp:new Set(),conn:new Set(),pmin:null,pmax:null,sort:F.sort};
  document.getElementById('search').value='';renderSidebar();render();renderActiveTags();}
function renderActiveTags(){
  const box=document.getElementById('activeTags');if(!box)return;
  let tags=[];['brand','type','mp','conn'].forEach(f=>F[f].forEach(v=>tags.push('<span class="atag" onclick="toggleF(\''+f+'\',\''+v+'\')">'+v+'</span>')));
  box.innerHTML=tags.join('');
}
function applyFilters(){
  const q=(document.getElementById('search').value||'').trim().toLowerCase();
  let list=POOL.filter(p=>{
    if(F.promoOnly&&!p.promo)return false;
    if(F.brand.size&&!F.brand.has(p.brand))return false;
    if(F.type.size&&!F.type.has(p.type))return false;
    if(F.mp.size&&!F.mp.has(p.mp))return false;
    if(F.conn.size&&![...F.conn].every(c=>p.conn.includes(c)))return false;
    if(F.pmin&&(!p.price||p.price<F.pmin))return false;
    if(F.pmax&&(!p.price||p.price>F.pmax))return false;
    if(q){const hay=(p.model+' '+p.desc+' '+p.cat+' '+p.brand+' '+p.res).toLowerCase();if(!q.split(' ').every(w=>hay.includes(w)))return false;}
    return true;});
  const s=F.sort;
  if(s==='price-asc')list.sort((a,b)=>(a.price||1e12)-(b.price||1e12));
  else if(s==='price-desc')list.sort((a,b)=>(b.price||0)-(a.price||0));
  else if(s==='name')list.sort((a,b)=>(a.brand+a.model).localeCompare(b.brand+b.model));
  else if(s==='photo')list.sort((a,b)=>(b.img?1:0)-(a.img?1:0));
  return list;
}
function imgURL(s){return /^https?:\/\//i.test(s)?s:'images/'+s;}
function imgFail(el){if(el&&el.parentNode)el.parentNode.innerHTML='<div class="noimg">\uD83D\uDCF7<br>\u0444\u043E\u0442\u043E<br>\u043F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443</div>';}
function cardHTML(it){
  const badge=it.promo?'<span class="fire-badge">\uD83D\uDD25 \u0410\u041A\u0426\u0418\u042F</span>':'';
  const img=(it.img?'<img src="'+imgURL(it.img)+'" loading="lazy" onerror="imgFail(this)" alt="'+esc(it.brand+' '+it.model)+'">':'<div class="noimg">\uD83D\uDCF7<br>\u0444\u043E\u0442\u043E<br>\u043F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443</div>');
  let price;
  if(it.price){
    const old=(it.promo&&it.oldprice)?'<span class="old">'+fmt(it.oldprice)+'</span>':'';
    price='<div class="price">'+old+fmt(it.price)+' <small>\u0420\u0420\u0426</small></div><div class="stock">\u041E\u043F\u0442 \u2014 \u043F\u0440\u0438 \u0437\u0430\u043A\u0430\u0437\u0435</div>';
  } else price='<div class="ondemand">\u0446\u0435\u043D\u0430 \u043F\u043E \u0437\u0430\u043F\u0440\u043E\u0441\u0443</div>';
  return '<div class="card"><a class="imgbox" href="/product/'+encodeURIComponent(it.sku||it.id)+'">'+badge+img+'</a><div class="cbody">'+
    '<div class="brand">'+esc(it.brand||it.cat)+'</div><div class="cmodel">'+esc(it.model)+'</div>'+
    '<div class="cdesc">'+(it.res?esc(it.res)+'. ':'')+esc(it.desc)+'</div><div class="cprice">'+price+'</div>'+
    '<button class="addbtn" data-add="'+esc(it.id)+'" onclick="addToCart(\''+encodeURIComponent(it.id).replace(/'/g,"%27")+'\')">+ \u0412 \u0437\u0430\u044F\u0432\u043A\u0443</button></div></div>';
}

function renderPromoStrip(){
  const box=document.getElementById('promoStrip');if(!box)return;
  const promos=POOL.filter(p=>p.promo);
  if(!promos.length){box.style.display='none';return;}
  box.style.display='block';
  box.innerHTML='<div class="promo-head"><span class="fire">\uD83D\uDD25</span><h2>\u0413\u043E\u0440\u044F\u0447\u0438\u0435 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F</h2><span class="sub">\u0421\u043F\u0435\u0446\u0446\u0435\u043D\u044B \u2014 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u043D\u043E\u0435 \u043A\u043E\u043B\u0438\u0447\u0435\u0441\u0442\u0432\u043E</span></div>'+
    '<div class="promo-scroll">'+promos.map(it=>{
      const img=it.img?'<img src="'+imgURL(it.img)+'" loading="lazy" decoding="async" onerror="imgFail(this)">':'<div class="ni">\uD83D\uDCF7</div>';
      const old=it.oldprice?'<span class="old">'+fmt(it.oldprice)+'</span>':'';
      return '<div class="promo-card"><div class="pi"><span class="fire-badge">\uD83D\uDD25</span>'+img+'</div>'+
        '<div class="pc2"><div class="pb">'+(it.brand||'')+'</div><div class="pm">'+it.model+'</div>'+
        '<div class="pp">'+old+'<span class="new">'+fmt(it.price)+'</span></div>'+
        '<button class="pab" data-add="'+it.id+'" onclick="addToCart(\''+it.id+'\')">+ \u0412 \u0437\u0430\u044F\u0432\u043A\u0443</button></div></div>';
    }).join('')+'</div>';
}

const BATCH=48; let _list=[], _shown=0;
function render(){
  _list=applyFilters();
  document.getElementById('count').textContent=_list.length+' '+plural(_list.length,'\u043F\u043E\u0437\u0438\u0446\u0438\u044F','\u043F\u043E\u0437\u0438\u0446\u0438\u0438','\u043F\u043E\u0437\u0438\u0446\u0438\u0439');
  const grid=document.getElementById('grid');
  _shown=0;
  if(!_list.length){
    grid.innerHTML='<div class="empty">\u041F\u043E \u0432\u0430\u0448\u0435\u043C\u0443 \u0437\u0430\u043F\u0440\u043E\u0441\u0443 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0448\u043B\u043E\u0441\u044C. \u0421\u0431\u0440\u043E\u0441\u044C\u0442\u0435 \u0444\u0438\u043B\u044C\u0442\u0440\u044B \u0438\u043B\u0438 \u043F\u043E\u0438\u0449\u0438\u0442\u0435 \u043F\u043E \u0430\u0440\u0442\u0438\u043A\u0443\u043B\u0443.</div>';
    updateMoreBtn();return;
  }
  grid.innerHTML='';
  renderMore();
}
function renderMore(){
  const grid=document.getElementById('grid');
  const next=_list.slice(_shown,_shown+BATCH);
  grid.insertAdjacentHTML('beforeend', next.map(cardHTML).join(''));
  _shown+=next.length;
  updateMoreBtn();
}
function updateMoreBtn(){
  let btn=document.getElementById('moreBtn');
  const left=_list.length-_shown;
  if(left>0){
    if(!btn){
      btn=document.createElement('button');btn.id='moreBtn';btn.className='more-btn';btn.onclick=renderMore;
      const grid=document.getElementById('grid'); grid.parentNode.insertBefore(btn, grid.nextSibling);
    }
    btn.textContent='\u041F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0435\u0449\u0451 ('+left+')';
    btn.style.display='block';
  } else if(btn){ btn.style.display='none'; }
}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('sbOverlay').classList.toggle('open');}

// Переключение направления (категории) на главной — фильтрация на месте
let CATTREE=[], curSub='';
function selectGroup(g){
  curGroup=g; curSub='';
  POOL=(g==='Все')?PRODUCTS:PRODUCTS.filter(p=>p.group===g);
  F.brand.clear&&F.brand.clear(); F.type&&F.type.clear&&F.type.clear(); F.mp&&F.mp.clear&&F.mp.clear(); F.conn&&F.conn.clear&&F.conn.clear();
  document.querySelectorAll('#dirChips .chip').forEach(c=>c.classList.toggle('active', c.dataset.g===g));
  buildSubChips(g);
  renderSidebar();renderPromoStrip();render();renderActiveTags();
  window.scrollTo({top:document.querySelector('.toolbar')?.offsetTop-10||0,behavior:'smooth'});
}
// Подкатегории выбранного раздела (фильтр по полю товара cat)
function selectSub(sub){
  curSub=sub;
  POOL=PRODUCTS.filter(p=>p.group===curGroup && (sub===''||p.cat===sub));
  document.querySelectorAll('#subChips .chip').forEach(c=>c.classList.toggle('active', c.dataset.s===sub));
  renderSidebar();render();renderActiveTags();
}
function buildSubChips(g){
  const box=document.getElementById('subChips'); if(!box) return;
  const node=CATTREE.find(t=>t.name===g);
  const subs=(node&&node.subcategories)?node.subcategories:[];
  if(g==='Все'||!subs.length){box.innerHTML='';box.style.display='none';return;}
  box.style.display='flex';
  let html='<a class="subchip active" data-s="" onclick="selectSub(\'\')">Все в разделе</a>';
  subs.forEach(s=>{ html+='<a class="subchip" data-s="'+esc(s)+'" onclick="selectSub(\''+s.replace(/'/g,"\\'")+'\')">'+esc(s)+'</a>'; });
  box.innerHTML=html;
}
// Построение чипов направлений из дерева видимых категорий (управляются в админке)
function buildCategoryChips(){
  const box=document.getElementById('dirChips'); if(!box) return;
  fetch('/api/categories').then(r=>r.json()).then(tree=>{
    CATTREE=Array.isArray(tree)?tree:[];
    // показываем ВСЕ включённые в админке верхние категории
    let html='<a class="chip catalog-btn" onclick="openCatalog()">📂 Все категории</a>';
    html+='<a class="chip active" data-g="Все" onclick="selectGroup(\'Все\')">Все товары</a>';
    CATTREE.forEach(t=>{ html+='<a class="chip" data-g="'+esc(t.name)+'" onclick="selectGroup(\''+t.name.replace(/'/g,"\\'")+'\')">'+esc(t.name)+'</a>'; });
    box.innerHTML=html;
  }).catch(()=>{});
}
// Вкладка «Все категории» — полное дерево, выбор любой категории/подкатегории
function buildCatalogOverlay(){
  if(document.getElementById('catalogOverlay')) return;
  const ov=document.createElement('div');
  ov.id='catalogOverlay'; ov.className='catalog-overlay';
  ov.onclick=e=>{ if(e.target===ov) closeCatalog(); };
  document.body.appendChild(ov);
}
function openCatalog(){
  buildCatalogOverlay();
  const ov=document.getElementById('catalogOverlay');
  let html='<div class="catalog-panel"><div class="catalog-head"><h2>Все категории</h2><button onclick="closeCatalog()" class="catalog-x">×</button></div><div class="catalog-grid">';
  if(!CATTREE.length){ html+='<p style="color:#888">Категории загружаются…</p>'; }
  CATTREE.forEach(t=>{
    const nm=t.name.replace(/'/g,"\\'");
    html+='<div class="catalog-col"><a class="catalog-top" onclick="pickCat(\''+nm+'\',\'\')">'+esc(t.name)+'</a>';
    (t.subcategories||[]).forEach(s=>{ html+='<a class="catalog-sub" onclick="pickCat(\''+nm+'\',\''+s.replace(/'/g,"\\'")+'\')">'+esc(s)+'</a>'; });
    html+='</div>';
  });
  html+='</div></div>';
  ov.innerHTML=html; ov.classList.add('open');
}
function closeCatalog(){ const ov=document.getElementById('catalogOverlay'); if(ov)ov.classList.remove('open'); }
function pickCat(top,sub){ closeCatalog(); selectGroup(top); if(sub) setTimeout(()=>selectSub(sub),50); }

loadCart();
// индикатор загрузки каталога
(function(){ const g=document.getElementById('grid'); if(g) g.innerHTML='<div class="loading">Загрузка каталога…</div>'; })();
function loadCatalog(){
  fetch('/api/products').then(r=>{ if(!r.ok) throw new Error('http '+r.status); return r.json(); }).then(d=>{
    PRODUCTS=d;
    POOL=curGroup==='\u0412\u0441\u0435'?d:d.filter(p=>p.group===curGroup);
    renderSidebar();renderPromoStrip();render();updateCartUI();renderActiveTags();
    if(window.PAGE_GROUP==='\u0412\u0441\u0435'||!window.PAGE_GROUP) buildCategoryChips();
    const s=document.getElementById('search'); if(s&&!s.dataset.bound){ s.dataset.bound='1'; let _st; const dr=()=>{clearTimeout(_st);_st=setTimeout(render,180);}; s.addEventListener('input',dr); }
    const so=document.getElementById('sortsel'); if(so&&!so.dataset.bound){ so.dataset.bound='1'; so.addEventListener('change',e=>{F.sort=e.target.value;render();}); }
  }).catch(()=>{
    const g=document.getElementById('grid');
    if(g) g.innerHTML='<div class="empty">Не удалось загрузить каталог. Проверьте соединение и обновите страницу.<br><button class="more-btn" style="margin-top:14px" onclick="loadCatalog()">Повторить</button></div>';
  });
}
loadCatalog();
// кнопка «Наверх»
(function(){
  const btn=document.createElement('button'); btn.id='toTop'; btn.className='to-top'; btn.title='Наверх'; btn.innerHTML='↑';
  btn.onclick=()=>window.scrollTo({top:0,behavior:'smooth'}); document.body.appendChild(btn);
  window.addEventListener('scroll',()=>{ btn.style.display = window.scrollY>500 ? 'flex' : 'none'; });
})();
