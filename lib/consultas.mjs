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
// Aqui o dado bruto do GSC vira decisão: o que já traz gente, o que está perto
// de trazer, e o que vale virar artigo.

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

/**
 * As que valem virar artigo, em ordem de retorno provável.
 *
 * O corte por impressão existe para não transformar ruído em fila: uma consulta
 * com 1 impressão em 28 dias não é demanda, é acaso.
 */
export function valemArtigo(consultas = [], { minImpressoes = 2 } = {}) {
  return consultas
    .filter((c) => c.impressions >= minImpressoes && estadoDaConsulta(c) !== 'traz')
    .sort((a, b) => b.impressions - a.impressions);
}

/** Resumo honesto do que a janela mostra, sem adjetivo. */
export function resumo(consultas = []) {
  const impressoes = consultas.reduce((s, c) => s + c.impressions, 0);
  const cliques = consultas.reduce((s, c) => s + c.clicks, 0);
  const porEstado = { traz: 0, quase: 0, longe: 0 };
  for (const c of consultas) porEstado[estadoDaConsulta(c)]++;
  return { consultas: consultas.length, impressoes, cliques, ...porEstado };
}
