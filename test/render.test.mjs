import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage, extractFaq, buildJsonLd } from '../lib/render.mjs';

const fm = {
  title: 'Arquitetura SaaS em 2026',
  description: 'Guia técnico.',
  summary: 'Resumo.',
  author: 'Tales Hack',
  publishedAt: '2026-08-14T10:00:00Z',
  updatedAt: '2026-08-19T10:00:00Z',
  tags: ['saas'],
  draft: false,
};
const site = { name: 'Hack Tech Farm', baseUrl: 'https://hacktechfarm.com.br', blogBasePath: '/blog' };

const md = `## Introdução

Texto com [link externo](https://vercel.com/docs) e [interno](/blog/outro).

| Opção | Custo |
| --- | --- |
| A | baixo |

## Perguntas Frequentes

### O que é multi-tenancy?

É a capacidade de uma única instância da aplicação servir múltiplos clientes com isolamento de dados garantido no nível do banco.

### Vale a pena usar RLS?

Sim, desde que a conexão defina o tenant por transação, caso contrário a policy não isola nada e você tem falsa sensação de segurança.`;

test('D12: sanitização remove script e handler de evento', () => {
  const html = renderPage({ slug: 'x', frontmatter: fm, site,
    markdown: md + '\n\n<script>alert(1)</script>\n<img src=x onerror="alert(1)">' });
  assert.ok(!/<script/i.test(html.split('</head>')[1]), 'script sobreviveu no corpo');
  assert.ok(!/onerror/i.test(html), 'handler de evento sobreviveu');
});

test('PRD 35: link externo recebe rel noopener noreferrer', () => {
  const html = renderPage({ slug: 'x', frontmatter: fm, markdown: md, site });
  assert.match(html, /href="https:\/\/vercel\.com\/docs"[^>]*rel="noopener noreferrer"/);
});

test('link interno NÃO recebe target blank', () => {
  const html = renderPage({ slug: 'x', frontmatter: fm, markdown: md, site });
  const anchor = html.match(/<a[^>]*href="\/blog\/outro"[^>]*>/)[0];
  assert.ok(!/target=/.test(anchor));
});

test('PRD 33: th de tabela recebe scope=col', () => {
  const html = renderPage({ slug: 'x', frontmatter: fm, markdown: md, site });
  assert.match(html, /<th scope="col">/);
});

