import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../lib/budget.mjs';

test('D9: custo é calculado por 1M de tokens', () => {
  // Sonnet 5: US$ 2 entrada + US$ 10 saída por milhão (console, 20/08/2026)
  const c = estimateCost('claude-sonnet-5', 1_000_000, 1_000_000);
  assert.equal(Number(c.toFixed(2)), 12.00);
});

test('custo de um artigo típico fica abaixo de US$ 0,10', () => {
  // ~4k tokens de entrada (prompt + esboço), ~3k de saída (1.500 palavras)
  const c = estimateCost('claude-sonnet-5', 4000, 3000);
  assert.ok(c < 0.10, `custo estimado US$ ${c.toFixed(4)}`);
});

test('D9: modelo desconhecido devolve 0 sem lançar', () => {
  assert.equal(estimateCost('modelo-inexistente', 1000, 1000), 0);
});
