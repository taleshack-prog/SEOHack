// Diagnóstico público de um site, feito só com o que é visível de fora.
//
// Por que existe: o funil dos concorrentes mostra ao dono do site uma fraqueza
// medida, com número na tela, antes de pedir qualquer coisa. Isso converte. A
// diferença aqui é que nenhum número é inventado: não usamos Domain Authority
// (métrica da Moz, que o Google não usa) nem "X% de tráfego em 90 dias" sobre
// base desconhecida. Só o que dá para verificar buscando as páginas do site.
//
// O que NÃO dá para saber de fora, e por isso não é prometido em lugar nenhum
// desta tela: quantas páginas estão no índice do Google, quantas impressões o
// site tem, e quais robôs realmente passaram por lá. Isso exige Search Console
// e log do servidor — é exatamente o que o App entrega depois de contratado.
import { AGENTES_BUSCA, AGENTES_TREINO } from './crawlers.mjs';

const TIMEOUT_MS = 8000;
const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Normaliza o que o usuário digitou em uma origem https. */
export function normalizarDominio(entrada = '') {
  const cru = String(entrada).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!cru) throw new Error('Digite o endereço do site.');
  const host = cru.toLowerCase().replace(/^www\./, '');
  // Barreira de SSRF: só nomes públicos com ponto, nada de IP nem rede interna.
  if (!host.includes('.') || IP_LITERAL.test(host)
      || /(^|\.)(localhost|local|internal|lan|home\.arpa)$/.test(host)) {
    throw new Error(`"${entrada}" não parece um domínio público.`);
  }
  if (!/^[a-z0-9.-]+$/.test(host)) throw new Error('Endereço com caracteres inválidos.');
  return { host, origem: `https://${host}` };
}

async function buscar(fetchImpl, url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'SEOHack-Diagnostico/1.0 (+https://hacktechfarm.com.br)' },
    });
    const texto = await r.text();
    return { ok: r.ok, status: r.status, url: r.url || url, texto };
  } catch (err) {
    return { ok: false, status: 0, url, texto: '', erro: err.name === 'AbortError' ? 'tempo esgotado' : err.message };
  } finally {
    clearTimeout(t);
  }
}

// --- leitura de robots.txt ------------------------------------------------
/**
 * Agentes de IA bloqueados pelo robots.txt.
 * Só conta bloqueio na raiz: "Disallow: /" para o agente, ou para "*".
 */
export function agentesBloqueados(robots = '') {
  const linhas = robots.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  const grupos = [];
  let atual = null;
  for (const linha of linhas) {
    const [campoCru, ...resto] = linha.split(':');
    const campo = (campoCru || '').toLowerCase().trim();
    const valor = resto.join(':').trim();
    if (campo === 'user-agent') {
      if (!atual || atual.regras.length) atual = { agentes: [], regras: [] }, grupos.push(atual);
      atual.agentes.push(valor.toLowerCase());
    } else if (atual && (campo === 'disallow' || campo === 'allow')) {
      atual.regras.push({ tipo: campo, caminho: valor });
    }
  }
  const bloqueiaRaiz = (g) => g.regras.some((r) => r.tipo === 'disallow' && r.caminho === '/')
    && !g.regras.some((r) => r.tipo === 'allow' && r.caminho === '/');

  const todos = [...AGENTES_BUSCA, ...AGENTES_TREINO];
  const fora = [];
  for (const agente of todos) {
    const alvo = agente.toLowerCase();
    const especifico = grupos.find((g) => g.agentes.includes(alvo));
    const curinga = grupos.find((g) => g.agentes.includes('*'));
    const grupo = especifico || curinga;
    if (grupo && bloqueiaRaiz(grupo)) fora.push(agente);
  }
  return fora;
}

export function sitemapsDeRobots(robots = '', origem = '') {
  return robots.split(/\r?\n/)
    .map((l) => /^\s*sitemap\s*:\s*(\S+)/i.exec(l)?.[1])
    .filter(Boolean)
    .map((u) => (u.startsWith('http') ? u : origem + (u.startsWith('/') ? u : `/${u}`)));
}

// --- leitura de sitemap ---------------------------------------------------
const TAG = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))]
  .map((m) => m[1].trim());

export function lerSitemap(xml = '') {
  const ehIndice = /<sitemapindex/i.test(xml);
  const blocos = TAG(xml, ehIndice ? 'sitemap' : 'url');
  const itens = blocos.map((b) => ({
    loc: TAG(b, 'loc')[0] || '',
    lastmod: TAG(b, 'lastmod')[0] || null,
  })).filter((i) => i.loc);
  return { ehIndice, itens };
}

