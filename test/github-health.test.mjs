// O health check precisa conferir escrita, não só leitura.
//
// Caso real: `npm run configure posthink.com.br` imprimiu "✓ destino acessível"
// e a primeira publicação morreu com 403 "Resource not accessible by personal
// access token" ao criar o blob — depois de o artigo estar escrito e pago. O
// token era fine-grained, restrito a outro repositório: enxergava este e não
// escrevia nele. Ler a ref, que era tudo o que se fazia, não distingue os dois.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { healthCheck } from '../lib/adapters/github.mjs';

/** Responde por rota, imitando a API do GitHub. */
function fetchFalso(repo) {
  return async (url) => {
    const caminho = String(url).replace('https://api.github.com', '');
    if (caminho.includes('/git/ref/heads/')) {
      return { ok: true, status: 200, json: async () => ({ object: { sha: 'abc' } }) };
    }
    if (caminho === `/repos/${repo.nome}`) {
      return { ok: true, status: 200, json: async () => repo };
    }
    return { ok: false, status: 404, text: async () => 'not found' };
  };
}

const original = globalThis.fetch;
const comApi = async (repo, fn) => {
  globalThis.fetch = fetchFalso(repo);
  try { return await fn(); } finally { globalThis.fetch = original; }
};

test('token com escrita passa', async () => {
  const r = await comApi({ nome: 'a/b', permissions: { pull: true, push: true } },
    () => healthCheck({ token: 't', repo: 'a/b' }));
  assert.equal(r.ok, true);
  assert.equal(r.escrita, true);
});

test('token só de leitura é recusado, com o nome da permissão que falta', async () => {
  await comApi({ nome: 'a/b', permissions: { pull: true, push: false } }, async () => {
    await assert.rejects(() => healthCheck({ token: 't', repo: 'a/b' }), (err) => {
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /Contents: Read and write/);
      return true;
    });
  });
});

test('admin e maintain também valem como escrita', async () => {
  for (const p of [{ admin: true }, { maintain: true }]) {
    const r = await comApi({ nome: 'a/b', permissions: p },
      () => healthCheck({ token: 't', repo: 'a/b' }));
    assert.equal(r.ok, true);
  }
});

test('repositório arquivado não aceita commits', async () => {
  await comApi({ nome: 'a/b', permissions: { push: true }, archived: true }, async () => {
    await assert.rejects(() => healthCheck({ token: 't', repo: 'a/b' }), /arquivado/);
  });
});

test('mock guarda: o fetch global foi restaurado', () => {
  assert.equal(globalThis.fetch, original);
  assert.ok(mock);
});
