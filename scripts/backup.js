// Бэкап базы: копирует data.sqlite в backups/ с датой. Запуск: node scripts/backup.js
// Рекомендуется по расписанию (cron на сервере раз в сутки).
const fs=require('fs');const path=require('path');
const src=process.env.DB_PATH||path.join(__dirname,'..','data.sqlite');
const dir=path.join(__dirname,'..','backups');
if(!fs.existsSync(src)){console.error('База не найдена:',src);process.exit(1);}
fs.mkdirSync(dir,{recursive:true});
// сбрасываем WAL в основной файл, чтобы копия была консистентной (иначе свежие записи в -wal не попадут)
try{const Database=require('better-sqlite3');const d=new Database(src);d.pragma('wal_checkpoint(TRUNCATE)');d.close();}catch(e){console.warn('checkpoint пропущен:',e.message);}
const name='data-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite';
fs.copyFileSync(src,path.join(dir,name));
// храним последние 14 копий
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sqlite')).sort();
while(files.length>14){fs.unlinkSync(path.join(dir,files.shift()));}
console.log('Бэкап создан:',name);
