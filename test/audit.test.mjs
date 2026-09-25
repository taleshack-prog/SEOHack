// Diagnóstico público: a tela é comercial, então cada número precisa vir de
// uma resposta real do site. Estes testes servem um site falso pelo fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditarSite, normalizarDominio, agentesBloqueados, lerSitemap, lerPagina } from '../lib/audit.mjs';

test('normaliza o que a pessoa digita', () => {
  assert.equal(normalizarDominio('https://www.Exemplo.com.br/blog/x').host, 'exemplo.com.br');
  assert.equal(normalizarDominio(' exemplo.com.br ').origem, 'https://exemplo.com.br');
});

test('recusa alvo interno — barreira de SSRF', () => {
  for (const mau of ['localhost', '127.0.0.1', 'http://10.0.0.5', 'roteador.local', '']) {
    assert.throws(() => normalizarDominio(mau), undefined, mau);
  }
});

test('lê bloqueio de robôs de IA no robots.txt', () => {
  const r = `User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\n`;
  assert.deepEqual(agentesBloqueados(r), ['GPTBot']);
});

test('bloqueio geral com curinga pega todos os agentes', () => {
  const fora = agentesBloqueados('User-agent: *\nDisallow: /');
  assert.ok(fora.includes('OAI-SearchBot') && fora.includes('ClaudeBot'));
});

test('Allow: / anula o Disallow do mesmo grupo', () => {
  assert.deepEqual(agentesBloqueados('User-agent: *\nDisallow: /\nAllow: /'), []);
});

test('sitemap comum e índice de sitemaps', () => {
  const s = lerSitemap('<urlset><url><loc>https://x.com/a</loc><lastmod>2026-09-01</lastmod></url></urlset>');
  assert.equal(s.ehIndice, false);
  assert.equal(s.itens[0].loc, 'https://x.com/a');
  assert.equal(lerSitemap('<sitemapindex><sitemap><loc>https://x.com/s1.xml</loc></sitemap></sitemapindex>').ehIndice, true);
});

test('lê título, canonical, JSON-LD e perguntas', () => {
  const p = lerPagina(`<html><head><title>Um título de tamanho razoável</title>
    <meta name="description" content="uma descrição">
    <link rel="canonical" href="https://x.com/">
    <script type="application/ld+json">{"@type":"FAQPage"}</script></head>
    <body><h1>Cabeçalho</h1><h2>O que é isso?</h2><h2>Quanto custa?</h2></body></html>`);
  assert.equal(p.titulo, 'Um título de tamanho razoável');
  assert.equal(p.canonical, 'https://x.com/');
  assert.deepEqual(p.tiposJsonLd, ['FAQPage']);
  assert.equal(p.perguntas, 2);
});

// --- site falso -----------------------------------------------------------
const hoje = new Date().toISOString().slice(0, 10);

function servidor({ robots, sitemap, home, soft404 = false }) {
  return async (url) => {
    const caminho = url.replace('https://exemplo.com.br', '');
    const resp = (texto, ok = true, status = 200) => ({ ok, status, url, text: async () => texto });
    if (caminho === '/robots.txt') return robots === null ? resp('', false, 404) : resp(robots);
    if (caminho === '/sitemap.xml') return sitemap === null ? resp('', false, 404) : resp(sitemap);
    if (caminho === '/' ) return resp(home);
    if (caminho.startsWith('/seohack-teste-404')) {
      return soft404 ? resp(home) : resp('não encontrado', false, 404);
    }
    return resp('', false, 404);
  };
}

const HOME_BOA = `<html><head><title>Exemplo — simulador de coisas úteis</title>
<meta name="description" content="descrição da home">
<link rel="canonical" href="https://exemplo.com.br/">
<script type="application/ld+json">{"@type":"SoftwareApplication"}</script></head>
<body><h1>Exemplo</h1><h2>O que é?</h2><h2>Para quem serve?</h2><h2>Quanto custa?</h2></body></html>`;

const SITEMAP_BOM = `<urlset>${
  ['a', 'b', 'c', 'd', 'e'].map((s) => `<url><loc>https://exemplo.com.br/blog/${s}</loc><lastmod>${hoje}</lastmod></url>`).join('')
}</urlset>`;

const acha = (r, id) => r.checks.find((c) => c.id === id);

test('site bem configurado tira nota alta e nenhuma falha', async () => {
  const r = await auditarSite('exemplo.com.br', {
    fetchImpl: servidor({ robots: 'User-agent: *\nAllow: /\nSitemap: https://exemplo.com.br/sitemap.xml',
                          sitemap: SITEMAP_BOM, home: HOME_BOA }),
  });
  assert.equal(r.checks.filter((c) => c.estado === 'falha').length, 0, JSON.stringify(r.checks, null, 1));
  assert.ok(r.nota >= 90, `nota ${r.nota}`);
  assert.equal(acha(r, 'conteudo').estado, 'ok');
});

test('bloqueio de robô de busca de IA vira falha, não aviso', async () => {
  const r = await auditarSite('exemplo.com.br', {
    fetchImpl: servidor({ robots: 'User-agent: OAI-SearchBot\nDisallow: /', sitemap: SITEMAP_BOM, home: HOME_BOA }),
  });
  assert.equal(acha(r, 'robos_ia').estado, 'falha');
  assert.match(acha(r, 'robos_ia').detalhe, /OAI-SearchBot/);
});

test('soft 404 é detectado', async () => {
  const r = await auditarSite('exemplo.com.br', {
    fetchImpl: servidor({ robots: 'User-agent: *\nAllow: /', sitemap: SITEMAP_BOM, home: HOME_BOA, soft404: true }),
  });
  assert.equal(acha(r, 'soft404').estado, 'falha');
});

test('site sem sitemap, sem dados estruturados e sem blog acusa as três', async () => {
  const r = await auditarSite('exemplo.com.br', {
    fetchImpl: servidor({ robots: null, sitemap: null, home: '<html><head><title>x</title></head><body>oi</body></html>' }),
  });
  assert.equal(acha(r, 'sitemap').estado, 'falha');
  assert.equal(acha(r, 'jsonld').estado, 'falha');
  assert.equal(acha(r, 'conteudo').estado, 'falha');
  assert.ok(r.nota <= 50, `nota ${r.nota}`);
});

test('site que não responde devolve diagnóstico honesto, não erro', async () => {
  const r = await auditarSite('exemplo.com.br', {
    fetchImpl: async () => { throw new Error('conexão recusada'); },
  });
  assert.equal(r.nota, 0);
  assert.equal(r.checks[0].estado, 'falha');
});

test('nenhum texto do diagnóstico promete métrica que não medimos', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../api/diagnostico.mjs', import.meta.url)), 'utf8');
  // O relatório pode CITAR que não usa DA; não pode exibir DA como número.
  assert.doesNotMatch(src, /Domain Authority:\s*\d|DA\s*\d+|\d+%\s*(a|de)\s*mais/i);
});

test('a tela pública renderiza o formulário e é indexável', async () => {
  const mod = await import('../api/diagnostico.mjs');
  const res = { statusCode: 200, body: '', headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { if (b) this.body += b; } };
  await mod.default({ method: 'GET', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /name="site"/);
  assert.match(res.body, /content="index,follow"/, 'a isca precisa ser indexável');
  assert.doesNotMatch(res.body, /Sair|Fila<\/a>/, 'não pode expor o menu do operador');
});
