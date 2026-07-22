// Генерация хэша пароля для ADMIN_PASSWORD_HASH в .env
// Запуск: node scripts/hash-password.js "ваш-пароль"
const {hashPassword}=require('../lib/security');
const pw=process.argv[2];
if(!pw){console.log('Использование: node scripts/hash-password.js "ваш-пароль"');process.exit(1);}
console.log('\nДобавьте в .env строку:\n');
console.log('ADMIN_PASSWORD_HASH='+hashPassword(pw)+'\n');
