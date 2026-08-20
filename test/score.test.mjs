import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opportunityScore, PILLAR_MULTIPLIER } from '../lib/score.mjs';

// Linhas reais do seeds/clusters.example.csv
const csv = [
  { topic: 'Guia definitivo de arquitetura SaaS',  vol: 880,  dif: 55, aff: 1.0, pillar: true },
  { topic: 'MRR churn e LTV',                      vol: 1300, dif: 45, aff: 1.0, pillar: false },
  { topic: 'Multi-tenancy no PostgreSQL',          vol: 320,  dif: 40, aff: 1.2, pillar: false },
  { topic: 'Quanto custa manter um SaaS',          vol: 210,  dif: 35, aff: 1.3, pillar: false },
  { topic: 'Guia definitivo de smart contracts',   vol: 1100, dif: 65, aff: 1.0, pillar: true },
  { topic: 'Auditoria de DApps',                   vol: 290,  dif: 50, aff: 1.5, pillar: false },
  { topic: 'Gas fees na EVM',                      vol: 540,  dif: 48, aff: 1.0, pillar: false },
  { topic: 'Automação de LinkedIn',                vol: 430,  dif: 42, aff: 1.5, pillar: false },
];

const scored = csv.map((r) => ({
  ...r,
  score: opportunityScore({ impressions: r.vol, position: 100, difficulty: r.dif, affinity: r.aff, isPillar: r.pillar }),
})).sort((a, b) => b.score - a.score);

test('pillar page não fica mais no fim da fila', () => {
  const posPillar = scored.findIndex((r) => r.pillar);
  assert.equal(posPillar, 0, `1º da fila deveria ser pillar, veio "${scored[0].topic}"`);
});

test('as duas pillars ficam acima da mediana', () => {
  const idx = scored.map((r, i) => (r.pillar ? i : -1)).filter((i) => i >= 0);
  for (const i of idx) assert.ok(i < scored.length / 2, `pillar na posição ${i} de ${scored.length}`);
});

test('multiplicador aplica só em pillar', () => {
  const args = { impressions: 500, position: 100, difficulty: 50, affinity: 1 };
  const sat = opportunityScore({ ...args, isPillar: false });
  const pil = opportunityScore({ ...args, isPillar: true });
  assert.equal(Number((sat * PILLAR_MULTIPLIER).toFixed(2)), pil);
});

test('regressão: a fórmula antiga punia a pillar (documenta o bug)', () => {
  const semBonus = csv.map((r) => ({
    ...r,
    score: opportunityScore({ impressions: r.vol, position: 100, difficulty: r.dif, affinity: r.aff, isPillar: false }),
  })).sort((a, b) => b.score - a.score);
  // Com o bônus desligado, as pillars voltam para o fim — que era o sintoma.
  assert.ok(semBonus[semBonus.length - 1].pillar, 'último deveria ser pillar sem o bônus');
});

test('afinidade comercial continua influindo', () => {
  const base = { impressions: 400, position: 100, difficulty: 45, isPillar: false };
  assert.ok(opportunityScore({ ...base, affinity: 1.5 }) > opportunityScore({ ...base, affinity: 1.0 }));
});
