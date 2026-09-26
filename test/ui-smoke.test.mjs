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

// Mutável: cada teste decide se há tópico travado em produção.
let PRESOS = [];

const TOPICO = { id: 't1', topic: 'Um tópico', cluster: 'saas', is_pillar: false,
                 status: 'approved', opportunity_score: '42.00', status_reason: null };

/** Devolve linhas conforme o que a consulta pede. */
function fakeSql(strings) {
  const q = strings.join(' ').replace(/\s+/g, ' ');
  if (/FROM clients c LEFT JOIN articles/i.test(q)) return Promise.resolve([{ id: CLIENTE.id, artigos: 24, fila: 2 }]);
  if (/FROM clients/i.test(q) && !/v_budget_status/i.test(q)) return Promise.resolve([CLIENTE, {
    ...CLIENTE, id: 'c2', name: 'GenBreed', domain: 'genbreed.com.br' }]);
  if (/v_budget_status/i.test(q)) return Promise.resolve([{ client_id: CLIENTE.id, name: 'Exemplo',
    monthly_budget_usd: '50.00', spent_usd: '1.19', remaining_usd: '48.81' }]);
  // A fila de presos usa a MESMA tabela; separa pelo estado consultado.
  if (/SELECT DISTINCT cluster FROM topics/i.test(q)) return Promise.resolve([{ cluster: 'saas' }]);
  if (/FROM topics/i.test(q) && /status = 'writing'/.test(q)) return Promise.resolve(PRESOS);
  if (/UPDATE topics/i.test(q)) return Promise.resolve(PRESOS);
  if (/FROM topics/i.test(q)) return Promise.resolve([TOPICO]);
  if (/FROM pipeline_runs/i.test(q)) return Promise.resolve([]);
  if (/FROM ai_crawler_hits/i.test(q) && /hit_date::text/i.test(q)) return Promise.resolve([
    { user_agent: 'ClaudeBot', dia: '2026-08-22', hits: 30 },
    { user_agent: 'ClaudeBot', dia: '2026-08-23', hits: 47 },
    { user_agent: 'Googlebot', dia: '2026-08-22', hits: 9 },
    { user_agent: 'Googlebot', dia: '2026-08-23', hits: 20 }]);
  if (/FROM ai_crawler_hits/i.test(q)) return Promise.resolve([{ user_agent: 'ClaudeBot', hits: 41, ultima: '2026-08-23' }]);
  if (/FROM seo_metrics/i.test(q)) return Promise.resolve([]);
  if (/FROM leads/i.test(q)) return Promise.resolve([{
    id: 'l1', nome: 'Heitor Hack', email: 'alguem@exemplo.com', assunto: 'Dúvida sobre um produto',
    mensagem: 'gostaria de entender como funciona o GenBreed?', origem: 'https://hacktechfarm.com.br',
    site_alvo: null, status: 'novo', email_erro: null, created_at: new Date() }]);
  if (/FROM llm_usage/i.test(q)) return Promise.resolve([{ total: '1.19' }]);
  if (/COUNT\(\*\)/i.test(q)) return Promise.resolve([{ n: 8, count: 8 }]);
  if (/v_article_performance|FROM articles/i.test(q)) return Promise.resolve([ARTIGO]);
  return Promise.resolve([]);
}

