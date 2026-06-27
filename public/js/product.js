// Корзина на странице товара (та же localStorage-корзина, что в каталоге)
const WA_NUMBER='77053541999';
function ymGoal(name){try{if(window.ym&&window.__YM_ID__&&window.__YM_ID__!=='__YM_ID__')ym(window.__YM_ID__,'reachGoal',name);}catch(e){}}
let CART={};
function loadCart(){try{CART=JSON.parse(localStorage.getItem('servis_cart')||'{}');}catch(e){CART={};}}
function saveCart(){try{localStorage.setItem('servis_cart',JSON.stringify(CART));}catch(e){}}
function cartCount(){return Object.values(CART).reduce((a,b)=>a+b,0);}
let PRODUCTS_CACHE=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(n){return n? Number(n).toLocaleString('ru-RU')+' \u20B8':'';}

function addProduct(){
  CART[PROD.id]=(CART[PROD.id]||0)+1;saveCart();updateCartUI();ymGoal('add_to_cart');
  const b=document.getElementById('addBtn');b.textContent='✓ Добавлено';b.classList.add('added');
  setTimeout(()=>{b.textContent='+ В заявку';b.classList.remove('added');},900);
}
function setQty(id,q){q=Math.max(0,q);if(q===0)delete CART[id];else CART[id]=q;saveCart();updateCartUI();}
function clearCart(){CART={};saveCart();updateCartUI();}

async function getProducts(){
  if(PRODUCTS_CACHE)return PRODUCTS_CACHE;
  try{PRODUCTS_CACHE=await (await fetch('/api/products')).json();}catch(e){PRODUCTS_CACHE=[];}
  return PRODUCTS_CACHE;
}
async function updateCartUI(){
  const c=cartCount(),badge=document.getElementById('cartCount');
  if(badge){badge.textContent=c;badge.style.display=c?'flex':'none';}
  const body=document.getElementById('cartBody');if(!body)return;
  const ids=Object.keys(CART);
  if(!ids.length){body.innerHTML='<div class="cart-empty">Заявка пуста.<br>Добавляйте товары кнопкой «+ В заявку».</div>';
    document.getElementById('cartSend').style.display='none';document.getElementById('cartClear').style.display='none';return;}
  const all=await getProducts();
  const find=id=>all.find(x=>String(x.id)===String(id))||(String(PROD.id)===String(id)?PROD:null);
  body.innerHTML=ids.map(id=>{const p=find(id);if(!p)return'';
    return '<div class="cart-row"><div class="cart-info"><b>'+esc((p.brand?p.brand+' ':'')+p.model)+'</b><span>'+esc(p.cat||'')+'</span></div>'+
      '<div class="cart-qty"><button onclick="setQty(\''+id+'\','+(CART[id]-1)+')">−</button>'+
      '<input type="number" min="0" value="'+CART[id]+'" onchange="setQty(\''+id+'\',parseInt(this.value)||0)">'+
      '<button onclick="setQty(\''+id+'\','+(CART[id]+1)+')">+</button></div>'+
      '<button class="cart-del" onclick="setQty(\''+id+'\',0)">×</button></div>';}).join('');
  document.getElementById('cartSend').style.display='block';document.getElementById('cartClear').style.display='block';
}
function openCart(){document.getElementById('cartPanel').classList.add('open');document.getElementById('cartOverlay').classList.add('open');}
function closeCart(){document.getElementById('cartPanel').classList.remove('open');document.getElementById('cartOverlay').classList.remove('open');}
async function sendCart(){const ids=Object.keys(CART);if(!ids.length)return;const all=await getProducts();
  const find=id=>all.find(x=>String(x.id)===String(id))||(String(PROD.id)===String(id)?PROD:null);
  const nameEl=document.getElementById('custName'),phoneEl=document.getElementById('custPhone');
  const cName=nameEl?nameEl.value.trim():'',cPhone=phoneEl?phoneEl.value.trim():'';
  const consentEl=document.getElementById('custConsent'); if(consentEl&&!consentEl.checked){alert('\u041F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430, \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0441\u043E\u0433\u043B\u0430\u0441\u0438\u0435 \u043D\u0430 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0443 \u043F\u0435\u0440\u0441\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0445 \u0434\u0430\u043D\u043D\u044B\u0445.');return;}
  if(!cPhone||cPhone.replace(/\D/g,'').length<7){alert('Укажите телефон — менеджер перезвонит вам с ценами и наличием.');if(phoneEl)phoneEl.focus();return;}
  let L=['Здравствуйте! Прошу посчитать и сообщить наличие:'];
  const payload=[];
  ids.forEach((id,i)=>{const p=find(id);if(p){L.push((i+1)+'. '+(p.brand?p.brand+' ':'')+p.model+' — '+CART[id]+' шт');payload.push({sku:p.sku||p.id,qty:CART[id]});}});
  if(cName||cPhone)L.push('',(cName?'Имя: '+cName:'')+(cPhone?'  Тел: '+cPhone:''));
  L.push('г. Усть-Каменогорск.');
  ymGoal('order_sent');
  try{fetch('/api/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:payload,name:cName,phone:cPhone})}).catch(()=>{});}catch(e){}
  if(confirm('Заявка отправлена! Менеджер перезвонит по номеру '+cPhone+'.\n\nПродублировать заявку в WhatsApp прямо сейчас?')){window.open('https://wa.me/'+WA_NUMBER+'?text='+encodeURIComponent(L.join('\n')),'_blank');}
  CART={};saveCart();updateCartUI();closeCart();}
loadCart();updateCartUI();
