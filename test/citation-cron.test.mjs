// O cron de citação não pode transformar falha em zero.
//
// 20/10/2026: dez chamadas, dez 403 (Sonar desligada em 27/09). O catch
// registrava no console e seguia; o lote terminou com succeeded 0 e o painel
// mostrou "0 citações em IA" — o mesmo que ele mostra quando a medição deu zero
// de verdade. Levou abrir o log da Vercel para descobrir a diferença.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const src = await readFile(fileURLToPath(new URL('../api/cron/citation.mjs', import.meta.url)), 'utf8');

test('a falha sobe no resultado do estágio, não só no console', () => {
  assert.match(src, /falhas\.push/, 'engole o erro');
  assert.match(src, /\.\.\.\(error \? \{ error \} : \{\}\)/,
    'o estágio não devolve o motivo, então pipeline_runs fica sem error_message');
});

test('erro de migração interrompe o lote', () => {
  assert.match(src, /err\.migracao/);
  assert.match(src, /break;/, 'insistiria nas outras nove com o mesmo 403');
});

test('continua usando o cliente compartilhado, não fetch solto', () => {
  assert.match(src, /from '\.\.\/\.\.\/lib\/perplexity\.mjs'/);
  assert.doesNotMatch(src, /api\.perplexity\.ai/, 'voltou a montar a chamada à mão');
  assert.doesNotMatch(src, /chat\/completions/, 'voltou ao endpoint desligado');
});

test('a comparação de domínio continua por host', () => {
  assert.match(src, /posicaoDoDominio\(fontes, client\.domain\)/);
  assert.doesNotMatch(src, /includes\(client\.domain\)/);
});
