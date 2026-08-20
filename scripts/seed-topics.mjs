#!/usr/bin/env node
// Alimenta a fila em modo seed — a entrada obrigatória do Sprint 2 e a única
// parte do sistema que a automação não gera sozinha, porque depende de saber
// quais serviços a HTF quer vender (bloqueador A1 da auditoria).
//
// Uso: node --env-file=.env scripts/seed-topics.mjs seeds/clusters.csv
import { readFile } from 'node:fs/promises';
import { sql, getClient } from '../lib/db.mjs';
import { opportunityScore } from '../lib/score.mjs';

const file = process.argv[2] || 'seeds/clusters.example.csv';
const text = await readFile(file, 'utf8');
const [header, ...lines] = text.trim().split('\n');
const cols = header.split(',').map((s) => s.trim());

const client = await getClient();
let inserted = 0, updated = 0, skipped = 0;

for (const line of lines) {
  if (!line.trim()) continue;
  const values = line.split(',').map((s) => s.trim());
  const row = Object.fromEntries(cols.map((c, i) => [c, values[i]]));

  const isPillar = row.is_pillar === 'true';
  const score = opportunityScore({
    impressions: Number(row.search_volume || 0),
    position: 100,                                   // ainda não rankeia
    difficulty: Number(row.difficulty_score || 50),
    affinity: Number(row.affinity || 1),
    isPillar,
  });

  // Entra como 'approved' porque o seed já É a curadoria humana. Tópico vindo
  // do modo gsc entra como 'pending' e precisa de aprovação no dashboard.
  const res = await sql`
    INSERT INTO topics (client_id, topic, source, cluster, is_pillar, keyword_type,
                        search_volume, difficulty_score, opportunity_score, status, approved_at)
    VALUES (${client.id}, ${row.topic}, 'seed', ${row.cluster},
            ${isPillar}, ${row.keyword_type || 'informational'},
            ${Number(row.search_volume) || null}, ${Number(row.difficulty_score) || null},
            ${score}, 'approved', NOW())
    ON CONFLICT (client_id, topic_norm) DO UPDATE
      SET cluster           = EXCLUDED.cluster,
          is_pillar         = EXCLUDED.is_pillar,
          keyword_type      = EXCLUDED.keyword_type,
          search_volume     = EXCLUDED.search_volume,
          difficulty_score  = EXCLUDED.difficulty_score,
          opportunity_score = EXCLUDED.opportunity_score
      -- Só atualiza o que ainda não entrou em produção. Tópico já escrito ou
      -- publicado é imutável: mexer nele reabriria artigo já commitado.
      WHERE topics.status IN ('pending','approved')
    RETURNING (xmax = 0) AS was_insert`;
  if (!res.length) skipped++;
  else if (res[0].was_insert) inserted++;
  else updated++;
}

console.log(`✓ ${inserted} inseridos, ${updated} atualizados, ${skipped} ignorados (já em produção)`);
const [{ count }] = await sql`
  SELECT COUNT(*)::int AS count FROM topics
   WHERE client_id = ${client.id} AND status IN ('pending','approved')`;
console.log(`  fila atual: ${count} tópicos`);
