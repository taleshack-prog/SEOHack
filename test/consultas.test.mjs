// Consultas reais da Search Console.
//
// Por que existe: em 47 dias o blog somou 28 artigos, 16 deles no Top 10, e
// 124 impressões. Posição 1,0 com 3 impressões. O problema nunca foi posição —
// é tópico sem demanda. E a tabela gsc_query_metrics, que guardaria a única
// evidência de demanda real, estava no schema desde a migração 001 sem nunca
// ter recebido uma linha.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorConsulta, estadoDaConsulta, aMelhorar, paginasSobrecarregadas, resumo,
  cobertura, ehLacuna, palavras, slugDaUrl,
} from '../lib/consultas.mjs';

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

test('o resumo conta sem adjetivo', () => {
  const r = resumo(agruparPorConsulta([
    linha('a', 'u', 10, 1, 3), linha('b', 'u', 4, 0, 15), linha('c', 'u', 2, 0, 40)]));
  assert.deepEqual(r, { consultas: 3, impressoes: 16, cliques: 1, traz: 1, quase: 1, longe: 1 });
});

// --- escrever x melhorar ---
//
// Dados reais da coleta de 20/10/2026.

const DEPRESSAO = 'https://hacktechfarm.com.br/blog/depressao-endogamica-o-que-a-consanguinidade-faz';
const ARRMRR = 'https://hacktechfarm.com.br/blog/arr-ou-mrr-qual-metrica-usar-e-quando';
const CAC = 'https://hacktechfarm.com.br/blog/como-calcular-cac-e-a-relacao-ltv-cac-no-saas';
const PELAGEM = 'https://hacktechfarm.com.br/blog/genetica-da-cor-da-pelagem-em-gatos-guia-completo';

test('consulta cujo artigo já é dela não vira tópico novo', () => {
  // "depressão endogâmica", 12 impressões na posição 10,1: tem artigo dedicado.
  // A versão anterior oferecia "virar tópico" aqui, o que criaria um segundo
  // artigo disputando a mesma busca com o primeiro.
  assert.equal(cobertura('depressão endogâmica', DEPRESSAO), 1);
  assert.equal(ehLacuna({ query: 'depressão endogâmica', pagina: DEPRESSAO }), false);
});

test('o prefixo faz "cálculo" casar com "calcular"', () => {
  assert.ok(cobertura('cálculo cac ltv', CAC) > 0.9);
});

test('busca sem artigo próprio continua sendo lacuna', () => {
  // "como funciona o gene mc1r" caiu na página de cor da pelagem, que não é
  // sobre o gene. Aqui um artigo novo acrescenta.
  assert.ok(cobertura('como funciona o gene mc1r', PELAGEM) < 0.5);
  assert.equal(ehLacuna({ query: 'como funciona o gene mc1r', pagina: PELAGEM }), true);
});

test('as de ligação não contam para a cobertura', () => {
  assert.deepEqual(palavras('o que é a depressão endogâmica'), ['depressao', 'endogamica']);
});

test('separa o que escrever do que melhorar', () => {
  const consultas = agruparPorConsulta([
    linha('depressão endogâmica', DEPRESSAO, 12, 0, 10.1),
    linha('como funciona o gene mc1r', PELAGEM, 2, 0, 11.0),
    linha('acaso', PELAGEM, 1, 0, 30),
  ]);
  const { escrever, melhorar } = aMelhorar(consultas);
  assert.deepEqual(escrever.map((c) => c.query), ['como funciona o gene mc1r']);
  assert.deepEqual(melhorar.map((c) => c.query), ['depressão endogâmica']);
});

test('uma impressão isolada não é demanda', () => {
  const { escrever, melhorar } = aMelhorar(agruparPorConsulta([linha('acaso', PELAGEM, 1, 0, 30)]));
  assert.deepEqual(escrever, []);
  assert.deepEqual(melhorar, []);
});

test('quem já está no top 10 não entra em nenhuma das duas listas', () => {
  const { escrever, melhorar } = aMelhorar(agruparPorConsulta([linha('ja ranqueia', PELAGEM, 40, 3, 4)]));
  assert.deepEqual(escrever, []);
  assert.deepEqual(melhorar, []);
});

// --- uma página, muitas buscas ---

test('a página que serve quatro buscas com posições de 10 a 87 é sinalizada', () => {
  const consultas = agruparPorConsulta([
    linha('o que é arr', ARRMRR, 6, 0, 10.0),
    linha('o que é mrr', ARRMRR, 2, 0, 36.0),
    linha('como calcular mrr', ARRMRR, 2, 0, 80.5),
    linha('mrr o que é', ARRMRR, 2, 0, 87.0),
  ]);
  const [p] = paginasSobrecarregadas(consultas);
  assert.equal(p.pagina, ARRMRR);
  assert.equal(p.consultas.length, 4);
  assert.equal(p.melhor, 10);
  assert.equal(p.pior, 87);
  assert.equal(p.consultas[0].query, 'o que é arr', 'não ordenou da melhor posição para a pior');
});

test('página que responde bem a várias buscas não é sinalizada', () => {
  const consultas = agruparPorConsulta([
    linha('a', PELAGEM, 5, 0, 3), linha('b', PELAGEM, 5, 0, 5), linha('c', PELAGEM, 5, 0, 7)]);
  assert.deepEqual(paginasSobrecarregadas(consultas), []);
});

test('duas buscas na mesma página ainda não é padrão', () => {
  const consultas = agruparPorConsulta([
    linha('a', ARRMRR, 5, 0, 3), linha('b', ARRMRR, 5, 0, 80)]);
  assert.deepEqual(paginasSobrecarregadas(consultas), []);
});

test('o slug sai da URL com ou sem barra final e query string', () => {
  assert.equal(slugDaUrl('https://a.com/blog/meu-artigo/'), 'meu-artigo');
  assert.equal(slugDaUrl('https://a.com/blog/meu-artigo?x=1'), 'meu-artigo');
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
  assert.match(src, /MAX\(period_start\)/);
  assert.doesNotMatch(src, /getDay\(\)/, 'amarrou a coleta a um dia da semana');
});

test('a data da janela não sai como "Sun Sep 20"', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../api/ui/consultas.mjs', import.meta.url)), 'utf8');
  assert.match(src, /dataBr/);
  assert.doesNotMatch(src, /String\(linhas\[0\]\.period_start\)\.slice/,
    'voltou a tratar Date como texto');
  // A ação de melhorar deixou de ser link para o editor (linkArtigo) e passou a
  // ser POST em /api/ui/melhorar; quem garante isso é test/rewrite.test.mjs.
  assert.match(src, /botaoMelhorar/, 'a tela perdeu o caminho para melhorar o artigo');
});
