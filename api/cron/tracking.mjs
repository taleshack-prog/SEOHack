// TRACKING ENGINE
//
// C5: coleta a janela D-3, não "hoje". O v4 coletaria conjunto vazio todo dia.
// D4: upsert pela chave natural (client, url, metric_date, search_type) —
//     sem ela, cada recoleta duplicava linha e distorcia toda a tendência.
// D6: ctr gravado como fração crua, exatamente como o GSC devolve.
import { cronHandler } from '../../lib/cron-auth.mjs';
import { sql, listClients, withTenant } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { defaultWindow, janelaLonga, byPage, byPageQuery } from '../../lib/search-console.mjs';

export default cronHandler(async () => {
  // Um cron para todos os sites. Cada cliente tem a própria propriedade na
  // Search Console; rodar um por vez mantém o isolamento e faz com que a falha
  // de um (propriedade sem permissão, por exemplo) não derrube os outros.
  const clientes = await listClients();
  const resultados = [];
  for (const client of clientes) {
    try {
      resultados.push({ cliente: client.domain, ...(await coletar(client)) });
    } catch (err) {
      console.error(`[tracking] ${client.domain}: ${err.message}`);
      resultados.push({ cliente: client.domain, erro: err.message });
    }
  }
  return { clientes: resultados };
});

async function coletar(client) {
  return runStage(client.id, 'tracking', async () => {
    const window = defaultWindow(3);
    let rows;
    try {
      rows = await byPage(window, 1000, { property: client.gsc_property });
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

    // Consulta é outra coleta, com outro ritmo e outro custo.
    const consultas = await coletarConsultas(client);

    return { processed: blogRows.length, succeeded: saved, window, consultas };
  });
}

/**
 * page x query, semanal.
 *
 * Por que semanal e não diário: agrupar por página E consulta é a chamada mais
 * cara em quota da Search Console (C6), e a resposta muda devagar. E por que
 * existe: a tabela gsc_query_metrics está no schema desde a migração 001 e
 * nunca recebeu uma linha — a única evidência de demanda real do projeto estava
 * sendo jogada fora a cada coleta.
 *
 * O intervalo é medido pelo dado, não pelo dia da semana: se o cron falhar numa
 * semana, a próxima execução coleta. Um cron que só roda "aos domingos" perde o
 * domingo em que a função morreu e ninguém percebe.
 */
async function coletarConsultas(client, { dias = 28, minimoDias = 7 } = {}) {
  const [ultima] = await sql`
    SELECT MAX(period_start) AS quando FROM gsc_query_metrics WHERE client_id = ${client.id}`;

  if (ultima?.quando && (Date.now() - new Date(ultima.quando)) < minimoDias * 86400000) {
    return { pulado: 'coletado há menos de uma semana' };
  }

  const janela = janelaLonga(dias);
  let linhas;
  try {
    linhas = await byPageQuery(janela, '/blog/', 5000, { property: client.gsc_property });
  } catch (err) {
    // Falhar aqui não pode derrubar a coleta por página, que já foi gravada.
    console.error(`[tracking] consultas de ${client.domain}: ${err.message}`);
    return { erro: err.message };
  }

  if (!linhas.length) return { gravadas: 0, janela, nota: 'nenhuma consulta na janela' };

  let gravadas = 0;
  await withTenant(client.id, async (c) => {
    for (const r of linhas) {
      await c.query(
        `INSERT INTO gsc_query_metrics (client_id, page_url, query, period_start, period_end,
                                        position, impressions, clicks, ctr)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (client_id, page_url, query, period_start)
         DO UPDATE SET period_end = EXCLUDED.period_end,
                       position = EXCLUDED.position,
                       impressions = EXCLUDED.impressions,
                       clicks = EXCLUDED.clicks,
                       ctr = EXCLUDED.ctr,
                       collected_at = NOW()`,
        [client.id, r.pageUrl, r.query.slice(0, 500), janela.startDate, janela.endDate,
         r.position, r.impressions, r.clicks, r.ctr]);
      gravadas++;
    }
  });

  return { gravadas, janela };
}
