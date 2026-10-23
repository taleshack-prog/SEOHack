// Reescrita de artigo publicado.
//
// O api/cron/optimization.mjs nasceu com `TODO Sprint 4` no lugar do motor:
// avaliava reescritas antigas, listava candidatos e devolvia succeeded: 0. Na
// tela, isso aparecia como "Melhorar artigo" levando para o editor — ou seja,
// o painel diagnosticava e passava o trabalho adiante.
//
// Reescrever texto que JÁ RANQUEIA tem risco que escrever do zero não tem, e é
// disso que estes testes tratam: alvo errado, piora silenciosa, URL trocada e
// insistência além do limite.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_PROVIDER = 'anthropic';
process.env.ANTHROPIC_API_KEY = 'x';
process.env.LLM_MODEL = 'claude-sonnet-5';

const CLIENTE = {
  id: 'c1', name: 'Exemplo', domain: 'exemplo.com.br', publish_adapter: 'github',
  adapter_config: {
    repo: 'a/b', token: 't', baseUrl: 'https://exemplo.com.br', blogBasePath: '/blog',
    productPaths: ['/produtos'],
  },
};

const ANTIGO = '## O que é\n\n' + 'palavra '.repeat(900)
  + '\n\nVeja o [outro](/blog/outro) e os [produtos](/produtos).';
const NOVO = '## O que é\n\n## Como medir\n\n' + 'palavra '.repeat(1100)
  + '\n\nVeja o [outro](/blog/outro) e os [produtos](/produtos).';

const ARTIGO = {
  id: 'a1', topic_id: 't1', slug: 'net-revenue-retention-o-que-e-e-como-medir',
  title: 'Net Revenue Retention', cluster: 'saas', markdown: ANTIGO,
  frontmatter: { title: 'Net Revenue Retention', publishedAt: '2026-09-01T00:00:00Z',
                 updatedAt: '2026-09-01T00:00:00Z', tags: ['saas'], draft: false },
  rewrite_count: 0,
};

const CONSULTAS = [
  { query: 'net revenue retention', page_url: 'https://exemplo.com.br/blog/net-revenue-retention-o-que-e-e-como-medir',
    impressions: 3, clicks: 0, position: 23 },
  { query: 'o que é nrr', page_url: 'https://exemplo.com.br/blog/net-revenue-retention-o-que-e-e-como-medir',
    impressions: 1, clicks: 0, position: 10 },
];

// Mutáveis por teste.
let artigo = { ...ARTIGO };
let consultas = [...CONSULTAS];
let textoDoModelo = NOVO;
const gravados = [];

function fakeSql(strings, ...vals) {
  const q = strings.join(' ').replace(/\s+/g, ' ');
  gravados.push({ q, vals });
  if (/FROM articles .* AND slug =/is.test(q) && /rewrite_count/.test(q)) {
    return Promise.resolve(artigo ? [artigo] : []);
  }
  if (/FROM gsc_query_metrics/i.test(q)) return Promise.resolve(consultas);
  if (/FROM articles/i.test(q)) return Promise.resolve([{ ...artigo, markdown: ANTIGO }]);
  if (/INSERT INTO optimization_log/i.test(q)) return Promise.resolve([]);
  if (/FROM v_budget_status|FROM llm_usage/i.test(q)) return Promise.resolve([]);
  return Promise.resolve([]);
}

mock.module('../lib/db.mjs', { namedExports: { sql: fakeSql, getClient: async () => CLIENTE } });
mock.module('../lib/budget.mjs', { namedExports: {
  assertBudget: async () => true,
  recordUsage: async () => ({ id: 'u1' }),
  linkUsage: async () => {},
  estimateCost: () => 0,
} });
mock.module('../lib/llm.mjs', { namedExports: {
  complete: async () => ({ text: textoDoModelo, provider: 'anthropic', model: 'claude-sonnet-5',
                           inputTokens: 100, outputTokens: 200, stopReason: 'end_turn' }),
  parseJson: (t) => JSON.parse(t),
} });

const publicacoes = [];
let commitSha = 'd3adbeef'.repeat(5); // 40 hex, como o Git devolve
mock.module('../lib/adapters/index.mjs', { namedExports: {
  publish: async (_c, arts) => {
    publicacoes.push(arts);
    return { committed: arts.map((a) => a.slug), rejected: [], commitSha };
  },
} });

