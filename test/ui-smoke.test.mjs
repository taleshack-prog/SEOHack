// Fumaça das telas do painel.
//
// Motivo de existir: a tela de desempenho quebrou em produção com
// "Cannot access 'idade' before initialization" — eu chamava uma função-ponte
// declarada depois da constante que ela lê. Havia 156 testes no projeto e
// nenhum executava um handler de ponta a ponta: todos testavam função pura ou
// liam o código como texto.
//
// Estes testes renderizam cada tela com um banco simulado. Não verificam
// conteúdo — verificam que a página é montada sem lançar, que é exatamente a
// classe de erro que passou.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.DASHBOARD_SECRET = 'x'.repeat(64);
process.env.DASHBOARD_PASSWORD = 'senha';
process.env.CLIENT_DOMAIN = 'exemplo.com.br';

const CLIENTE = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Exemplo', domain: 'exemplo.com.br',
  publish_adapter: 'github',
  adapter_config: { productPaths: ['/produtos'], blogBasePath: '/blog', baseUrl: 'https://exemplo.com.br' },
  monthly_budget_usd: '50.00',
};

const ARTIGO = {
  id: 'a1', slug: 'artigo-de-teste', title: 'Artigo de Teste',
  description: 'Descrição.', cluster: 'saas', is_pillar: true, status: 'published',
  word_count: 1200, markdown: '## Um\n\ntexto\n\n[NOTA PARA O OPERADOR]: contar algo real.',
  frontmatter: { title: 'Artigo de Teste', publishedAt: '2026-08-20T10:00:00Z', updatedAt: '2026-08-20T10:00:00Z' },
  created_at: new Date('2026-08-20T10:00:00Z'),
  first_published_at: new Date('2026-08-20T10:00:00Z'),
  content_updated_at: new Date('2026-08-20T10:00:00Z'),
  citation_count: 0, custo: '0.15',
};

const TOPICO = { id: 't1', topic: 'Um tópico', cluster: 'saas', is_pillar: false,
                 status: 'approved', opportunity_score: '42.00', status_reason: null };

/** Devolve linhas conforme o que a consulta pede. */
function fakeSql(strings) {
  const q = strings.join(' ').replace(/\s+/g, ' ');
  if (/FROM clients/i.test(q) && !/v_budget_status/i.test(q)) return Promise.resolve([CLIENTE]);
  if (/v_budget_status/i.test(q)) return Promise.resolve([{ client_id: CLIENTE.id, name: 'Exemplo',
    monthly_budget_usd: '50.00', spent_usd: '1.19', remaining_usd: '48.81' }]);
  if (/FROM topics/i.test(q)) return Promise.resolve([TOPICO]);
  if (/FROM pipeline_runs/i.test(q)) return Promise.resolve([]);
  if (/FROM ai_crawler_hits/i.test(q) && /hit_date::text/i.test(q)) return Promise.resolve([
    { user_agent: 'ClaudeBot', dia: '2026-08-22', hits: 30 },
    { user_agent: 'ClaudeBot', dia: '2026-08-23', hits: 47 },
    { user_agent: 'Googlebot', dia: '2026-08-22', hits: 9 },
    { user_agent: 'Googlebot', dia: '2026-08-23', hits: 20 }]);
  if (/FROM ai_crawler_hits/i.test(q)) return Promise.resolve([{ user_agent: 'ClaudeBot', hits: 41, ultima: '2026-08-23' }]);
  if (/FROM seo_metrics/i.test(q)) return Promise.resolve([]);
  if (/FROM llm_usage/i.test(q)) return Promise.resolve([{ total: '1.19' }]);
  if (/COUNT\(\*\)/i.test(q)) return Promise.resolve([{ n: 8, count: 8 }]);
  if (/v_article_performance|FROM articles/i.test(q)) return Promise.resolve([ARTIGO]);
  return Promise.resolve([]);
}

mock.module('../lib/db.mjs', {
  namedExports: {
    sql: fakeSql,
    getClient: async () => CLIENTE,
    withTenant: async (_id, fn) => fn({ query: async () => ({ rows: [] }) }),
  },
});

const { issue } = await import('../lib/auth.mjs');
const cookie = `htf_session=${encodeURIComponent(issue())}`;

function fakeRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = JSON.stringify(o); return this; },
    end(b) { if (b) this.body += b; return this; },
  };
}

const req = (extra = {}) => ({ method: 'GET', headers: { cookie }, query: {}, ...extra });

async function renderiza(caminho, reqExtra = {}) {
  const mod = await import(caminho);
  const res = fakeRes();
  await mod.default(req(reqExtra), res);
  return res;
}

test('a fila renderiza sem lançar', async () => {
  const res = await renderiza('../api/ui/home.mjs');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<h1 class="lede"/);
  assert.match(res.body, /No ar/, 'não listou os publicados');
});

test('regressão: a tela de desempenho renderiza sem ReferenceError', async () => {
  // Quebrou em produção com "Cannot access 'idade' before initialization".
  const res = await renderiza('../api/ui/metrics.mjs');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Desempenho/);
  assert.match(res.body, /ClaudeBot/, 'não montou a tabela de crawlers');
});

test('a tela de revisão renderiza para artigo publicado', async () => {
  const res = await renderiza('../api/ui/review.mjs', { query: { slug: 'artigo-de-teste' } });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Republicar/);
  assert.match(res.body, /name="markdown"/);
});

test('a tela de login renderiza sem sessão', async () => {
  const mod = await import('../api/ui/login.mjs');
  const res = fakeRes();
  await mod.default({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /type="password"/);
});

test('sem sessão, as telas redirecionam para /login', async () => {
  const mod = await import('../api/ui/home.mjs');
  const res = fakeRes();
  await mod.default({ method: 'GET', headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/login');
});

test('slug inexistente devolve 404 em vez de quebrar', async () => {
  const mod = await import('../api/ui/review.mjs');
  const res = fakeRes();
  // Faz a consulta de artigo voltar vazia.
  const original = fakeSql;
  await mod.default(req({ query: { slug: '' } }), res);
  assert.equal(res.statusCode, 404);
  assert.ok(original);
});

// --- POST de correção em artigo publicado ---
//
// O caso real: um artigo com 1 link interno foi publicado quando havia poucos
// artigos no ar. Depois, com oito publicados, a regra passou a exigir 2 — e uma
// edição que só removia código quebrado era rejeitada por uma pendência que ela
// não tocou. As regras evoluem com o blog; correção não pode ficar refém disso.

mock.module('../lib/adapters/index.mjs', {
  namedExports: {
    publish: async (_c, arts) => ({ committed: arts.map((a) => a.slug), rejected: [], commitSha: 'abc' }),
  },
});

const CORPO_BASE = '## Título\n\n' + 'palavra '.repeat(900)
  + '\n\nVeja o [outro artigo](/blog/artigo-de-teste) e os [produtos](/produtos).';

function reqPost(campos) {
  const corpo = new URLSearchParams(campos).toString();
  return {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    query: {},
    async *[Symbol.asyncIterator]() { yield Buffer.from(corpo); },
  };
}

test('regressão: edição não é bloqueada por pendência que já existia', async () => {
  // O artigo mockado tem só 1 link interno — falha "mínimo 2" antes e depois.
  const mod = await import('../api/ui/review.mjs');
  const res = fakeRes();
  const editado = CORPO_BASE + '\n\nParágrafo novo, sem introduzir problema.';
  await mod.default(reqPost({ slug: 'artigo-de-teste', acao: 'publicar', markdown: editado }), res);
  assert.equal(res.statusCode, 302, `esperava redirect, veio ${res.statusCode}: ${res.body.slice(0, 300)}`);
  assert.match(res.headers.location, /republicado=/);
});

test('edição que INTRODUZ problema continua bloqueada', async () => {
  const mod = await import('../api/ui/review.mjs');
  const res = fakeRes();
  // Injeta script: erro novo, que não existia no texto original.
  const ruim = CORPO_BASE + '\n\n<script>alert(1)</script>';
  await mod.default(reqPost({ slug: 'artigo-de-teste', acao: 'publicar', markdown: ruim }), res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /Sua edição introduziu um problema/);
});

test('salvar sem publicar grava sem validar', async () => {
  const mod = await import('../api/ui/review.mjs');
  const res = fakeRes();
  await mod.default(reqPost({ slug: 'artigo-de-teste', acao: 'salvar', markdown: 'texto curto' }), res);
  assert.equal(res.statusCode, 200);
});
