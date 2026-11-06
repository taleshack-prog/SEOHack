// O estado do motor sai daqui em vez de esperar numa tela.
//
// 06/11/2026: "não criei esse projeto para eu ficar abrindo e procurando o que
// deve ser feito". Como a escolha foi segurar todo artigo com lacuna, parado é
// o estado normal de parte da produção — e parado sem aviso vira esquecido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarResumo, enviarResumo, dataBr } from '../lib/resumo.mjs';

const PUB = [{ title: 'Quadro de Punnett', url: 'https://x.com.br/blog/punnett' }];

test('a semana boa lista o que foi ao ar, com link', () => {
  const r = montarResumo({ publicados: PUB, fila: 5, cliente: 'Hack Tech Farm' });
  assert.match(r.texto, /1 artigo publicado esta semana/);
  assert.match(r.texto, /Quadro de Punnett/);
  assert.match(r.texto, /blog\/punnett/);
  assert.match(r.texto, /Fila: 5 tópicos aprovados/);
  assert.doesNotMatch(r.assunto, /esperando/);
});

// --- nenhum zero sem motivo ---

test('zero publicado por artigo preso não é igual a zero por fila vazia', () => {
  const preso = montarResumo({ segurados: [{ title: 'A', motivo: 'Falta 1 trecho: planos' }], fila: 4 });
  const seca = montarResumo({ fila: 0 });
  assert.match(preso.texto, /estão esperando você/);
  assert.match(seca.texto, /a fila está vazia/);
  assert.notEqual(preso.texto, seca.texto);
});

test('artigo parado vem com o motivo e o caminho, não só o título', () => {
  const r = montarResumo({
    segurados: [{ title: 'Guia X', url: 'https://x.com.br/blog/guia-x',
                  motivo: 'Faltam 2 trechos: lista de planos | integrações' }],
    fila: 2,
  });
  assert.match(r.texto, /Guia X/);
  assert.match(r.texto, /Faltam 2 trechos/);
  assert.match(r.texto, /integrações/);
  assert.match(r.texto, /blog\/guia-x/);
});

test('tópico barrado antes de escrever aparece com a razão gravada', () => {
  const r = montarResumo({
    topicosPresos: [{ topic: 'guia do posthink', motivo: 'Descreva em Produtos o que o Posthink faz.' }],
    fila: 3,
  });
  assert.match(r.texto, /1 tópico barrado antes de escrever/);
  assert.match(r.texto, /Descreva em Produtos/);
});

test('o assunto diz, sem abrir, se tem coisa esperando', () => {
  const comAcao = montarResumo({ publicados: PUB, segurados: [{ title: 'A', motivo: 'x' }], fila: 1 });
  assert.match(comAcao.assunto, /1 publicado, 1 esperando você/);
  const semAcao = montarResumo({ publicados: PUB, fila: 9, cliente: 'HTF' });
  assert.match(semAcao.assunto, /1 artigo publicado · HTF/);
});

test('fila baixa e fila vazia pedem coisas diferentes', () => {
  assert.match(montarResumo({ fila: 1 }).texto, /só 1 tópico/);
  assert.match(montarResumo({ fila: 0 }).texto, /gerada toda segunda/);
  assert.match(montarResumo({ fila: 8 }).texto, /O motor segue sozinho/);
});

test('reescrita sem veredito não vira promessa de resultado', () => {
  const r = montarResumo({ fila: 4, reescritas: [{ outcome: 'pending' }, { outcome: 'pending' }] });
  assert.match(r.texto, /aguardando medição/);
  assert.doesNotMatch(r.texto, /subiu|melhorou/);
});

test('custo sai com teto e percentual', () => {
  const r = montarResumo({ fila: 4, custo: { gasto: '2.50', teto: '10.00' } });
  assert.match(r.texto, /US\$ 2\.50 de US\$ 10\.00 \(25%\)/);
});

test('semana totalmente parada é marcada como vazia, para quem quiser não enviar', () => {
  assert.equal(montarResumo({ fila: 5 }).vazio, true);
  assert.equal(montarResumo({ publicados: PUB, fila: 5 }).vazio, false);
});

test('data do banco não vira "Sun Nov 06"', () => {
  assert.equal(dataBr('2026-11-06'), '06/11/2026');
  assert.equal(dataBr(null), '—');
});

// --- envio ---

test('sem chave do Brevo o resumo falha sem lançar', async () => {
  const antes = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;
  try {
    const r = await enviarResumo({ assunto: 'a', texto: 'b' });
    assert.equal(r.enviado, false);
    assert.match(r.motivo, /BREVO_API_KEY/);
  } finally { if (antes) process.env.BREVO_API_KEY = antes; }
});

test('Brevo fora do ar não derruba o cron', async () => {
  process.env.BREVO_API_KEY = 'k';
  process.env.CONTATO_EMAIL = 'tales@exemplo.com';
  const r = await enviarResumo({ assunto: 'a', texto: 'b' },
    { fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.equal(r.enviado, false);
  assert.match(r.motivo, /ECONNRESET/);
});

test('o e-mail sai com o assunto e o texto do resumo', async () => {
  process.env.BREVO_API_KEY = 'k';
  process.env.CONTATO_EMAIL = 'tales@exemplo.com';
  let corpo = null;
  const r = await enviarResumo({ assunto: 'SEOHack — 2 publicados', texto: 'corpo do resumo' },
    { fetchImpl: async (_u, o) => { corpo = JSON.parse(o.body); return { ok: true, status: 201 }; } });
  assert.equal(r.enviado, true);
  assert.equal(corpo.subject, 'SEOHack — 2 publicados');
  assert.equal(corpo.textContent, 'corpo do resumo');
  assert.equal(corpo.to[0].email, 'tales@exemplo.com');
});

test('o cron está declarado e aponta para o arquivo', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const j = JSON.parse(await readFile(
    fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
  const c = j.crons.find((x) => x.path === '/api/cron/resumo');
  assert.ok(c, 'o resumo não roda sozinho');
  assert.equal(c.schedule, '0 23 * * 5', 'sexta 23h UTC = 20h de Brasília');
});

test('falha de envio não derruba o estágio, mas aparece no resultado', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(
    fileURLToPath(new URL('../api/cron/resumo.mjs', import.meta.url)), 'utf8');
  assert.match(src, /error: `resumo não enviado/);
  assert.doesNotMatch(src, /throw new Error/, 'observação não pode derrubar o pipeline');
});
