import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateArticle, OPERATOR_MARKER } from '../lib/validate.mjs';

const base = () => ({
  title: 'Como Escolher a Stack Ideal para SaaS em 2026',
  description: 'Guia técnico sobre escolha de stack para startups.',
  summary: 'Resumo para card de listagem.',
  author: 'Tales Hack',
  publishedAt: '2026-08-14T10:00:00Z',
  updatedAt: '2026-08-14T10:00:00Z',
  tags: ['saas'],
  draft: false,
});

const body = (extra = '') => `## Introdução

${'Texto técnico de exemplo com conteúdo suficiente. '.repeat(200)}

Veja também o [guia de deploy](/blog/guia-de-deploy) e a [arquitetura multi-tenant](/blog/multi-tenant).
Conheça os [serviços da HTF](/servicos).
${extra}`;

test('artigo bem formado passa', () => {
  const r = validateArticle({ slug: 'stack-saas-2026', frontmatter: base(), markdown: body() });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('A2: marcador de operador é permitido em draft', () => {
  const fm = { ...base(), draft: true };
  const r = validateArticle({ slug: 'x-y', frontmatter: fm, markdown: body(`\n${OPERATOR_MARKER}: descrever um caso real.`) });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.equal(r.stats.hasOperatorNote, true);
});

test('A2: marcador de operador com draft:false reprova', () => {
  const r = validateArticle({ slug: 'x-y', frontmatter: base(), markdown: body(`\n${OPERATOR_MARKER}: falta contexto.`) });
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.rule === 'operator_note_unresolved'));
});

test('PRD 8.1: estatística sem link de fonte reprova', () => {
  const r = validateArticle({ slug: 'x-y', frontmatter: base(),
    markdown: body('\n\nO tempo de build caiu 47% depois da mudança.') });
  assert.ok(r.errors.some((e) => e.rule === 'unsourced_statistic'));
});

test('PRD 8.1: estatística com link de fonte passa', () => {
  const r = validateArticle({ slug: 'x-y', frontmatter: base(),
    markdown: body('\n\nO limite padrão é 300 segundos, segundo a [documentação da Vercel](https://vercel.com/docs/functions/limitations).') });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

test('PRD 8.2: experiência fabricada reprova', () => {
  const r = validateArticle({ slug: 'x-y', frontmatter: base(),
    markdown: body('\n\nEm nossa experiência, isso sempre funciona.') });
  assert.ok(r.errors.some((e) => e.rule === 'fabricated_experience'));
});

test('D10: slug no frontmatter reprova', () => {
  const r = validateArticle({ slug: 'x-y', frontmatter: { ...base(), slug: 'x-y' }, markdown: body() });
  assert.ok(r.errors.some((e) => e.rule === 'slug_in_frontmatter'));
});

test('frontmatter com campo extra reprova', () => {
  const r = validateArticle({ slug: 'x-y', frontmatter: { ...base(), cluster: 'saas' }, markdown: body() });
  assert.ok(r.errors.some((e) => e.rule === 'frontmatter_extra'));
});

test('PRD 20: sem link de produto reprova', () => {
  const md = `## T\n${'palavra '.repeat(900)}\n[a](/blog/a) [b](/blog/b)`;
  const r = validateArticle({ slug: 'x-y', frontmatter: base(), markdown: md });
  assert.ok(r.errors.some((e) => e.rule === 'product_links'));
});

test('artigo curto reprova', () => {
  const r = validateArticle({ slug: 'x-y', frontmatter: base(), markdown: '## Oi\nTexto curto.' });
  assert.ok(r.errors.some((e) => e.rule === 'word_count'));
});

test('triagem de segurança pega script e handler', () => {
  for (const bad of ['<script>alert(1)</script>', '<img onerror="x">', '[a](javascript:alert(1))']) {
    const r = validateArticle({ slug: 'x-y', frontmatter: base(), markdown: body(`\n\n${bad}`) });
    assert.equal(r.valid, false, `deveria reprovar: ${bad}`);
  }
});

test('slug inválido reprova', () => {
  for (const s of ['Com Maiuscula', 'com_underscore', '-inicio', 'ab']) {
    const r = validateArticle({ slug: s, frontmatter: base(), markdown: body() });
    assert.equal(r.valid, false, `deveria reprovar slug: ${s}`);
  }
});

// --- cold start: blog vazio não pode exigir links para artigos inexistentes ---
const semLinksInternos = `## T
${'palavra '.repeat(900)}
Conheça os [nossos produtos](/produtos).`;

test('blog vazio: não exige links internos', () => {
  const r = validateArticle({ slug: 'primeiro', frontmatter: base(), markdown: semLinksInternos },
    { productPaths: ['/produtos'], existingSlugs: [] });
  assert.equal(r.valid, true, JSON.stringify(r.errors));
  assert.equal(r.stats.minInternalRequired, 0);
});

test('blog com 1 artigo: exige no máximo 1 link interno', () => {
  const r = validateArticle({ slug: 'segundo', frontmatter: base(), markdown: semLinksInternos },
    { productPaths: ['/produtos'], existingSlugs: ['primeiro'] });
  assert.ok(r.errors.some((e) => e.rule === 'internal_links'));
  assert.equal(r.stats.minInternalRequired, 1);
});

test('link para artigo inexistente é reprovado', () => {
  const md = `## T\n${'palavra '.repeat(900)}\n[a](/blog/existe) [b](/blog/inventado) [p](/produtos)`;
  const r = validateArticle({ slug: 'artigo-teste', frontmatter: base(), markdown: md },
    { productPaths: ['/produtos'], existingSlugs: ['existe'] });
  assert.ok(r.errors.some((e) => e.rule === 'broken_internal_link'), JSON.stringify(r.errors));
  assert.match(r.errors.find((e) => e.rule === 'broken_internal_link').detail, /inventado/);
});

test('caminho de produto vem do cliente, não do padrão da HTF', () => {
  const md = `## T\n${'palavra '.repeat(900)}\n[loja](/shop)`;
  const ok = validateArticle({ slug: 'artigo-teste', frontmatter: base(), markdown: md },
    { productPaths: ['/shop'], existingSlugs: [] });
  assert.equal(ok.valid, true, JSON.stringify(ok.errors));
  const nao = validateArticle({ slug: 'artigo-teste', frontmatter: base(), markdown: md },
    { productPaths: ['/produtos'], existingSlugs: [] });
  assert.ok(nao.errors.some((e) => e.rule === 'product_links'));
});
