// TRACKING ENGINE
//
// C5: coleta a janela D-3, não "hoje". O v4 coletaria conjunto vazio todo dia.
// D4: upsert pela chave natural (client, url, metric_date, search_type) —
//     sem ela, cada recoleta duplicava linha e distorcia toda a tendência.
// D6: ctr gravado como fração crua, exatamente como o GSC devolve.
import { cronHandler } from '../../lib/cron-auth.mjs';
import { sql, getClient, withTenant } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { defaultWindow, byPage } from '../../lib/search-console.mjs';

export default cronHandler(async () => {
  const client = await getClient();

  return runStage(client.id, 'tracking', async () => {
    const window = defaultWindow(3);
    let rows;
    try {
      rows = await byPage(window);
    } catch (err) {
      if (err.quota) {
        // PRD §32 stale-while-revalidate: marca o dado mais recente como
        // desatualizado em vez de apagar o gráfico.
        await sql`
          UPDATE seo_metrics SET is_stale = TRUE
           WHERE client_id = ${client.id}
             AND metric_date = (SELECT MAX(metric_date) FROM seo_metrics WHERE client_id = ${client.id})`;
        return { processed: 0, succeeded: 0, note: 'quota GSC — dados marcados como stale' };
      }
      throw err;
    }

    const blogRows = rows.filter((r) => r.pageUrl.includes('/blog/'));
    if (blogRows.length === 0) {
      return { processed: 0, succeeded: 0, window, note: 'sem dados de /blog nesta janela' };
    }

    const articles = await sql`SELECT id, slug FROM articles WHERE client_id = ${client.id}`;
    const bySlug = new Map(articles.map((a) => [a.slug, a.id]));
    const idFor = (url) => bySlug.get(url.replace(/\/$/, '').split('/').pop()) || null;

    let saved = 0;
    await withTenant(client.id, async (c) => {
      for (const r of blogRows) {
        await c.query(
          `INSERT INTO seo_metrics (client_id, article_id, page_url, metric_date,
                                    search_type, position, impressions, clicks, ctr, is_stale)
           VALUES ($1,$2,$3,$4,'web',$5,$6,$7,$8,FALSE)
           ON CONFLICT (client_id, page_url, metric_date, search_type)
           DO UPDATE SET position = EXCLUDED.position,
                         impressions = EXCLUDED.impressions,
                         clicks = EXCLUDED.clicks,
                         ctr = EXCLUDED.ctr,
                         is_stale = FALSE,
                         collected_at = NOW()`,
          [client.id, idFor(r.pageUrl), r.pageUrl, r.metricDate,
           r.position, r.impressions, r.clicks, r.ctr]);
        saved++;
      }
    });

    return { processed: blogRows.length, succeeded: saved, window };
  });
});