// --- leitura de HTML ------------------------------------------------------
const conteudoMeta = (html, nome) =>
  new RegExp(`<meta[^>]+name=["']${nome}["'][^>]+content=["']([^"']*)["']`, 'i').exec(html)?.[1]
  || new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${nome}["']`, 'i').exec(html)?.[1]
  || null;

export function lerPagina(html = '') {
  const jsonld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]);
  const tipos = new Set();
  for (const bruto of jsonld) {
    try {
      const dado = JSON.parse(bruto.trim());
      for (const no of [].concat(dado['@graph'] || dado)) {
        if (no && no['@type']) [].concat(no['@type']).forEach((t) => tipos.add(t));
      }
    } catch { tipos.add('(json inválido)'); }
  }
  const h2s = [...html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  return {
    titulo: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() || null,
    descricao: conteudoMeta(html, 'description'),
    h1: /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, ' ').trim() || null,
    canonical: /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1] || null,
    tiposJsonLd: [...tipos],
    perguntas: h2s.filter((t) => t.includes('?')).length,
    palavras: html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length,
  };
}

const dias = (iso) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
};

/**
 * Diagnóstico completo. Nenhuma métrica proprietária, nenhuma estimativa.
 * @returns {{host:string, checks:Array, nota:number, resumo:string}}
 */
