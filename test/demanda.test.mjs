// A escolha do termo passou a ser medida.
//
// 06/11/2026, com 77 dias de dado: 29 artigos, 21 na primeira página, quatro
// cliques no mês. O gerador escolhia por relevância e estimava dificuldade
// perguntando ao modelo; volume ele gravava como zero. Agora a SERP decide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  termosChave, lerSerp, vereditoDoTermo, sondarDemanda, MIN_EVIDENCIA, MIN_PAGINAS,
} from '../lib/demanda.mjs';

const pagina = (title, url) => ({ title, url });

const SERP_COM_DEMANDA = [
  pagina('Herança poligênica: o que é, exemplos e exercícios', 'https://blogdegenetica.com.br/a'),
  pagina('O que é herança poligênica?', 'https://estudokids.com.br/b'),
  pagina('Herança poligênica — Biologia', 'https://brasilescola.uol.com.br/c'),
  pagina('Herança poligênica explicada passo a passo', 'https://cursinhoz.com/d'),
  pagina('Entenda a herança poligênica', 'https://vetnews.com.br/e'),
  pagina('Herança poligênica em bovinos', 'https://criadorrural.com.br/f'),
];

// A SERP que o mc1r teria: quase ninguém escreveu, e quem escreveu é pesado.
const SERP_SEM_DEMANDA = [
  pagina('Melanocortin 1 receptor gene in cattle', 'https://www.sciencedirect.com/x'),
  pagina('Pigmentation genetics review', 'https://www.nature.com/y'),
  pagina('Genética animal', 'https://pt.wikipedia.org/wiki/z'),
];

test('as palavras de ligação não contam como termo', () => {
  assert.deepEqual(termosChave('o que é a herança poligênica'), ['heranca', 'poligenica']);
});

test('termo com muita gente escrevendo é aprovado', () => {
  const s = lerSerp('herança poligênica', SERP_COM_DEMANDA);
  assert.equal(s.evidencia, 1);
  assert.ok(s.concorrencia < 0.5);
  assert.equal(vereditoDoTermo(s).aprovado, true);
});

test('SERP curta demais não sustenta conclusão', () => {
  const v = vereditoDoTermo(lerSerp('gene mc1r', SERP_SEM_DEMANDA));
  assert.equal(v.aprovado, false);
  assert.match(v.motivo, /sem evidência de que alguém procure/);
  assert.ok(SERP_SEM_DEMANDA.length < MIN_PAGINAS);
});

test('ninguém escreveu para o termo: lacuna sem concorrente é ausência de demanda', () => {
  // Seis páginas do assunto, nenhuma escrita PARA esta busca.
  const serp = [
    pagina('Genética da pelagem em equinos', 'https://blog1.com.br/a'),
    pagina('Cores de pelagem e hereditariedade', 'https://blog2.com.br/b'),
    pagina('Como funciona a pigmentação animal', 'https://blog3.com.br/c'),
    pagina('Alelos e expressão de cor', 'https://blog4.com.br/d'),
    pagina('Melanina em mamíferos', 'https://blog5.com.br/e'),
  ];
  const s = lerSerp('como funciona o gene mc1r', serp);
  assert.ok(s.evidencia < MIN_EVIDENCIA);
  const v = vereditoDoTermo(s);
  assert.equal(v.aprovado, false);
  assert.match(v.motivo, /lacuna sem concorrente/);
});

test('topo tomado por enciclopédia e universidade é recusado', () => {
  const serp = Array.from({ length: 6 }, (_, i) =>
    pagina('Herança poligênica', `https://pt.wikipedia.org/wiki/${i}`));
  const s = lerSerp('herança poligênica', serp);
  assert.equal(s.concorrencia, 1);
  const v = vereditoDoTermo(s);
  assert.equal(v.aprovado, false);
  assert.match(v.motivo, /custa anos/);
});

test('a dificuldade medida substitui o palpite, com piso e teto', () => {
  const facil = lerSerp('herança poligênica', SERP_COM_DEMANDA);
  const dificil = lerSerp('herança poligênica',
    Array.from({ length: 5 }, (_, i) => pagina('Herança poligênica', `https://gov.br/${i}`)));
  assert.ok(facil.dificuldade < dificil.dificuldade);
  assert.ok(dificil.dificuldade <= 95 && facil.dificuldade >= 10);
});

test('SERP vazia não é "fácil", é desconhecida', () => {
  const s = lerSerp('qualquer termo', []);
  assert.equal(s.dificuldade, 50, 'zero concorrente não pode virar dificuldade mínima');
  assert.equal(vereditoDoTermo(s).aprovado, false);
});

// --- a sondagem ---

test('cada termo é sondado numa chamada própria', async () => {
  const pedidos = [];
  await sondarDemanda(
    [{ topico: 'a herança poligênica' }, { topico: 'o coeficiente de endogamia' }],
    { buscarImpl: async (q) => { pedidos.push(q); return { results: SERP_COM_DEMANDA }; } });
  // buscar() funde os resultados de consultas diferentes numa lista só, sem
  // dizer de quem é cada um: mandar as duas juntas daria uma sopa.
  assert.deepEqual(pedidos, ['a herança poligênica', 'o coeficiente de endogamia']);
});

test('separa aprovados de reprovados, com o motivo de cada recusa', async () => {
  const r = await sondarDemanda(
    [{ topico: 'herança poligênica' }, { topico: 'gene mc1r' }],
    { buscarImpl: async (q) => ({
      results: q.includes('mc1r') ? SERP_SEM_DEMANDA : SERP_COM_DEMANDA }) });
  assert.equal(r.aprovados.length, 1);
  assert.equal(r.aprovados[0].topico, 'herança poligênica');
  assert.ok(r.aprovados[0].sinais.evidencia > 0);
  assert.equal(r.reprovados.length, 1);
  assert.ok(r.reprovados[0].motivo);
});

test('busca fora do ar não reprova o termo', async () => {
  const r = await sondarDemanda([{ topico: 'herança poligênica' }],
    { buscarImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.equal(r.aprovados.length, 1, 'descartaria pauta boa por instabilidade da API');
  assert.equal(r.aprovados[0].sinais, null);
  assert.match(r.aprovados[0].semSonda, /ECONNRESET/);
  assert.equal(r.sondados, 0);
});

test('o teto limita quantas sondagens são feitas', async () => {
  let n = 0;
  const muitos = Array.from({ length: 30 }, (_, i) => ({ topico: `termo numero ${i}` }));
  await sondarDemanda(muitos, { teto: 5, buscarImpl: async () => { n++; return { results: [] }; } });
  assert.equal(n, 5);
});
