// ============================================================================
// REGRAS DE VALIDAÇÃO DE ARTIGO — FONTE ÚNICA DE VERDADE
//
// Corrige o bloqueador A3 da auditoria. No v4 a validação só rodava no build
// do site, DEPOIS de a F8 já ter feito o commit em main: um artigo reprovado
// deixava lixo no histórico e congelava o deploy de produção.
//
// Este arquivo roda em TRÊS lugares:
//   1. no Content Engine, antes de enviar (falha mais barata possível);
//   2. dentro da F8, antes do commit  -> repo do site;
//   3. no verify-articles.mjs do build -> repo do site, defesa em profundidade.
//
// Os itens 2 e 3 vivem no outro repositório. Copie este arquivo para lá SEM
// alterar, ou publique como pacote privado. Se as duas cópias divergirem, o
// bloqueador A3 volta a existir em silêncio.
// ============================================================================

export const OPERATOR_MARKER = '[NOTA PARA O OPERADOR]';

export const FRONTMATTER_FIELDS = [
  'title', 'description', 'summary', 'author',
  'publishedAt', 'updatedAt', 'tags', 'draft',
];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
// Dois níveis de suspeita, porque o custo do falso positivo é alto: o artigo
// já foi escrito e pago quando a regra reprova.
//
// FORTE — percentual, moeda e multiplicador. É a forma que estatística de
// mercado inventada assume ("73% das startups", "R$ 4.500 por mês", "3x mais
// rápido"). Exige fonte sempre.
const STAT_FORTE = /(\d{1,3}(?:[.,]\d+)?\s?%|R\$\s?\d|US\$\s?\d|\b\d+(?:[.,]\d+)?\s?(?:x|vezes)\b)/gi;

// FRACO — número grande com separador de milhar. Em texto técnico isto é
// ordem de grandeza, não estatística: "2.000 schemas", "10.000 linhas",
// "50.000 requisições". Só exige fonte quando o parágrafo apresenta o número
// como dado apurado. Antes, "2.000 schemas" reprovava um artigo inteiro sobre
// multi-tenancy no PostgreSQL.
const STAT_FRACA = /\b\d{1,3}(?:\.\d{3})+\b/g;

// Linguagem que transforma número em afirmação sobre o mundo.
const AFIRMACAO = /\b(pesquisa|estudo|relat[óo]rio|levantamento|dados? (mostram|indicam|apontam)|segundo|de acordo com|na m[ée]dia|em m[ée]dia|mercado|benchmark|estat[íi]stica)\b/i;
const LINK_RE = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
const DANGEROUS = [
  { re: /<script\b/i,              rule: 'html_script' },
  { re: /<iframe\b/i,              rule: 'html_iframe' },
  { re: /\son[a-z]+\s*=/i,         rule: 'html_event_handler' },
  { re: /javascript\s*:/i,         rule: 'protocol_javascript' },
  { re: /data\s*:\s*text\/html/i,  rule: 'protocol_data' },
];

// Multi-cliente: os caminhos de produto e o prefixo do blog variam por cliente.
// Ficavam fixos aqui (HTF), o que reprovaria todo artigo de qualquer outro
// cliente. Agora vêm de clients.adapter_config, com este default só para a HTF.
const DEFAULT_PRODUCT_PATHS = ['/servicos', '/produtos', '/contato', '/neuroart', '/posthink'];
const DEFAULT_BLOG_PATH = '/blog';

export const LIMITS = {
  minWords: 800,
  maxBytes: 500 * 1024,
  minInternalLinks: 2,
  minProductLinks: 1,
  slugMin: 3,
  slugMax: 80,
};

