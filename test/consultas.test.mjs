// Consultas reais da Search Console.
//
// Por que existe: em 47 dias o blog somou 28 artigos, 16 deles no Top 10, e
// 124 impressões. Posição 1,0 com 3 impressões. O problema nunca foi posição —
// é tópico sem demanda. E a tabela gsc_query_metrics, que guardaria a única
// evidência de demanda real, estava no schema desde a migração 001 sem nunca
// ter recebido uma linha.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparPorConsulta, estadoDaConsulta, valemArtigo, resumo } from '../lib/consultas.mjs';

const linha = (query, page_url, impressions, clicks, position) =>
  ({ query, page_url, impressions, clicks, position });

test('a mesma consulta em duas páginas vira uma linha, somando impressões', () => {
  const [c] = agruparPorConsulta([
    linha('quadro de punnett', 'https://a.com/blog/x', 10, 1, 4),
    linha('quadro de punnett', 'https://a.com/blog/y', 5, 0, 12),
  ]);
  assert.equal(c.impressions, 15);
  assert.equal(c.clicks, 1);
  assert.equal(c.paginas, 2, 'não sinalizou duas páginas disputando a mesma busca');
  assert.equal(c.pagina, 'https://a.com/blog/x', 'escolheu a página com menos impressões');
});

test('a posição é ponderada por impressão, não média simples', () => {
  // 300 impressões na posição 2 e 1 na posição 50: a média simples diria 26.
  const [c] = agruparPorConsulta([
    linha('x', 'https://a.com/1', 300, 0, 2),
    linha('x', 'https://a.com/2', 1, 0, 50),
  ]);
  assert.ok(c.position < 3, `esperava perto de 2, veio ${c.position}`);
});

test('sem impressão nenhuma, cai para média simples em vez de dividir por zero', () => {
  const [c] = agruparPorConsulta([linha('x', 'u', 0, 0, 10), linha('x', 'v', 0, 0, 20)]);
  assert.equal(c.position, 15);
  assert.equal(c.ctr, 0);
});

test('consulta vazia é descartada', () => {
  assert.deepEqual(agruparPorConsulta([linha('  ', 'u', 5, 0, 3)]), []);
});

test('ordena por impressão, e desempata por posição', () => {
  const r = agruparPorConsulta([
    linha('b', 'u', 5, 0, 9), linha('a', 'u', 10, 0, 3), linha('c', 'u', 5, 0, 2)]);
  assert.deepEqual(r.map((c) => c.query), ['a', 'c', 'b']);
});

test('o estado separa quem traz, quem está na página 2 e quem está longe', () => {
  assert.equal(estadoDaConsulta({ position: 3 }), 'traz');
  assert.equal(estadoDaConsulta({ position: 10 }), 'traz');
  assert.equal(estadoDaConsulta({ position: 11 }), 'quase');
  assert.equal(estadoDaConsulta({ position: 20 }), 'quase');
  assert.equal(estadoDaConsulta({ position: 21 }), 'longe');
  assert.equal(estadoDaConsulta({ position: null }), 'longe');
});

test('uma impressão isolada não é demanda', () => {
  const consultas = agruparPorConsulta([
    linha('acaso', 'u', 1, 0, 30),
    linha('demanda real', 'u', 9, 0, 14)]);
  const valem = valemArtigo(consultas);
  assert.deepEqual(valem.map((c) => c.query), ['demanda real']);
});

test('quem já está no top 10 não entra na lista de escrever', () => {
  const consultas = agruparPorConsulta([linha('ja ranqueia', 'u', 40, 3, 4)]);
  assert.deepEqual(valemArtigo(consultas), []);
});

test('o resumo conta sem adjetivo', () => {
  const r = resumo(agruparPorConsulta([
    linha('a', 'u', 10, 1, 3), linha('b', 'u', 4, 0, 15), linha('c', 'u', 2, 0, 40)]));
  assert.deepEqual(r, { consultas: 3, impressoes: 16, cliques: 1, traz: 1, quase: 1, longe: 1 });
});

// --- coleta ---
test('o cron grava consultas e respeita o intervalo semanal', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../api/cron/tracking.mjs', import.meta.url)), 'utf8');

  assert.match(src, /INSERT INTO gsc_query_metrics/, 'a tabela continua sem receber linha');
  assert.match(src, /ON CONFLICT \(client_id, page_url, query, period_start\)/,
    'sem upsert pela chave natural, recoletar duplica e distorce a série');
  assert.match(src, /property: client\.gsc_property/,
    'leria a propriedade errada num motor multi-cliente');
  // Intervalo medido pelo dado, não pelo dia da semana: cron que falha no
  // domingo não pode esperar o domingo seguinte.
  assert.match(src, /MAX\(period_start\)/);
  assert.doesNotMatch(src, /getDay\(\)/, 'amarrou a coleta a um dia da semana');
});
