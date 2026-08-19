import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost } from '../lib/budget.mjs';

test('D9: custo é calculado por 1M de tokens', () => {
  const c = estimateCost('claude-sonnet-4-5', 1_000_000, 1_000_000);
  assert.equal(Number(c.toFixed(2)), 18.00);
});

test('D9: modelo desconhecido devolve 0 sem lançar', () => {
  assert.equal(estimateCost('modelo-inexistente', 1000, 1000), 0);
});
