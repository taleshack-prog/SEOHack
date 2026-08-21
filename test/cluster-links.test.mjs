import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPillarSection, upsertPillarSection, pillarsToRefresh, SENTINELA }
  from '../lib/cluster-links.mjs';

const site = { blogBasePath: '/blog' };

const satelites = [
  { slug: 'quanto-custa-saas', title: 'Quanto custa manter um SaaS', description: 'Custos reais. Detalhes.' },
  { slug: 'multi-tenancy', title: 'Multi-tenancy no PostgreSQL', description: 'Schema vs RLS.' },
];

const pilarMd = `## O que é arquitetura SaaS

Texto do pilar.

## Perguntas Frequentes

### Pergunta?

Resposta com tamanho suficiente para constar no schema de FAQ sem ser descartada.`;

test('seção lista os satélites com link e resumo', () => {
  const s = buildPillarSection(satelites, site);
  assert.match(s, /\[Quanto custa manter um SaaS\]\(\/blog\/quanto-custa-saas\)/);
  assert.match(s, /Custos reais\./);
  assert.ok(!s.includes('Detalhes.'), 'deveria usar só a primeira frase');
});

test('sem satélites não gera seção', () => {
  assert.equal(buildPillarSection([], site), '');
});

test('seção entra antes do FAQ, não depois', () => {
  const out = upsertPillarSection(pilarMd, buildPillarSection(satelites, site));
  assert.ok(out.indexOf(SENTINELA) < out.indexOf('Perguntas Frequentes'),
    'links ficaram depois do FAQ');
});

test('regressão: o pilar passa a ter links de saída', () => {
  // Estado real do blog: o pilar de saas recebia 4 links e devolvia 0.
  assert.equal((pilarMd.match(/\]\(\/blog\//g) || []).length, 0);
  const out = upsertPillarSection(pilarMd, buildPillarSection(satelites, site));
  assert.equal((out.match(/\]\(\/blog\//g) || []).length, 2);
});

test('idempotente: rodar duas vezes não empilha seção', () => {
  const uma = upsertPillarSection(pilarMd, buildPillarSection(satelites, site));
  const duas = upsertPillarSection(uma, buildPillarSection(satelites, site));
  assert.equal(duas, uma);
  assert.equal(duas.split(SENTINELA).length - 1, 1, 'sentinela duplicada');
});

test('satélite novo substitui a seção antiga em vez de somar', () => {
  const uma = upsertPillarSection(pilarMd, buildPillarSection([satelites[0]], site));
  const duas = upsertPillarSection(uma, buildPillarSection(satelites, site));
  assert.equal((duas.match(/\]\(\/blog\//g) || []).length, 2);
  assert.match(duas, /multi-tenancy/);
});

test('pilar sem FAQ recebe a seção no fim', () => {
  const semFaq = '## Só um H2\n\nTexto.';
  const out = upsertPillarSection(semFaq, buildPillarSection(satelites, site));
  assert.ok(out.indexOf(SENTINELA) > out.indexOf('Texto.'));
});

// --- seleção de pilares a atualizar ---
const publicados = [
  { slug: 'pilar-saas', title: 'Pilar SaaS', cluster: 'saas', is_pillar: true, markdown: pilarMd, first_published_at: '2026-08-20' },
  { slug: 'quanto-custa-saas', title: 'Quanto custa', cluster: 'saas', is_pillar: false, markdown: 'x', first_published_at: '2026-08-21' },
  { slug: 'pilar-web3', title: 'Pilar Web3', cluster: 'web3', is_pillar: true, markdown: pilarMd, first_published_at: '2026-08-20' },
];

test('só o pilar do cluster tocado é atualizado', () => {
  const r = pillarsToRefresh(publicados, ['quanto-custa-saas'], site);
  assert.equal(r.length, 1);
  assert.equal(r[0].article.slug, 'pilar-saas');
});

test('publicar um pilar não dispara atualização de pilar', () => {
  assert.equal(pillarsToRefresh(publicados, ['pilar-web3'], site).length, 0);
});

test('cluster sem pilar publicado é ignorado sem quebrar', () => {
  const orfaos = [{ slug: 'solto', title: 'Solto', cluster: 'automacao', is_pillar: false, markdown: 'x' }];
  assert.deepEqual(pillarsToRefresh(orfaos, ['solto'], site), []);
});

test('nada muda se a seção já está correta', () => {
  const atualizado = publicados.map((a) => a.slug === 'pilar-saas'
    ? { ...a, markdown: upsertPillarSection(pilarMd, buildPillarSection([publicados[1]], site)) }
    : a);
  assert.equal(pillarsToRefresh(atualizado, ['quanto-custa-saas'], site).length, 0);
});

// --- sincronização manual pelo painel ---
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const ler = (p) => readFile(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

test('sincronização manual cobre pilar de cluster já completo', () => {
  // A automática só dispara ao publicar satélite. O cluster saas já estava
  // completo quando a função nasceu, então nunca seria corrigido sozinho.
  const completo = [
    { slug: 'pilar-saas', title: 'Pilar', cluster: 'saas', is_pillar: true, markdown: pilarMd, first_published_at: '2026-08-20' },
    { slug: 'sat-1', title: 'S1', cluster: 'saas', is_pillar: false, markdown: 'x', first_published_at: '2026-08-21' },
    { slug: 'sat-2', title: 'S2', cluster: 'saas', is_pillar: false, markdown: 'x', first_published_at: '2026-08-21' },
  ];
  // Nenhuma publicação nova → automática não faz nada
  assert.equal(pillarsToRefresh(completo, [], site).length, 0);
  // Sincronização manual passa todos os satélites → pilar entra na lista
  const todos = completo.filter((a) => !a.is_pillar).map((a) => a.slug);
  const r = pillarsToRefresh(completo, todos, site);
  assert.equal(r.length, 1);
  assert.equal((r[0].markdown.match(/\]\(\/blog\//g) || []).length, 2);
});

test('endpoint de sync não chama o LLM', async () => {
  const src = await ler('api/ui/sync-clusters.mjs');
  assert.ok(!src.includes('complete('), 'sync deveria ser custo zero');
  assert.ok(!src.includes('llm.mjs'), 'sync importou o wrapper de LLM');
  assert.match(src, /requireAuth/, 'endpoint sem autenticação');
});

test('painel detecta pilar sem a seção de links', async () => {
  const src = await ler('api/ui/home.mjs');
  assert.match(src, /Continue neste cluster/, 'não detecta pilar dessincronizado');
  assert.match(src, /sync-clusters/, 'sem botão de sincronizar');
});

test('sync tem duração declarada no vercel.json', async () => {
  const j = JSON.parse(await ler('vercel.json'));
  assert.ok(j.functions['api/ui/sync-clusters.mjs']?.maxDuration >= 60);
});