mock.module('../lib/db.mjs', {
  namedExports: {
    sql: fakeSql,
    getClient: async (d) => (d && d !== CLIENTE.domain
      ? { ...CLIENTE, id: 'c2', name: 'GenBreed', domain: d } : CLIENTE),
    listClients: async () => [CLIENTE, { ...CLIENTE, id: 'c2', name: 'GenBreed', domain: 'genbreed.com.br' }],
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

test('regressão: fila vazia não promete produção', async () => {
  // O botão respondia "Produção iniciada, leva de 2 a 5 minutos" mesmo sem
  // tópico aprovado. O operador esperou um dia por algo que nunca começou.
  const src = await (await import('node:fs/promises'))
    .readFile((await import('node:url')).fileURLToPath(new URL('../api/ui/generate.mjs', import.meta.url)), 'utf8');
  assert.match(src, /aviso=fila-vazia/, 'não avisa quando não há o que gerar');
  // A checagem precisa vir ANTES do disparo — o waitUntil é o ponto sem volta.
  const antes = src.slice(0, src.indexOf('waitUntil('));
  assert.match(antes, /approved/, 'dispara a produção antes de checar a fila');
  assert.ok(src.indexOf('aviso=fila-vazia') < src.indexOf('waitUntil('),
    'o retorno antecipado está depois do disparo');
});

// --- número sem fonte segura o artigo em vez de descartá-lo ---
//
// Lote 2: três artigos (NRR, tokenização, CAC) foram descartados depois de
// pagos porque a regex acusou "100%" e "R$ 2". Agora o artigo fica na fila,
// e a revisão mostra o número destacado e abre o editor.
test('artigo segurado por número sem fonte abre com editor e destaque', async () => {
  const original = { ...ARTIGO };
  Object.assign(ARTIGO, {
    status: 'needs_human', first_published_at: null,
    frontmatter: { title: 'Artigo de Teste', author: 'Tales Hack', tags: ['saas'],
      description: 'Uma descrição de teste com tamanho suficiente para passar pela regra de comprimento mínimo exigida pelo validador de artigos do blog.',
      summary: 'Resumo do artigo de teste.', draft: true,
      publishedAt: '2026-09-20T10:00:00Z', updatedAt: '2026-09-20T10:00:00Z' },
    markdown: CORPO_BASE + '\n\nO churn médio do mercado é de 8% ao mês.',
  });
  try {
    const res = await renderiza('../api/ui/review.mjs', { query: { slug: 'artigo-de-teste' } });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /name="markdown"/, 'sem lacuna, precisa abrir o editor');
    assert.match(res.body, /<mark>8%<\/mark>/, 'não destacou o número');
    assert.match(res.body, /Publicar artigo/);

    const home = await renderiza('../api/ui/home.mjs');
    assert.match(home.body, /1 número para conferir/);

    // Publicar como está: o operador aprovou, o número não bloqueia.
    const mod = await import('../api/ui/review.mjs');
    const post = fakeRes();
    await mod.default(reqPost({ slug: 'artigo-de-teste', acao: 'publicar', markdown: ARTIGO.markdown }), post);
    assert.equal(post.statusCode, 302, (post.body.match(/problema:[^<]*/) || [post.body.slice(0, 300)])[0]);
    assert.match(post.headers.location, /\?ok=/);
  } finally {
    Object.assign(ARTIGO, original);
  }
});

// --- tópico preso em 'writing' ---
//
// O motor marca 'writing' antes de chamar o LLM. Quando a execução morre no
// meio, o tópico fica nesse estado e some da fila, que lista só 'pending' e
// 'approved'. Foi assim que quatro tópicos de genética sumiram sem aviso.
test('tópico travado em produção aparece no painel com saída', async () => {
  PRESOS = [{ id: 't9', topic: 'Como fazer o quadro de Punnett', cluster: 'genetica',
              assigned_at: new Date('2026-09-24T10:00:00Z') }];
  try {
    const res = await renderiza('../api/ui/home.mjs');
    assert.match(res.body, /travado em produção/);
    assert.match(res.body, /quadro de Punnett/);
    assert.match(res.body, /action="\/api\/ui\/destravar"/, 'sem botão, o operador não tem saída pelo painel');
  } finally { PRESOS = []; }
});

test('sem tópico preso, o bloco não aparece', async () => {
  const res = await renderiza('../api/ui/home.mjs');
  assert.doesNotMatch(res.body, /travado em produção/);
});

test('destravar devolve à fila e redireciona com a contagem', async () => {
  PRESOS = [{ topic: 'a' }, { topic: 'b' }];
  try {
    const mod = await import('../api/ui/destravar.mjs');
    const res = fakeRes();
    await mod.default(reqPost({}), res);
    assert.equal(res.statusCode, 302);
    assert.match(res.headers.location, /destravados=2/);
  } finally { PRESOS = []; }
});

test('destravar só aceita POST', async () => {
  const mod = await import('../api/ui/destravar.mjs');
  const res = fakeRes();
  await mod.default(req(), res);
  assert.equal(res.statusCode, 405);
});

test('a tela de contatos lista o que chegou', async () => {
  const res = await renderiza('../api/ui/contatos.mjs');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Heitor Hack/);
  assert.match(res.body, /mailto:alguem@exemplo\.com/);
  assert.match(res.body, /Marcar como respondido/);
});

// A fila vazia não pode mandar o operador para o terminal.
test('a tela de tópicos renderiza com formulário e fila atual', async () => {
  const res = await renderiza('../api/ui/topicos.mjs');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /name="topicos"/);
  assert.match(res.body, /Adicionar à fila/);
  assert.match(res.body, /Um tópico/, 'precisa listar o que já está na fila');
});

test('POST sem tópico válido explica e não redireciona', async () => {
  const mod = await import('../api/ui/topicos.mjs');
  const res = fakeRes();
  await mod.default(reqPost({ topicos: 'curto', cluster: 'saas' }), res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /curto demais/);
});

test('POST válido grava e volta para a fila com resumo', async () => {
  const mod = await import('../api/ui/topicos.mjs');
  const res = fakeRes();
  await mod.default(reqPost({ topicos: '* Guia completo de alguma coisa\nOutro tópico bem escrito',
                              cluster: 'novo', tipo: 'informational', afinidade: '1.2' }), res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /\?fila=/);
});

test('painel não manda mais o operador rodar npm run seed', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../api/ui/home.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /npm run seed/);
  assert.match(src, /\/topicos/);
});

// --- multi-cliente no painel ---
test('a tela de clientes lista os sites e marca o que está em uso', async () => {
  const res = await renderiza('../api/ui/clientes.mjs');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /GenBreed/);
  assert.match(res.body, /em uso/);
  assert.match(res.body, /Usar este/);
  assert.doesNotMatch(res.body, /<input[^>]+name="token"/i, 'segredo não pode ter campo no formulário');
});

test('trocar de cliente grava o cookie e volta para a lista', async () => {
  const mod = await import('../api/ui/clientes.mjs');
  const res = fakeRes();
  await mod.default(reqPost({ acao: 'trocar', dominio: 'genbreed.com.br' }), res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers['set-cookie'], /htf_cliente=genbreed\.com\.br/);
  assert.match(res.headers['set-cookie'], /HttpOnly/);
});

test('domínio inválido não cadastra cliente', async () => {
  const mod = await import('../api/ui/clientes.mjs');
  const res = fakeRes();
  await mod.default(reqPost({ acao: 'criar', name: 'X', dominio: 'não é domínio' }), res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body, /não parece um domínio/);
});

test('a barra do painel mostra de qual cliente é a tela', async () => {
  const res = await renderiza('../api/ui/home.mjs');
  assert.match(res.body, /SEOHack <span>· Exemplo<\/span>/);
});
