import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// As funções não são exportadas (uso interno do módulo); testamos via reimport
// do fonte, que é preferível a exportar detalhe interno só para o teste.
const src = await readFile(fileURLToPath(new URL('../lib/content-engine.mjs', import.meta.url)), 'utf8');
const bloco = src.slice(src.indexOf('function trim('), src.indexOf('export async function generateBatch'));
const { trim, normalizeOutline, validateOutline } =
  await import(`data:text/javascript,${encodeURIComponent(bloco + '\nexport { trim, normalizeOutline, validateOutline };')}`);

const outlineOk = () => ({
  title: 'Arquitetura SaaS em 2026',
  description: 'Um guia técnico sobre como estruturar a arquitetura de um SaaS em 2026, cobrindo multi-tenancy, custo de infraestrutura e escolhas de banco.',
  entities: ['multi-tenancy', 'PostgreSQL', 'serverless'],
  sections: [{ h2: 'a' }, { h2: 'b' }, { h2: 'c' }],
});

test('esboço bem formado passa', () => {
  assert.deepEqual(validateOutline(outlineOk()), []);
});

test('regressão: descrição fora da faixa não reprova mais', () => {
  // Este era o erro real: "description fora da faixa 140-158" descartava um
  // esboço já pago por causa de alguns caracteres.
  const curta = { ...outlineOk(), description: 'Guia técnico sobre arquitetura SaaS.' };
  assert.deepEqual(validateOutline(curta), []);
  const longa = { ...outlineOk(), description: 'x'.repeat(180) };
  assert.deepEqual(validateOutline(longa), []);
});

test('descrição longa é cortada em 158 sem partir palavra', () => {
  const o = { ...outlineOk(), description: 'palavra '.repeat(40).trim() };
  const avisos = normalizeOutline(o);
  assert.ok(o.description.length <= 158, `ficou com ${o.description.length}`);
  assert.ok(!o.description.endsWith('palav'), 'cortou no meio da palavra');
  assert.match(avisos.join(' '), /cortada para 158/);
});

test('título longo é cortado em 60', () => {
  const o = { ...outlineOk(), title: 'Como escolher a arquitetura ideal para o seu SaaS brasileiro em 2026 e além' };
  normalizeOutline(o);
  assert.ok(o.title.length <= 60, `ficou com ${o.title.length}`);
});

test('descrição curta gera aviso, não erro', () => {
  const o = { ...outlineOk(), description: 'Guia curto.' };
  assert.deepEqual(validateOutline(o), []);
  assert.match(normalizeOutline(o).join(' '), /descrição curta/);
});

test('o que é estrutural continua reprovando', () => {
  assert.ok(validateOutline({ ...outlineOk(), title: '' }).length);
  assert.ok(validateOutline({ ...outlineOk(), entities: ['a'] }).length);
  assert.ok(validateOutline({ ...outlineOk(), sections: [{ h2: 'a' }] }).length);
  assert.ok(validateOutline({ ...outlineOk(), description: 'x'.repeat(500) }).length);
});

test('trim não estraga texto que já cabe', () => {
  assert.equal(trim('curto', 60), 'curto');
  assert.equal(trim('  espaços   demais  ', 60), 'espaços demais');
});
