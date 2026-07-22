// Интеграционные тесты API. Запуск: npm test
// Поднимает сервер на тестовом порту, прогоняет проверки, выходит с кодом 0/1.
process.env.PORT=process.env.PORT||'3099';
process.env.NODE_ENV='development';
process.env.ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'test-pass';
process.env.JWT_SECRET=process.env.JWT_SECRET||'test-secret';
process.env.IMPORT_TOKEN=process.env.IMPORT_TOKEN||'test-token';
process.env.BACKUP_DISABLE='1';
// Домен для sitemap/robots/canonical берётся отсюда. Задаём явно и заведомо «не дефолтный»,
// чтобы тест ловил именно чтение SITE_URL, а не совпадение с хардкодом в коде.
process.env.SITE_URL=process.env.SITE_URL||'https://test.example.kz';
// изоляция: свежая временная БД на каждый прогон (иначе повторный запуск конфликтует по created/…)
const _os=require('os'), _fs=require('fs'), _path=require('path');
process.env.DB_PATH=process.env.DB_PATH||_path.join(_os.tmpdir(),'s1com-test.sqlite');
['','-wal','-shm'].forEach(x=>{try{_fs.unlinkSync(process.env.DB_PATH+x)}catch(e){}});
require('../server.js');
const http=require('http');
const PORT=process.env.PORT;
function rq(path,data,token,method){return new Promise(res=>{
  const body=(data!==undefined&&data!==null)?JSON.stringify(data):null;
  const o={host:'localhost',port:PORT,path,method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json'}};
  if(token)o.headers.Authorization='Bearer '+token;
  const r=http.request(o,p=>{let d='';p.on('data',c=>d+=c);p.on('end',()=>{try{res({s:p.statusCode,j:JSON.parse(d),h:p.headers})}catch(e){res({s:p.statusCode,j:d,h:p.headers})}})});
  if(body)r.write(body);r.end();
});}
let pass=0,fail=0;const ok=(c,m)=>{c?(pass++,console.log('  ✓ '+m)):(fail++,console.log('  ✗ FAIL: '+m));};
setTimeout(async()=>{
  ok((await rq('/health')).j.status==='ok','health-check');
  ok((await rq('/api/import',{products:[]},'WRONG')).s===401,'import: неверный токен → 401');
  ok((await rq('/api/admin/login',{password:'x'})).s===401,'login: неверный пароль → 401');
  const tok=(await rq('/api/admin/login',{password:process.env.ADMIN_PASSWORD})).j.token;
  ok(!!tok,'login: верный пароль → токен');
  ok((await rq('/api/import',{products:'x'},process.env.IMPORT_TOKEN)).s===400,'import: не-массив → 400');
  let r=await rq('/api/import',{source:'test',products:[{sku:'T-1',brand:'B',model:'M',price:1000,stock:5}]},process.env.IMPORT_TOKEN);
  ok(r.j.created>=1,'import: товар создан');
  const pub=await rq('/api/products');
  const t1=pub.j.find(p=>p.sku==='T-1');
  ok(t1 && t1.stock===5 && t1.inStock===true,'public API: остаток показывается (5), есть inStock');
  const adm=await rq('/api/admin/products',null,tok);
  ok(adm.j.items.find(p=>p.sku==='T-1').stock===5,'admin API: точный остаток виден (5)');
  await rq('/api/import',{products:[{sku:'RND-1',brand:'Z',price:1000}]},process.env.IMPORT_TOKEN);
  await rq('/api/admin/bulk-price',{pct:10,brand:'Z',round:100},tok);
  ok((await rq('/api/admin/products',null,tok)).j.items.find(p=>p.sku==='RND-1').price===1100,'bulk-price: +10% округл = 1100');
  ok((await rq('/notexist')).s===404,'неизвестный API-путь → 404');
  // новые эндпоинты (сессия 2026-07): счётчики категорий + заливка только характеристик
  const cc=await rq('/api/category-counts');
  ok(cc.s===200 && cc.j && typeof cc.j==='object' && !Array.isArray(cc.j),'category-counts: 200, объект {cat_id:{t,s}}');
  ok((await rq('/api/import/attrs',{items:[]},'bad-token')).s===401,'import/attrs: неверный токен → 401');
  const ca=await rq('/api/import/attrs',{items:[{sku:'T-1',attrs:[{name:'Цвет',value:'Чёрный'}]}],onlyEmpty:false},process.env.IMPORT_TOKEN);
  ok(ca.j && ca.j.updated>=1,'import/attrs: характеристики залиты (только attrs)');
  const t1a=(await rq('/api/admin/products',null,tok)).j.items.find(p=>p.sku==='T-1');
  ok(t1a && Array.isArray(t1a.attrs) && t1a.attrs.some(a=>a.name==='Цвет'),'import/attrs: attrs сохранились у товара');
  // P0: телефон обязателен и валидируется (Казахстан)
  ok((await rq('/api/order',{items:[{sku:'T-1',qty:1}],name:'X'})).s===400,'order: без телефона → 400');
  ok((await rq('/api/order',{items:[{sku:'T-1',qty:1}],name:'X',phone:'123'})).s===400,'order: кривой телефон → 400');
  const ord=await rq('/api/order',{items:[{sku:'T-1',qty:2}],name:'X',phone:'8 705 354 19 99'});
  ok(ord.s===200 && ord.j.ok,'order: валидный телефон (8→7 норм.) → 200, заявка создана');
  // CMS: XSS-санитайз тела страницы (script/on*)
  const pg=await rq('/api/admin/pages',{title:'XSS тест',slug:'xsstest',body:'<p>ok</p><script>alert(1)</script><img src=x onerror="steal()">'},tok);
  if(pg.j&&pg.j.slug){
    const s=String((await rq('/page/'+pg.j.slug)).j);
    ok(s.indexOf('alert(1)')<0 && s.indexOf('steal()')<0 && s.indexOf('onerror')<0,'CMS: инъекция script/on* вырезана из тела страницы');
  } else ok(false,'CMS: страница не создалась ('+JSON.stringify(pg.j)+')');
  // Единый домен: sitemap и robots берут хост из SITE_URL (а не из хардкода в коде).
  // Проверяем именно это свойство: тест задаёт SITE_URL в шапке файла и ждёт его в выдаче.
  const sm=String((await rq('/sitemap.xml')).j), rb=String((await rq('/robots.txt')).j);
  ok(sm.indexOf(process.env.SITE_URL)>=0 && rb.indexOf(process.env.SITE_URL+'/sitemap.xml')>=0,'домен: sitemap/robots из единого SITE_URL');
  ok(sm.indexOf('https://s1com.kz')<0,'домен: чужой хост не течёт в sitemap');
  // honeypot: ботовая заявка тихо принята (не сохраняется)
  ok((await rq('/api/order',{items:[{sku:'T-1',qty:1}],phone:'87053541999',hp:'bot'})).j.ok===true,'honeypot: ботовая заявка тихо принята');
  // валидация reorder категорий
  ok((await rq('/api/admin/categories/reorder',{order:[]},tok)).s===400,'categories/reorder: пустой order → 400');
  // код INVALID_PHONE в ответе /api/order
  ok((await rq('/api/order',{items:[{sku:'T-1',qty:1}],name:'X',phone:'abc'})).j.code==='INVALID_PHONE','order: невалидный телефон → code INVALID_PHONE');
  // единый публичный конфиг сайта, без секретов
  const sc=await rq('/api/site-config');
  ok(sc.s===200 && !!sc.j.wa && !!sc.j.site_url && sc.j.tg_token===undefined && sc.j.tg_chat_id===undefined,'site-config: контакты есть, секретов нет');
  // быстрый заказ создаёт реальную заявку (P0 п.4)
  const qoBad=await rq('/api/quick-order',{items:[{sku:'T-1',qty:2}],name:'Ivan'});
  ok(qoBad.s===400 && qoBad.j.code==='INVALID_PHONE','quick-order: без телефона → INVALID_PHONE');
  const qo=await rq('/api/quick-order',{items:[{sku:'T-1',qty:3}],name:'Ivan',phone:'+7 705 354 19 99'});
  ok(qo.s===200 && qo.j.ok===true && !!qo.j.id,'quick-order: создаёт реальную заявку (возвращает id)');
  ok(Array.isArray((await rq('/api/quick-order',{skus:['T-1','NOPE-999']})).j.items),'quick-order: резолв SKU (совместимость) работает');
  // --- security / доступ ---
  ok((await rq('/api/admin/products')).s===401,'access: админ-эндпоинт без токена → 401');
  ok((await rq('/api/admin/backups/x/download')).s===401,'access: backup download без токена → 401');
  ok((await rq('/api/admin/backups/notabackup.txt/download',null,tok)).s===400,'backup download: некорректное имя → 400 (path-traversal guard)');
  ok((await rq('/api/order',{items:Array.from({length:201},()=>({sku:'T-1',qty:1})),phone:'87053541999'})).s===413,'order: >200 позиций → 413');
  ok((await rq('/api/import',{products:Array.from({length:5001},()=>({sku:'x'}))},process.env.IMPORT_TOKEN)).s===413,'import: >MAX_IMPORT → 413');
  ok((await rq('/category/99999999')).s===404,'category: несуществующая → 404');
  // аналитика: единый трекер window.track инжектится в страницы (applySeo)
  ok(String((await rq('/')).j).indexOf('window.track')>=0,'analytics: window.track инжектится в страницы');
  // CSP: script-src на per-request nonce (без unsafe-inline), все инлайн-<script> помечены этим nonce
  const home=await rq('/');
  const csp=(home.h&&home.h['content-security-policy'])||'';
  const nm=csp.match(/'nonce-([^']+)'/);
  const nonce=nm?nm[1]:null;
  ok(!!nonce && !/script-src [^;]*'unsafe-inline'/.test(csp),'CSP: script-src на nonce, без unsafe-inline');
  const inl=[...String(home.j).matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)].map(x=>x[0]);
  ok(inl.length>0 && inl.every(t=>nonce&&t.includes('nonce="'+nonce+'"')),'CSP: все инлайн-<script> помечены nonce ('+inl.length+' шт.)');
  // админка получает свой relaxed-CSP (unsafe-inline для script — за JWT, мимо applySeo)
  const admPage=await rq('/admin/index.html');
  ok(/script-src [^;]*'unsafe-inline'/.test((admPage.h&&admPage.h['content-security-policy'])||''),'CSP: админка на relaxed-CSP (unsafe-inline)');
  // CSV/formula-injection: поля заявки заполняет отправитель; экспорт в Excel должен нейтрализовать формулы
  await rq('/api/order',{items:[{sku:'T-1',qty:1}],name:'=1+1',phone:'87053541999',comment:'@SUM(A1:A9)'});
  const xbuf=await new Promise(r=>{const rr=http.request({host:'localhost',port:PORT,path:'/api/admin/orders/export',headers:{Authorization:'Bearer '+tok}},p=>{const ch=[];p.on('data',c=>ch.push(c));p.on('end',()=>r(Buffer.concat(ch)))});rr.end();});
  const XLSX=require('xlsx');
  const ws=(()=>{const wb=XLSX.read(xbuf,{type:'buffer'});return wb.Sheets[wb.SheetNames[0]];})();
  const flat=XLSX.utils.sheet_to_json(ws,{header:1}).flat();
  const danger=flat.filter(c=>typeof c==='string'&&/^[=+\-@]/.test(c)&&(c.includes('1+1')||c.includes('SUM')));
  ok(danger.length===0 && flat.some(c=>typeof c==='string'&&c.indexOf("'=1+1")===0),'export: CSV/formula-injection нейтрализован (апостроф)');
  // ---------- Пользователи (личный кабинет) ----------
  const reg=await rq('/api/user/register',{name:'Тест Клиент',phone:'87051112233',email:'CLIENT@Test.KZ',password:'secret123'});
  ok(reg.s===200 && !!reg.j.token,'user: регистрация (телефон+email) → токен');
  ok(reg.j.user && reg.j.user.email==='client@test.kz' && reg.j.user.phone==='+77051112233','user: email/телефон нормализованы');
  const utok=reg.j.token;
  ok((await rq('/api/user/register',{name:'x',phone:'87009998877',email:'client@test.kz',password:'secret123'})).s===409,'user: дубль email → 409');
  ok((await rq('/api/user/register',{name:'x',phone:'87051112233',email:'other@test.kz',password:'secret123'})).s===409,'user: дубль телефона → 409');
  ok((await rq('/api/user/register',{phone:'87001234567',email:'nopass@test.kz',password:'123'})).s===400,'user: короткий пароль → 400');
  ok((await rq('/api/user/login',{login:'+7 705 111 22 33',password:'secret123'})).s===200,'user: вход по телефону → 200');
  ok((await rq('/api/user/login',{login:'client@test.kz',password:'secret123'})).s===200,'user: вход по email → 200');
  ok((await rq('/api/user/login',{login:'client@test.kz',password:'nope'})).s===401,'user: неверный пароль → 401');
  const me=await rq('/api/user/me',null,utok);
  ok(me.s===200 && me.j.user.email==='client@test.kz','user: /me по токену');
  ok((await rq('/api/user/me')).s===401,'user: /me без токена → 401');
  // ИЗОЛЯЦИЯ: пользовательский токен не пускает в админку
  ok((await rq('/api/admin/products',null,utok)).s===401,'ИЗОЛЯЦИЯ: user-токен на /api/admin/products → 401');
  ok((await rq('/api/admin/users',null,utok)).s===401,'ИЗОЛЯЦИЯ: user-токен на /api/admin/users → 401');
  ok((await rq('/api/admin/users',null,tok)).s===200,'admin: список пользователей → 200');
  // Привязка заявки к аккаунту
  await rq('/api/order',{items:[{sku:'T-1',qty:4}],name:'Тест Клиент',phone:'87051112233'},utok);
  const uord=await rq('/api/user/orders',null,utok);
  ok(uord.s===200 && uord.j.orders.length>=1 && uord.j.orders[0].items[0].sku==='T-1','user: заказ привязан к аккаунту и виден в истории');
  // Списки
  const lst=await rq('/api/user/lists',{name:'Объект',items:[{sku:'T-1',qty:2}]},utok);
  ok(lst.s===200 && !!lst.j.id,'user: создать список → id');
  ok((await rq('/api/user/lists',null,utok)).j.lists.length>=1,'user: список сохранён');
  ok((await rq('/api/user/lists/'+lst.j.id,null,utok,'DELETE')).s===200,'user: удалить список → 200');
  // Сброс пароля менеджером (без почты/SMS)
  const ulist=await rq('/api/admin/users',null,tok);
  const cid=((ulist.j.users||[]).find(u=>u.email==='client@test.kz')||{}).id;
  const rst=await rq('/api/admin/users/'+cid+'/password',{},tok);
  ok(rst.s===200 && rst.j.password && rst.j.password.length>=8,'admin: сброс пароля → временный пароль');
  ok((await rq('/api/user/login',{login:'client@test.kz',password:rst.j.password})).s===200,'user: вход с временным паролем → 200');
  ok((await rq('/api/user/login',{login:'client@test.kz',password:'secret123'})).s===401,'user: старый пароль после сброса → 401');
  ok((await rq('/api/admin/users/999999/password',{},tok)).s===404,'admin: сброс несуществующего → 404');
  ok((await rq('/api/admin/users/'+cid+'/password',{},utok)).s===401,'ИЗОЛЯЦИЯ: user-токен не может сбросить пароль → 401');
  // Избранное (синк с аккаунтом)
  ok(JSON.stringify((await rq('/api/user/favorites',null,utok)).j.skus)==='[]','favorites: пусто по умолчанию → []');
  const favPut=await rq('/api/user/favorites',{skus:['T-1','T-1','  ','RND-1']},utok,'PUT');
  ok(favPut.s===200 && JSON.stringify(favPut.j.skus)==='["T-1","RND-1"]','favorites: PUT дедуп/тримминг');
  ok(JSON.stringify((await rq('/api/user/favorites',null,utok)).j.skus)==='["T-1","RND-1"]','favorites: GET сохранённое');
  ok((await rq('/api/user/favorites')).s===401,'favorites: без токена → 401');
  ok((await rq('/izbrannoe')).s===200 && String((await rq('/izbrannoe')).j).includes('favpage.js'),'favorites: страница /izbrannoe рендерится');

  // ===== Расширенное покрытие: валидация регистрации =====
  ok((await rq('/api/user/register',{phone:'87000000001',password:'secret123'})).s===400,'register: без email → 400');
  ok((await rq('/api/user/register',{email:'nophone@test.kz',password:'secret123'})).s===400,'register: без телефона → 400');
  ok((await rq('/api/user/register',{phone:'87000000002',email:'bad-email',password:'secret123'})).s===400,'register: кривой email → 400');
  ok((await rq('/api/user/register',{phone:'123',email:'okmail@test.kz',password:'secret123'})).s===400,'register: кривой телефон → 400');

  // ===== Профиль: обновление реквизитов + смена пароля =====
  const upd=await rq('/api/user/me',{name:'Пётр Обн',company:'ТОО Ромашка',bin:'123456789012',address:'Алматы'},utok,'PUT');
  ok(upd.s===200 && upd.j.user.company==='ТОО Ромашка' && upd.j.user.bin==='123456789012','profile: PUT обновил реквизиты');
  ok((await rq('/api/user/me',null,utok)).j.user.name==='Пётр Обн','profile: GET видит обновление');
  ok((await rq('/api/user/password',{old:'wrong',password:'newpass1'},utok)).s===403,'password: неверный старый → 403');

  // ===== Второй пользователь — IDOR (списки/избранное/заказы изолированы) =====
  const reg2=await rq('/api/user/register',{name:'Второй',phone:'87020000002',email:'second@test.kz',password:'secret123'});
  const utok2=reg2.j.token;
  const l2=await rq('/api/user/lists',{name:'Чужой',items:[{sku:'T-1',qty:1}]},utok2);
  ok(l2.s===200 && !!l2.j.id,'lists(u2): создан');
  ok((await rq('/api/user/lists',null,utok)).j.lists.every(x=>x.id!==l2.j.id),'IDOR: user1 не видит список user2');
  ok((await rq('/api/user/lists/'+l2.j.id,{name:'взлом',items:[]},utok,'PUT')).s===404,'IDOR: user1 не может изменить список user2 → 404');
  await rq('/api/user/lists/'+l2.j.id,null,utok,'DELETE'); // чужой DELETE (ok, но WHERE user_id — не тронет)
  ok((await rq('/api/user/lists',null,utok2)).j.lists.some(x=>x.id===l2.j.id),'IDOR: список user2 цел после чужого DELETE');
  await rq('/api/user/favorites',{skus:['AAA','BBB']},utok2,'PUT');
  ok(JSON.stringify((await rq('/api/user/favorites',null,utok)).j.skus)!=='["AAA","BBB"]','IDOR: избранное user2 не видно user1');
  ok(JSON.stringify((await rq('/api/user/favorites',null,utok2)).j.skus)==='["AAA","BBB"]','favorites(u2): своё сохранено');

  // ===== Смена пароля (успешная) на user2 =====
  ok((await rq('/api/user/password',{old:'secret123',password:'newpass9'},utok2)).s===200,'password: смена с верным старым → 200');
  ok((await rq('/api/user/login',{login:'second@test.kz',password:'newpass9'})).s===200,'password: вход с новым паролем → 200');
  ok((await rq('/api/user/login',{login:'second@test.kz',password:'secret123'})).s===401,'password: старый пароль больше не работает → 401');

  // ===== Заказы изолированы; новый пользователь — пустая история; битый токен = гость =====
  await rq('/api/order',{items:[{sku:'T-1',qty:1}],name:'Второй',phone:'87020000002'},utok2);
  ok((await rq('/api/user/orders',null,utok2)).j.orders.length>=1,'orders(u2): свой заказ виден');
  const reg3=await rq('/api/user/register',{name:'Третий',phone:'87030000003',email:'third@test.kz',password:'secret123'});
  ok(JSON.stringify((await rq('/api/user/orders',null,reg3.j.token)).j.orders)==='[]','orders: у нового пользователя пусто (чужие/гостевые не видны)');
  ok((await rq('/api/order',{items:[{sku:'T-1',qty:1}],name:'Гость',phone:'87053541999'},'garbage-token')).s===200,'order: битый user-токен → принят как гость (200)');

  // ===== Режим approval: pending → блок входа → подтверждение → вход → блокировка =====
  await rq('/api/admin/settings',{registration_mode:'approval'},tok);
  const pend=await rq('/api/user/register',{name:'Ожид',phone:'87040000004',email:'pending@test.kz',password:'secret123'});
  ok(pend.s===200 && pend.j.pending===true && !pend.j.token,'approval: регистрация → pending, без токена');
  ok((await rq('/api/user/login',{login:'pending@test.kz',password:'secret123'})).s===403,'approval: вход pending → 403');
  const pid=((await rq('/api/admin/users?status=pending',null,tok)).j.users.find(u=>u.email==='pending@test.kz')||{}).id;
  ok((await rq('/api/admin/users/'+pid+'/status',{status:'active'},tok)).s===200,'approval: менеджер подтвердил');
  ok((await rq('/api/user/login',{login:'pending@test.kz',password:'secret123'})).s===200,'approval: после подтверждения вход → 200');
  ok((await rq('/api/admin/users/'+pid+'/status',{status:'blocked'},tok)).s===200,'admin: блокировка пользователя');
  ok((await rq('/api/user/login',{login:'pending@test.kz',password:'secret123'})).s===403,'blocked: вход → 403');
  ok((await rq('/api/admin/users/'+pid+'/status',{status:'zzz'},tok)).s===400,'admin: некорректный статус → 400');
  await rq('/api/admin/settings',{registration_mode:'open'},tok); // вернуть режим
  const au=await rq('/api/admin/users',null,tok);
  ok(au.j.counts && typeof au.j.counts.active==='number' && typeof au.j.counts.pending==='number','admin/users: counts по статусам');
  ok((await rq('/api/admin/settings',null,tok)).j.registration_mode==='open','settings: registration_mode отдаётся и вернулся в open');

  // ===== Аналитика спроса в дашборде (customers + topFavorites) =====
  const st=await rq('/api/admin/stats',null,tok);
  ok(st.s===200 && st.j.customers && st.j.customers.total>=3,'stats: метрика клиентов (customers.total)');
  ok(typeof st.j.customers.withOrders==='number' && typeof st.j.customers.conversion==='number','stats: клиенты с заказами + конверсия');
  ok(Array.isArray(st.j.topFavorites) && st.j.topFavorites.some(f=>f.sku==='T-1'),'stats: T-1 в топе желаемого (агрегат избранного)');
  ok(st.j.topFavorites.every(f=>typeof f.ordered==='boolean' && typeof f.count==='number'),'stats: у топа желаемого есть флаг ordered и count');

  // ===== Скрытие товара переживает импорт (регрессия: /api/import ставил visible=1 всем) =====
  const IT=process.env.IMPORT_TOKEN;
  const impHid=()=>rq('/api/import',{source:'al-style',products:[{sku:'HID-1',brand:'HB',model:'HM',grp:'Видеонаблюдение',price:100,stock:1}]},IT);
  await impHid();
  const hidRow=(await rq('/api/admin/products?q=HID-1',null,tok)).j.items[0]; // админ-API отдаёт visible как boolean
  ok(!!hidRow && hidRow.visible===true,'скрытие: товар создан импортом и видим');
  await rq('/api/admin/products/bulk',{ids:[hidRow.id],action:'hide'},tok);
  await impHid();
  const afterImp=(await rq('/api/admin/products?q=HID-1',null,tok)).j.items[0];
  ok(afterImp.visible===false,'скрытие: скрытый товар НЕ воскрес после импорта');
  await rq('/api/admin/products/bulk',{ids:[hidRow.id],action:'show'},tok);
  await impHid();
  ok((await rq('/api/admin/products?q=HID-1',null,tok)).j.items[0].visible===true,'скрытие: «Показать» снимает флаг, импорт не прячет обратно');

  // ===== Склейка дублей между поставщиками (Этап E) =====
  await rq('/api/import',{source:'al-style',products:[{sku:'MRG-A',brand:'MB',model:'MPN-100',grp:'Видеонаблюдение',price:5000,stock:2}]},IT);
  await rq('/api/import',{source:'complex',products:[{sku:'MPN-100',brand:'MB',model:'Камера',grp:'Видеонаблюдение',price:4700,stock:3}]},IT);
  await rq('/api/offers-sync',{supplier:'al-style',offers:[{ext_id:'MRG-A',brand:'MB',mpn:'MPN-100',ean:'4600000000017',price_buy:4000,stock:2}]},IT);
  await rq('/api/offers-sync',{supplier:'complex',offers:[{ext_id:'MPN-100',brand:'MB',mpn:'MPN-100',ean:'4600000000017',price_buy:3900,stock:3}]},IT);
  const pv=await rq('/api/admin/match/preview',null,tok);
  ok(pv.s===200 && pv.j.high>=1,'склейка: предпросмотр нашёл надёжную (EAN) группу');
  ok((await rq('/api/admin/match/preview')).s===401,'склейка: preview без токена → 401');
  const dry=await rq('/api/admin/match/run',{dry:true},tok);
  ok(dry.s===200 && dry.j.merged===0,'склейка: dry-run ничего не меняет');
  const run=await rq('/api/admin/match/run',{},tok);
  ok(run.s===200 && run.j.merged>=1,'склейка: боевой запуск склеил дубль');
  const merged=await rq('/api/admin/match/merged',null,tok);
  ok(merged.j.total>=1,'склейка: список склеенного не пуст');
  const loser=merged.j.items[0];
  ok(loser.merged_into>0,'склейка: у дубля проставлен merged_into');
  await rq('/api/import',{source:'complex',products:[{sku:'MPN-100',brand:'MB',model:'Камера',grp:'Видеонаблюдение',price:4600,stock:4}]},IT);
  const afterMergeImp=(await rq('/api/admin/products?q=MPN-100',null,tok)).j.items.find(p=>p.sku==='MPN-100');
  ok(afterMergeImp.visible===false,'склейка: склеенный дубль не воскрес после импорта');
  ok((await rq('/api/admin/match/resolve',{id:1},tok)).s===400,'склейка: resolve без keep → 400 (не закрывает группу молча)');
  const un=await rq('/api/admin/match/unmerge',{ids:[loser.id]},tok);
  ok(un.j.restored===1,'склейка: отмена вернула товар на витрину');
  ok((await rq('/api/admin/match/unmerge',{ids:[loser.id]},tok)).j.restored===0,'склейка: unmerge не трогает то, что склейка не прятала');

  // Авто-склейка после импорта (cron зовёт с токеном выгрузки, а не админским JWT)
  ok((await rq('/api/match/auto',{})).s===401,'авто-склейка: без токена → 401');
  ok((await rq('/api/match/auto',{},'WRONG-TOKEN')).s===401,'авто-склейка: чужой токен → 401');
  const auto=await rq('/api/match/auto',{},IT);
  ok(auto.s===200 && auto.j.merged>=1,'авто-склейка: токеном выгрузки склеила дубль обратно');

  // ===== Статьи «Полезное» (SEO-контент) =====
  ok((await rq('/api/admin/articles')).s===401,'статьи: список без токена → 401');
  ok((await rq('/api/admin/articles',{title:'x'})).s===401,'статьи: создание без токена → 401');
  const seeded=await rq('/api/articles');
  ok(Array.isArray(seeded.j) && seeded.j.length>=5,'статьи: сид засеял стартовые статьи ('+(seeded.j||[]).length+')');
  ok(seeded.j.every(a=>a.slug&&a.title),'статьи: у всех есть slug и заголовок');
  const byGrp=await rq('/api/articles?grp='+encodeURIComponent('Видеонаблюдение'));
  ok(byGrp.s===200 && byGrp.j.every(a=>a.grp==='Видеонаблюдение'),'статьи: фильтр ?grp= отдаёт только свой раздел');
  ok((await rq('/api/articles?limit=2')).j.length<=2,'статьи: ?limit= ограничивает выдачу');

  const na=await rq('/api/admin/articles',{title:'Тестовая статья',slug:'test-article-api',excerpt:'Анонс',body:'<h2>Заголовок</h2><p>Текст</p>',grp:'Видеонаблюдение'},tok);
  ok(na.s===200 && na.j.id,'статьи: создание через админ-API');
  ok((await rq('/api/admin/articles',{title:'Дубль',slug:'test-article-api'},tok)).s===409,'статьи: дубль адреса → 409');
  ok((await rq('/api/admin/articles',{title:''},tok)).s===400,'статьи: без заголовка → 400');

  // body — доверенный HTML из админки, но script вырезаем (та же санитизация, что у инфо-страниц)
  await rq('/api/admin/articles/'+na.j.id,{body:'<p>ок</p><script>alert(1)</script><p onclick="alert(2)">x</p>'},tok,'PUT');
  const dirty=(await rq('/api/admin/articles',null,tok)).j.find(a=>a.id===na.j.id);
  ok(!/<script/i.test(dirty.body),'статьи: <script> вырезается из тела');
  ok(!/onclick=/i.test(dirty.body),'статьи: onclick вырезается из тела');

  const artPage=await rq('/poleznoe/test-article-api');
  ok(artPage.s===200,'статьи: страница статьи открывается');
  ok((await rq('/poleznoe/net-takoy-stati')).s===404,'статьи: несуществующая → 404');
  ok((await rq('/poleznoe')).s===200,'статьи: список /poleznoe открывается');

  await rq('/api/admin/articles/'+na.j.id,{visible:false},tok,'PUT');
  ok((await rq('/poleznoe/test-article-api')).s===404,'статьи: скрытая не отдаётся');
  ok(!(await rq('/api/articles')).j.some(a=>a.slug==='test-article-api'),'статьи: скрытая пропала из публичного списка');

  const homeArts=await rq('/api/home');
  ok(Array.isArray(homeArts.j.articles),'статьи: /api/home отдаёт articles (блок на главной)');
  ok(homeArts.j.articles.length<=3,'статьи: на главную идёт не больше 3');

  ok((await rq('/api/admin/articles/'+na.j.id,null,tok,'DELETE')).s===200,'статьи: удаление');
  ok(!(await rq('/api/admin/articles',null,tok)).j.some(a=>a.id===na.j.id),'статьи: после удаления пропала из админ-списка');

  // ===== Брендовое скрытие «убрать из Al-Style» (hidden_manual=2) =====
  // Механика: галка прячет чужие товары бренда, снятие — возвращает; спрятанное руками (=1) не трогается.
  await rq('/api/import',{source:'al-style',products:[
    {sku:'BR-1',brand:'BrandX',model:'M1',grp:'Видеонаблюдение',price:100,stock:1},
    {sku:'BR-2',brand:'BrandX',model:'M2',grp:'Видеонаблюдение',price:200,stock:1}]},IT);
  const br2=(await rq('/api/admin/products?q=BR-2',null,tok)).j.items[0];
  await rq('/api/admin/products/bulk',{ids:[br2.id],action:'hide'},tok); // спрятан РУКАМИ (hidden_manual=1)
  await rq('/api/admin/suppliers',{code:'brandtest',name:'BrandTest',kind:'api'},tok);
  const onCfg={code:'brandtest',brands:[{brand:'BrandX',section:'Видеонаблюдение',on:true,exAlstyle:true}]};
  const hid=await rq('/api/admin/supplier-brands',onCfg,tok);
  ok(hid.s===200 && hid.j.hidden>=1,'бренды: «убрать из Al-Style» спрятало товары бренда ('+hid.j.hidden+')');
  await rq('/api/import',{source:'al-style',products:[{sku:'BR-1',brand:'BrandX',model:'M1',grp:'Видеонаблюдение',price:100,stock:1}]},IT);
  ok((await rq('/api/admin/products?q=BR-1',null,tok)).j.items[0].visible===false,'бренды: скрытие пережило импорт');
  const off=await rq('/api/admin/supplier-brands',{code:'brandtest',brands:[{brand:'BrandX',section:'Видеонаблюдение',on:true,exAlstyle:false}]},tok);
  ok(off.j.restored>=1,'бренды: снятие галки вернуло товары ('+off.j.restored+')');
  ok((await rq('/api/admin/products?q=BR-1',null,tok)).j.items[0].visible===true,'бренды: BR-1 снова на витрине');
  ok((await rq('/api/admin/products?q=BR-2',null,tok)).j.items[0].visible===false,'бренды: спрятанный РУКАМИ товар не воскрес (разные причины скрытия)');

  console.log(`\nИТОГ: ${pass} прошло, ${fail} провалено`);
  process.exit(fail?1:0);
},1200);
