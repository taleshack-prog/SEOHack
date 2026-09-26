// Cadastro de tópicos pelo painel. Motivo de existir: abastecer a fila era a
// última operação presa no terminal (editar CSV + npm run seed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTopicos } from '../lib/topics.mjs';

test('uma linha vira um tópico', () => {
  const { topicos } = parseTopicos('Como fazer o quadro de Punnett', { cluster: 'genetica' });
  assert.equal(topicos.length, 1);
  assert.equal(topicos[0].topic, 'Como fazer o quadro de Punnett');
  assert.equal(topicos[0].cluster, 'genetica');
  assert.equal(topicos[0].isPillar, false);
});

test('asterisco marca pilar e some do título', () => {
  const { topicos } = parseTopicos('* Guia completo de genética felina', {});
  assert.equal(topicos[0].isPillar, true);
  assert.equal(topicos[0].topic, 'Guia completo de genética felina');
});

test('volume e dificuldade depois da barra entram na pontuação', () => {
  const { topicos } = parseTopicos('Castrar gato em Porto Alegre | 480 | 30', {});
  assert.equal(topicos[0].volume, 480);
  assert.equal(topicos[0].dificuldade, 30);
  const semNumero = parseTopicos('Castrar gato em Porto Alegre', {}).topicos[0];
  assert.ok(topicos[0].score > semNumero.score, 'tópico com volume precisa pontuar mais');
});

test('pilar pontua acima do satélite de mesmo volume', () => {
  const [pilar] = parseTopicos('* Guia de genética felina | 300', {}).topicos;
  const [sat] = parseTopicos('Genética de pelagem cinza | 300', {}).topicos;
  assert.ok(pilar.score > sat.score);
});

test('cluster é normalizado para minúsculas com hífen', () => {
  const { topicos } = parseTopicos('Um tópico qualquer aqui', { cluster: ' Genética Felina ' });
  assert.equal(topicos[0].cluster, 'genética-felina');
});

test('linhas vazias, curtas e repetidas viram erro, não tópico', () => {
  const { topicos, erros } = parseTopicos(`
Um tópico perfeitamente válido
curto
Um tópico perfeitamente válido

`, {});
  assert.equal(topicos.length, 1);
  assert.equal(erros.length, 2);
  assert.match(erros.join(' '), /curto demais/);
  assert.match(erros.join(' '), /repetido/);
});

test('cabeçalho de CSV colado por engano é ignorado em silêncio', () => {
  const { topicos, erros } = parseTopicos('cluster,topic,is_pillar\nUm tópico de verdade aqui', {});
  assert.equal(topicos.length, 1);
  assert.equal(erros.length, 0);
});

test('afinidade fora da faixa cai para 1', () => {
  const [a] = parseTopicos('Um tópico qualquer aqui', { afinidade: 99 }).topicos;
  const [b] = parseTopicos('Um tópico qualquer aqui', { afinidade: 1 }).topicos;
  assert.equal(a.score, b.score);
});

test('tipo inválido cai para informational', () => {
  const [t] = parseTopicos('Um tópico qualquer aqui', { tipo: 'sei-la' }).topicos;
  assert.equal(t.tipo, 'informational');
});

test('dificuldade acima de 100 é descartada em vez de distorcer o score', () => {
  const [t] = parseTopicos('Um tópico qualquer aqui | 100 | 900', {}).topicos;
  assert.equal(t.dificuldade, null);
});

// --- a origem gravada precisa existir no schema ---
//
// Caso real: o INSERT do painel gravava source = 'painel'. A coluna tem
// CHECK (source IN ('seed','gsc','manual','gap')) desde a migração 001, então
// o Postgres recusou a linha com 23514 e a tela respondeu 500 — depois de a
// pessoa já ter digitado a lista inteira. Os 263 testes não pegaram porque
// nenhum deles conhecia o CHECK: o banco dos testes é simulado.
//
// Este teste lê a restrição do próprio arquivo de migração. Se alguém mudar a
// lista no schema, ou inventar uma origem nova no código, quebra aqui.
test('a origem do painel é uma das aceitas pelo CHECK da migração', async () => {
  const { FONTE_PAINEL } = await import('../lib/topics.mjs');
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const sql = await readFile(
    fileURLToPath(new URL('../db/migrations/001_schema_v5.sql', import.meta.url)), 'utf8');

  const m = sql.match(/source[\s\S]{0,120}?CHECK\s*\(\s*source\s+IN\s*\(([^)]+)\)/i);
  assert.ok(m, 'não achei o CHECK de topics.source na migração 001');
  const aceitos = m[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));

  assert.ok(aceitos.includes(FONTE_PAINEL),
    `source '${FONTE_PAINEL}' não está em ${aceitos.join(', ')}`);

  // E o valor não pode passar do tamanho da coluna.
  const largura = Number((sql.match(/source\s+VARCHAR\((\d+)\)/i) || [])[1] || 0);
  assert.ok(FONTE_PAINEL.length <= largura, `source não cabe em VARCHAR(${largura})`);
});

test('nenhum INSERT em topics grava uma origem fora do CHECK', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const raiz = fileURLToPath(new URL('../', import.meta.url));
  const sql = await readFile(`${raiz}db/migrations/001_schema_v5.sql`, 'utf8');
  const aceitos = sql.match(/CHECK\s*\(\s*source\s+IN\s*\(([^)]+)\)/i)[1]
    .match(/'([^']+)'/g).map((s) => s.slice(1, -1));

  const dirs = ['api/ui/', 'api/cron/', 'scripts/', 'lib/'];
  for (const d of dirs) {
    for (const f of (await readdir(raiz + d)).filter((n) => n.endsWith('.mjs'))) {
      const src = await readFile(raiz + d + f, 'utf8');
      const bloco = src.match(/INSERT INTO topics[\s\S]{0,900}?VALUES\s*\(([\s\S]{0,500}?)\)\s*\n/i);
      if (!bloco) continue;
      for (const lit of bloco[1].match(/'([^']*)'/g) || []) {
        const v = lit.slice(1, -1);
        // Só interessa o que parece origem: palavra curta, sem espaço.
        if (/^[a-z]{2,10}$/.test(v) && !['pending', 'approved', 'rejected', 'writing'].includes(v)
            && !v.includes('informational')) {
          assert.ok(aceitos.includes(v) || ['manual'].includes(v),
            `${d}${f} grava source/status '${v}', fora de ${aceitos.join(', ')}`);
        }
      }
    }
  }
});
