// Cliente da Perplexity.
//
// Nenhuma rede: o `fetch` é injetado. A chave entra pelo ambiente e nunca
// aparece em asserção nem em saída de teste.
//
// 20/10/2026 — a Sonar Chat Completions foi desligada em 27/09/2026 e as dez
// medições de citação do dia falharam em bloco com 403. O painel mostrou "0
// citações", indistinguível de uma medição legítima que deu zero. Os testes
// abaixo fixam o endpoint novo, o formato da resposta e o erro de migração.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buscar, responder, lerResposta, posicaoDoDominio, normalizarUrl, temChave, ErroPerplexity,
} from '../lib/perplexity.mjs';

process.env.PERPLEXITY_API_KEY = 'pplx-teste';

const fake = {};
const ok = (corpo) => async (url, init) => {
  fake.ultima = { url, body: JSON.parse(init.body), headers: init.headers };
  return { ok: true, status: 200, json: async () => corpo };
};

const erro = (status, texto = '{"error":"x"}', cabecalhos = {}) => async () => ({
  ok: false, status,
  headers: { get: (k) => cabecalhos[k.toLowerCase()] ?? null },
  text: async () => texto,
});

/** Resposta da Agent API, no formato documentado. */
const RESPOSTA = {
  id: 'resp_1', object: 'response', status: 'completed', model: 'fast',
  output: [
    { type: 'search_results',
      results: [{ url: 'https://a.com/1', title: 'A' }, { url: 'https://b.com/2', title: 'B' }] },
    { type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Funciona assim.' }] },
  ],
};

test('há chave configurada', () => {
  assert.equal(temChave(), true);
});

// --- Search ---

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

// --- Agent ---

test('responder usa /v1/agent com preset e input', async () => {
  const r = await responder('como funciona X?', { fetchImpl: ok(RESPOSTA) });
  assert.match(fake.ultima.url, /\/v1\/agent$/, 'continua chamando o endpoint desligado');
  assert.equal(fake.ultima.body.preset, 'fast');
  assert.equal(fake.ultima.body.input, 'como funciona X?');
  assert.equal('model' in fake.ultima.body, false, 'model sem preset tira a ancoragem na web');
  assert.equal('messages' in fake.ultima.body, false, 'messages é o formato antigo');
  assert.equal(r.answer, 'Funciona assim.');
  assert.deepEqual(r.fontes, ['https://a.com/1', 'https://b.com/2']);
});

test('a resposta é lida do array output tipado, não de choices', () => {
  const r = lerResposta(RESPOSTA);
  assert.equal(r.answer, 'Funciona assim.');
  assert.deepEqual(r.fontes, ['https://a.com/1', 'https://b.com/2']);
});

test('resposta com várias partes de texto é juntada', () => {
  const r = lerResposta({ output: [{ type: 'message', content: [
    { type: 'output_text', text: 'Primeira.' }, { type: 'output_text', text: 'Segunda.' }] }] });
  assert.equal(r.answer, 'Primeira.\nSegunda.');
});

test('resposta sem fontes não quebra', () => {
  const r = lerResposta({ output: [{ type: 'message', content: [{ text: 'só texto' }] }] });
  assert.equal(r.answer, 'só texto');
  assert.deepEqual(r.fontes, []);
});

test('corpo inesperado devolve vazio em vez de lançar', () => {
  assert.deepEqual(lerResposta({}), { answer: '', fontes: [] });
  assert.deepEqual(lerResposta(), { answer: '', fontes: [] });
});

test('403 de endpoint descontinuado é marcado como migração e não é repetido', async () => {
  let n = 0;
  const texto = '{"error":{"message":"Sonar is now the Agent API. Use /v1/agent instead of '
    + '/chat/completions. Migrate here: https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview"}}';
  const fetchImpl = async () => { n++; return erro(403, texto)(); };

  await assert.rejects(() => responder('x', { fetchImpl }), (err) => {
    assert.ok(err instanceof ErroPerplexity);
    assert.equal(err.statusCode, 403);
    assert.equal(err.migracao, true, 'não marcou como migração — o painel mostraria zero');
    return true;
  });
  assert.equal(n, 1, 'repetiu uma falha que só troca de código resolve');
});

test('403 comum não é confundido com migração', async () => {
  await assert.rejects(() => responder('x', { fetchImpl: erro(403, '{"error":"forbidden"}') }),
    (err) => { assert.equal(err.migracao, false); return true; });
});

test('429 respeita o Retry-After e tenta de novo', async () => {
  let n = 0;
  const esperas = [];
  const fetchImpl = async (...args) => (++n === 1
    ? erro(429, 'slow down', { 'retry-after': '7' })()
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

test('chamada que pendura é cortada, para não derrubar o lote inteiro', async () => {
  // A função de citação tem 300s de teto e faz dez chamadas em sequência.
  const esperas = [];
  let n = 0;
  const fetchImpl = async () => {
    n++;
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    throw err;
  };
  await assert.rejects(
    () => responder('x', { fetchImpl, limiteMs: 30000, esperar: (ms) => { esperas.push(ms); return Promise.resolve(); } }),
    /não respondeu em 30s/);
  assert.equal(n, 3, 'desistiu sem tentar de novo');
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
