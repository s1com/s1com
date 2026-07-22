#!/usr/bin/env node
/**
 * alstyle-categories.js — выгрузка ПОЛНОГО дерева категорий Al-Style из их API в текстовый файл.
 * Только категории и подкатегории (без товаров). Все уровни вложенности.
 *
 * ЗАЧЕМ: получить 100% полное и актуальное дерево всех разделов каталога Al-Style —
 * надёжнее ручного сбора с сайта.
 *
 * ПЕРЕД ЗАПУСКОМ (TODO):
 *   1. Вписать ALSTYLE_API_KEY (ключ из кабинета b2bportal.al-style.kz → API).
 *   2. Вписать ALSTYLE_CATEGORIES_URL — метод, отдающий категории
 *      (уточнить в документации API; часто это что-то вроде .../categories или .../get-categories).
 *   3. В normalizeNode() подтвердить названия полей по реальному ответу
 *      (id, name/title, parent_id/parent, children) — посмотрите один ответ API.
 *
 * Запуск:  node alstyle-categories.js
 * Результат: файл  categories_full.txt  с деревом всех категорий.
 */
'use strict';
const https = require('https');
const fs = require('fs');

const CONFIG = {
  ALSTYLE_CATEGORIES_URL: process.env.ALSTYLE_CATEGORIES_URL || 'https://b2bportal.al-style.kz/get-api/PLACEHOLDER-categories', // TODO
  ALSTYLE_API_KEY: process.env.ALSTYLE_API_KEY || 'PUT-YOUR-KEY',                                                                // TODO
  OUT_FILE: 'categories_full.txt',
};

// Запрос к API
function fetchCategories() {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.ALSTYLE_CATEGORIES_URL);
    // Способ передачи ключа уточнить в документации (параметр или заголовок):
    // url.searchParams.set('key', CONFIG.ALSTYLE_API_KEY);
    const opts = { method: 'GET', headers: { /* 'Authorization': 'Bearer ' + CONFIG.ALSTYLE_API_KEY */ } };
    https.get(url, opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Не разобрать ответ: ' + e.message + '\nНачало ответа: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

// Приведение узла к единому виду. TODO: подтвердить имена полей.
function normalizeNode(n) {
  return {
    id: n.id ?? n.ID ?? n.category_id ?? n.code,
    name: n.name ?? n.title ?? n.category_name ?? '(без названия)',
    parent: n.parent_id ?? n.parent ?? n.parentId ?? null,
    children: n.children || n.items || n.subcategories || [],
  };
}

// Построение дерева: либо из вложенных children, либо из плоского списка parent_id.
function buildTree(raw) {
  // raw может быть {categories:[...]}, {data:[...]}, или просто [...]
  const list = raw.categories || raw.data || raw.elements || raw.items || (Array.isArray(raw) ? raw : []);
  const nodes = list.map(normalizeNode);

  // Если у узлов уже есть вложенные children — используем как есть.
  const hasNested = nodes.some(n => Array.isArray(n.children) && n.children.length);
  if (hasNested) return nodes.filter(n => n.parent == null || !nodes.some(p => p.id === n.parent)) ;

  // Иначе строим дерево по parent.
  const byId = new Map(nodes.map(n => [String(n.id), { ...n, children: [] }]));
  const roots = [];
  byId.forEach(n => {
    const p = n.parent != null ? byId.get(String(n.parent)) : null;
    if (p) p.children.push(n); else roots.push(n);
  });
  return roots;
}

// Печать дерева с отступами и чекбоксами
function printTree(nodes, depth = 0, lines = []) {
  const pad = '    '.repeat(depth);
  for (const n of nodes) {
    lines.push(`${pad}[ ] ${n.name}`);
    if (n.children && n.children.length) printTree(n.children, depth + 1, lines);
  }
  return lines;
}

(async () => {
  try {
    console.log('Запрашиваю дерево категорий Al-Style…');
    const raw = await fetchCategories();
    const tree = buildTree(raw);
    const lines = printTree(tree);
    const header =
      '================================================================\n' +
      '  ПОЛНОЕ ДЕРЕВО КАТЕГОРИЙ AL-STYLE (из API)\n' +
      '  Поставьте [X] напротив нужных. Дата выгрузки: ' + new Date().toLocaleString('ru-RU') + '\n' +
      '================================================================\n\n';
    fs.writeFileSync(CONFIG.OUT_FILE, header + lines.join('\n') + '\n', 'utf8');
    console.log(`Готово. Категорий: ${lines.length}. Файл: ${CONFIG.OUT_FILE}`);
  } catch (e) {
    console.error('ОШИБКА:', e.message);
    console.error('Проверьте URL метода категорий, ключ и имена полей в normalizeNode().');
    process.exit(1);
  }
})();
