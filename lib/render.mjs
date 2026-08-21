// RENDERIZAÇÃO — dentro do App, não no site do cliente.
//
// Esta é a peça que torna o produto vendável. No PRD v4 a conversão
// Markdown -> HTML acontecia no build.mjs do cliente, o que obrigava a instalar
// código no repositório dele. Agora o App entrega HTML pronto: o site do cliente
// só precisa servir arquivo estático, coisa que ele já faz.
//
// Consequências diretas:
//   - some a duplicação de validate.mjs em três repositórios;
//   - some o verify-articles.mjs que abortava o build;
//   - o JSON-LD deixa de depender de o cliente ter implementado a derivação.
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// Whitelist do PRD §19. É a defesa real contra XSS — a checagem por blacklist
// no validate.mjs é só triagem barata (defeito B3/D12 da auditoria).
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h2', 'h3', 'h4', 'strong', 'em', 'del',
  'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'figure', 'figcaption',
];

const SANITIZE = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    code: ['class'],
    th: ['scope'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Sem data: e sem javascript: — nem em href nem em src.
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href || '';
      const external = /^https?:\/\//i.test(href);
      return {
        tagName: 'a',
        attribs: external
          ? { ...attribs, rel: 'noopener noreferrer', target: '_blank' }  // PRD §35
          : attribs,
      };
    },
    img: (tagName, attribs) => ({
      tagName: 'img',
      attribs: { ...attribs, loading: 'lazy', decoding: 'async' },        // CLS
    }),
    th: (tagName, attribs) => ({
      tagName: 'th',
      attribs: { scope: attribs.scope || 'col' },                         // PRD §33
    }),
  },
};

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** Deriva Article + FAQPage a partir do HTML já renderizado. */
export function buildJsonLd({ frontmatter, html, url, siteName, authorUrl, logoUrl }) {
  const graph = [{
    '@type': 'BlogPosting',
    headline: frontmatter.title,
    description: frontmatter.description,
    datePublished: frontmatter.publishedAt,
    dateModified: frontmatter.updatedAt,          // PRD §37
    inLanguage: 'pt-BR',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: { '@type': 'Person', name: frontmatter.author, ...(authorUrl && { url: authorUrl }) },
    publisher: {
      '@type': 'Organization',
      name: siteName,
      ...(logoUrl && { logo: { '@type': 'ImageObject', url: logoUrl } }),
    },
    keywords: (frontmatter.tags || []).join(', '),
  }];

  // FAQPage: o rich result do Google acabou em 7 de maio de 2026. Mantido
  // porque continua sendo tipo válido do Schema.org e é lido por Bingbot,
  // PerplexityBot e demais crawlers de RAG — que é o objetivo GEO.
  const faq = extractFaq(html);
  if (faq.length >= 2) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faq.map((q) => ({
        '@type': 'Question',
        name: q.question,
        acceptedAnswer: { '@type': 'Answer', text: q.answer },
      })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** H3 dentro da seção de FAQ vira pergunta; o parágrafo seguinte, resposta. */
export function extractFaq(html) {
  const faqStart = html.search(/<h2[^>]*>\s*(FAQ|Perguntas Frequentes)/i);
  if (faqStart === -1) return [];
  const section = html.slice(faqStart);
  const out = [];
  const re = /<h3[^>]*>(.*?)<\/h3>\s*<p>(.*?)<\/p>/gis;
  let m;
  while ((m = re.exec(section))) {
    const question = m[1].replace(/<[^>]+>/g, '').trim();
    const answer = m[2].replace(/<[^>]+>/g, '').trim();
    // Faixa do PRD §6.2 — respostas fora dela degradam a citação.
    if (answer.length >= 40 && answer.length <= 800) out.push({ question, answer });
  }
  return out;
}

/**
 * Markdown -> página HTML completa, pronta para ser servida como arquivo estático.
 * @param {object} shell Template do cliente: { head, headerHtml, footerHtml, bodyEnd }
 *   bodyEnd carrega os <script defer> do site. Fica no fim do body porque a CSP
 *   do cliente é script-src 'self' — script inline não executa, só arquivo.
 */
export function renderPage({ slug, frontmatter, markdown, site, shell = {} }) {
  const dirty = marked.parse(markdown, { gfm: true, breaks: false });
  const body = sanitizeHtml(dirty, SANITIZE);

  const url = `${site.baseUrl}${site.blogBasePath}/${slug}`;
  const jsonLd = buildJsonLd({
    frontmatter, html: body, url,
    siteName: site.name, authorUrl: site.authorUrl, logoUrl: site.logoUrl,
  });

  const words = markdown.split(/\s+/).filter(Boolean).length;
  const readingTime = Math.ceil(words / 220);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(frontmatter.title)}</title>
<meta name="description" content="${esc(frontmatter.description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(frontmatter.title)}">
<meta property="og:description" content="${esc(frontmatter.summary || frontmatter.description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:locale" content="pt_BR">
<meta name="twitter:card" content="summary_large_image">
${site.cssHref ? `<link rel="stylesheet" href="${esc(site.cssHref)}">` : ''}
${shell.head || ''}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
${shell.headerHtml || ''}
<main>
<article>
<h1>${esc(frontmatter.title)}</h1>
<p class="meta">
<time datetime="${esc(frontmatter.publishedAt)}">${frontmatter.publishedAt.slice(0, 10)}</time>
· ${readingTime} min de leitura
${frontmatter.updatedAt !== frontmatter.publishedAt
    ? `· atualizado em <time datetime="${esc(frontmatter.updatedAt)}">${frontmatter.updatedAt.slice(0, 10)}</time>` : ''}
</p>
${body}
</article>
</main>
${shell.footerHtml || ''}
${shell.bodyEnd || ''}
</body>
</html>`;
}

/**
 * Índice do blog. Sem ele, /blog/ responde 404 num site estático — e o link
 * "Blog" do menu levaria a lugar nenhum. Gerado pelo App a cada publicação,
 * pelo mesmo motivo dos artigos: o cliente não deve precisar de build.
 */
export function renderIndex({ articles, site, shell = {} }) {
  const itens = articles.map((a) => {
    const url = `${site.blogBasePath}/${a.slug}`;
    const data = new Date(a.first_published_at || a.content_updated_at);
    return `<li class="post">
  <h2><a href="${esc(url)}">${esc(a.title)}</a></h2>
  <p class="post-sum">${esc(a.description || '')}</p>
  <p class="post-meta"><time datetime="${data.toISOString()}">${data.toLocaleDateString('pt-BR')}</time>${a.cluster ? ` · ${esc(a.cluster)}` : ''}</p>
</li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blog · ${esc(site.name)}</title>
<meta name="description" content="Artigos técnicos sobre SaaS, Web3 e desenvolvimento.">
<link rel="canonical" href="${esc(site.baseUrl + site.blogBasePath)}">
${site.cssHref ? `<link rel="stylesheet" href="${esc(site.cssHref)}">` : ''}
${shell.head || ''}
</head>
<body>
${shell.headerHtml || ''}
<main>
<h1>Blog</h1>
${articles.length ? `<ul class="post-list">\n${itens}\n</ul>` : '<p>Em breve.</p>'}
</main>
${shell.footerHtml || ''}
${shell.bodyEnd || ''}
</body>
</html>`;
}

/** Sitemap só do blog — evita ter que reescrever o sitemap do cliente. */
export function renderSitemap(articles, site) {
  const urls = articles.map((a) => `  <url>
    <loc>${site.baseUrl}${site.blogBasePath}/${a.slug}</loc>
    <lastmod>${new Date(a.content_updated_at || a.first_published_at).toISOString().slice(0, 10)}</lastmod>
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}
