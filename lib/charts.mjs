// Gráficos em SVG gerado no servidor.
//
// Sem biblioteca e sem JavaScript no cliente, por três motivos: o painel já é
// HTML renderizado no servidor e adicionar um bundle de charting para desenhar
// quatro linhas seria desproporcional; SVG inline funciona com JS desativado; e
// não há dependência nova para envelhecer.
//
// Princípio que atravessa o arquivo: nenhum gráfico é desenhado sem dado. Eixo
// vazio com zeros sugere fracasso, e ausência de medição não é fracasso — o
// blog tem três dias e a Search Console leva semanas.

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Paleta derivada da do painel. A cor de destaque é reservada para a série que
// importa; as demais ficam em tons de tinta para não competir.
const CORES = ['var(--proof)', '#3F5A6C', '#7C7669', '#A8B0A2', '#C3A15A'];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Datas contínuas entre início e fim, para o eixo não pular dias sem dado. */
export function eixoDeDatas(inicio, fim) {
  const dias = [];
  const d = new Date(inicio);
  const ate = new Date(fim);
  while (d <= ate) {
    dias.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dias;
}

/**
 * Linha temporal com uma ou mais séries.
 * @param {Array<{nome:string, pontos:Array<{x:string, y:number}>}>} series
 */
export function graficoLinha(series, { altura = 180, titulo = '', unidade = '' } = {}) {
  const comDado = series.filter((s) => s.pontos.some((p) => num(p.y) > 0));
  if (!comDado.length) return '';

  const eixoX = [...new Set(comDado.flatMap((s) => s.pontos.map((p) => p.x)))].sort();
  if (eixoX.length < 2) return '';   // um ponto não é uma linha

  const maxY = Math.max(...comDado.flatMap((s) => s.pontos.map((p) => num(p.y))), 1);
  const L = 40, R = 8, T = 12, B = 26;   // margens
  const W = 720, H = altura;
  const larg = W - L - R;
  const alt = H - T - B;

  const px = (i) => L + (eixoX.length === 1 ? larg / 2 : (i / (eixoX.length - 1)) * larg);
  const py = (v) => T + alt - (num(v) / maxY) * alt;

  const linhas = comDado.map((s, idx) => {
    const mapa = new Map(s.pontos.map((p) => [p.x, num(p.y)]));
    const d = eixoX.map((x, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(mapa.get(x) ?? 0).toFixed(1)}`).join(' ');
    const cor = CORES[idx % CORES.length];
    const pontos = eixoX.map((x, i) => mapa.has(x)
      ? `<circle cx="${px(i).toFixed(1)}" cy="${py(mapa.get(x)).toFixed(1)}" r="2.5" fill="${cor}"/>` : '').join('');
    return `<path d="${d}" fill="none" stroke="${cor}" stroke-width="1.8"
      stroke-linejoin="round" stroke-linecap="round"/>${pontos}`;
  }).join('');

  // Três marcas no eixo Y: zero, meio e topo. Mais que isso vira grade.
  const marcas = [0, maxY / 2, maxY].map((v) => `
    <line x1="${L}" y1="${py(v).toFixed(1)}" x2="${W - R}" y2="${py(v).toFixed(1)}"
          stroke="var(--rule)" stroke-width="1"/>
    <text x="${L - 6}" y="${(py(v) + 3).toFixed(1)}" text-anchor="end"
          font-size="10" fill="var(--muted)" font-family="var(--mono)">${Math.round(v)}</text>`).join('');

  const primeiro = eixoX[0].slice(8) + '/' + eixoX[0].slice(5, 7);
  const ultimo = eixoX.at(-1).slice(8) + '/' + eixoX.at(-1).slice(5, 7);

  // O total na legenda existe para conciliar o gráfico com a tabela ao lado: o
  // gráfico mostra o pico DIÁRIO e a tabela mostra o ACUMULADO do período, e
  // sem os dois números visíveis o leitor conclui que um dos dois está errado.
  const legenda = comDado.map((s, i) => {
    const total = s.pontos.reduce((acc, p) => acc + num(p.y), 0);
    return `<span class="leg"><i style="background:${CORES[i % CORES.length]}"></i>${esc(s.nome)}
      <b>${total}</b></span>`;
  }).join('');

  return `<figure class="chart">
  ${titulo ? `<figcaption>${esc(titulo)}${unidade ? ` <span>(${esc(unidade)})</span>` : ''}</figcaption>` : ''}
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}" preserveAspectRatio="none">
    ${marcas}${linhas}
    <text x="${L}" y="${H - 8}" font-size="10" fill="var(--muted)" font-family="var(--mono)">${primeiro}</text>
    <text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="var(--mono)">${ultimo}</text>
  </svg>
  <div class="legenda">${legenda}</div>
</figure>`;
}

/**
 * Barras horizontais. Usado para custo por artigo e distribuição de posições.
 * @param {Array<{rotulo:string, valor:number, sufixo?:string}>} itens
 */
export function graficoBarras(itens, { titulo = '', formata = (v) => v } = {}) {
  const validos = itens.filter((i) => num(i.valor) > 0);
  if (!validos.length) return '';

  const max = Math.max(...validos.map((i) => num(i.valor)));
  const linhas = validos.map((i) => {
    const pct = (num(i.valor) / max) * 100;
    return `<div class="barra-linha">
      <span class="barra-rotulo">${esc(i.rotulo)}</span>
      <span class="barra-trilho"><span class="barra" style="width:${pct.toFixed(1)}%"></span></span>
      <span class="barra-valor">${esc(formata(i.valor))}</span>
    </div>`;
  }).join('');

  return `<figure class="chart">
  ${titulo ? `<figcaption>${esc(titulo)}</figcaption>` : ''}
  <div class="barras">${linhas}</div>
</figure>`;
}

/**
 * Distribuição de ranking (PRD §29): quantos artigos em cada faixa.
 * Só considera artigo com posição medida — artigo sem dado não é "posição ruim",
 * é ausência de medição, e somá-lo à última faixa mentiria.
 */
export function distribuicaoDeRanking(artigos) {
  // `Number(null)` é 0, e `Number.isFinite(0)` é true — então artigo SEM posição
  // medida era contado como posição 0 e caía em "Top 3". A tela mostraria como
  // primeiros colocados artigos que nunca foram medidos. Posição válida no
  // Google começa em 1.
  const comPosicao = artigos.filter((a) => {
    if (a.position === null || a.position === undefined || a.position === '') return false;
    const p = Number(a.position);
    return Number.isFinite(p) && p >= 1;
  });
  if (!comPosicao.length) return { total: 0, faixas: [] };
  const faixa = (p) => (p <= 3 ? 'Top 3' : p <= 10 ? 'Top 10' : p <= 20 ? 'Top 20' : 'Além do Top 20');
  const contagem = new Map([['Top 3', 0], ['Top 10', 0], ['Top 20', 0], ['Além do Top 20', 0]]);
  for (const a of comPosicao) contagem.set(faixa(Number(a.position)), contagem.get(faixa(Number(a.position))) + 1);
  return {
    total: comPosicao.length,
    faixas: [...contagem].map(([rotulo, valor]) => ({ rotulo, valor })),
  };
}
