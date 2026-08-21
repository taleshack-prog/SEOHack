// Identificação de crawlers a partir do user-agent.
//
// Por que isto importa: liberar um agente no robots.txt não prova que ele
// visita. O log é o único sinal de que o conteúdo está sendo efetivamente
// buscado — e é o primeiro a aparecer, em horas, contra semanas de espera pela
// Search Console. Se OAI-SearchBot não passa, citação no ChatGPT é impossível,
// e isso é detectável no mesmo dia da publicação.

// A ordem importa: padrões mais específicos primeiro, porque alguns
// user-agents contêm o nome de outro (Claude-SearchBot contém "Claude").
const AGENTES = [
  // OpenAI — três agentes distintos com funções diferentes
  ['OAI-SearchBot', /OAI-SearchBot/i],
  ['ChatGPT-User', /ChatGPT-User/i],
  ['GPTBot', /GPTBot/i],
  // Anthropic
  ['Claude-SearchBot', /Claude-SearchBot/i],
  ['Claude-User', /Claude-User/i],
  ['ClaudeBot', /ClaudeBot|anthropic-ai/i],
  // Perplexity
  ['Perplexity-User', /Perplexity-User/i],
  ['PerplexityBot', /PerplexityBot/i],
  // Google
  ['Google-Extended', /Google-Extended/i],
  ['Googlebot', /Googlebot/i],
  // Outros que importam para GEO
  ['Applebot', /Applebot/i],
  ['Bingbot', /bingbot/i],
  ['meta-externalagent', /meta-externalagent|facebookexternalhit/i],
  ['Amazonbot', /Amazonbot/i],
  ['Bytespider', /Bytespider/i],
  ['CCBot', /CCBot/i],
];

/** @returns {string|null} nome normalizado do agente, ou null se não for crawler rastreado */
export function identifyCrawler(userAgent = '') {
  const ua = String(userAgent);
  if (!ua) return null;
  for (const [nome, re] of AGENTES) if (re.test(ua)) return nome;
  return null;
}

/** Agentes cuja ausência inviabiliza citação em respostas de IA. */
export const ESSENCIAIS_GEO = ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot'];

/**
 * Extrai user-agent, caminho e status de um registro de log da Vercel.
 *
 * O formato varia por origem (static, edge, lambda) e o user-agent às vezes
 * vem como array. Extração defensiva de propósito: um campo que mudou de lugar
 * não deve derrubar o endpoint que recebe os logs.
 */
export function extractRequest(log) {
  const p = log?.proxy || {};
  const ua = p.userAgent ?? log?.userAgent ?? log?.headers?.['user-agent'];
  return {
    userAgent: Array.isArray(ua) ? ua[0] : (ua || ''),
    path: p.path || log?.path || log?.requestPath || '',
    statusCode: Number(p.statusCode ?? log?.statusCode) || null,
    timestamp: log?.timestamp || Date.now(),
  };
}

/**
 * Agrupa um lote de logs em linhas prontas para o banco.
 * Somar em memória evita um INSERT por requisição — um crawler faz dezenas de
 * hits no mesmo lote.
 */
export function aggregate(logs) {
  const mapa = new Map();
  for (const log of logs) {
    const { userAgent, path, statusCode, timestamp } = extractRequest(log);
    const agente = identifyCrawler(userAgent);
    if (!agente) continue;
    const data = new Date(Number(timestamp) || Date.now()).toISOString().slice(0, 10);
    const chave = `${agente}|${path}|${data}`;
    const atual = mapa.get(chave);
    if (atual) atual.hits += 1;
    else mapa.set(chave, { agente, path, statusCode, data, hits: 1 });
  }
  return [...mapa.values()];
}
