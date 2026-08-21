// Registro de adapters + orquestração da publicação.
//
// O contrato do produto: o cliente CONCEDE ACESSO uma vez, não INSTALA código.
// Cada adapter é uma forma diferente de conceder esse acesso.
import * as github from './github.mjs';
import * as wordpress from './wordpress.mjs';
import * as webhook from './webhook.mjs';
import { renderPage, renderSitemap, renderIndex } from '../render.mjs';

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
      const dir = (cfg.contentDir || 'blog').replace(/^\/|\/$/g, '');
      const files = [];

      for (const a of articles) {
        // Artigo em draft nem chega aqui — o Content Engine o segura no banco
        // até a fila de revisão liberar. Mas a checagem fica como rede.
        if (a.frontmatter.draft) continue;
        files.push({
          path: `${dir}/${a.slug}.html`,
          content: renderPage({ slug: a.slug, frontmatter: a.frontmatter,
                                markdown: a.markdown, site, shell: cfg.shell || {} }),
        });
      }

      // O Markdown de origem NÃO é escrito por padrão.
      //
      // Num site estático sem build, tudo que está no repositório é servido.
      // Com cleanUrls ligado, `blog/_src/slug.md` viraria uma URL pública
      // `/blog/_src/slug` — o texto do artigo acessível em duas URLs, o que é
      // conteúdo duplicado e ainda expõe os marcadores internos. Desde a
      // migração 003 o Markdown vive no Neon, então o arquivo é redundante.
      // Quem quiser o fonte versionado liga `keepSource` e assume o Disallow.
      if (cfg.keepSource) {
        for (const a of articles) {
          files.push({ path: `${dir}/_src/${a.slug}.md`, content: toMarkdownFile(a) });
        }
      }

      // Índice e sitemap incluem o que já está publicado MAIS o lote atual —
      // senão o artigo novo só apareceria na listagem na publicação seguinte.
      const publicados = mergePublished(allPublished, articles);
      if (publicados.length) {
        files.push({ path: `${dir}/index.html`, content: renderIndex({ articles: publicados, site, shell: cfg.shell || {} }) });
        files.push({ path: cfg.sitemapPath || 'sitemap-blog.xml', content: renderSitemap(publicados, site) });
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

/** Junta os já publicados com o lote atual, sem duplicar slug. */
function mergePublished(anteriores, lote) {
  const mapa = new Map(anteriores.map((a) => [a.slug, a]));
  for (const a of lote) {
    if (a.frontmatter.draft) continue;
    mapa.set(a.slug, {
      slug: a.slug,
      title: a.frontmatter.title,
      description: a.frontmatter.description,
      cluster: a.frontmatter.tags?.[0],
      first_published_at: a.frontmatter.publishedAt,
      content_updated_at: a.frontmatter.updatedAt,
    });
  }
  return [...mapa.values()].sort((x, y) =>
    new Date(y.first_published_at || 0) - new Date(x.first_published_at || 0));
}

function toMarkdownFile({ frontmatter, markdown }) {
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : typeof v === 'boolean' ? v : JSON.stringify(v)}`)
    .join('\n');
  return `---\n${yaml}\n---\n\n${markdown}\n`;
}
