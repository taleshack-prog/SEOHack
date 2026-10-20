// O que as pessoas realmente digitaram.
//
// Motivo de existir: em 47 dias o blog da Hack Tech Farm publicou 28 artigos,
// colocou 16 deles no Top 10 — e somou 124 impressões. Posição 1,0 com 3
// impressões. Isso não é falha de motor nem de indexação: é tópico sem
// demanda, escolhido à mão, sem nenhum número por trás.
//
// A tabela gsc_query_metrics existe desde a migração 001 e nunca recebeu uma
// linha. Ou seja: a única evidência de demanda real que o projeto tem — as
// buscas que de fato levaram alguém até uma página — estava sendo descartada
// a cada coleta.
//
// 20/10/2026 — a primeira coleta mostrou o defeito da primeira versão desta
// tela. Ela oferecia "virar tópico" para TODA consulta fora do Top 10,
// inclusive "depressão endogâmica", que já tinha artigo dedicado ranqueando em
// 10,1. Clicar teria criado um segundo artigo disputando a mesma busca com o
// primeiro — exatamente a canibalização que o projeto gastou uma tarde
// consertando. A coleta só olha páginas em /blog/, então por construção TODA
// consulta aqui já caiu num artigo: a pergunta certa não é "existe página?",
// é "a página é sobre isso?".

/** Média de posição ponderada por impressão — a posição de quem apareceu mais
 *  pesa mais. Média simples dá o mesmo peso a uma página com 1 impressão e a
 *  outra com 300. */
function posicaoMedia(linhas) {
  const total = linhas.reduce((s, l) => s + (Number(l.impressions) || 0), 0);
  if (!total) {
    const n = linhas.filter((l) => l.position != null).length;
    return n ? linhas.reduce((s, l) => s + (Number(l.position) || 0), 0) / n : null;
  }
  return linhas.reduce((s, l) => s + (Number(l.position) || 0) * (Number(l.impressions) || 0), 0) / total;
}

/**
 * Junta as linhas page x query numa linha por consulta.
 *
 * @param {Array<{query, page_url, impressions, clicks, position}>} linhas
 * @returns {Array} ordenado por impressões, depois por posição
 */
export function agruparPorConsulta(linhas = []) {
  const mapa = new Map();
  for (const l of linhas) {
    const q = String(l.query || '').trim();
    if (!q) continue;
    if (!mapa.has(q)) mapa.set(q, []);
    mapa.get(q).push(l);
  }

  return [...mapa.entries()].map(([query, grupo]) => {
    const impressions = grupo.reduce((s, l) => s + (Number(l.impressions) || 0), 0);
    const clicks = grupo.reduce((s, l) => s + (Number(l.clicks) || 0), 0);
    // A página que mais apareceu para esta consulta é a que o Google escolheu
    // para respondê-la. Duas páginas disputando a mesma consulta é
    // canibalização, e por isso `paginas` fica visível.
    const ordenadas = [...grupo].sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
    return {
      query,
      impressions,
      clicks,
      ctr: impressions ? clicks / impressions : 0,
      position: posicaoMedia(grupo),
      pagina: ordenadas[0]?.page_url || null,
      paginas: new Set(grupo.map((l) => l.page_url)).size,
    };
  }).sort((a, b) => b.impressions - a.impressions
    || (a.position ?? 999) - (b.position ?? 999));
}

/**
 * Em que estado está a consulta.
 *
 *  'traz'    — já está no Top 10 e aparece. É o que sustenta o blog hoje.
 *  'quase'   — página 2 (11 a 20). Um artigo dedicado costuma ser o empurrão.
 *  'longe'   — além da posição 20. Existe demanda e o site não responde bem.
 */
export function estadoDaConsulta({ position }) {
  if (position == null) return 'longe';
  if (position <= 10) return 'traz';
  if (position <= 20) return 'quase';
  return 'longe';
}

// --- a página de destino já é sobre a consulta? ---

const SEM_PESO = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das',
  'e', 'ou', 'que', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'com', 'como', 'qual',
  'quais', 'sem', 'ao', 'aos', 'se', 'sua', 'seu']);

