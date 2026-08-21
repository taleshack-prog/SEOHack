import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete, parseJson } from '../lib/llm.mjs';

const realFetch = globalThis.fetch;
const okBody = { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 5, output_tokens: 2 } };
const resp = (status, body) => ({
  ok: status < 400, status,
  json: async () => body,
  text: async () => JSON.stringify(body),
  headers: new Map(),
});

function mock(fn) { globalThis.fetch = fn; }
function restore() { globalThis.fetch = realFetch; }

process.env.LLM_API_KEY = 'sk-teste';

test('temperature não é enviada por padrão (foi depreciada)', async () => {
  let enviado;
  mock(async (_u, o) => { enviado = JSON.parse(o.body); return resp(200, okBody); });
  try {
    await complete({ system: 's', prompt: 'p', model: 'claude-sonnet-5', provider: 'anthropic' });
    assert.ok(!('temperature' in enviado), 'temperature foi enviada sem ser pedida');
    assert.equal(enviado.model, 'claude-sonnet-5');
  } finally { restore(); }
});

test('temperature é enviada quando pedida explicitamente', async () => {
  let enviado;
  mock(async (_u, o) => { enviado = JSON.parse(o.body); return resp(200, okBody); });
  try {
    await complete({ system: 's', prompt: 'p', provider: 'anthropic', temperature: 0.3 });
    assert.equal(enviado.temperature, 0.3);
  } finally { restore(); }
});

test('parâmetro recusado é removido e a chamada repetida', async () => {
  const corpos = [];
  mock(async (_u, o) => {
    const b = JSON.parse(o.body);
    corpos.push(b);
    if ('temperature' in b) {
      return resp(400, { type: 'error',
        error: { type: 'invalid_request_error', message: '`temperature` is deprecated for this model.' } });
    }
    return resp(200, okBody);
  });
  try {
    const r = await complete({ system: 's', prompt: 'p', provider: 'anthropic', temperature: 0.3 });
    assert.equal(corpos.length, 2, 'deveria ter tentado duas vezes');
    assert.ok('temperature' in corpos[0]);
    assert.ok(!('temperature' in corpos[1]), 'não removeu o parâmetro na 2ª tentativa');
    assert.deepEqual(r.droppedParams, ['temperature']);
    assert.equal(r.text, 'ok');
  } finally { restore(); }
});

test('erro 400 que não aponta parâmetro não vira laço infinito', async () => {
  let chamadas = 0;
  mock(async () => { chamadas++; return resp(400, { error: { message: 'algo genérico' } }); });
  try {
    await assert.rejects(() => complete({ system: 's', prompt: 'p', provider: 'anthropic' }));
    assert.equal(chamadas, 1);
  } finally { restore(); }
});

test('erro carrega status e corpo cru do provedor', async () => {
  mock(async () => resp(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
  try {
    await complete({ system: 's', prompt: 'p', provider: 'anthropic' });
    assert.fail('deveria ter lançado');
  } catch (err) {
    assert.equal(err.status, 401);
    assert.match(err.raw, /invalid x-api-key/);
  } finally { restore(); }
});

test('openai continua recebendo os penalties que só ela aceita', async () => {
  let enviado;
  mock(async (_u, o) => {
    enviado = JSON.parse(o.body);
    return resp(200, { choices: [{ message: { content: 'ok' } }],
                       usage: { prompt_tokens: 5, completion_tokens: 2 } });
  });
  try {
    await complete({ system: 's', prompt: 'p', provider: 'openai', model: 'gpt-5' });
    assert.equal(enviado.frequency_penalty, 0.3);
    assert.ok(!('max_tokens' in enviado), 'openai usa max_completion_tokens');
  } finally { restore(); }
});

test('parseJson tolera cercas de markdown', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Segue:\n{"b":2}'), { b: 2 });
});

test('resposta cortada por limite de tokens dá erro que aponta a causa', () => {
  const truncado = '{"title":"x","sections":[{"h2":"a","points":["b"';
  assert.throws(() => parseJson(truncado, 'max_tokens'), /cortada pelo limite de tokens/);
});

test('JSON inválido sem corte mostra o trecho final', () => {
  assert.throws(() => parseJson('{"a":1,,}'), /Trecho final/);
});

test('stop_reason é propagado pelo wrapper', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200, headers: new Map(),
    json: async () => ({ content: [{ type: 'text', text: '{}' }],
                         usage: { input_tokens: 1, output_tokens: 2000 },
                         stop_reason: 'max_tokens' }),
    text: async () => '',
  });
  try {
    const r = await complete({ system: 's', prompt: 'p', provider: 'anthropic' });
    assert.equal(r.stopReason, 'max_tokens');
  } finally { globalThis.fetch = real; }
});
