// Nome de marca não é escolha de estilo do modelo.
//
// 04/11/2026: o artigo sobre o Posthink saiu com "PostHink" em todo o texto —
// H maiúsculo no meio, que lê como outra palavra. Passou em toda validação,
// porque não há regra sobre grafia de nome próprio, e o operador não tinha
// como corrigir: o artigo tinha lacunas, e com lacunas a tela de revisão só
// oferecia os campos das lacunas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corrigirMarcas, resumoDasTrocas, MIN_NOME } from '../lib/marca.mjs';

const PRODUTOS = [{ name: 'Posthink' }, { name: 'GenBreed' }];

test('a grafia registrada substitui qualquer variação de maiúsculas', () => {
  const { markdown, trocas } = corrigirMarcas(
    'O PostHink organiza o fluxo. O POSTHINK não é editor. posthink serve a times.', PRODUTOS);
  assert.equal(markdown,
    'O Posthink organiza o fluxo. O Posthink não é editor. Posthink serve a times.');
  assert.equal(trocas.reduce((n, t) => n + t.vezes, 0), 3);
});

test('o alvo do link não é tocado — ali é caminho, não marca', () => {
  const { markdown } = corrigirMarcas('Veja o [PostHink](/posthink) e o [guia](/blog/posthink-guia).',
    PRODUTOS);
  assert.match(markdown, /\[Posthink\]\(\/posthink\)/);
  assert.match(markdown, /\/blog\/posthink-guia/, 'reescreveu um slug de URL');
});

test('código inline e bloco de código ficam como estão', () => {
  const md = 'Rode `posthink init`.\n\n```bash\nnpm i posthink\n```\n\nO PostHink roda.';
  const { markdown } = corrigirMarcas(md, PRODUTOS);
  assert.match(markdown, /`posthink init`/);
  assert.match(markdown, /npm i posthink/);
  assert.match(markdown, /O Posthink roda/);
});

test('nome dentro de outra palavra não é trocado', () => {
  const { markdown, trocas } = corrigirMarcas('posthinkagem e pré-posthink não são a marca.', PRODUTOS);
  assert.equal(trocas.length, 0);
  assert.equal(markdown, 'posthinkagem e pré-posthink não são a marca.');
});

test('grafia já correta não conta como troca', () => {
  const { trocas } = corrigirMarcas('O Posthink e o GenBreed.', PRODUTOS);
  assert.deepEqual(trocas, []);
});

test('nome curto demais é ignorado — "Post" reescreveria meio texto', () => {
  const { markdown, trocas } = corrigirMarcas('Cada post do blog.', [{ name: 'Pos' }]);
  assert.equal(trocas.length, 0);
  assert.equal(markdown, 'Cada post do blog.');
  assert.ok(MIN_NOME >= 4);
});

test('sem produto cadastrado, o texto passa intacto', () => {
  const md = 'O PostHink organiza.';
  assert.equal(corrigirMarcas(md, []).markdown, md);
  assert.equal(corrigirMarcas(md, undefined).markdown, md);
});

test('o resumo das trocas é legível no log', () => {
  const { trocas } = corrigirMarcas('PostHink e POSTHINK.', PRODUTOS);
  assert.match(resumoDasTrocas(trocas), /"PostHink" → "Posthink"/);
  assert.equal(resumoDasTrocas([]), '');
});

test('o motor de conteúdo e o de reescrita aplicam a correção', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  for (const f of ['../lib/content-engine.mjs', '../lib/rewrite.mjs']) {
    const src = await readFile(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
    assert.match(src, /corrigirMarcas\(/, `${f} não corrige a grafia da marca`);
  }
});

test('a tela de revisão abre o manuscrito inteiro mesmo com lacunas', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../api/ui/review.mjs', import.meta.url)), 'utf8');
  assert.match(src, /total === 0 \|\| texto/,
    'com lacunas, corrigir uma palavra no corpo continua impossível');
  assert.match(src, /\?texto=1/, 'falta o caminho para o manuscrito inteiro');
  assert.match(src, /não apague os marcadores/, 'o operador precisa saber que os marcadores ficam');
});