export async function auditarSite(entrada, { fetchImpl = fetch } = {}) {
  const { host, origem } = normalizarDominio(entrada);
  const checks = [];
  const add = (id, titulo, estado, detalhe, porque) =>
    checks.push({ id, titulo, estado, detalhe, porque });

  const [home, robots, semRota] = await Promise.all([
    buscar(fetchImpl, `${origem}/`),
    buscar(fetchImpl, `${origem}/robots.txt`),
    buscar(fetchImpl, `${origem}/seohack-teste-404-${Date.now().toString(36)}`),
  ]);

  if (!home.ok || !home.texto) {
    return {
      host,
      nota: 0,
      resumo: 'Não consegui carregar o site.',
      checks: [{
        id: 'alcance', titulo: 'O site respondeu', estado: 'falha',
        detalhe: home.erro || `resposta ${home.status}`,
        porque: 'Se eu não alcanço a página, o robô do Google também pode não alcançar.',
      }],
    };
  }

  // 1. HTTPS
  add('https', 'HTTPS', home.url.startsWith('https://') ? 'ok' : 'falha',
    home.url.startsWith('https://') ? 'certificado válido' : 'o site não respondeu em https',
    'Sem HTTPS o navegador marca o site como não seguro e a busca rebaixa.');

  // 2. robots.txt
  add('robots', 'robots.txt', robots.ok ? 'ok' : 'alerta',
    robots.ok ? `${robots.texto.split('\n').length} linhas` : 'não encontrado',
    'É o primeiro arquivo que todo robô lê. Sem ele, cada robô decide sozinho o que fazer.');

  // 3. Robôs de IA — o achado que ninguém mostra
  const bloqueados = robots.ok ? agentesBloqueados(robots.texto) : [];
  const buscaFora = bloqueados.filter((a) => AGENTES_BUSCA.includes(a));
  add('robos_ia', 'Robôs de IA', bloqueados.length === 0 ? 'ok' : (buscaFora.length ? 'falha' : 'alerta'),
    bloqueados.length === 0
      ? 'nenhum bloqueado'
      : `bloqueados: ${bloqueados.join(', ')}`,
    buscaFora.length
      ? 'Estes são os robôs que buscam páginas para responder perguntas no ChatGPT e no Perplexity. '
        + 'Bloqueados, o site não pode ser citado nessas respostas.'
      : 'Os robôs de treino estão bloqueados. É uma escolha legítima, mas vale saber que foi feita.');

  // 4. sitemap
  const candidatos = [...new Set([
    ...(robots.ok ? sitemapsDeRobots(robots.texto, origem) : []),
    `${origem}/sitemap.xml`, `${origem}/sitemap_index.xml`,
  ])].slice(0, 3);

  let urls = [];
  let sitemapUrl = null;
  for (const url of candidatos) {
    const r = await buscar(fetchImpl, url);
    if (!r.ok || !/<(urlset|sitemapindex)/i.test(r.texto)) continue;
    sitemapUrl = url;
    const { ehIndice, itens } = lerSitemap(r.texto);
    if (!ehIndice) { urls = itens; break; }
    for (const sub of itens.slice(0, 2)) {
      const s = await buscar(fetchImpl, sub.loc);
      if (s.ok) urls = urls.concat(lerSitemap(s.texto).itens);
    }
    break;
  }
  add('sitemap', 'Sitemap', sitemapUrl ? 'ok' : 'falha',
    sitemapUrl ? `${urls.length} endereços listados` : 'não encontrado',
    'É a lista do que existe no site. Sem ela, o Google descobre página por página, seguindo links.');

  // 5. frescor
  const idades = urls.map((u) => (u.lastmod ? dias(u.lastmod) : null)).filter((d) => d !== null);
  const maisNovo = idades.length ? Math.min(...idades) : null;
  const ultimos30 = idades.filter((d) => d <= 30).length;
  add('frescor', 'Publicação recente',
    maisNovo === null ? 'alerta' : (maisNovo <= 30 ? 'ok' : 'falha'),
    maisNovo === null
      ? 'o sitemap não informa data de atualização'
      : `${ultimos30} página(s) publicadas ou atualizadas nos últimos 30 dias; a mais nova tem ${maisNovo} dia(s)`,
    'Os assistentes de IA preferem citar conteúdo recente. Site parado some dessas respostas antes de sumir do Google.');

  // 6. soft 404
  const soft = semRota.status === 200 && semRota.texto.length > 200;
  add('soft404', 'Endereço inexistente', soft ? 'falha' : 'ok',
    soft ? 'qualquer endereço inventado responde 200 com conteúdo' : `responde ${semRota.status || 'erro'}`,
    'Se toda URL errada vira página válida, o buscador indexa endereços que não existem e cria conteúdo duplicado no seu domínio.');

  // 7..10 — a página inicial
  const p = lerPagina(home.texto);
  const tamanhoTitulo = p.titulo ? p.titulo.length : 0;
  add('titulo', 'Título da página',
    p.titulo && tamanhoTitulo >= 15 && tamanhoTitulo <= 65 ? 'ok' : (p.titulo ? 'alerta' : 'falha'),
    p.titulo ? `${tamanhoTitulo} caracteres: "${p.titulo.slice(0, 70)}"` : 'ausente',
    'É a linha que aparece no resultado de busca. Fora de 15 a 65 caracteres, o Google reescreve por conta própria.');

  add('descricao', 'Descrição', p.descricao ? 'ok' : 'alerta',
    p.descricao ? `${p.descricao.length} caracteres` : 'ausente',
    'Não muda posição, mas decide quem clica.');

  add('h1', 'Título visível (H1)', p.h1 ? 'ok' : 'alerta',
    p.h1 ? `"${p.h1.slice(0, 70)}"` : 'ausente',
    'É o que diz ao buscador e ao modelo de linguagem do que a página trata.');

  add('canonical', 'Canonical', p.canonical ? 'ok' : 'alerta',
    p.canonical || 'ausente',
    'Evita que duas URLs do mesmo conteúdo disputem entre si.');

  // 11. dados estruturados
  add('jsonld', 'Dados estruturados',
    p.tiposJsonLd.length ? 'ok' : 'falha',
    p.tiposJsonLd.length ? p.tiposJsonLd.join(', ') : 'nenhum bloco JSON-LD',
    'É a ficha técnica que o buscador e os modelos leem sem precisar interpretar o texto.');

  // 12. formato de extração
  add('extracao', 'Formato de pergunta e resposta',
    p.perguntas >= 3 || p.tiposJsonLd.includes('FAQPage') ? 'ok' : 'alerta',
    p.perguntas ? `${p.perguntas} subtítulo(s) em forma de pergunta` : 'nenhum',
    'Resposta gerada por IA é montada a partir de trechos curtos que respondem a uma pergunta direta.');

  // 13. conteúdo publicado
  const artigos = urls.filter((u) => /\/(blog|artigos?|noticias?|insights)\//i.test(u.loc)).length;
  add('conteudo', 'Conteúdo publicado', artigos >= 5 ? 'ok' : (artigos ? 'alerta' : 'falha'),
    artigos ? `${artigos} artigo(s) no sitemap` : 'nenhum blog ou seção de artigos encontrada',
    'Página de produto responde a quem já conhece você. Artigo é o que responde a quem ainda está procurando.');

  const pesos = { ok: 1, alerta: 0.5, falha: 0 };
  const nota = Math.round((checks.reduce((s, c) => s + pesos[c.estado], 0) / checks.length) * 100);
  const falhas = checks.filter((c) => c.estado === 'falha').length;
  const resumo = falhas === 0
    ? 'Nenhuma falha grave. O que falta agora é conteúdo com demanda de busca.'
    : `${falhas} ${falhas === 1 ? 'falha' : 'falhas'} que custam visita hoje.`;

  return { host, checks, nota, resumo };
}
