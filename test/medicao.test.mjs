// "Zero" e "não medimos" são coisas diferentes.
//
// 20/10/2026: dez medições de citação voltaram 403 (a Sonar Chat Completions
// foi desligada em 27/09) e o painel mostrou "0 citações em IA" — o mesmo que
// mostraria se tivesse medido e não achado nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoDaMedicao } from '../lib/medicao.mjs';

const run = (extra) => ({ status: 'success', started_at: '2026-10-20T22:27:00Z',
                          finished_at: '2026-10-20T22:28:00Z', items_processed: 10,
                          items_succeeded: 10, error_message: null, ...extra });

test('nunca medido não é zero', () => {
  const r = estadoDaMedicao(null);
  assert.equal(r.texto, 'nunca medido');
  assert.equal(r.ruim, true);
});

test('dez tentativas e nenhuma medição é falha, não resultado', () => {
  const r = estadoDaMedicao(run({ status: 'partial', items_succeeded: 0,
                                  error_message: 'Perplexity 403' }));
  assert.equal(r.ruim, true);
  assert.match(r.texto, /falhou/);
  assert.match(r.texto, /nenhuma das 10/);
  assert.equal(r.motivo, 'Perplexity 403');
});

test('medição completa é confiável e diz quando foi', () => {
  const r = estadoDaMedicao(run());
  assert.equal(r.ruim, false);
  assert.match(r.texto, /medido em 20\/10\/2026/);
  assert.match(r.texto, /10 perguntas/);
});

test('medição parcial avisa que o número está incompleto', () => {
  const r = estadoDaMedicao(run({ items_succeeded: 4 }));
  assert.equal(r.ruim, true);
  assert.match(r.texto, /4 de 10/);
});

test('sem artigo para medir não é falha', () => {
  const r = estadoDaMedicao(run({ items_processed: 0, items_succeeded: 0 }));
  assert.equal(r.ruim, false);
  assert.match(r.texto, /nada para medir/);
});

test('medição em andamento não acusa falha', () => {
  const r = estadoDaMedicao(run({ status: 'running', finished_at: null,
                                  items_processed: 0, items_succeeded: 0 }));
  assert.equal(r.ruim, false);
  assert.match(r.texto, /medindo agora/);
});

test('uma pergunta só não vira "1 perguntas"', () => {
  const r = estadoDaMedicao(run({ items_processed: 1, items_succeeded: 1 }));
  assert.match(r.texto, /1 pergunta,?|1 pergunta$/);
  assert.doesNotMatch(r.texto, /1 perguntas/);
});

test('a tela mostra traço, não zero, quando a medição não vale', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../api/ui/metrics.mjs', import.meta.url)), 'utf8');
  assert.match(src, /estadoDaMedicao/);
  assert.match(src, /medicao\.ruim \? '—' : citacoes/, 'o cartão ainda mostraria zero');
  assert.match(src, /stage = 'citation'/, 'não lê a última execução do estágio');
});
