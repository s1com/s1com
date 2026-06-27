const fs=require('fs');const path=require('path');const db=require('../db');
const items=JSON.parse(fs.readFileSync(path.join(__dirname,'seed-products.json'),'utf8'));
const now=new Date().toISOString();
const ins=db.prepare(`INSERT OR IGNORE INTO products(sku,brand,model,grp,cat,descr,res,price,oldprice,promo,stock,img,mp,conn,type,created_at,updated_at)
  VALUES(@sku,@brand,@model,@grp,@cat,@descr,@res,@price,@oldprice,@promo,@stock,@img,@mp,@conn,@type,@now,@now)`);
let n=0;
const tx=db.transaction(list=>{for(const p of list){
  ins.run({sku:p.id,brand:p.brand||'',model:p.model||'',grp:p.group||'',cat:p.cat||'',descr:p.desc||'',
    res:p.res||'',price:Math.round(+p.price||0),oldprice:Math.round(+p.oldprice||0),promo:p.promo?1:0,
    stock:0,img:p.img||'',mp:p.mp||'',conn:Array.isArray(p.conn)?p.conn.join(','):(p.conn||''),type:p.type||'',now});n++;
}});
tx(items);
console.log('Загружено товаров:',n);


// Категории
try {
  const catItems = JSON.parse(require('fs').readFileSync(require('path').join(__dirname,'seed-categories.json'),'utf8'));
  const insC = db.prepare('INSERT OR IGNORE INTO categories(name,parent,visible,sort_order,created_at) VALUES(?,?,?,?,?)');
  const nowC = new Date().toISOString();
  let cn=0;
  const txC = db.transaction(list => { for (const c of list){ insC.run(c.name, c.parent||'', c.visible?1:0, c.sort_order||100, nowC); cn++; } });
  txC(catItems);
  console.log('Загружено категорий:', cn);
} catch(e){ console.warn('категории не загружены:', e.message); }