test('C1: FAQPage é derivado e Article também', () => {
  const html = renderPage({ slug: 'x', frontmatter: fm, markdown: md, site });
  const ld = JSON.parse(html.match(/application\/ld\+json">(.*?)<\/script>/s)[1]);
  const types = ld['@graph'].map((n) => n['@type']);
  assert.deepEqual(types, ['BlogPosting', 'FAQPage']);
  assert.equal(ld['@graph'][1].mainEntity.length, 2);
});

test('PRD 37: dateModified vem do updatedAt', () => {
  const ld = buildJsonLd({ frontmatter: fm, html: '', url: 'u', siteName: 's' });
  assert.equal(ld['@graph'][0].dateModified, '2026-08-19T10:00:00Z');
  assert.notEqual(ld['@graph'][0].datePublished, ld['@graph'][0].dateModified);
});

test('resposta de FAQ fora da faixa 40-800 é descartada', () => {
  const html = '<h2>FAQ</h2><h3>Curta?</h3><p>Sim.</p><h3>Boa?</h3><p>' + 'a'.repeat(100) + '</p>';
  const faq = extractFaq(html);
  assert.equal(faq.length, 1);
  assert.equal(faq[0].question, 'Boa?');
});

test('canonical e og:url usam o baseUrl do cliente', () => {
  const html = renderPage({ slug: 'arquitetura-saas', frontmatter: fm, markdown: md, site });
  assert.match(html, /rel="canonical" href="https:\/\/hacktechfarm\.com\.br\/blog\/arquitetura-saas"/);
});

test('título com aspas não quebra o HTML', () => {
  const html = renderPage({ slug: 'x', site, markdown: md,
    frontmatter: { ...fm, title: 'O "melhor" stack <script>' } });
  assert.ok(!/<title>.*<script>/.test(html));
  assert.match(html, /&quot;melhor&quot;/);
});

// --- índice do blog e shell do cliente ---
import { renderIndex } from '../lib/render.mjs';

const publicados = [
  { slug: 'arquitetura-saas', title: 'Arquitetura SaaS em 2026',
    description: 'Guia técnico.', cluster: 'saas',
    first_published_at: '2026-08-19T10:00:00Z', content_updated_at: '2026-08-19T10:00:00Z' },
  { slug: 'gas-fees-evm', title: 'Gas fees na EVM',
    description: 'Como estimar.', cluster: 'web3',
    first_published_at: '2026-08-18T10:00:00Z', content_updated_at: '2026-08-18T10:00:00Z' },
];

const shell = {
  head: '<link rel="stylesheet" href="https://fonts.example/x.css">',
  headerHtml: '<header id="nav">MENU</header>',
  footerHtml: '<footer>RODAPE</footer>',
  bodyEnd: '<script src="/js/site.js" defer></script>',
};

test('índice lista os artigos com URL sem .html (cleanUrls)', () => {
  const html = renderIndex({ articles: publicados, site, shell });
  assert.match(html, /href="\/blog\/arquitetura-saas"/);
  assert.ok(!html.includes('.html"'), 'gerou link com extensão');
});

test('índice injeta cabeçalho, rodapé e script do site', () => {
  const html = renderIndex({ articles: publicados, site, shell });
  assert.match(html, /<header id="nav">MENU<\/header>/);
  assert.match(html, /<footer>RODAPE<\/footer>/);
  assert.match(html, /<script src="\/js\/site\.js" defer><\/script>/);
});

test('CSP: o script do site fica no fim do body, não inline', () => {
  const html = renderPage({ slug: 'x', frontmatter: fm, markdown: md, site, shell });
  const posScript = html.indexOf('/js/site.js');
  const posFooter = html.indexOf('RODAPE');
  assert.ok(posScript > posFooter, 'script deveria vir depois do rodapé');
  // JSON-LD é bloco de dados, não é barrado por script-src 'self'
  assert.match(html, /<script type="application\/ld\+json">/);
});

test('índice vazio não quebra', () => {
  const html = renderIndex({ articles: [], site, shell });
  assert.match(html, /Em breve/);
});

// --- regressão: quebra em produção por dependência ESM ---
// O deploy falhou com ERR_REQUIRE_ESM porque sanitize-html (CommonJS) passou a
// depender de htmlparser2 v12, que é ESM puro. Isso só funciona em runtime com
// suporte a require(esm) — o da Vercel não tinha. Um override fixa o parser na
// última versão CommonJS. Este teste reproduz exatamente o caminho que falhou.
import { createRequire } from 'node:module';

test('sanitize-html carrega por require() sem ERR_REQUIRE_ESM', () => {
  const require = createRequire(import.meta.url);
  const sanitize = require('sanitize-html');
  assert.equal(typeof sanitize, 'function');
  assert.equal(sanitize('<p>ok</p><script>x</script>', { allowedTags: ['p'] }), '<p>ok</p>');
});

test('htmlparser2 resolvido é CommonJS', async () => {
  // O package.json não é exportado pelo campo "exports", então lemos do disco.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const caminho = fileURLToPath(new URL('../node_modules/htmlparser2/package.json', import.meta.url));
  const pkg = JSON.parse(await readFile(caminho, 'utf8'));
  assert.notEqual(pkg.type, 'module',
    `htmlparser2 ${pkg.version} voltou a ser ESM — o override em package.json falhou`);
});

// --- CVE GHSA-vccv-cmxp-4j9h: javascript: via atributos de formulário/mídia ---
// A whitelist já não permite esses atributos, mas o teste trava a garantia:
// se alguém afrouxar allowedAttributes no futuro, isto quebra primeiro.
test('atributos vetados pelo CVE não sobrevivem à sanitização', () => {
  const ataques = [
    '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form>',
    '<video poster="javascript:alert(1)"></video>',
    '<body background="javascript:alert(1)">',
    '<object data="javascript:alert(1)"></object>',
    '<a href="javascript:alert(1)">clique</a>',
    '<img src="javascript:alert(1)">',
  ];
  for (const ataque of ataques) {
    const html = renderPage({ slug: 'x', frontmatter: fm, site, markdown: md + '\n\n' + ataque });
    const corpo = html.slice(html.indexOf('<article>'));
    assert.ok(!/javascript\s*:/i.test(corpo), `passou: ${ataque}`);
    for (const attr of ['formaction', 'poster', 'background', 'action=']) {
      assert.ok(!corpo.includes(attr), `atributo "${attr}" sobreviveu`);
    }
  }
});