function countWords(body) {
  return body
    .replace(/```[\s\S]*?```/g, ' ')   // blocos de código não contam
    .replace(/[#>*_`~\-|]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * @param {{slug:string, frontmatter:object, markdown:string}} article
 * @returns {{valid:boolean, errors:Array<{rule:string,detail:string}>, warnings:Array, stats:object}}
 */
export function validateArticle({ slug, frontmatter = {}, markdown = '' }, site = {}) {
  const productPaths = site.productPaths || DEFAULT_PRODUCT_PATHS;
  const blogPath = site.blogBasePath || DEFAULT_BLOG_PATH;
  // Slugs que existem de verdade. Sem esta lista, "2 links internos" obriga o
  // modelo a inventar URLs num blog vazio — e link inventado é 404.
  const existentes = site.existingSlugs || null;
  const errors = [];
  const warnings = [];
  const fail = (rule, detail) => errors.push({ rule, detail });

  // --- slug (D10: fonte única é o nome do arquivo) ---
  if (!slug || !SLUG_RE.test(slug)) {
    fail('slug_format', `slug inválido: "${slug}"`);
  } else if (slug.length < LIMITS.slugMin || slug.length > LIMITS.slugMax) {
    fail('slug_length', `slug deve ter ${LIMITS.slugMin}-${LIMITS.slugMax} chars`);
  }
  if ('slug' in frontmatter) {
    fail('slug_in_frontmatter',
      'slug não pode estar no frontmatter — deriva do nome do arquivo');
  }

  // --- frontmatter: exatamente 8 campos ---
  const keys = Object.keys(frontmatter);
  for (const f of FRONTMATTER_FIELDS) {
    if (!(f in frontmatter)) fail('frontmatter_missing', `campo obrigatório ausente: ${f}`);
  }
  for (const k of keys) {
    if (!FRONTMATTER_FIELDS.includes(k)) fail('frontmatter_extra', `campo não permitido: ${k}`);
  }
  for (const f of ['publishedAt', 'updatedAt']) {
    if (frontmatter[f] && !ISO_RE.test(frontmatter[f])) {
      fail('date_format', `${f} deve ser ISO 8601 UTC (2026-08-14T10:00:00Z)`);
    }
  }
  if (frontmatter.tags && !Array.isArray(frontmatter.tags)) {
    fail('tags_type', 'tags deve ser array');
  }
  if (typeof frontmatter.draft !== 'boolean') {
    fail('draft_type', 'draft deve ser booleano');
  }

  // --- gate humano (bloqueador A2) ---
  // A regra do v4 era "abortar o build se achar o marcador". Isso quebrava o
  // caminho feliz do PRD §8.2. Agora: o marcador é PERMITIDO desde que o
  // artigo esteja como draft. Publicar com marcador é que é erro.
  const hasMarker = markdown.includes(OPERATOR_MARKER);
  if (hasMarker && frontmatter.draft !== true) {
    fail('operator_note_unresolved',
      'artigo contém nota para o operador mas está marcado como draft:false');
  }

  // --- corpo ---
  const words = countWords(markdown);
  if (words < LIMITS.minWords) {
    fail('word_count', `${words} palavras, mínimo ${LIMITS.minWords}`);
  }
  if (Buffer.byteLength(markdown, 'utf8') > LIMITS.maxBytes) {
    fail('payload_size', `markdown acima de ${LIMITS.maxBytes} bytes`);
  }
  if (/^em nossa experiência|na nossa experiência|quando implementamos/im.test(markdown)) {
    fail('fabricated_experience',
      'experiência em primeira pessoa fabricada (PRD §8.2) — use o marcador de nota');
  }

  // --- links (PRD §20) ---
  const links = [...markdown.matchAll(LINK_RE)].map((m) => m[1]);
  const internal = links.filter((h) => h.startsWith(`${blogPath}/`));
  const product = links.filter((h) => productPaths.some((p) => h.startsWith(p)));
  const external = links.filter((h) => /^https?:\/\//i.test(h));
  // A exigência acompanha o que existe: num blog com 0 ou 1 artigo, cobrar 2
  // links internos é impossível de cumprir honestamente.
  const minInternos = existentes === null
    ? LIMITS.minInternalLinks
    : Math.min(LIMITS.minInternalLinks, existentes.length);

  if (internal.length < minInternos) {
    fail('internal_links', `${internal.length} links internos, mínimo ${minInternos}`);
  }

  if (existentes) {
    const quebrados = internal
      .map((h) => h.replace(`${blogPath}/`, '').replace(/[#?].*$/, ''))
      .filter((s) => s && s !== slug && !existentes.includes(s));
    if (quebrados.length) {
      fail('broken_internal_link',
        `aponta para artigo inexistente: ${[...new Set(quebrados)].slice(0, 3).join(', ')}`);
    }
  }
  if (product.length < LIMITS.minProductLinks) {
    fail('product_links', `${product.length} links de produto, mínimo ${LIMITS.minProductLinks}`);
  }

  // --- integridade factual (PRD §8.1) ---
  //
  // A regra existe para impedir estatística de mercado inventada ("73% das
  // startups falham"), que é a principal ameaça ao E-E-A-T. Ela NÃO deveria
  // pegar aritmética de exemplo — e pegava: um artigo ensinando a calcular MRR
  // é feito de "se você tem 100 clientes pagando R$ 50", número para o qual não
  // existe fonte a citar. O artigo era reprovado depois de escrito e pago.
  //
  // Duas exceções, ambas detectáveis pelo próprio parágrafo:
  //   - marcadores de exemplo hipotético
  //   - contexto de cálculo (fórmula, operador aritmético, unidade por mês)
  const EXEMPLO = /\b(por exemplo|suponha|imagine|digamos|considere|vamos supor|hipot[ée]tic|se voc[êe] (tem|tiver)|imaginemos|um caso|no exemplo)\b/i;
  const CALCULO = /[=÷×]|\b(dividid|multiplicad|f[óo]rmula|c[áa]lculo|calcul(a|ar|ando)|som(a|ar)|subtra|resulta em|equival)\w*/i;

  const paragraphs = markdown.split(/\n{2,}/);
  const unsourced = [];
  for (const par of paragraphs) {
    const t = par.trimStart();
    if (t.startsWith('```') || t.startsWith('|') || t.startsWith('    ')) continue;
    if (EXEMPLO.test(par) || CALCULO.test(par)) continue;

    STAT_FORTE.lastIndex = 0;
    STAT_FRACA.lastIndex = 0;
    const fortes = par.match(STAT_FORTE) || [];
    const fracas = (par.match(STAT_FRACA) || []).filter(() => AFIRMACAO.test(par));
    const achados = [...fortes, ...fracas];
    if (!achados.length) continue;

    const hasSource = [...par.matchAll(LINK_RE)].some((m) => /^https?:\/\//i.test(m[1]));
    if (!hasSource) unsourced.push(achados[0]);
  }
  if (unsourced.length) {
    fail('unsourced_statistic',
      `estatística sem link de fonte: ${unsourced.slice(0, 3).join(', ')}. ` +
      'Se for exemplo hipotético, deixe isso explícito no texto ("suponha que...").');
  }

  // --- triagem de segurança ---
  // Isto é TRIAGEM, não a defesa (defeito B3/D12). A defesa real é a whitelist
  // do sanitize-html no render, no repo do site. Blacklist só rejeita cedo.
  for (const { re, rule } of DANGEROUS) {
    if (re.test(markdown)) fail(rule, 'conteúdo potencialmente perigoso rejeitado');
  }

  // --- avisos (não bloqueiam) ---
  if (external.length === 0) warnings.push({ rule: 'no_external_source', detail: 'nenhuma fonte externa' });
  if (!/^##\s+(FAQ|Perguntas Frequentes)/im.test(markdown)) {
    warnings.push({ rule: 'no_faq_section',
      detail: 'sem seção de FAQ — o rich result acabou, mas o bloco ainda vale para GEO' });
  }
  if (words > 3000) warnings.push({ rule: 'very_long', detail: `${words} palavras` });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: { words, internalLinks: internal.length, productLinks: product.length,
             externalLinks: external.length, hasOperatorNote: hasMarker,
             minInternalRequired: minInternos },
  };
}
