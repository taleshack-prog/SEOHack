// Multi-cliente. O banco sempre foi multi-tenant; o painel e o recebimento de
// logs é que enxergavam um site só. Estes testes cobrem as duas pontas: a
// escolha do cliente na sessão e a atribuição de cada visita de crawler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, extractRequest } from '../lib/crawlers.mjs';
import { lerClienteCookie, COOKIE_CLIENTE } from '../lib/tenant.mjs';

test('o host é extraído do log da Vercel', () => {
  const r = extractRequest({ proxy: { host: 'WWW.GenBreed.com.br', path: '/blog/x',
                                      userAgent: ['ClaudeBot/1.0'], statusCode: 200 } });
  assert.equal(r.host, 'genbreed.com.br', 'host precisa vir normalizado, sem www');
});

test('log sem host não quebra a extração', () => {
  assert.equal(extractRequest({ userAgent: 'GPTBot' }).host, '');
});

test('visitas de sites diferentes não são somadas na mesma linha', () => {
  const log = (host) => ({ proxy: { host, path: '/blog/a', userAgent: 'ClaudeBot/1.0',
                                    statusCode: 200 }, timestamp: Date.parse('2026-09-26T10:00:00Z') });
  const linhas = aggregate([log('genbreed.com.br'), log('genbreed.com.br'), log('posthink.com.br')]);
  assert.equal(linhas.length, 2);
  const gen = linhas.find((l) => l.host === 'genbreed.com.br');
  assert.equal(gen.hits, 2);
  assert.equal(linhas.find((l) => l.host === 'posthink.com.br').hits, 1);
});

test('cookie do cliente é lido e ausente devolve vazio', () => {
  assert.equal(lerClienteCookie({ headers: { cookie: `${COOKIE_CLIENTE}=genbreed.com.br; outro=1` } }),
    'genbreed.com.br');
  assert.equal(lerClienteCookie({ headers: {} }), '');
});

test('o endpoint de logs separa por cliente antes de gravar', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../api/logs.mjs', import.meta.url)), 'utf8');
  assert.match(src, /listClients/);
  assert.match(src, /porDominio\.get\(l\.host\)/);
});

test('o tracking roda para todos os clientes, com a propriedade de cada um', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../api/cron/tracking.mjs', import.meta.url)), 'utf8');
  assert.match(src, /listClients/);
  assert.match(src, /property: client\.gsc_property/);
});

test('as telas do painel leem o cliente da sessão, não da variável de ambiente', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const dir = fileURLToPath(new URL('../api/ui/', import.meta.url));
  for (const f of await readdir(dir)) {
    const src = await readFile(dir + f, 'utf8');
    assert.doesNotMatch(src, /await getClient\(\)/, `${f} ainda resolve o cliente sozinho`);
  }
});
