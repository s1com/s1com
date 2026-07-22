#!/usr/bin/env node
// Отчёт готовности каталога к запуску: по брендам — фото / цена / температура / ТТХ.
// Зачем: после импорта Al-Style+DC Complex решить, какие бренды прятать на старте,
// чтобы витрина была ЧИСТОЙ (решение совета: чистое ядро, не сырой полный каталог).
// Маркетолог: «дай список фото/ТТХ по брендам». Температура критична — в ВКО ниже −40,
// а не все модели столько держат; карточка без честной температуры = риск рекламаций.
//
// Запуск (на проде после импорта):  DB_PATH=/data/data.sqlite node scripts/catalog-readiness.js
// Read-only: витрину не трогает, только считает и печатает.

const path = require('path');
let rows;
try {
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');
  const db = require('better-sqlite3')(DB_PATH, { readonly: true });
  // берём только видимые товары — их увидит клиент
  rows = db.prepare("SELECT brand, img, price, descr, attrs, stock FROM products WHERE visible=1").all();
  console.log('Источник: БД', DB_PATH, '· видимых товаров:', rows.length, '\n');
} catch (e) {
  // fallback на seed (для локальной проверки без БД)
  const seed = require('./seed-products.json');
  rows = seed.map(p => ({ brand: p.brand, img: p.img, price: p.price, descr: p.desc, attrs: JSON.stringify(p.conn || []), stock: p.stock }));
  console.log('Источник: seed-products.json (БД недоступна) · позиций:', rows.length, '\n');
}

const TEMP_RE = /-?\d+\s*°?\s*[CС]|темпер|мороз|рабочая\s*темп/i;
const B = {};
for (const p of rows) {
  const b = (p.brand && String(p.brand).trim()) || '(без бренда)';
  B[b] = B[b] || { n: 0, img: 0, price: 0, temp: 0, ttx: 0 };
  const s = B[b]; s.n++;
  const d = String(p.descr || '') + ' ' + String(p.attrs || '');
  if (p.img && String(p.img).trim()) s.img++;
  if (Number(p.price) > 0) s.price++;
  if (TEMP_RE.test(d)) s.temp++;
  if (d.replace(/\s/g, '').length > 40) s.ttx++; // есть содержательные характеристики
}

const pct = (a, n) => n ? Math.round(a / n * 100) + '%' : '—';
const brands = Object.entries(B).sort((a, b) => b[1].n - a[1].n);

console.log('флаг | бренд | всего | фото | цена | темп. | ТТХ | готовность | рекомендация');
console.log('-----|-------|-------|------|------|-------|-----|-----------|------------');
const hide = [];
for (const [name, v] of brands) {
  const score = Math.round((v.img / v.n * 0.35 + v.price / v.n * 0.3 + v.temp / v.n * 0.15 + v.ttx / v.n * 0.2) * 100);
  const flag = score >= 50 ? '🟢' : score >= 25 ? '🟡' : '🔴';
  const rec = score >= 50 ? 'показывать' : score >= 25 ? 'показывать, дополнить' : 'СПРЯТАТЬ на старте';
  if (score < 25) hide.push(name);
  console.log(`${flag} | ${name} | ${v.n} | ${pct(v.img, v.n)} | ${pct(v.price, v.n)} | ${pct(v.temp, v.n)} | ${pct(v.ttx, v.n)} | ${score}% | ${rec}`);
}

console.log('\nИтог: показывать чистое ядро (🟢/🟡). Спрятать на старте (🔴):', hide.length ? hide.join(', ') : 'нет');
console.log('Как спрятать: админка → 🏭 Поставщики/каталог → фильтр по бренду → bulk-hide.');
console.log('⚠️ Температура — если низкая (Imou до −30, часть Dahua Full-color −40), ставить честный предел в карточку, не выдумывать.');
