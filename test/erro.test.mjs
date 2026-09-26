// A tela que quebra precisa dizer o que quebrou.
//
// Caso real: /topicos respondeu 500 FUNCTION_INVOCATION_FAILED em produção.
// A página da Vercel não traz mensagem, arquivo nem linha; os testes locais
// passavam porque o banco era simulado. Diagnosticar virou eliminação cega.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

process.env.DASHBOARD_SECRET = 'x'.repeat(64);
process.env.DASHBOARD_PASSWORD = 'senha';

const { comErro, stackDoProjeto, resumo } = await import('../lib/erro.mjs');
const { issue } = await import('../lib/auth.mjs');

const fakeRes = () => ({
  statusCode: 200, headers: {}, body: '', headersSent: false, writableEnded: false,
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  end(b) { if (b) this.body += b; this.writableEnded = true; return this; },
});

const comSessao = () => ({ method: 'GET', url: '/api/ui/topicos',
                           headers: { cookie: `htf_session=${encodeURIComponent(issue())}` } });

test('exceção vira página com a mensagem, não 500 mudo', async () => {
  const h = comErro(async () => { throw new Error('coluna "cluster" não existe'); });
  const res = fakeRes();
  await h(comSessao(), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body, /coluna &quot;cluster&quot; não existe/);
  assert.match(res.body, /\/api\/ui\/topicos/, 'não disse em qual rota');
});

test('erro do Postgres mostra código e campos do driver', async () => {
  const err = Object.assign(new Error('relation "topicos" does not exist'),
    { code: '42P01', position: '23', routine: 'parserOpenTable' });
  const res = fakeRes();
  await comErro(async () => { throw err; })(comSessao(), res);
  assert.match(res.body, /42P01/);
  assert.match(res.body, /parserOpenTable/);
});

test('sem sessão não vaza stack', async () => {
  const res = fakeRes();
  await comErro(async () => { throw new Error('DATABASE_URL ausente'); })(
    { method: 'GET', url: '/api/ui/topicos', headers: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body, 'Erro interno.');
  assert.doesNotMatch(res.body, /DATABASE_URL/);
});

test('resposta já enviada não é sobrescrita', async () => {
  const res = fakeRes();
  await comErro(async (_q, r) => { r.end('metade'); throw new Error('depois'); })(comSessao(), res);
  assert.equal(res.body, 'metade');
  assert.equal(res.statusCode, 200);
});

test('handler que funciona passa intacto', async () => {
  const res = fakeRes();
  await comErro(async (_q, r) => { r.statusCode = 302; r.end(); })(comSessao(), res);
  assert.equal(res.statusCode, 302);
});

test('o stack mostra o projeto, não o node_modules', () => {
  const stack = ['Error: x',
    '    at estado (/var/task/api/ui/topicos.mjs:95:20)',
    '    at async /var/task/node_modules/@neondatabase/serverless/index.mjs:10:1',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)'].join('\n');
  const out = stackDoProjeto(stack);
  assert.match(out, /api\/ui\/topicos\.mjs:95:20/);
  assert.doesNotMatch(out, /node_modules|node:internal/);
  assert.doesNotMatch(out, /\/var\/task\//);
});

test('o resumo de log cabe em uma linha', () => {
  assert.equal(resumo(Object.assign(new Error('bum'), { code: '42703' })), 'Error [42703]: bum');
});

// Regressão: adicionar uma tela nova e esquecer o comErro devolve o painel ao
// 500 mudo. O teste falha no dia em que isso acontecer, não no mês seguinte.
test('toda tela do painel está dentro do comErro', async () => {
  const dir = fileURLToPath(new URL('../api/ui/', import.meta.url));
  const isentos = new Set(['login.mjs', 'logout.mjs']);
  for (const f of (await readdir(dir)).filter((n) => n.endsWith('.mjs') && !isentos.has(n))) {
    const src = await readFile(dir + f, 'utf8');
    assert.match(src, /export default comErro\(/, `${f} não está protegido por comErro`);
  }
});
