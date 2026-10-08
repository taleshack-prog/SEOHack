// Cliente da Perplexity.
//
// Nenhuma rede: o `fetch` é injetado. A chave entra pelo ambiente e nunca
// aparece em asserção nem em saída de teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscar, responder, posicaoDoDominio, normalizarUrl, temChave } from '../lib/perplexity.mjs';

process.env.PERPLEXITY_API_KEY = 'pplx-teste';

const ok = (corpo) => async (url, init) => {
  fake.ultima = { url, body: JSON.parse(init.body), headers: init.headers };
  return { ok: true, status: 200, json: async () => corpo };
};
const fake = {};

const erro = (status, cabecalhos = {}) => async () => ({
  ok: false, status,
  headers: { get: (k) => cabecalhos[k.toLowerCase()] ?? null },
  text: async () => '{"error":"x"}',
});

test('há chave configurada', () => {
  assert.equal(temChave(), true);
});

test('busca com uma consulta manda a string, não um array', async () => {
  const r = await buscar('genética felina', { fetchImpl: ok({ id: 'a', results: [] }) });
  assert.equal(fake.ultima.body.query, 'genética felina');
  assert.equal(fake.ultima.body.max_results, 10);
  assert.match(fake.ultima.url, /\/search$/);
  assert.deepEqual(r.results, []);
});

test('até cinco consultas vão num pedido só, como array', async () => {
  await buscar(['a', 'b', 'c'], { fetchImpl: ok({ id: 'a', results: [] }) });
  assert.deepEqual(fake.ultima.body.query, ['a', 'b', 'c']);
});

test('mais de cinco consultas é recusado antes da rede', async () => {
  await assert.rejects(() => buscar(['a', 'b', 'c', 'd', 'e', 'f']), /até 5 consultas/);
});

test('max_results fora de 1–20 é recusado antes da rede', async () => {
  await assert.rejects(() => buscar('x', { max_results: 21 }), /entre 1 e 20/);
  await assert.rejects(() => buscar('x', { max_results: 0 }), /entre 1 e 20/);
});

test('os filtros passam com o nome que a API usa', async () => {
  await buscar('x', { max_results: 3, country: 'BR', search_domain_filter: ['gov.br'],
                      search_recency_filter: 'month', fetchImpl: ok({ id: 'a', results: [] }) });
  assert.equal(fake.ultima.body.country, 'BR');
  assert.deepEqual(fake.ultima.body.search_domain_filter, ['gov.br']);
  assert.equal(fake.ultima.body.search_recency_filter, 'month');
});

test('a mesma página em duas consultas conta uma vez, e a melhor colocada fica', async () => {
  const r = await buscar(['a', 'b'], { fetchImpl: ok({ id: 'a', results: [
    { title: 'Primeiro', url: 'https://exemplo.com/artigo', snippet: 's' },
    { title: 'Repetido', url: 'https://www.exemplo.com/artigo/?utm_source=x', snippet: 's' },
    { title: 'Outro', url: 'https://outro.com/p', snippet: 's' }] }) });
  assert.equal(r.results.length, 2);
  assert.equal(r.results[0].title, 'Primeiro');
});

test('a busca não devolve resposta gerada — ela não existe nesta API', async () => {
  const r = await buscar('x', { fetchImpl: ok({ id: 'a', results: [{ title: 't', url: 'https://a.com', snippet: 's' }] }) });
  assert.equal('answer' in r, false);
  assert.equal('citations' in r, false);
});

test('responder devolve a resposta e as fontes citadas', async () => {
  const r = await responder('como funciona X?', { fetchImpl: ok({
    choices: [{ message: { content: 'Funciona assim.' } }],
    search_results: [{ url: 'https://a.com/1' }, { url: 'https://b.com/2' }] }) });
  assert.equal(r.answer, 'Funciona assim.');
  assert.deepEqual(r.fontes, ['https://a.com/1', 'https://b.com/2']);
  assert.equal(fake.ultima.body.model, 'sonar');
});

test('responder aceita o campo antigo citations', async () => {
  const r = await responder('x', { fetchImpl: ok({
    choices: [{ message: { content: 'c' } }], citations: ['https://a.com/1'] }) });
  assert.deepEqual(r.fontes, ['https://a.com/1']);
});

test('429 respeita o Retry-After e tenta de novo', async () => {
  let n = 0;
  const esperas = [];
  const fetchImpl = async (...args) => (++n === 1
    ? erro(429, { 'retry-after': '7' })()
    : ok({ id: 'a', results: [] })(...args));
  await buscar('x', { fetchImpl, esperar: (ms) => { esperas.push(ms); return Promise.resolve(); } });
  assert.deepEqual(esperas, [7000], 'ignorou o Retry-After');
  assert.equal(n, 2);
});

test('401 não é repetido — chave errada não melhora com insistência', async () => {
  let n = 0;
  const fetchImpl = async () => { n++; return erro(401)(); };
  await assert.rejects(() => buscar('x', { fetchImpl }), /401/);
  assert.equal(n, 1);
});

test('a chave nunca sai no erro', async () => {
  try {
    await buscar('x', { fetchImpl: erro(401) });
  } catch (err) {
    assert.doesNotMatch(err.message, /pplx-teste/);
  }
});

test('sem chave, a mensagem diz onde criar', async () => {
  const antes = process.env.PERPLEXITY_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  try {
    await assert.rejects(() => buscar('x', { fetchImpl: ok({}) }), /console\.perplexity\.ai/);
    assert.equal(temChave(), false);
  } finally { process.env.PERPLEXITY_API_KEY = antes; }
});

test('posição do domínio compara host, não pedaço de texto', () => {
  const fontes = ['https://outro.com/a', 'https://www.posthink.com.br/blog/x'];
  assert.equal(posicaoDoDominio(fontes, 'posthink.com.br'), 2);
  assert.equal(posicaoDoDominio(['https://naoposthink.com.br/a'], 'posthink.com.br'), 0,
    'casou com um domínio que só contém o nome');
  assert.equal(posicaoDoDominio(['https://blog.posthink.com.br/a'], 'posthink.com.br'), 1,
    'subdomínio do cliente deveria contar');
  assert.equal(posicaoDoDominio([], 'a.com'), 0);
  assert.equal(posicaoDoDominio(['não é url'], 'a.com'), 0);
});

test('normalizar URL ignora www, barra final, hash e utm', () => {
  assert.equal(normalizarUrl('https://www.A.com/p/?utm_source=x#topo'), 'https://a.com/p');
  assert.equal(normalizarUrl('https://a.com/p?id=2'), 'https://a.com/p?id=2');
});
