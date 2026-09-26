// Precedência do repositório de destino.
//
// O erro que originou o arquivo: `npm run configure posthink.com.br` gravou
// taleshack-prog/Hack-Tech-Farm-site no cliente Posthink, porque o GITHUB_REPO
// do .env vinha antes do repositório descrito em seeds/targets.json. O health
// check passou — o repositório existe — e o resumo imprimiu o nome errado sem
// nenhum sinal de problema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escolherRepo } from '../lib/alvo.mjs';

test('o destino do cliente ganha da variável de ambiente', () => {
  const r = escolherRepo({ alvo: 'taleshack-prog/linkedin-app',
                           env: 'taleshack-prog/Hack-Tech-Farm-site' });
  assert.equal(r.repo, 'taleshack-prog/linkedin-app');
  assert.equal(r.origem, 'seeds/targets.json');
  assert.match(r.conflito, /Hack-Tech-Farm-site/, 'não avisou que o ambiente discordava');
});

test('a flag ganha de todo mundo', () => {
  const r = escolherRepo({ flag: 'a/b', alvo: 'c/d', env: 'e/f' });
  assert.equal(r.repo, 'a/b');
  assert.match(r.conflito, /c\/d/);
});

test('sem destino descrito, o ambiente serve de padrão', () => {
  const r = escolherRepo({ alvo: '', env: 'a/b' });
  assert.equal(r.repo, 'a/b');
  assert.equal(r.origem, '.env (GITHUB_REPO)');
  assert.equal(r.conflito, null);
});

test('valores em branco não contam como escolha', () => {
  assert.equal(escolherRepo({ flag: '  ', alvo: '  ', env: '  ' }).repo, undefined);
  assert.equal(escolherRepo({ flag: '  ', alvo: 'a/b' }).repo, 'a/b');
});

test('ambiente igual ao destino não vira aviso', () => {
  assert.equal(escolherRepo({ alvo: 'a/b', env: 'a/b' }).conflito, null);
});

test('o script usa escolherRepo e não a ordem antiga', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../scripts/configure-target.mjs', import.meta.url)), 'utf8');
  assert.match(src, /escolherRepo\(/);
  assert.doesNotMatch(src, /process\.env\.GITHUB_REPO \|\| alvo\.repo/,
    'a precedência invertida voltou');
});
