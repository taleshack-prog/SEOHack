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

const GSC_MODE_THRESHOLD = 200;   // impressões/dia no /blog
const MIN_QUEUE = 6;              // abaixo disso, alerta: a fila vai secar

/** Opportunity Score do PRD §24. Volume x proximidade do Top 10 x afinidade. */
export function opportunityScore({ impressions = 0, position = 100, difficulty = 50, affinity = 1 }) {
  const reach = Math.log10(impressions + 1) * 20;
  const proximity = Math.max(0, 100 - Math.abs(position - 8) * 5);
  const ease = 100 - difficulty;
  return Number(((reach * 0.4 + proximity * 0.35 + ease * 0.25) * affinity).toFixed(2));
}

async function gscMode(client) {
  const window = { startDate: defaultWindow(30).startDate, endDate: defaultWindow(3).endDate };
  const opportunities = await pageTwoOpportunities(window);

  let inserted = 0;
  for (const o of opportunities.slice(0, 20)) {
    const score = opportunityScore({ impressions: o.impressions, position: o.position });
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
      // Modo seed: nada a descobrir automaticamente. A função só reporta a
      // saúde da fila. Deixar isto explícito evita a ilusão de que o motor está
      // trabalhando quando na verdade não tem entrada.
      const [{ count }] = await sql`
        SELECT COUNT(*)::int AS count FROM topics
         WHERE client_id = ${client.id} AND status IN ('pending','approved')`;

      if (count < MIN_QUEUE) {
        console.warn(`[research] FILA BAIXA: ${count} tópicos. Rode scripts/seed-topics.mjs.`);
      }
      return {
        mode: 'seed',
        blogImpressions: impressions,
        threshold: GSC_MODE_THRESHOLD,
        queueDepth: count,
        needsSeeding: count < MIN_QUEUE,
        processed: 0, succeeded: 0,
      };
    }

    return gscMode(client);
  });
});