const { reescreverArtigo, escolherAlvo, resumirMudancas, MAX_TENTATIVAS } =
  await import('../lib/rewrite.mjs');

function reset() {
  artigo = { ...ARTIGO };
  consultas = [...CONSULTAS];
  textoDoModelo = NOVO;
  commitSha = 'd3adbeef'.repeat(5);
  publicacoes.length = 0;
  gravados.length = 0;
}

// --- escolha do alvo ---

test('o alvo é a busca com mais impressões FORA do top 10', () => {
  const alvo = escolherAlvo([
    { query: 'ja ranqueia', impressions: 50, position: 3 },
    { query: 'alvo', impressions: 12, position: 23 },
    { query: 'pouca', impressions: 2, position: 40 },
  ]);
  assert.equal(alvo.query, 'alvo', 'mirou numa busca que já está bem posicionada');
});

test('sem busca fora do top 10 não há alvo', () => {
  assert.equal(escolherAlvo([{ query: 'a', impressions: 9, position: 4 }]), null);
});

test('reescrita sem alvo é recusada antes de gastar', async () => {
  reset();
  consultas = [{ ...CONSULTAS[1] }]; // só a que está em 10
  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, false);
  assert.match(r.motivo, /nenhuma busca fora do Top 10/);
  assert.equal(publicacoes.length, 0);
});

// --- o que protege o artigo que já está no ar ---

test('a URL não muda', async () => {
  reset();
  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, true);
  assert.equal(publicacoes[0][0].slug, ARTIGO.slug, 'trocou o slug de uma página que ranqueia');
});

test('a data de publicação original é preservada, só a de atualização muda', async () => {
  reset();
  await reescreverArtigo(CLIENTE, ARTIGO.slug);
  const fm = publicacoes[0][0].frontmatter;
  assert.equal(fm.publishedAt, '2026-09-01T00:00:00Z');
  assert.notEqual(fm.updatedAt, '2026-09-01T00:00:00Z');
  assert.equal(fm.title, 'Net Revenue Retention', 'mexeu no título de uma página posicionada');
});

test('resposta truncada não é publicada', async () => {
  reset();
  textoDoModelo = '## Oi\n\ntexto curto';
  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, false);
  assert.match(r.motivo, /truncada ou vazia/);
  assert.equal(publicacoes.length, 0, 'publicou um artigo de três palavras');
});

test('reescrita que introduz problema não vai ao ar', async () => {
  reset();
  // Perde os dois links e ganha script: erros que o texto antigo não tinha.
  textoDoModelo = '## Novo\n\n' + 'palavra '.repeat(1000) + '\n\n<script>alert(1)</script>';
  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, false);
  assert.match(r.motivo, /introduziu problema/);
  assert.equal(publicacoes.length, 0);
});

test('pendência que já existia no texto antigo não bloqueia a melhoria', async () => {
  reset();
  // Os dois textos têm o mesmo defeito: só 1 link interno.
  artigo = { ...ARTIGO, markdown: '## A\n\n' + 'palavra '.repeat(900) + '\n\n[produtos](/produtos)' };
  textoDoModelo = '## A\n\n## B\n\n' + 'palavra '.repeat(1100) + '\n\n[produtos](/produtos)';
  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, true, 'bloqueou por pendência herdada');
});

// --- a trava de três tentativas ---

test('na quarta tentativa a decisão vira humana', async () => {
  reset();
  artigo = { ...ARTIGO, rewrite_count: MAX_TENTATIVAS };
  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, false);
  assert.match(r.motivo, /decisão agora é humana/);
  assert.equal(publicacoes.length, 0);
});

test('cada reescrita conta uma tentativa', async () => {
  reset();
  artigo = { ...ARTIGO, rewrite_count: 1 };
  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.tentativa, 2);
  const update = gravados.find((g) => /UPDATE articles/.test(g.q) && /rewrite_count/.test(g.q));
  assert.ok(update, 'não gravou a contagem de reescritas');
});

test('o log de otimização é gravado para o cron avaliar em 30 dias', async () => {
  reset();
  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, true);
  const log = gravados.find((g) => /INSERT INTO optimization_log/.test(g.q));
  assert.ok(log, 'sem log, optimization_log nunca responde se a reescrita funcionou');
  assert.ok(log.vals.includes(23), 'não guardou a posição de antes');
});

