import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify } from '../lib/publish.mjs';

const SECRET = 'a'.repeat(64);
const BODY = JSON.stringify({ articles: [{ slug: 'x-y', markdown: '## T', frontmatter: {} }] });

test('A5: assinatura válida é aceita', () => {
  const h = sign(SECRET, BODY);
  assert.deepEqual(verify(SECRET, BODY, h), { ok: true });
});

test('A5: corpo adulterado é rejeitado', () => {
  const h = sign(SECRET, BODY);
  assert.equal(verify(SECRET, BODY + ' ', h).ok, false);
});

test('A5: segredo errado é rejeitado', () => {
  const h = sign(SECRET, BODY);
  assert.equal(verify('b'.repeat(64), BODY, h).ok, false);
});

test('A5: replay fora da janela de 300s é rejeitado', () => {
  const old = (Math.floor(Date.now() / 1000) - 600).toString();
  const h = sign(SECRET, BODY, { timestamp: old });
  assert.equal(verify(SECRET, BODY, h).reason, 'timestamp_out_of_window');
});

test('A5: nonce muda a cada assinatura', () => {
  assert.notEqual(sign(SECRET, BODY).nonce, sign(SECRET, BODY).nonce);
});
