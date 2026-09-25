// Recebimento de contato. O defeito que originou isto: o formulário do site
// respondia "A mensagem não foi enviada" — todo visitante era perdido em
// silêncio. Estes testes existem para que isso não volte sem aviso.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.DASHBOARD_SECRET = 'y'.repeat(64);
process.env.DASHBOARD_PASSWORD = 'senha';
process.env.CLIENT_DOMAIN = 'exemplo.com.br';

const { validarContato, hashIp, avisarPorEmail } = await import('../lib/leads.mjs');

const bom = {
  nome: 'Heitor Hack', email: 'alguem@exemplo.com',
  assunto: 'Dúvida sobre um produto',
  mensagem: 'gostaria de entender como funciona o GenBreed?',
};

test('contato válido passa e vem normalizado', () => {
  const r = validarContato({ ...bom, email: '  ALGUEM@Exemplo.com ' });
  assert.equal(r.ok, true);
  assert.equal(r.lead.email, 'alguem@exemplo.com');
});

test('campos faltando devolvem mensagem que a pessoa entende', () => {
  assert.match(validarContato({ ...bom, nome: '' }).erro, /nome/i);
  assert.match(validarContato({ ...bom, email: 'nao-e-email' }).erro, /e-mail/i);
  assert.match(validarContato({ ...bom, mensagem: 'oi' }).erro, /mensagem/i);
});

test('armadilha de robô é silenciosa', () => {
  const r = validarContato({ ...bom, empresa: 'Spam Ltda' });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'silencioso');
});

test('quebra de linha em nome e assunto é removida (injeção de cabeçalho)', () => {
  const r = validarContato({ ...bom, nome: 'Fulano\nBcc: vitima@x.com', assunto: 'a\r\nX: y' });
  assert.equal(r.lead.nome.includes('\n'), false);
  assert.equal(r.lead.assunto.includes('\r'), false);
});

test('mensagem enorme é cortada, não rejeitada', () => {
  const r = validarContato({ ...bom, mensagem: 'x'.repeat(9000) });
  assert.equal(r.ok, true);
  assert.equal(r.lead.mensagem.length, 4000);
});

test('IP não é guardado cru', () => {
  const h = hashIp({ headers: { 'x-forwarded-for': '200.1.2.3, 10.0.0.1' } }, 'segredo');
  assert.equal(h.length, 32);
  assert.ok(!h.includes('200.1'));
  assert.notEqual(h, hashIp({ headers: { 'x-forwarded-for': '200.1.2.4' } }, 'segredo'));
});

test('sem chave do Brevo, o aviso falha sem lançar', async () => {
  delete process.env.BREVO_API_KEY;
  const r = await avisarPorEmail(bom);
  assert.equal(r.enviado, false);
  assert.match(r.motivo, /BREVO_API_KEY/);
});

test('com chave, o e-mail sai com replyTo de quem escreveu', async () => {
  process.env.BREVO_API_KEY = 'k';
  process.env.CONTATO_EMAIL = 'dono@exemplo.com';
  let enviado = null;
  const r = await avisarPorEmail({ ...bom, siteAlvo: 'cliente.com.br' }, {
    fetchImpl: async (url, opts) => { enviado = { url, corpo: JSON.parse(opts.body) }; return { ok: true }; },
  });
  assert.equal(r.enviado, true);
  assert.match(enviado.url, /brevo/);
  assert.equal(enviado.corpo.replyTo.email, bom.email);
  assert.match(enviado.corpo.textContent, /cliente\.com\.br/);
  delete process.env.BREVO_API_KEY;
});

test('Brevo fora do ar não derruba o recebimento', async () => {
  process.env.BREVO_API_KEY = 'k';
  process.env.CONTATO_EMAIL = 'dono@exemplo.com';
  const r = await avisarPorEmail(bom, { fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.equal(r.enviado, false);
  assert.match(r.motivo, /ECONNRESET/);
  delete process.env.BREVO_API_KEY;
});

// --- endpoint -------------------------------------------------------------
let GRAVADOS = [];
let FALHA = null;
let REPETIDO = false;

mock.module('../lib/db.mjs', {
  namedExports: {
    sql: (strings, ...vals) => {
      const q = strings.join(' ');
      if (/SELECT 1 FROM leads/i.test(q)) return Promise.resolve(REPETIDO ? [{ '?column?': 1 }] : []);
      if (/INSERT INTO leads/i.test(q)) {
        if (FALHA) return Promise.reject(new Error(FALHA));
        GRAVADOS.push(vals);
        return Promise.resolve([{ id: 'lead-1' }]);
      }
      return Promise.resolve([]);
    },
    getClient: async () => ({ id: 'c1' }),
  },
});

const contato = (await import('../api/contato.mjs')).default;

function fakeRes() {
  return { statusCode: 200, headers: {}, body: '',
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { if (b) this.body += b; return this; } };
}
const post = (corpo, headers = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: corpo,
});

test('POST válido grava e responde ok', async () => {
  GRAVADOS = [];
  const res = fakeRes();
  await contato(post(bom), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.equal(GRAVADOS.length, 1);
});

test('POST inválido não grava e explica o motivo', async () => {
  GRAVADOS = [];
  const res = fakeRes();
  await contato(post({ ...bom, email: 'x' }), res);
  assert.equal(res.statusCode, 422);
  assert.equal(GRAVADOS.length, 0);
});

test('duplo clique não grava de novo nem vira erro', async () => {
  GRAVADOS = []; REPETIDO = true;
  const res = fakeRes();
  await contato(post(bom), res);
  REPETIDO = false;
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).duplicado, true);
  assert.equal(GRAVADOS.length, 0, 'a mensagem repetida não pode ser gravada duas vezes');
});

test('freio fora do ar não impede o recebimento', async () => {
  GRAVADOS = [];
  const res = fakeRes();
  // A consulta de freio falha, o INSERT segue.
  await contato(post({ ...bom, mensagem: `${bom.mensagem} variação` }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(GRAVADOS.length, 1);
});

test('falha real do banco devolve 500, não silêncio', async () => {
  FALHA = 'connection terminated';
  const res = fakeRes();
  await contato(post(bom), res);
  FALHA = null;
  assert.equal(res.statusCode, 500);
  assert.match(JSON.parse(res.body).erro, /Tente de novo/);
});

test('CORS liberado para os sites da casa e negado para o resto', async () => {
  const r1 = fakeRes();
  await contato(post(bom, { origin: 'https://genbreed.com.br' }), r1);
  assert.equal(r1.headers['access-control-allow-origin'], 'https://genbreed.com.br');

  const r2 = fakeRes();
  await contato(post(bom, { origin: 'https://site-de-terceiro.com' }), r2);
  assert.equal(r2.headers['access-control-allow-origin'], undefined);
});

test('preflight OPTIONS responde 204', async () => {
  const res = fakeRes();
  await contato({ method: 'OPTIONS', headers: { origin: 'https://hacktechfarm.com.br' } }, res);
  assert.equal(res.statusCode, 204);
});

test('GET é recusado', async () => {
  const res = fakeRes();
  await contato({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});
