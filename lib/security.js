// Хэширование пароля на встроенном crypto (scrypt) — без нативных зависимостей
const crypto=require('crypto');
function hashPassword(password,salt){
  salt=salt||crypto.randomBytes(16).toString('hex');
  const hash=crypto.scryptSync(String(password),salt,64).toString('hex');
  return salt+':'+hash;
}
function verifyPassword(password,stored){
  if(!stored||!stored.includes(':')) return false;
  const [salt,hash]=stored.split(':');
  const test=crypto.scryptSync(String(password),salt,64).toString('hex');
  const a=Buffer.from(hash,'hex'), b=Buffer.from(test,'hex');
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
// безопасное сравнение токенов (защита от тайминг-атак)
function safeEqual(a,b){
  const ba=Buffer.from(String(a)), bb=Buffer.from(String(b));
  if(ba.length!==bb.length) return false;
  return crypto.timingSafeEqual(ba,bb);
}
module.exports={hashPassword,verifyPassword,safeEqual};
