// RESUMO SEMANAL
//
// 06/11/2026: "não criei esse projeto para eu ficar abrindo e procurando o que
// deve ser feito". O painel só responde a quem vai até ele. Este cron inverte
// isso: uma vez por semana o estado do motor sai daqui e chega por e-mail.
//
// Sexta às 23h UTC (20h de Brasília): depois da última rodada de conteúdo da
// semana e da coleta de desempenho do dia.
import { cronHandler } from '../../lib/cron-auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { parseNotes } from '../../lib/notes.mjs';
import { montarResumo, enviarResumo } from '../../lib/resumo.mjs';

const JANELA = '7 days';

export default cronHandler(async () => {
  const client = await getClient();
  const cfg = client.adapter_config || {};
  const base = `${cfg.baseUrl || ''}${cfg.blogBasePath || '/blog'}`;

  return runStage(client.id, 'resumo', async () => {
    const [publicados, segurados, presos, [{ fila }], reescritas, [custo]] = await Promise.all([
      sql`SELECT slug, title FROM articles
           WHERE client_id = ${client.id} AND status = 'published'
             AND first_published_at > NOW() - INTERVAL ${JANELA}
           ORDER BY first_published_at`,

      // Artigo escrito e parado. O motivo sai do próprio texto: marcador de
      // operador é lacuna; sem marcador, foi número sem fonte.
      sql`SELECT slug, title, markdown, operator_note_required FROM articles
           WHERE client_id = ${client.id} AND status = 'needs_human'
           ORDER BY created_at`,

      // Tópico barrado antes de virar artigo — hoje, o portão de produto sem
      // descrição. O motivo foi gravado em status_reason.
      sql`SELECT topic, status_reason FROM topics
           WHERE client_id = ${client.id} AND status = 'needs_human'
             AND status_reason IS NOT NULL
           ORDER BY assigned_at DESC NULLS LAST LIMIT 10`,

      sql`SELECT COUNT(*)::int AS fila FROM topics
           WHERE client_id = ${client.id} AND status = 'approved'`,

      sql`SELECT outcome FROM optimization_log
           WHERE client_id = ${client.id}
             AND optimized_at > NOW() - INTERVAL ${JANELA}`,

      sql`SELECT spent_usd, monthly_budget_usd FROM v_budget_status
           WHERE client_id = ${client.id}`,
    ]);

    const [pauta] = await sql`
      SELECT status, items_processed, items_succeeded, error_message
        FROM pipeline_runs
       WHERE client_id = ${client.id} AND stage = 'research'
         AND started_at > NOW() - INTERVAL ${JANELA}
       ORDER BY started_at DESC LIMIT 1`;

    const resumo = montarResumo({
      cliente: client.name,
      publicados: publicados.map((a) => ({ title: a.title, url: `${base}/${a.slug}` })),
      segurados: segurados.map((a) => {
        const lacunas = parseNotes(a.markdown || '');
        return {
          title: a.title,
          url: `${base}/${a.slug}`,
          motivo: lacunas.length
            ? `${lacunas.length === 1 ? 'Falta 1 trecho' : `Faltam ${lacunas.length} trechos`}: `
              + lacunas.map((l) => l.instruction || l.texto || '').filter(Boolean)
                .join(' | ').slice(0, 300)
            : 'Número sem fonte no texto — confira os valores destacados antes de publicar.',
        };
      }),
      topicosPresos: presos.map((t) => ({ topic: t.topic, motivo: t.status_reason })),
      fila,
      reescritas,
      pauta: pauta ? {
        status: pauta.status,
        avaliados: pauta.items_processed,
        novos: pauta.items_succeeded,
        erro: pauta.error_message,
      } : null,
      custo: custo ? { gasto: custo.spent_usd, teto: custo.monthly_budget_usd } : null,
    });

    const envio = await enviarResumo(resumo);

    // O envio falhar não é falha do estágio: o resumo é observação, não
    // produção. Mas precisa aparecer no resultado, senão some.
    return {
      processed: 1,
      succeeded: envio.enviado ? 1 : 0,
      ...(envio.enviado ? {} : { error: `resumo não enviado: ${envio.motivo}` }),
      assunto: resumo.assunto,
      publicados: publicados.length,
      segurados: segurados.length,
      fila,
    };
  });
});
