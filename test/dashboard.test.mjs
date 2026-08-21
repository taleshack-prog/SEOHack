import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNotes, applyNotes, splitForReview, MARKER } from '../lib/notes.mjs';
import { esc, page } from '../lib/ui.mjs';

process.env.DASHBOARD_SECRET = 'x'.repeat(64);
process.env.DASHBOARD_PASSWORD = 'senha-de-teste';
const { issue, isValid, passwordMatches } = await import('../lib/auth.mjs');

const md = `## Escolhendo a stack

Texto gerado pela máquina sobre o assunto.

${MARKER}: conte um caso real de migração que deu errado.

Mais texto gerado.

${MARKER}: qual foi o custo real no primeiro mês?

Conclusão.`;

test('encontra os dois marcadores e suas instruções', () => {
  const n = parseNotes(md);
  assert.equal(n.length, 2);
  assert.match(n[0].instruction, /caso real de migração/);
  assert.match(n[1].instruction, /custo real/);
});

test('costura o texto do operador no lugar certo', () => {
  const out = applyNotes(md, ['Migramos de Heroku e perdemos 4h.', 'US$ 38 no primeiro mês.']);
  assert.ok(!out.includes(MARKER), 'sobrou marcador');
  assert.match(out, /Migramos de Heroku/);
  assert.match(out, /US\$ 38/);
  assert.ok(out.indexOf('Migramos') < out.indexOf('Mais texto'), 'nota fora de ordem');
});

test('nota vazia remove a linha sem deixar buraco', () => {
  const out = applyNotes(md, ['', 'US$ 38.']);
  assert.ok(!out.includes(MARKER));
  assert.ok(!/\n{3,}/.test(out), 'sobrou linha em branco tripla');
});

test('splitForReview alterna texto e lacuna na ordem do artigo', () => {
  const p = splitForReview(md);
  const tipos = p.map((x) => x.type);
  assert.deepEqual(tipos, ['text', 'gap', 'text', 'gap', 'text']);
  assert.equal(p[1].index, 0);
  assert.equal(p[3].index, 1);
});

test('artigo sem marcador devolve um bloco só', () => {
  const p = splitForReview('## Só texto\n\nsem lacuna.');
  assert.equal(p.length, 1);
  assert.equal(p[0].type, 'text');
});

test('sessão válida é aceita e adulterada é rejeitada', () => {
  const t = issue();
  assert.equal(isValid(t), true);
  assert.equal(isValid(t.slice(0, -2) + 'ff'), false);
  assert.equal(isValid('lixo'), false);
  assert.equal(isValid(''), false);
});

test('sessão expirada é rejeitada', () => {
  const antiga = `${Math.floor(Date.now() / 1000) - 10}.abc.` + '0'.repeat(64);
  assert.equal(isValid(antiga), false);
});

test('senha correta passa, errada não', () => {
  assert.equal(passwordMatches('senha-de-teste'), true);
  assert.equal(passwordMatches('outra'), false);
  assert.equal(passwordMatches(''), false);
});