const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Palavras com conteúdo, sem acento e sem as de ligação. */
export function palavras(texto = '') {
  return semAcento(texto).split(/[^a-z0-9]+/).filter((t) => t && !SEM_PESO.has(t));
}

// Prefixo de cinco letras no lugar de radical de verdade: faz "cálculo" casar
// com "calcular" e "genética" com "genético", sem trazer um stemmer para o
// projeto por causa de uma heurística de tela.
const raiz = (t) => t.slice(0, 5);

export function slugDaUrl(url = '') {
  const caminho = String(url).replace(/[?#].*$/, '').replace(/\/+$/, '');
  return caminho.split('/').pop() || '';
}

/**
 * Quanto da consulta a página de destino já cobre, de 0 a 1.
 *
 * 1 = a página é sobre exatamente isso, e escrever outra seria canibalizar.
 * Perto de 0 = o Google escolheu a página mais próxima que tinha, e existe
 * lacuna de verdade.
 */
export function cobertura(query, pageUrl) {
  const q = palavras(query);
  if (!q.length) return 0;
  const alvo = new Set(palavras(slugDaUrl(pageUrl)).map(raiz));
  return q.filter((t) => alvo.has(raiz(t))).length / q.length;
}

export const LIMIAR_LACUNA = 0.5;

/** A consulta não tem artigo próprio — vale escrever um. */
export const ehLacuna = (c) => cobertura(c.query, c.pagina) < LIMIAR_LACUNA;

/**
 * Consultas que pedem ação, separadas pelo tipo de ação.
 *
 * O corte por impressão existe para não transformar ruído em fila: uma consulta
 * com 1 impressão em 28 dias não é demanda, é acaso.
 */
export function aMelhorar(consultas = [], { minImpressoes = 2 } = {}) {
  const fora = consultas.filter((c) => c.impressions >= minImpressoes
    && estadoDaConsulta(c) !== 'traz');
  return {
    escrever: fora.filter(ehLacuna).sort((a, b) => b.impressions - a.impressions),
    melhorar: fora.filter((c) => !ehLacuna(c)).sort((a, b) => b.impressions - a.impressions),
  };
}

/**
 * Páginas que o Google escolheu para várias buscas diferentes e responde mal a
 * quase todas.
 *
 * Caso real: `/blog/arr-ou-mrr-qual-metrica-usar-e-quando` é o destino de "o
 * que é arr" (posição 10), "o que é mrr" (36), "como calcular mrr" (80) e "mrr
 * o que é" (87). Uma página tentando responder duas perguntas ganha para uma e
 * afunda para a outra — e não se conserta escrevendo mais.
 */
export function paginasSobrecarregadas(consultas = [], { minConsultas = 3, espalhamento = 20 } = {}) {
  const mapa = new Map();
  for (const c of consultas) {
    if (!c.pagina) continue;
    if (!mapa.has(c.pagina)) mapa.set(c.pagina, []);
    mapa.get(c.pagina).push(c);
  }

  return [...mapa.entries()]
    .map(([pagina, grupo]) => {
      const posicoes = grupo.map((c) => c.position).filter((p) => p != null);
      const melhor = posicoes.length ? Math.min(...posicoes) : null;
      const pior = posicoes.length ? Math.max(...posicoes) : null;
      return {
        pagina,
        consultas: grupo.sort((a, b) => (a.position ?? 999) - (b.position ?? 999)),
        melhor,
        pior,
        impressoes: grupo.reduce((s, c) => s + c.impressions, 0),
      };
    })
    .filter((p) => p.consultas.length >= minConsultas
      && p.melhor != null && (p.pior - p.melhor) >= espalhamento)
    .sort((a, b) => b.impressoes - a.impressoes);
}

/** Resumo honesto do que a janela mostra, sem adjetivo. */
export function resumo(consultas = []) {
  const impressoes = consultas.reduce((s, c) => s + c.impressions, 0);
  const cliques = consultas.reduce((s, c) => s + c.clicks, 0);
  const porEstado = { traz: 0, quase: 0, longe: 0 };
  for (const c of consultas) porEstado[estadoDaConsulta(c)]++;
  return { consultas: consultas.length, impressoes, cliques, ...porEstado };
}