test('trigger_reason fora do CHECK é recusado antes do banco', async () => {
  reset();
  await assert.rejects(() => reescreverArtigo(CLIENTE, ARTIGO.slug, { motivo: 'porque sim' }),
    /trigger_reason inválido/);
});

test('artigo inexistente não quebra', async () => {
  reset();
  artigo = null;
  const r = await reescreverArtigo(CLIENTE, 'nao-existe');
  assert.equal(r.publicado, false);
  assert.match(r.motivo, /não encontrado/);
});

test('o resumo das mudanças é mecânico e legível', () => {
  // A contagem inclui as palavras do próprio título de seção, por isso o corpo
  // cresce 48 e o total 50: 100+2 antes, 148+4 depois.
  const m = resumirMudancas({
    antes: '## A\n' + 'uma '.repeat(100),
    depois: '## A\n## B\n' + 'uma '.repeat(148),
    alvo: { query: 'net revenue retention', position: 23 },
  });
  assert.match(m, /net revenue retention/);
  assert.match(m, /\+50 palavras/);
  assert.match(m, /\+1 seção/);
});

// --- o cron deixou de ser esboço ---

test('o cron de otimização chama o motor em vez do TODO', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../api/cron/optimization.mjs', import.meta.url)), 'utf8');
  assert.match(src, /reescreverArtigo/);
  assert.doesNotMatch(src, /TODO Sprint 4/, 'o esboço continua lá');
  assert.doesNotMatch(src, /succeeded: 0,/, 'ainda devolve zero fixo');
  assert.match(src, /catch \(err\)/, 'uma página sem alvo derrubaria as outras');
});

test('a tela de consultas age, não manda para o editor', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../api/ui/consultas.mjs', import.meta.url)), 'utf8');
  assert.match(src, /action="\/api\/ui\/melhorar"/);
  assert.doesNotMatch(src, /class="pill">Melhorar artigo<\/a>/, 'voltou a ser só link');
});

test('a função de melhorar leva os prompts no pacote', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const v = JSON.parse(await readFile(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
  // Sem includeFiles o prompt não vai para dentro da função e a reescrita
  // morre no cold start com ENOENT.
  assert.equal(v.functions['api/ui/melhorar.mjs'].includeFiles, 'prompts/**');
  assert.equal(v.functions['api/cron/optimization.mjs'].includeFiles, 'prompts/**');
  assert.ok(mock);
});

// --- o que o banco aceita ---
//
// O 500 de /api/ui/topicos foi exatamente isto: código gravando um valor que o
// CHECK da migração não aceita, descoberto em produção. A reescrita escreve em
// quatro colunas com restrição (trigger_reason, llm_usage.stage, rewrite_count,
// github_commit_sha), então o teste lê a migração em vez de confiar na memória.
test('os valores gravados cabem nos CHECK da migração', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const mig = await readFile(
    fileURLToPath(new URL('../db/migrations/001_schema_v5.sql', import.meta.url)), 'utf8');
  const src = await readFile(
    fileURLToPath(new URL('../lib/rewrite.mjs', import.meta.url)), 'utf8');

  const permitidos = (coluna) => {
    const bloco = mig.match(new RegExp(`CHECK \\(${coluna} IN \\(([^)]*)\\)`, 's'));
    assert.ok(bloco, `a migração não tem mais CHECK em ${coluna}`);
    return bloco[1].match(/'[^']+'/g).map((v) => v.slice(1, -1));
  };

  // trigger_reason: a lista do código tem de ser subconjunto da do banco.
  const motivos = src.match(/const MOTIVOS = \[([^\]]*)\]/s)[1]
    .match(/'[^']+'/g).map((v) => v.slice(1, -1));
  const doBanco = permitidos('trigger_reason');
  for (const m of motivos) assert.ok(doBanco.includes(m), `trigger_reason "${m}" viola o CHECK`);
  assert.ok(motivos.includes('content_gap'), 'o motivo usado pelo painel saiu da lista');

  // llm_usage.stage: 'rewrite' precisa estar previsto, senão a cobrança falha
  // DEPOIS de o modelo ter sido chamado e pago.
  assert.ok(permitidos('stage').includes('rewrite'));
  assert.match(src, /stage: 'rewrite'/);

  // pipeline_runs.stage: é o que /api/ui/melhorar abre.
  const melhorar = await readFile(
    fileURLToPath(new URL('../api/ui/melhorar.mjs', import.meta.url)), 'utf8');
  assert.match(melhorar, /'optimization'/);

  // rewrite_count BETWEEN 0 AND 3: a trava do código não pode passar da do banco.
  const faixa = mig.match(/rewrite_count[^\n]*BETWEEN (\d+) AND (\d+)/);
  assert.ok(faixa, 'a migração não limita mais rewrite_count');
  assert.ok(MAX_TENTATIVAS <= Number(faixa[2]),
    `MAX_TENTATIVAS ${MAX_TENTATIVAS} estouraria o CHECK ate ${faixa[2]}`);
});

