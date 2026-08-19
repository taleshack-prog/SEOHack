// Registro de adapters + orquestração da publicação.
//
// O contrato do produto: o cliente CONCEDE ACESSO uma vez, não INSTALA código.
// Cada adapter é uma forma diferente de conceder esse acesso.
import * as github from './github.mjs';
import * as wordpress from './wordpress.mjs';
import * as webhook from './webhook.mjs';
import { renderPage, renderSitemap } from '../render.mjs';

export const ADAPTERS = { github, wordpress, webhook };

export function getAdapter(name) {
  const a = ADAPTERS[name];
  if (!a) throw new Error(`Adapter desconhecido: "${name}". Disponíveis: ${Object.keys(ADAPTERS).join(', ')}`);
  return a;
}

export function healthCheck(client) {
  return getAdapter(client.publish_adapter).healthCheck(client.adapter_config);
}

/**
 * Publica um lote já validado.
 * @param {object} client  linha da tabela clients (publish_adapter + adapter_config)
 * @param {Array<{slug, frontmatter, markdown}>} articles
 * @param {Array} allPublished  usado só para regerar o sitemap no adapter github
 */
export async function publish(client, articles, allPublished = []) {
  const cfg = client.adapter_config;
  const site = {
    name: client.name,
    baseUrl: cfg.baseUrl?.replace(/\/$/, '') || `https://${client.domain}`,
    blogBasePath: cfg.blogBasePath || '/blog',
    cssHref: cfg.cssHref,
    authorUrl: cfg.authorUrl,
    logoUrl: cfg.logoUrl,
  };

  switch (client.publish_adapter) {
    case 'github': {
      // Grava HTML renderizado no diretório que o site JÁ serve estaticamente.
      // Para a maioria dos sites estáticos isso é zero alteração de build.
      // O .md vai junto como arquivo de origem/arquivo morto — o site ignora.
      const dir = (cfg.contentDir || 'public/blog').replace(/\/$/, '');
      const files = [];
      for (const a of articles) {
        const html = renderPage({
          slug: a.slug, frontmatter: a.frontmatter, markdown: a.markdown,
          site, shell: cfg.shell || {},
        });
        // Artigo em draft não vira HTML servível — só o fonte fica versionado.
        // É assim que o gate humano funciona sem precisar de build gate.
        if (!a.frontmatter.draft) files.push({ path: `${dir}/${a.slug}.html`, content: html });
        files.push({ path: `${dir}/_src/${a.slug}.md`, content: toMarkdownFile(a) });
      }
      if (allPublished.length) {
        files.push({
          path: (cfg.sitemapPath || 'public/sitemap-blog.xml'),
          content: renderSitemap(allPublished, site),
        });
      }
      const message = `content: ${articles.map((a) => a.slug).join(', ')}`;
      const r = await github.publish({ ...cfg, files, message });
      return { committed: articles.map((a) => a.slug), rejected: [], commitSha: r.commitSha };
    }

    case 'wordpress': {
      const committed = [];
      for (const a of articles) {
        const html = renderPage({
          slug: a.slug, frontmatter: a.frontmatter, markdown: a.markdown, site,
        });
        // O WordPress já entrega o <html> completo; enviamos só o corpo.
        const bodyOnly = html.slice(html.indexOf('<article>'), html.indexOf('</article>') + 10);
        await wordpress.publish(cfg, {
          slug: a.slug, title: a.frontmatter.title,
          excerpt: a.frontmatter.summary || a.frontmatter.description,
          html: bodyOnly, isDraft: a.frontmatter.draft,
          publishedAt: a.frontmatter.publishedAt,
        });
        committed.push(a.slug);
      }
      return { committed, rejected: [], commitSha: null };
    }

    case 'webhook': {
      const payload = articles.map(({ slug, markdown, frontmatter }) => ({ slug, markdown, frontmatter }));
      return webhook.publish(cfg, payload);
    }

    default:
      throw new Error(`Adapter não implementado: ${client.publish_adapter}`);
  }
}

function toMarkdownFile({ frontmatter, markdown }) {
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : typeof v === 'boolean' ? v : JSON.stringify(v)}`)
    .join('\n');
  return `---\n${yaml}\n---\n\n${markdown}\n`;
}
