// Интеграционные тесты API. Запуск: npm test
// Поднимает сервер на тестовом порту, прогоняет проверки, выходит с кодом 0/1.
process.env.PORT=process.env.PORT||'3099';
process.env.NODE_ENV='development';
process.env.ADMIN_PASSWORD=process.env.ADMIN_PASSWORD||'test-pass';
process.env.JWT_SECRET=process.env.JWT_SECRET||'test-secret';
process.env.IMPORT_TOKEN=process.env.IMPORT_TOKEN||'test-token';
require('../server.js');
const http=require('http');
const PORT=process.env.PORT;
function rq(path,data,token,method){return new Promise(res=>{
  const body=data!==undefined?JSON.stringify(data):null;
  const o={host:'localhost',port:PORT,path,method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json'}};
  if(token)o.headers.Authorization='Bearer '+token;
  const r=http.request(o,p=>{let d='';p.on('data',c=>d+=c);p.on('end',()=>{try{res({s:p.statusCode,j:JSON.parse(d)})}catch(e){res({s:p.statusCode,j:d})}})});
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
  ok(adm.j.find(p=>p.sku==='T-1').stock===5,'admin API: точный остаток виден (5)');
  await rq('/api/import',{products:[{sku:'RND-1',brand:'Z',price:1000}]},process.env.IMPORT_TOKEN);
  await rq('/api/admin/bulk-price',{pct:10,brand:'Z',round:100},tok);
  ok((await rq('/api/admin/products',null,tok)).j.find(p=>p.sku==='RND-1').price===1100,'bulk-price: +10% округл = 1100');
  ok((await rq('/notexist')).s===404,'неизвестный API-путь → 404');
  console.log(`\nИТОГ: ${pass} прошло, ${fail} провалено`);
  process.exit(fail?1:0);
},1200);
