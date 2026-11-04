// Artigo sobre um produto da casa precisa de material do dono.
//
// 04/11/2026: o motor escreveu um guia do Posthink com papéis de usuário,
// fluxo de aprovação, histórico de versões, integração via API com CMS e
// estrutura de planos. O Posthink publica post no LinkedIn. O modelo recebeu
// uma linha de cadastro e 2.000 palavras para preencher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { produtoDoTema, faltaMaterial, MIN_DESCRICAO } from '../lib/produto-tema.mjs';

const COMPLETO = 'Gera e publica posts no LinkedIn a partir de um tema. '.repeat(8);
const PRODUTOS = [
  { name: 'Posthink', path: '/posthink', about: 'Posts no LinkedIn.' },
  { name: 'GenBreed', path: 'https://genbreed.com.br', about: COMPLETO },
];

test('tópico sobre o produto é reconhecido', () => {
  assert.equal(produtoDoTema('Guia completo do Posthink', PRODUTOS)?.name, 'Posthink');
  assert.equal(produtoDoTema('posthink vale a pena?', PRODUTOS)?.name, 'Posthink');
  assert.equal(produtoDoTema('o que é o GenBreed', PRODUTOS)?.name, 'GenBreed');
});

test('tópico que só CITA o produto não é artigo sobre ele', () => {
  // O assunto é do mundo; o produto entra como link. Estes o motor escreve bem.
  assert.equal(produtoDoTema('automação de LinkedIn sem violar os termos de uso', PRODUTOS), null);
  assert.equal(produtoDoTema('coeficiente de endogamia de Wright', PRODUTOS), null);
});

test('nome dentro de outra palavra não conta', () => {
  assert.equal(produtoDoTema('posthinkagem no mercado', PRODUTOS), null);
});

test('cadastro raso barra o tópico antes de gastar', () => {
  const f = faltaMaterial('Guia completo do Posthink', PRODUTOS);
  assert.equal(f.produto, 'Posthink');
  assert.match(f.motivo, /a única fonte sobre o Posthink é você/);
  assert.match(f.motivo, /planos, papéis de usuário e integrações que não existem/);
  assert.match(f.motivo, /Descreva em Produtos/, 'o motivo precisa dizer o que fazer');
});

test('cadastro com substância libera a escrita', () => {
  assert.equal(faltaMaterial('o que é o GenBreed', PRODUTOS), null);
  assert.ok(COMPLETO.length >= MIN_DESCRICAO);
});

test('tópico que não é sobre produto nenhum nunca é barrado', () => {
  assert.equal(faltaMaterial('quadro de Punnett passo a passo', PRODUTOS), null);
  assert.equal(faltaMaterial('qualquer tema', []), null);
});

test('o motor barra o tópico em vez de escrever ficção', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../lib/content-engine.mjs', import.meta.url)), 'utf8');
  assert.match(src, /faltaMaterial\(topic\.topic/);
  // Tem de vir ANTES do UPDATE que marca 'writing' e da chamada ao modelo.
  assert.ok(src.indexOf('faltaMaterial(topic.topic') < src.indexOf("status='writing'"),
    'o tópico seria marcado como em produção antes de se saber que falta material');
  // Compara com a CHAMADA dentro do laço, não com a declaração da função.
  assert.ok(src.indexOf('faltaMaterial(topic.topic') < src.indexOf('await generateOutline(topic'),
    'o gasto viria antes da verificação');
  assert.match(src, /status_reason=\$\{falta\.motivo\}/,
    'sem o motivo gravado, o tópico some da fila sem explicação');
});

test('o contexto proíbe afirmar fato de produto que não está no cadastro', async () => {
  const { buildContext } = await import('../lib/content-engine.mjs');
  const ctx = buildContext({ products: PRODUTOS, blogBasePath: '/blog' }, [], null);
  assert.match(ctx, /é TUDO o que você sabe sobre ele/);
  assert.match(ctx, /recurso, tela, botão, papel de usuário, limite, plano, preço, integração/);
  assert.match(ctx, /SOMENTE o marcador/);
  assert.match(ctx, /Não escreva um parágrafo genérico antes nem depois/,
    'foi exatamente isso que o guia do Posthink fez');
});

test('cliente sem produto cadastrado não recebe a regra', async () => {
  const { buildContext } = await import('../lib/content-engine.mjs');
  const ctx = buildContext({ blogBasePath: '/blog' }, [], null);
  assert.doesNotMatch(ctx, /é TUDO o que você sabe/);
});
