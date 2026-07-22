#!/usr/bin/env node
'use strict';
// CLI миграций.  db:migrate — применяет ожидающие (require('../db') бутстрапит схему и вызывает runMigrations).
//                db:status  — печатает список применённых/ожидающих.
const path = require('path');
const db = require('../db'); // при require применяются все ожидающие миграции (runMigrations в db.js)
const { status } = require('../lib/migrations');
const dir = path.join(__dirname, '..', 'migrations');
const st = status(db, dir);
const applied = st.filter(x => x.applied), pending = st.filter(x => !x.applied);
console.log('Миграции: применено ' + applied.length + ', ожидают ' + pending.length);
st.forEach(x => console.log('  ' + (x.applied ? '✓' : '·') + ' ' + x.name + (x.applied_at ? '  (' + x.applied_at + ')' : '')));
process.exit(pending.length ? 1 : 0);
