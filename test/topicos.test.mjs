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