test('XSS: título malicioso é escapado na página', () => {
  const html = page({ title: 'x', body: `<h1>${esc('<script>alert(1)</script>')}</h1>` });
  assert.ok(!html.includes('<script>alert(1)'), 'script passou');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('painel não é indexável', () => {
  assert.match(page({ title: 'x', body: '' }), /name="robots" content="noindex,nofollow"/);
});

// --- health check por adapter (bug: cobrava variáveis da F8 de todo mundo) ---
const { checkEnv } = await import('../lib/checks.mjs');
const semEnv = (fn) => {
  const antes = { ...process.env };
  for (const k of ['PUBLISH_URL', 'PUBLISH_TOKEN', 'F8_SIGNING_SECRET']) delete process.env[k];
  try { return fn(); } finally { Object.assign(process.env, antes); }
};

test('adapter github não exige as variáveis da F8', () => {
  const r = semEnv(() => checkEnv('github'));
  for (const k of ['PUBLISH_URL', 'PUBLISH_TOKEN', 'F8_SIGNING_SECRET']) {
    assert.ok(!r.missing.includes(k), `${k} não deveria ser exigida no adapter github`);
  }
});

test('adapter webhook continua exigindo as variáveis da F8', () => {
  const r = semEnv(() => checkEnv('webhook'));
  assert.ok(r.missing.includes('PUBLISH_URL'));
  assert.ok(r.missing.includes('F8_SIGNING_SECRET'));
});

test('Search Console é opcional, não bloqueia o modo seed', () => {
  const r = checkEnv('github');
  assert.ok(!r.missing.includes('GSC_CLIENT_EMAIL'));
  assert.ok(r.optionalMissing.includes('GSC_CLIENT_EMAIL') || process.env.GSC_CLIENT_EMAIL);
});

test('senha do painel é obrigatória em qualquer adapter', () => {
  const antes = process.env.DASHBOARD_PASSWORD;
  delete process.env.DASHBOARD_PASSWORD;
  try { assert.ok(checkEnv('github').missing.includes('DASHBOARD_PASSWORD')); }
  finally { process.env.DASHBOARD_PASSWORD = antes; }
});

// --- regressão: prompt não empacotado (ENOENT em produção) ---
const { checkPrompt } = await import('../lib/checks.mjs');

test('prompt real é encontrado e tem conteúdo', async () => {
  const r = await checkPrompt();
  assert.equal(r.ok, true, r.reason);
  assert.ok(r.bytes > 1000, `prompt com apenas ${r.bytes} bytes`);
});

test('prompt ausente dá mensagem que aponta o includeFiles', async () => {
  const r = await checkPrompt('nao-existe.md');
  assert.equal(r.ok, false);
  assert.match(r.reason, /includeFiles/);
});

test('vercel.json empacota prompts em todos os crons', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const j = JSON.parse(await readFile(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
  const crons = Object.keys(j.functions).filter((f) => f.startsWith('api/cron/'));
  assert.ok(crons.length >= 5, 'esperava 5 crons configurados');
  for (const c of crons) {
    assert.equal(j.functions[c].includeFiles, 'prompts/**', `${c} sem includeFiles`);
  }
});

test('todo cron declarado tem arquivo correspondente', async () => {
  const { access } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const j = JSON.parse(await (await import('node:fs/promises'))
    .readFile(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
  for (const { path } of j.crons) {
    const arquivo = fileURLToPath(new URL(`..${path}.mjs`, import.meta.url));
    await access(arquivo);   // lança se não existir
  }
});

// --- disparo de produção pelo painel ---
test('meta refresh só aparece quando há produção rodando', () => {
  assert.match(page({ title: 'x', body: '', refresh: 20 }), /http-equiv="refresh" content="20"/);
  assert.ok(!page({ title: 'x', body: '' }).includes('http-equiv="refresh"'));
});

test('cron e painel usam o mesmo módulo de geração', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const ler = (p) => readFile(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
  const cron = await ler('api/cron/content.mjs');
  const ui = await ler('api/ui/generate.mjs');
  for (const [nome, src] of [['cron', cron], ['painel', ui]]) {
    assert.match(src, /generateBatch/, `${nome} não chama generateBatch`);
    assert.match(src, /content-engine\.mjs/, `${nome} não importa o módulo compartilhado`);
  }
  // Nenhum dos dois pode ter cópia da lógica.
  assert.ok(!cron.includes('generateOutline'), 'lógica duplicada no cron');
  assert.ok(!ui.includes('generateOutline'), 'lógica duplicada no painel');
});

test('geração pelo painel roda em segundo plano com waitUntil', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../api/ui/generate.mjs', import.meta.url)), 'utf8');
  assert.match(src, /waitUntil/, 'sem waitUntil a função morre antes de terminar');
  assert.match(src, /status = 'running'/, 'sem trava de execução concorrente');
});
