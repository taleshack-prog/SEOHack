// LINKS BIDIRECIONAIS DE CLUSTER (PRD §34)
//
// O problema que isto resolve: um satélite escrito depois do pilar linka para
// ele, mas o pilar foi escrito quando o satélite não existia — e nunca recebe
// o link de volta. Resultado observado no blog real: o pilar de `saas` recebia
// link de quatro artigos e não devolvia nenhum. A página que deveria distribuir
// autoridade para o cluster virou beco sem saída, e piora a cada publicação.
//
// A correção não precisa de LLM: é montar uma lista de links a partir do que já
// está publicado. Custo zero, e entra no mesmo commit do satélite novo.

export const SENTINELA = '## Continue neste cluster';

/** Seção de links para os satélites do cluster. */
export function buildPillarSection(satelites, site) {
  if (!satelites.length) return '';
  const base = site.blogBasePath || '/blog';
  const itens = satelites
    .map((a) => `- [${a.title}](${base}/${a.slug})${a.description ? ` — ${primeiraFrase(a.description)}` : ''}`)
    .join('\n');
  return `${SENTINELA}\n\n${itens}\n`;
}

function primeiraFrase(texto = '') {
  const t = String(texto).trim();
  const fim = t.search(/[.!?](\s|$)/);
  return fim === -1 ? t : t.slice(0, fim + 1);
}

/**
 * Insere ou atualiza a seção no Markdown do pilar.
 *
 * Idempotente: rodar de novo substitui a seção anterior em vez de empilhar. A
 * seção entra ANTES do FAQ, porque o FAQ é fechamento — links de navegação
 * depois dele ficam órfãos visualmente e o leitor já saiu da página.
 */
export function upsertPillarSection(markdown, secao) {
  if (!secao) return markdown;

  const jaTem = markdown.indexOf(SENTINELA);
  let limpo = markdown;
  if (jaTem !== -1) {
    // Remove da sentinela até o próximo H2 (ou o fim do texto).
    const resto = markdown.slice(jaTem + SENTINELA.length);
    const proximoH2 = resto.search(/^## /m);
    limpo = markdown.slice(0, jaTem) + (proximoH2 === -1 ? '' : resto.slice(proximoH2));
  }

  const faq = limpo.search(/^##\s+(FAQ|Perguntas Frequentes)/im);
  const corpo = faq === -1
    ? `${limpo.trimEnd()}\n\n${secao}`
    : `${limpo.slice(0, faq).trimEnd()}\n\n${secao}\n${limpo.slice(faq)}`;

  return corpo.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/**
 * Decide o que precisa ser reescrito depois de uma publicação.
 *
 * @param {Array} publicados  todos os artigos publicados do cliente
 * @param {Array} novos       slugs recém-publicados nesta execução
 * @returns {Array<{article, markdown}>} pilares a regravar
 */
export function pillarsToRefresh(publicados, novos, site) {
  const clustersTocados = new Set(
    publicados.filter((a) => novos.includes(a.slug) && !a.is_pillar).map((a) => a.cluster));

  const saida = [];
  for (const cluster of clustersTocados) {
    if (!cluster) continue;
    const pilar = publicados.find((a) => a.cluster === cluster && a.is_pillar);
    // Cluster sem pilar publicado não tem o que atualizar — os satélites ficam
    // soltos até alguém escrever a âncora. Vale um alerta no dashboard um dia.
    if (!pilar || !pilar.markdown) continue;

    const satelites = publicados
      .filter((a) => a.cluster === cluster && !a.is_pillar && a.slug !== pilar.slug)
      .sort((a, b) => new Date(a.first_published_at || 0) - new Date(b.first_published_at || 0));

    const markdown = upsertPillarSection(pilar.markdown, buildPillarSection(satelites, site));
    if (markdown !== pilar.markdown) saida.push({ article: pilar, markdown });
  }
  return saida;
}
