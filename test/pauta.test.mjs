// A fila se abastece sozinha.
//
// 06/11/2026: o cron de pesquisa rodava toda segunda sem criar tópico nenhum.
// O portão para sair do modo seed são 200 impressões por DIA no /blog, e o
// site faz 1,8 — nunca ia abrir. O motor parecia parado; estava sem entrada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  montarPrompt, normalizarPauta, jaExiste, gerarPauta, ALVO_DA_FILA, MAX_POR_EXECUCAO,
} from '../lib/pauta.mjs';

const PRODUTOS = [
  { name: 'GenBreed', about: 'Simulador de genética para criadores.', clusters: ['genetica'] },
  { name: 'Posthink', about: 'Publica posts no LinkedIn.', clusters: ['automacao'] },
];
const CLUSTERS = [{ cluster: 'genetica', artigos: 10, exemplos: ['Quadro de Punnett', 'Tigre branco'] }];

// --- a regra que decide se o pipeline anda ---

test('o prompt proíbe tema sobre o próprio produto', () => {
  const p = montarPrompt({ produtos: PRODUTOS, clusters: CLUSTERS, existentes: [], quantos: 5 });
  assert.match(p, /nunca\s*\n?sobre o produto/);
  assert.match(p, /guia do <produto>/);
  assert.match(p, /recursos, telas, planos, preços, limites ou integrações/);
  // O motivo tem de estar no prompt, não só na cabeça de quem escreveu.
  assert.match(p, /só o dono tem, e o artigo trava/);
});

test('o prompt entrega os clusters e o que já existe, para não repetir', () => {
  const p = montarPrompt({ produtos: PRODUTOS, clusters: CLUSTERS,
    existentes: ['quadro de punnett passo a passo'], quantos: 5 });
  assert.match(p, /"genetica": 10 artigo/);
  assert.match(p, /quadro de punnett passo a passo/);
  assert.match(p, /NÃO repita nem reformule/);
});

test('blog vazio e sem produto não quebra o prompt', () => {
  const p = montarPrompt({ produtos: [], clusters: [], existentes: [], quantos: 3 });
  assert.match(p, /nenhum produto cadastrado/);
  assert.match(p, /nenhum artigo publicado ainda/);
});

// --- o que entra na fila ---

test('tema repetido é recusado, inclusive reformulado', () => {
  const existentes = ['coeficiente de endogamia de wright'];
  assert.equal(jaExiste('coeficiente de endogamia de Wright', existentes), true);
  assert.equal(jaExiste('como calcular o coeficiente de endogamia de wright', existentes), true);
  assert.equal(jaExiste('depressão endogâmica em bovinos', existentes), false);
});

test('tema curto ou gigante não entra', () => {
  const { aceitos, recusados } = normalizarPauta([
    { topico: 'genética' },
    { topico: 'x'.repeat(220) },
    { topico: 'como ler um pedigree de três gerações' },
  ]);
  assert.equal(aceitos.length, 1);
  assert.equal(recusados.length, 2);
  assert.match(recusados[0].motivo, /tamanho/);
});

test('valor fora da faixa cai no padrão em vez de distorcer o score', () => {
  const { aceitos } = normalizarPauta([
    { topico: 'como ler um pedigree', dificuldade: 999, afinidade: 50, tipo: 'inventado' },
  ]);
  assert.equal(aceitos[0].dificuldade, 50);
  assert.equal(aceitos[0].afinidade, 1);
  assert.equal(aceitos[0].tipo, 'informational');
});

test('a fila sai ordenada por score, e afinidade comercial pesa', () => {
  const { aceitos } = normalizarPauta([
    { topico: 'curiosidade solta sobre gatos', dificuldade: 20, afinidade: 0.5 },
    { topico: 'como calcular consanguinidade de um plantel', dificuldade: 20, afinidade: 2 },
  ]);
  assert.equal(aceitos[0].topico, 'como calcular consanguinidade de um plantel');
  assert.ok(aceitos[0].score > aceitos[1].score * 2);
});

