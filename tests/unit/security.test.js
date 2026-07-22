'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { hashPassword, verifyPassword, safeEqual } = require('../../lib/security');

test('hashPassword → verifyPassword: верный пароль проходит', () => {
  const h = hashPassword('S3cret!pass');
  assert.match(h, /^[0-9a-f]+:[0-9a-f]+$/, 'формат salt:hash');
  assert.strictEqual(verifyPassword('S3cret!pass', h), true);
});

test('verifyPassword: неверный пароль не проходит', () => {
  const h = hashPassword('correct-horse');
  assert.strictEqual(verifyPassword('wrong-horse', h), false);
});

test('verifyPassword: битый/пустой хэш → false, без throw', () => {
  assert.strictEqual(verifyPassword('x', ''), false);
  assert.strictEqual(verifyPassword('x', 'no-colon'), false);
  assert.strictEqual(verifyPassword('x', null), false);
});

test('hashPassword: разные соли → разные хэши одного пароля', () => {
  assert.notStrictEqual(hashPassword('same'), hashPassword('same'));
});

test('safeEqual: равные строки → true, разные → false', () => {
  assert.strictEqual(safeEqual('token-abc', 'token-abc'), true);
  assert.strictEqual(safeEqual('token-abc', 'token-abd'), false);
  assert.strictEqual(safeEqual('short', 'longer-string'), false);
  assert.strictEqual(safeEqual('', ''), true);
});
