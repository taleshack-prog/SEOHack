// Demanda medida na SERP, no lugar do palpite do modelo.
//
// 06/11/2026, com 77 dias de dado na mesa: 29 artigos, 21 deles no Top 10,
// cinco no Top 3, quatro cliques no mês. Posição o motor conquista; tráfego
// não aparece. O gargalo não é escrever nem ranquear, é a ESCOLHA DO TERMO.
//
// O gerador de pauta estimava dificuldade e afinidade perguntando ao próprio
// modelo, e volume ele simplesmente não tinha — gravava zero. Então otimizava
// relevância, que é o que ele sabe julgar, e ignorava demanda, que é o que
// decide se alguém chega.
//
// A Perplexity não é ferramenta de palavra-chave: ela não devolve volume de
// busca, e nenhum número aqui é volume. O que ela devolve é a SERP, e a SERP
// carrega dois sinais mecânicos que valem mais que palpite:
//
//   1. QUEM ESCREVEU. Se dez páginas sólidas disputam um termo, alguém procura
//      por ele — ninguém escreve dez vezes para ninguém. Se o termo não aparece
//      em título nenhum, não é nicho inexplorado, é termo que não existe. Foi o
//      que aconteceu com "como funciona o gene mc1r": a lacuna era real na
//      Search Console, virou artigo, e o artigo está na posição 79 com três
//      impressões. Lacuna sem concorrente quase sempre é ausência de demanda.
//
//   2. QUEM SÃO. Wikipédia, universidade, órgão de governo e portal grande no
//      topo significam que ganhar ali custa anos. Blog de nicho, fórum e Q&A
//      significam que dá para entrar.
//
// O primeiro sinal é o que faltava: ele REPROVA o termo sem demanda, que é
// exatamente o tipo de termo que o blog vinha ganhando sem receber ninguém.

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const LIGACAO = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'para', 'por',
  'com', 'que', 'uma', 'um', 'os', 'as', 'e', 'ou', 'o', 'a', 'como', 'qual', 'quais']);

/** Palavras que carregam o sentido do termo, sem acento. */
export const termosChave = (t) => semAcento(t)
  .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  .filter((p) => p.length > 2 && !LIGACAO.has(p));

// Domínios cuja presença no topo encarece a disputa. Não é lista de "sites
// ruins": é lista de quem não se desloca.
const PESOS_PESADOS = [
  'wikipedia.org', 'britannica.com', 'scielo', 'nature.com', 'sciencedirect.com',
  'springer.com', 'nih.gov', 'who.int', 'embrapa.br', 'usp.br', 'unicamp.br',
  'ufrgs.br', 'globo.com', 'uol.com.br', 'terra.com.br', 'abril.com.br',
  'estadao.com.br', 'folha.uol.com.br', 'gov.br', 'edu.br', 'amazon.com',
  'mercadolivre.com.br', 'youtube.com',
];

const forte = (url) => {
  const h = semAcento(url).replace(/^https?:\/\//, '').split('/')[0];
  return PESOS_PESADOS.some((d) => h === d || h.endsWith(`.${d}`) || h.includes(d));
};

/**
 * Lê a SERP de um termo.
 *
 * @returns {{evidencia:number, concorrencia:number, paginas:number,
 *            dominios:number, dificuldade:number}}
 *   evidencia    0–1, quantos resultados trazem o termo no título
 *   concorrencia 0–1, quantos vêm de domínio que não se desloca
 *   dificuldade  0–100, para alimentar o opportunityScore
 */
export function lerSerp(termo, resultados = []) {
  const chaves = termosChave(termo);
  const lista = Array.isArray(resultados) ? resultados : [];
  if (!chaves.length || !lista.length) {
    return { evidencia: 0, concorrencia: 0, paginas: lista.length, dominios: 0, dificuldade: 50 };
  }

  let comTermo = 0;
  let fortes = 0;
  const dominios = new Set();

  for (const r of lista) {
    const titulo = semAcento(r?.title);
    // Título que cobre a maior parte das palavras do termo conta como página
    // escrita PARA aquela busca. Uma palavra solta em comum não conta.
    const cobertos = chaves.filter((k) => titulo.includes(k)).length;
    if (cobertos / chaves.length >= 0.6) comTermo++;
    if (forte(r?.url || '')) fortes++;
    try { dominios.add(new URL(r.url).hostname.replace(/^www\./, '')); } catch { /* ignora */ }
  }

  const evidencia = comTermo / lista.length;
  const concorrencia = fortes / lista.length;

  return {
    evidencia: Number(evidencia.toFixed(2)),
    concorrencia: Number(concorrencia.toFixed(2)),
    paginas: lista.length,
    dominios: dominios.size,
    // Piso de 10 e teto de 95: SERP vazia não é "fácil", é desconhecida.
    dificuldade: Math.max(10, Math.min(95, Math.round(concorrencia * 85 + 15))),
  };
}

/** Abaixo disso, ninguém escreveu para o termo — e ninguém procura por ele. */
export const MIN_EVIDENCIA = 0.3;
/** SERP com menos páginas que isto não sustenta conclusão nenhuma. */
export const MIN_PAGINAS = 4;

export function vereditoDoTermo(sinais) {
  if (sinais.paginas < MIN_PAGINAS) {
    return { aprovado: false, motivo: `só ${sinais.paginas} página(s) na SERP — sem evidência de que alguém procure` };
  }
  if (sinais.evidencia < MIN_EVIDENCIA) {
    return { aprovado: false,
      motivo: `nenhum concorrente escreveu para este termo (${Math.round(sinais.evidencia * 100)}% dos títulos) `
        + '— lacuna sem concorrente costuma ser ausência de demanda, não oportunidade' };
  }
  if (sinais.concorrencia >= 0.8) {
    return { aprovado: false,
      motivo: `${Math.round(sinais.concorrencia * 100)}% do topo é enciclopédia, universidade ou portal grande `
        + '— ganhar aqui custa anos' };
  }
  return { aprovado: true, motivo: null };
}

/**
 * Sonda os candidatos na SERP, um por chamada.
 *
 * Um por chamada porque `buscar()` funde os resultados de consultas diferentes
 * numa lista só, sem dizer de quem é cada um — mandar cinco juntas devolveria
 * uma sopa impossível de atribuir.
 *
 * @returns {Promise<{aprovados:Array, reprovados:Array, sondados:number}>}
 */
export async function sondarDemanda(candidatos = [], { buscarImpl, maxResults = 10, teto = 12 } = {}) {
  const aprovados = [];
  const reprovados = [];
  let sondados = 0;

  for (const c of candidatos.slice(0, teto)) {
    let sinais;
    try {
      const r = await buscarImpl(c.topico, { max_results: maxResults });
      sinais = lerSerp(c.topico, r?.results);
      sondados++;
    } catch (err) {
      // Falha de rede não reprova o termo: mantém sem sinal, com a dificuldade
      // neutra, em vez de descartar uma pauta boa por instabilidade da API.
      aprovados.push({ ...c, sinais: null, semSonda: err.message });
      continue;
    }

    const v = vereditoDoTermo(sinais);
    if (v.aprovado) aprovados.push({ ...c, sinais });
    else reprovados.push({ ...c, sinais, motivo: v.motivo });
  }

  return { aprovados, reprovados, sondados };
}
