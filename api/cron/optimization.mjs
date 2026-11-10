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
import { reescreverArtigo } from '../../lib/rewrite.mjs';

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

    // O Sprint 4 chegou. lib/rewrite.mjs faz a reescrita incremental: mira na
    // busca que a página já recebe e está fora do Top 10, valida contra o texto
    // antigo (só barra o que a reescrita introduziu) e republica no mesmo
    // endereço. Cada falha é isolada — uma página que não tem alvo não impede
    // a seguinte.
    const resultados = [];
    for (const c of candidates) {
      try {
        resultados.push(await reescreverArtigo(client, c.slug, { motivo: 'content_gap' }));
      } catch (err) {
        console.error(`[optimization] ${c.slug}: ${err.message}`);
        resultados.push({ publicado: false, classe: 'problema', slug: c.slug, motivo: err.message });
      }
    }

    const publicados = resultados.filter((r) => r.publicado);

    // Recusa correta não é falha.
    //
    // 10/11/2026: o cron vinha sendo marcado 'failed' todo domingo porque duas
    // páginas ganham todas as buscas que recebem e o motor dizia, certíssimo,
    // que não havia alvo. Isso ia para error_message, o finishRun via erro e
    // gravava falha — então o estágio que mais acerta era o que mais parecia
    // quebrado, e uma falha de verdade ficaria escondida no meio.
    const nadaAFazer = resultados.filter((r) => !r.publicado && r.classe === 'nada-a-fazer');
    const problemas = resultados.filter((r) => !r.publicado && r.classe !== 'nada-a-fazer');

    return {
      // Página sem alvo não entra na conta: não foi processada, não havia o
      // que processar. Assim 2/2 significa "tentei duas e consegui duas".
      processed: candidates.length - nadaAFazer.length,
      succeeded: publicados.length,
      evaluatedPending: evaluated,
      reescritos: publicados.map((r) => ({ slug: r.slug, alvo: r.alvo, mudancas: r.mudancas })),
      needsHumanDecision: exhausted.map((e) => e.slug),
      semAlvo: nadaAFazer.map((r) => r.slug),
      ...(problemas.length
        ? { error: problemas.map((r) => `"${r.slug}": ${r.motivo}`).join(' | ') }
        : {}),
    };
  });
});
