// Opportunity Score (PRD §24) — função pura, sem dependência de banco ou rede.
//
// Vivia dentro de api/cron/research.mjs, que importa db.mjs e search-console.mjs.
// Resultado: testar a fórmula exigia driver de Postgres instalado. Módulo à
// parte para que a regra de priorização seja testável isoladamente.

// Pillar page é a âncora do cluster (PRD §34): os satélites linkam para ela.
// Publicá-la depois faz cada satélite nascer apontando para página inexistente.
export const PILLAR_MULTIPLIER = 1.6;

/**
 * Volume x proximidade do Top 10 x facilidade x afinidade comercial,
 * com bônus para pillar page.
 *
 * A versão anterior ignorava `is_pillar` e ponderava dificuldade em 25%. Como
 * pillar page é justamente o tema mais difícil de um cluster, a fórmula punia
 * exatamente o conteúdo mais estratégico — no seed inicial, as duas pillars
 * caíram para o último lugar da fila.
 *
 * Correção em duas camadas: aqui o score reflete a estratégia; e o Content
 * Engine ordena por `is_pillar DESC` antes do score, garantindo a precedência
 * mesmo quando o multiplicador não superar um satélite de altíssima afinidade.
 */
export function opportunityScore({
  impressions = 0, position = 100, difficulty = 50, affinity = 1, isPillar = false,
}) {
  const reach = Math.log10(impressions + 1) * 20;
  const proximity = Math.max(0, 100 - Math.abs(position - 8) * 5);
  const ease = 100 - difficulty;
  const base = reach * 0.4 + proximity * 0.35 + ease * 0.25;
  return Number((base * affinity * (isPillar ? PILLAR_MULTIPLIER : 1)).toFixed(2));
}
