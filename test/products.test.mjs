// Produto com cluster próprio (GenBreed): o cluster "genetica" foi criado para
// levar leitores a genbreed.com.br. Sem estas garantias, o artigo podia cumprir
// a regra de link de produto apontando para /contato, e o produto que motivou
// o cluster ficava sem visita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArticle, productForCluster } from '../lib/validate.mjs';
import { buildContext } from '../lib/content-engine.mjs';

const GENBREED = { path: 'https://genbreed.com.br', name: 'GenBreed',
  about: 'simulador de laboratório de genética com herança mendeliana real.', clusters: ['genetica'],
  voice: 'Escreva como professor de genética.' };
const site = { productPaths: ['/produtos', '/contato'], products: [GENBREED],
               existingSlugs: ['x'], blogBasePath: '/blog' };

const fm = {
  title: 'Quadro de Punnett', author: 'Tales Hack', tags: ['genetica'], draft: false,
  description: 'Aprenda a montar o quadro de Punnett passo a passo, com exemplos de cruzamento monoíbrido e diíbrido e a leitura das proporções.',
  summary: 'Guia prático do quadro de Punnett.',
  publishedAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z',
};
const corpo = (links) => `## Quadro de Punnett\n\n${'palavra '.repeat(900)}\n\n[outro](/blog/x) ${links}`;
const erros = (md, cluster) =>
  validateArticle({ slug: 'quadro-de-punnett', frontmatter: fm, markdown: md }, { ...site, cluster })
    .errors.map((e) => e.rule);

test('artigo do cluster genetica sem link para o GenBreed reprova', () => {
  assert.ok(erros(corpo('[fale conosco](/contato)'), 'genetica').includes('cluster_product_link'));
});

test('artigo do cluster genetica com link para o GenBreed passa', () => {
  const r = erros(corpo('[pratique no simulador](https://genbreed.com.br)'), 'genetica');
  assert.deepEqual(r, []);
});

test('link para subpágina do produto também conta', () => {
  assert.deepEqual(erros(corpo('[crie sua conta](https://genbreed.com.br/signup)'), 'genetica'), []);
});

test('URL do produto conta como link de produto mesmo fora do productPaths', () => {
  // Sem /contato nem /produtos: só o GenBreed cumpre a regra de produto.
  assert.ok(!erros(corpo('[simulador](https://genbreed.com.br)'), 'saas').includes('product_links'));
});

test('artigo de outro cluster não é obrigado a linkar o GenBreed', () => {
  assert.ok(!erros(corpo('[fale conosco](/contato)'), 'saas').includes('cluster_product_link'));
});

test('domínio parecido não conta como link do produto', () => {
  assert.ok(erros(corpo('[x](/contato) [falso](https://genbreed.com.br.golpe.com)'), 'genetica')
    .includes('cluster_product_link'));
});

test('âncora e query string no link do produto contam', () => {
  assert.deepEqual(erros(corpo('[planos](https://genbreed.com.br/#planos)'), 'genetica'), []);
  assert.deepEqual(erros(corpo('[planos](https://genbreed.com.br?ref=blog)'), 'genetica'), []);
});

test('productForCluster sem cluster ou sem produtos devolve null', () => {
  assert.equal(productForCluster([GENBREED], null), null);
  assert.equal(productForCluster(undefined, 'genetica'), null);
  assert.equal(productForCluster([GENBREED], 'genetica').name, 'GenBreed');
});

test('contexto do modelo descreve o produto e marca o do cluster', () => {
  const ctx = buildContext(site, [], 'genetica');
  assert.match(ctx, /https:\/\/genbreed\.com\.br — GenBreed: simulador/);
  assert.match(ctx, /PRODUTO DESTE CLUSTER/);
  assert.match(ctx, /Linke para https:\/\/genbreed\.com\.br pelo menos uma vez/);
  assert.match(ctx, /- \/contato/, 'caminhos sem cadastro continuam listados');
});

test('contexto de outro cluster lista o produto sem obrigar o link', () => {
  const ctx = buildContext(site, [], 'saas');
  assert.match(ctx, /GenBreed/);
  assert.doesNotMatch(ctx, /PRODUTO DESTE CLUSTER/);
});

test('voz do produto entra só nos artigos do cluster dele', () => {
  assert.match(buildContext(site, [], 'genetica'), /Voz e público deste artigo[\s\S]*professor de genética/);
  assert.doesNotMatch(buildContext(site, [], 'saas'), /Voz e público/);
});

test('primeiro artigo de cluster novo não é obrigado a linkar outro tema', () => {
  const md = `## Punnett\n\n${'palavra '.repeat(900)}\n\n[simulador](https://genbreed.com.br)`;
  const r = validateArticle({ slug: 'quadro-de-punnett', frontmatter: fm, markdown: md },
    { ...site, existingSlugs: ['mrr', 'nrr', 'web3'], cluster: 'genetica', clusterSlugs: [] });
  assert.deepEqual(r.errors.map((e) => e.rule), []);
});

test('com dois artigos no cluster, a exigência de 2 links volta', () => {
  const md = `## Punnett\n\n${'palavra '.repeat(900)}\n\n[simulador](https://genbreed.com.br) [pilar](/blog/pelagem)`;
  const r = validateArticle({ slug: 'quadro-de-punnett', frontmatter: fm, markdown: md },
    { ...site, existingSlugs: ['pelagem', 'albinismo', 'mrr'], cluster: 'genetica',
      clusterSlugs: ['pelagem', 'albinismo'] });
  assert.ok(r.errors.some((e) => e.rule === 'internal_links'));
});
