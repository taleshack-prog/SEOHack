import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identifyCrawler, extractRequest, aggregate, ESSENCIAIS_GEO } from '../lib/crawlers.mjs';

test('reconhece os três agentes essenciais para GEO', () => {
  assert.equal(identifyCrawler('Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)'), 'OAI-SearchBot');
  assert.equal(identifyCrawler('Mozilla/5.0 (compatible; Claude-SearchBot/1.0)'), 'Claude-SearchBot');
  assert.equal(identifyCrawler('Mozilla/5.0 (compatible; PerplexityBot/1.0)'), 'PerplexityBot');
  for (const a of ESSENCIAIS_GEO) assert.ok(a);
});

test('não confunde agentes com nome parecido', () => {
  // Claude-SearchBot contém "Claude"; a ordem dos padrões precisa proteger isso.
  assert.equal(identifyCrawler('Claude-SearchBot/1.0'), 'Claude-SearchBot');
  assert.equal(identifyCrawler('ClaudeBot/1.0'), 'ClaudeBot');
  assert.equal(identifyCrawler('Claude-User/1.0'), 'Claude-User');
  // GPTBot vs ChatGPT-User vs OAI-SearchBot
  assert.equal(identifyCrawler('GPTBot/1.2'), 'GPTBot');
  assert.equal(identifyCrawler('ChatGPT-User/1.0'), 'ChatGPT-User');
});

test('navegador comum não é contado como crawler', () => {
  assert.equal(identifyCrawler('Mozilla/5.0 (X11; Linux x86_64) Chrome/141.0 Safari/537.36'), null);
  assert.equal(identifyCrawler(''), null);
  assert.equal(identifyCrawler(undefined), null);
});

test('extrai user-agent vindo como array', () => {
  // A Vercel entrega proxy.userAgent como array em algumas origens.
  const r = extractRequest({ proxy: { userAgent: ['GPTBot/1.2'], path: '/blog/x', statusCode: 200 } });
  assert.equal(r.userAgent, 'GPTBot/1.2');
  assert.equal(r.path, '/blog/x');
  assert.equal(r.statusCode, 200);
});

test('campo em lugar diferente não quebra a extração', () => {
  assert.equal(extractRequest({ userAgent: 'ClaudeBot/1.0' }).userAgent, 'ClaudeBot/1.0');
  assert.equal(extractRequest({ headers: { 'user-agent': 'Bingbot/2.0' } }).userAgent, 'Bingbot/2.0');
  assert.deepEqual(extractRequest({}).userAgent, '');
  assert.doesNotThrow(() => extractRequest(null));
});

test('agrega hits do mesmo agente e caminho num só registro', () => {
  const ts = Date.parse('2026-08-21T10:00:00Z');
  const logs = [
    { proxy: { userAgent: ['GPTBot/1.2'], path: '/blog/a', statusCode: 200 } , timestamp: ts },
    { proxy: { userAgent: ['GPTBot/1.2'], path: '/blog/a', statusCode: 200 } , timestamp: ts },
    { proxy: { userAgent: ['GPTBot/1.2'], path: '/blog/b', statusCode: 200 } , timestamp: ts },
    { proxy: { userAgent: ['Chrome/141'], path: '/blog/a', statusCode: 200 } , timestamp: ts },
  ];
  const r = aggregate(logs);
  assert.equal(r.length, 2, 'deveria agrupar por agente+caminho+data');
  const a = r.find((x) => x.path === '/blog/a');
  assert.equal(a.hits, 2);
  assert.equal(a.data, '2026-08-21');
  assert.ok(!r.some((x) => x.agente === null), 'navegador entrou na contagem');
});

test('lote sem crawler devolve lista vazia', () => {
  assert.deepEqual(aggregate([{ proxy: { userAgent: ['Chrome/141'] } }]), []);
  assert.deepEqual(aggregate([]), []);
});

// --- contrato do endpoint ---
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const src = await readFile(fileURLToPath(new URL('../api/logs.mjs', import.meta.url)), 'utf8');

test('assinatura é calculada sobre o corpo cru, não reserializado', () => {
  // JSON.stringify(req.body) muda espaçamento e ordem de chaves; a assinatura
  // passaria a falhar de forma intermitente.
  assert.ok(!src.includes('JSON.stringify(req.body)'), 'reserializa o corpo');
  assert.match(src, /createHmac\('sha1'/, 'a Vercel usa SHA-1, não SHA-256');
  assert.match(src, /timingSafeEqual/);
});

test('header de verificação sai em toda resposta', () => {
  // A Vercel valida o endpoint ANTES de o drain existir, quando ainda não há
  // assinatura para conferir. Se o header só saísse no caminho felizardo, a
  // verificação nunca passaria.
  const antesDoMetodo = src.slice(0, src.indexOf("req.method === 'GET'"));
  assert.match(antesDoMetodo, /x-vercel-verify/);
});

test('endpoint rejeita sem assinatura válida', () => {
  assert.match(src, /statusCode = 401/);
});

// --- leitura do estágio de rastreamento ---
import { readCrawlerStatus, AGENTES_BUSCA, AGENTES_TREINO } from '../lib/crawlers.mjs';

test('regressão: ClaudeBot rastreando não é "citação impossível"', () => {
  // O painel dizia "citação em IA é impossível" com ClaudeBot em 41 visitas.
  // Agente de treinamento passando prova que o robots.txt está certo.
  const r = readCrawlerStatus(['ClaudeBot', 'Googlebot'], 2);
  assert.equal(r.nivel, 'parcial');
  assert.ok(!/impossível/i.test(r.texto), 'ainda afirma impossibilidade');
  assert.match(r.texto, /robots\.txt está correto/);
});

test('agente de busca presente muda o veredito', () => {
  const r = readCrawlerStatus(['OAI-SearchBot', 'ClaudeBot'], 5);
  assert.equal(r.nivel, 'ok');
  assert.match(r.texto, /elegível para citação/);
});

test('nada visitando em site novo é tratado como normal', () => {
  const r = readCrawlerStatus([], 2);
  assert.equal(r.nivel, 'vazio');
  assert.match(r.texto, /Normal para conteúdo publicado/);
});

test('nada visitando após uma semana sugere investigar', () => {
  const r = readCrawlerStatus([], 10);
  assert.match(r.texto, /Firewall da Vercel/);
});

test('agentes de busca e de treinamento são listas distintas', () => {
  for (const a of AGENTES_BUSCA) assert.ok(!AGENTES_TREINO.includes(a), `${a} nas duas listas`);
  assert.ok(AGENTES_TREINO.includes('ClaudeBot'));
  assert.ok(AGENTES_BUSCA.includes('Claude-SearchBot'));
});
