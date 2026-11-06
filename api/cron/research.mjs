// RESEARCH ENGINE
//
// Corrige o bloqueador A1 (cold start). O v4 descobria tópicos lendo posições
// 11-20 na Search Console — mas o próprio PRD §2.1 diz que não existe blog. Sem
// impressões residuais a consulta volta vazia por 8 a 12 semanas e o pipeline
// inteiro fica parado esperando um dado que não vem.
//
// Solução: dois modos, com gate automático por volume, não por data.
//   seed -> fila alimentada pelo mapeamento manual de clusters (scripts/seed-topics.mjs)
//   gsc  -> comportamento do PRD, quando o /blog passar de GSC_MODE_THRESHOLD
import { cronHandler } from '../../lib/cron-auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { defaultWindow, blogImpressions, pageTwoOpportunities } from '../../lib/search-console.mjs';
import { opportunityScore } from '../../lib/score.mjs';
import { gerarPauta, ALVO_DA_FILA, MAX_POR_EXECUCAO } from '../../lib/pauta.mjs';
import { assertBudget, recordUsage } from '../../lib/budget.mjs';

export { opportunityScore } from '../../lib/score.mjs';

const GSC_MODE_THRESHOLD = 200;   // impressões/dia no /blog


async function gscMode(client) {
  const window = { startDate: defaultWindow(30).startDate, endDate: defaultWindow(3).endDate };
  const opportunities = await pageTwoOpportunities(window);

  let inserted = 0;
  for (const o of opportunities.slice(0, 20)) {
    // Tópico descoberto na GSC é sempre satélite: pillar é decisão editorial.
    const score = opportunityScore({ impressions: o.impressions, position: o.position, isPillar: false });
    // ON CONFLICT resolve o defeito D3: sem a chave natural normalizada o motor
    // reinseria o mesmo tópico a cada execução.
    const rows = await sql`
      INSERT INTO topics (client_id, topic, source, search_volume,
                          current_position, opportunity_score, status)
      VALUES (${client.id}, ${o.query}, 'gsc', ${o.impressions},
              ${o.position}, ${score}, 'pending')
      ON CONFLICT (client_id, topic_norm) DO NOTHING
      RETURNING id`;
    if (rows.length) inserted++;
  }
  return { mode: 'gsc', candidates: opportunities.length, processed: opportunities.length, succeeded: inserted };
}


async function pautaMode(client, impressions) {
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM topics
     WHERE client_id = ${client.id} AND status IN ('pending','approved')`;

  if (count >= ALVO_DA_FILA) {
    return { mode: 'pauta', blogImpressions: impressions, queueDepth: count,
             processed: 0, succeeded: 0, note: 'fila cheia, nada a gerar' };
  }

  const quantos = Math.min(ALVO_DA_FILA - count, MAX_POR_EXECUCAO);

  // Não gastar sem orçamento, e falhar aqui é barato: a fila só não cresce
  // nesta semana.
  await assertBudget(client.id);

  // Contexto: o que existe no blog e o que já está na fila.
  const [publicados, naFila] = await Promise.all([
    sql`SELECT title, cluster FROM articles
         WHERE client_id = ${client.id} AND status = 'published'`,
    sql`SELECT topic FROM topics WHERE client_id = ${client.id}
         AND status IN ('pending','approved','writing','needs_human','published')`,
  ]);

  const porCluster = new Map();
  for (const a of publicados) {
    const c = a.cluster || 'sem cluster';
    if (!porCluster.has(c)) porCluster.set(c, []);
    porCluster.get(c).push(a.title);
  }
  const clusters = [...porCluster].map(([cluster, titulos]) =>
    ({ cluster, artigos: titulos.length, exemplos: titulos }));

  const existentes = [...naFila.map((t) => t.topic), ...publicados.map((a) => a.title)];

  const r = await gerarPauta(
    { produtos: (client.adapter_config || {}).products || [], clusters, existentes, quantos },
    { clientId: client.id });

  if (r.uso) {
    await recordUsage(client.id, { stage: 'research', provider: r.uso.provider,
      model: r.uso.model, inputTokens: r.uso.inputTokens, outputTokens: r.uso.outputTokens });
  }

  if (r.erro) {
    return { mode: 'pauta', blogImpressions: impressions, queueDepth: count,
             processed: 0, succeeded: 0, error: r.erro };
  }

  let inserted = 0;
  for (const t of r.aceitos) {
    // 'approved' e não 'pending': o modo gsc insere pending e o motor de
    // conteúdo só consome approved — por isso um tópico descoberto sozinho
    // ainda esperava um clique. Pauta gerada já entra pronta para escrever.
    const rows = await sql`
      INSERT INTO topics (client_id, topic, cluster, source, keyword_type,
                          search_volume, opportunity_score, status, approved_at)
      VALUES (${client.id}, ${t.topico}, ${t.cluster}, 'seed', ${t.tipo},
              0, ${t.score}, 'approved', NOW())
      ON CONFLICT (client_id, topic_norm) DO NOTHING
      RETURNING id`;
    if (rows.length) inserted++;
  }

  return {
    mode: 'pauta',
    blogImpressions: impressions,
    queueDepth: count + inserted,
    processed: r.aceitos.length,
    succeeded: inserted,
    recusados: r.recusados.length,
    temas: r.aceitos.map((t) => t.topico),
  };
}

export default cronHandler(async () => {
  const client = await getClient();

  return runStage(client.id, 'research', async () => {
    // Gate seed -> gsc: volume real, não calendário.
    let impressions = 0;
    try {
      const w = defaultWindow(3);
      impressions = await blogImpressions(w);
    } catch (err) {
      if (!err.quota) throw err;
      console.warn('[research] quota GSC — permanecendo em modo seed neste ciclo');
    }

    if (impressions < GSC_MODE_THRESHOLD) {
      // 06/11/2026: aqui o cron dormia. O modo seed só reportava "fila baixa,
      // rode scripts/seed-topics.mjs" — e o portão para o modo gsc são 200
      // impressões por DIA, num blog que faz 1,8. Nunca ia abrir. Na prática a
      // fila dependia de alguém lembrar de abastecê-la, e o pipeline inteiro
      // ficava parado esperando uma pessoa.
      //
      // Agora o modo seed se abastece: gera a pauta a partir dos produtos
      // cadastrados e dos clusters que já existem.
      return pautaMode(client, impressions);
    }

    return gscMode(client);
  });
});
