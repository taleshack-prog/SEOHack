// Sincronização manual dos links de cluster.
//
// A sincronização automática dispara quando um satélite é publicado. Isso não
// cobre dois casos reais: cluster que já estava completo antes desta função
// existir (o `saas` do blog, cujo pilar recebia quatro links e devolvia zero),
// e artigo editado à mão pela tela de revisão.
//
// Não chama o LLM — monta a lista a partir do banco e regrava o HTML. Custo
// zero, então pode ser acionado à vontade.
import { requireAuth } from '../../lib/auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { pillarsToRefresh } from '../../lib/cluster-links.mjs';
import { publish as publishViaAdapter } from '../../lib/adapters/index.mjs';

export default requireAuth(async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const client = await getClient();

  const resultado = await runStage(client.id, 'optimization', async () => {
    const publicados = await sql`
      SELECT id, slug, title, description, cluster, is_pillar, markdown, frontmatter,
             first_published_at, content_updated_at
        FROM articles
       WHERE client_id = ${client.id} AND status = 'published'`;

    // Passa TODOS os slugs como "recém-publicados": aqui a intenção é revisar
    // o blog inteiro, não reagir a uma publicação específica.
    const todos = publicados.filter((a) => !a.is_pillar).map((a) => a.slug);
    const pendentes = pillarsToRefresh(publicados, todos, client.adapter_config || {});

    if (!pendentes.length) {
      return { processed: 0, succeeded: 0, note: 'todos os pilares já estão sincronizados' };
    }

    const ts = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const lote = pendentes.map(({ article, markdown }) => ({
      slug: article.slug,
      markdown,
      frontmatter: { ...article.frontmatter, updatedAt: ts },
    }));

    const r = await publishViaAdapter(client, lote, publicados);

    for (const item of lote) {
      if (!r.committed.includes(item.slug)) continue;
      await sql`
        UPDATE articles
           SET markdown = ${item.markdown},
               frontmatter = ${JSON.stringify(item.frontmatter)},
               content_updated_at = NOW(), updated_at = NOW()
         WHERE client_id = ${client.id} AND slug = ${item.slug}`;
    }

    return { processed: pendentes.length, succeeded: r.committed.length, pillars: r.committed };
  });

  const msg = resultado.succeeded
    ? `sincronizados=${resultado.succeeded}`
    : 'ja-sincronizado';
  res.statusCode = 302;
  res.setHeader('Location', `/?clusters=${encodeURIComponent(msg)}`);
  res.end();
});