test('o teto por execução é respeitado', () => {
  const muitos = Array.from({ length: 20 }, (_, i) => ({ topico: `tema numero ${i} do blog` }));
  const { aceitos } = normalizarPauta(muitos, { limite: MAX_POR_EXECUCAO });
  assert.equal(aceitos.length, MAX_POR_EXECUCAO);
  assert.ok(ALVO_DA_FILA >= MAX_POR_EXECUCAO);
});

test('cluster vira minúsculas-com-hífen, como o resto do sistema', () => {
  const { aceitos } = normalizarPauta([{ topico: 'como ler pedigree', cluster: 'Genética Animal' }]);
  assert.equal(aceitos[0].cluster, 'genética-animal');
});

// --- a chamada ao modelo ---

test('resposta ilegível não derruba o cron', async () => {
  const r = await gerarPauta({ produtos: PRODUTOS, clusters: [], existentes: [] },
    { completeImpl: async () => ({ text: 'desculpe, não consegui', provider: 'x', model: 'y' }) });
  assert.deepEqual(r.aceitos, []);
  assert.match(r.erro, /ilegível/);
  assert.ok(r.uso, 'o gasto aconteceu e precisa ser contabilizado mesmo assim');
});

test('a pauta volta normalizada a partir do JSON do modelo', async () => {
  const r = await gerarPauta({ produtos: PRODUTOS, clusters: CLUSTERS, existentes: ['tigre branco'] },
    { completeImpl: async () => ({
      text: '{"temas":[{"topico":"como montar um pedigree de tres geracoes","cluster":"genetica",'
        + '"tipo":"informational","dificuldade":30,"afinidade":2,"porque":"quem monta pedigree simula"},'
        + '{"topico":"tigre branco"}]}',
      provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 10, outputTokens: 20 }) });
  assert.equal(r.aceitos.length, 1, 'o repetido tinha de ser recusado');
  assert.equal(r.aceitos[0].cluster, 'genetica');
  assert.ok(r.aceitos[0].score > 0);
});

// --- o cron ---

test('o cron de pesquisa não dorme mais em modo seed', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../api/cron/research.mjs', import.meta.url)), 'utf8');
  assert.match(src, /pautaMode\(client, impressions\)/);
  assert.doesNotMatch(src, /Rode scripts\/seed-topics\.mjs/,
    'o cron continua mandando o operador abastecer a fila à mão');
  assert.match(src, /'approved', NOW\(\)/,
    "tópico gerado precisa entrar approved — o motor de conteúdo só consome approved");
  assert.match(src, /assertBudget/, 'geração sem freio de orçamento');
  assert.match(src, /recordUsage/, 'a chamada semanal precisa aparecer no custo');
});

test('fila cheia não gera nada', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../api/cron/research.mjs', import.meta.url)), 'utf8');
  assert.match(src, /count >= ALVO_DA_FILA/);
  assert.ok(src.indexOf('count >= ALVO_DA_FILA') < src.indexOf('await assertBudget('),
    'gastaria antes de ver que a fila já está cheia');
});

test('array solto no topo não some em silêncio', () => {
  // O parseJson compartilhado recorta de "{" até "}". Com um array no topo ele
  // devolvia o primeiro item como se fosse a resposta inteira, e normalizarPauta
  // via um objeto onde esperava lista: zero aceitos, zero recusados, cron verde
  // e fila vazia. O prompt pede objeto, mas a função aceita as duas formas.
  const direto = normalizarPauta([{ topico: 'como ler um pedigree de tres geracoes' }]);
  const embrulhado = normalizarPauta({ temas: [{ topico: 'como ler um pedigree de tres geracoes' }] });
  assert.equal(direto.aceitos.length, 1);
  assert.deepEqual(embrulhado.aceitos, direto.aceitos);
  assert.deepEqual(normalizarPauta({ outra_chave: 'nada' }).aceitos, []);
});

test('o prompt pede o formato que o parser compartilhado consegue ler', () => {
  const p = montarPrompt({ produtos: [], clusters: [], existentes: [], quantos: 3 });
  assert.match(p, /"temas": \[/, 'pedir array no topo faz a resposta sumir no parseJson');
});