test('commit sha que não couber em CHAR(40) é descartado, não derruba o UPDATE', async () => {
  reset();
  // O artigo foi publicado; o que não cabe no banco é só a referência a ele.
  // Um adapter futuro que devolva um caminho, ou um id de API, daria 22001 no
  // UPDATE e o banco ficaria sem registro de uma reescrita que aconteceu.
  commitSha = 'commit/em/um/caminho/que/nao-e-sha-de-git';
  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, true, 'perdeu a reescrita por causa de um identificador');
  const update = gravados.find((g) => /UPDATE articles/.test(g.q));
  assert.ok(update.vals.includes(null), 'tentou gravar texto livre em CHAR(40)');
});

test('sha de 40 hex é preservado', async () => {
  reset();
  await reescreverArtigo(CLIENTE, ARTIGO.slug);
  const update = gravados.find((g) => /UPDATE articles/.test(g.q));
  assert.ok(update.vals.includes('d3adbeef'.repeat(5)));
});

// --- a trava de repetição ----------------------------------------------------
test('reescrita que repete mais que o texto atual não vai ao ar', async () => {
  reset();
  const ideia = 'A homozigose de alelos recessivos deletérios aumenta a cada geração '
    + 'de acasalamento entre parentes dentro da mesma linhagem fechada.';
  const parafrase = 'O acasalamento entre parentes aumenta, geração após geração, a '
    + 'homozigose dos alelos recessivos deletérios daquela linhagem fechada.';
  const outra = 'Criadores acompanham o tamanho médio da ninhada e a mortalidade dos '
    + 'filhotes para perceber o problema cedo.';

  artigo = { ...ARTIGO, markdown: `## A\n\n${ideia}\n\n${outra}\n\n[produtos](/produtos)\n[o](/blog/outro)` };
  textoDoModelo = `## A\n\n## Em outras palavras\n\n${ideia}\n\n${parafrase}\n\n${outra}\n\n`
    + 'palavra '.repeat(300) + '\n\n[produtos](/produtos)\n[o](/blog/outro)';

  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, false);
  assert.match(r.motivo, /repete mais que o texto atual/);
  assert.match(r.motivo, /homozigose/, 'não mostrou qual trecho repetiu');
  assert.equal(publicacoes.length, 0);
});

test('repetição que já existia no texto antigo não bloqueia', async () => {
  reset();
  const ideia = 'A homozigose de alelos recessivos deletérios aumenta a cada geração '
    + 'de acasalamento entre parentes dentro da mesma linhagem fechada.';
  const parafrase = 'O acasalamento entre parentes aumenta, geração após geração, a '
    + 'homozigose dos alelos recessivos deletérios daquela linhagem fechada.';
  // Os dois textos repetem igual; o novo só acrescenta conteúdo diferente.
  artigo = { ...ARTIGO, markdown: `## A\n\n${ideia}\n\n${parafrase}\n\n[p](/produtos)\n[o](/blog/outro)` };
  textoDoModelo = `## A\n\n## B\n\n${ideia}\n\n${parafrase}\n\n` + 'palavra '.repeat(400)
    + '\n\n[p](/produtos)\n[o](/blog/outro)';

  const r = await reescreverArtigo(CLIENTE, ARTIGO.slug);
  assert.equal(r.publicado, true, 'bloqueou por repetição herdada do texto antigo');
});

test('o prompt manda melhorar a seção existente em vez de criar outra', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../lib/rewrite.mjs', import.meta.url)), 'utf8');
  assert.match(src, /procure a que já responde/);
  assert.match(src, /FAQ que devolve o que o corpo já respondeu/);
  assert.doesNotMatch(src, /em uma seção dedicada se\n\s*ainda não houver/,
    'a instrução que produziu a seção repetida continua lá');
});
