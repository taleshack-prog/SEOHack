// OPTIMIZATION ENGINE
//
// B7: o Plano §10 mandava rodar semanalmente e o PRD §27 falava em ciclos de 30
// dias. Os dois são compatíveis se separados: o cron AVALIA toda semana, mas a
// elegibilidade exige 30 dias desde a última publicação/reescrita. Essa regra
// vive na view v_optimization_candidates, não aqui.
//
// D8: além de disparar a reescrita, este cron fecha o loop — avalia em D+30 se
// a reescrita anterior funcionou e grava o outcome. Sem isso, optimization_log
// nunca responde a única pergunta que justifica sua existência.
import { cronHandler } from '../../lib/cron-auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { assertBudget } from '../../lib/budget.mjs';

const MAX_REWRITES_PER_RUN = 2;

/** Fecha o loop das reescritas antigas comparando posição antes x depois. */
async function evaluatePending(clientId) {
  const pending = await sql`
    SELECT o.id, o.article_id, o.old_position, o.old_impressions, o.optimized_at
      FROM optimization_log o
     WHERE o.client_id = ${clientId}
       AND o.outcome = 'pending'
       AND o.optimized_at < NOW() - INTERVAL '30 days'`;

  for (const p of pending) {
    const [now] = await sql`
      SELECT position, impressions FROM seo_metrics
       WHERE article_id = ${p.article_id}
       ORDER BY metric_date DESC LIMIT 1`;
    if (!now) continue;

    const before = Number(p.old_position ?? 100);
    const after = Number(now.position ?? 100);
    // Posição menor é melhor. Margem de 1.0 evita chamar ruído de melhoria.
    const outcome = after < before - 1 ? 'improved'
      : after > before + 1 ? 'worsened'
      : 'neutral';

    await sql`
      UPDATE optimization_log
         SET new_position = ${now.position}, new_impressions = ${now.impressions},
             outcome = ${outcome}, evaluated_at = NOW()
       WHERE id = ${p.id}`;
  }
  return pending.length;
}

export default cronHandler(async () => {
  const client = await getClient();

  return runStage(client.id, 'optimization', async () => {
    const evaluated = await evaluatePending(client.id);
    await assertBudget(client.id);

    const candidates = await sql`
      SELECT * FROM v_optimization_candidates
       WHERE client_id = ${client.id}
       ORDER BY impressions DESC NULLS LAST
       LIMIT ${MAX_REWRITES_PER_RUN}`;

    // PRD §27: ao bater 3 tentativas sem sucesso, a decisão passa a ser humana
    // (abandonar, consolidar ou manter como satélite). Não insistir.
    const exhausted = await sql`
      SELECT slug, title FROM articles
       WHERE client_id = ${client.id} AND rewrite_count >= 3 AND status = 'published'`;

    // TODO Sprint 4: gerar a reescrita incremental via LLM comparando com o
    // conteúdo que ocupa as primeiras posições (Content Gap, PRD §27) e enviar
    // pela publishBatch. A infraestrutura de registro já está pronta abaixo.
    return {
      processed: candidates.length,
      succeeded: 0,
      evaluatedPending: evaluated,
      candidates: candidates.map((c) => ({ slug: c.slug, position: c.position, rewrites: c.rewrite_count })),
      needsHumanDecision: exhausted.map((e) => e.slug),
      note: 'reescrita automática entra no Sprint 4; este ciclo apenas avalia e lista',
    };
  });
});
