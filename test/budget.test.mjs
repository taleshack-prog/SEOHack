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

// --- custo por artigo (o painel mostrava US$ 0,00 com total > 0) ---
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const ler = (p) => readFile(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

test('recordUsage devolve o id para amarrar ao artigo depois', async () => {
  const src = await ler('lib/budget.mjs');
  assert.match(src, /RETURNING id/, 'sem id não há como ligar ao artigo');
  assert.match(src, /export async function linkUsage/);
});

test('o motor amarra outline e draft ao artigo criado', async () => {
  const src = await ler('lib/content-engine.mjs');
  assert.match(src, /linkUsage\(client\.id, article\.id/, 'custo continua órfão');
  assert.match(src, /outline\._usageId/);
});

test('falha de validação diz qual dado foi acusado', async () => {
  const src = await ler('lib/content-engine.mjs');
  // Só o nome da regra não permite julgar se o problema é do texto ou da regra.
  assert.match(src, /e\.rule\} \(\$\{e\.detail\}\)/, 'mensagem sem o detalhe do erro');
});
