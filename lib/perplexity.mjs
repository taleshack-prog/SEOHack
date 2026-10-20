// Cliente da Perplexity — duas superfícies, propósitos diferentes.
//
// `buscar()`  → POST /search. Devolve resultados ranqueados (title, url,
//               snippet, date) como dado estruturado. NÃO devolve resposta
//               gerada nem citação: a documentação é explícita, e o corpo da
//               resposta só traz `results`, `id` e `server_time`.
//
// `responder()` → POST /v1/agent. Devolve a resposta em prosa E as fontes que
//               ela citou. É esta, e não a Search, que mede o que o Citation
//               Engine existe para medir: se o domínio do cliente aparece como
//               fonte de uma resposta gerada. Procurar o domínio em `/search`
//               responderia outra pergunta — "o domínio está no índice da
//               Perplexity" —, que é parente de posição em buscador, não de
//               citação em IA.
//
// 20/10/2026 — a Sonar Chat Completions foi desligada em 27/09/2026. A chamada
// antiga (`POST /chat/completions` com `model: 'sonar'`) passou a responder 403
// com a mensagem de migração, e as dez medições de citação do dia falharam em
// bloco. O painel mostrou "0 citações", que é o mesmo que ele mostra quando a
// medição nunca aconteceu — foi preciso abrir o log da Vercel para descobrir
// que não era zero, era erro. Daí a `ErroPerplexity` com `migracao`: o motivo
// de uma falha dessas precisa chegar à tela, não ao log.
//
// Sem dependência nova: `fetch` nativo, igual aos adapters.
//
// A chave é lida preguiçosamente, como em db.mjs. Se fosse validada no topo do
// módulo, qualquer import da cadeia derrubaria a função no cold start com um
// 500 opaco, e /api/health não conseguiria reportar o que falta.
const BASE = 'https://api.perplexity.ai';

/** Chave de PERPLEXITY_API_KEY. Nunca é impressa, registrada nem devolvida. */
function chave() {
  const k = process.env.PERPLEXITY_API_KEY;
  if (!k) {
    throw new Error('PERPLEXITY_API_KEY ausente — crie a chave em '
      + 'https://console.perplexity.ai e grave nas variáveis de ambiente do projeto');
  }
  return k;
}

/** Há chave configurada? Só presença — o valor não sai daqui. */
export const temChave = () => Boolean(process.env.PERPLEXITY_API_KEY);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export class ErroPerplexity extends Error {
  constructor(mensagem, { statusCode, migracao = false } = {}) {
    super(mensagem);
    this.name = 'ErroPerplexity';
    this.statusCode = statusCode;
    // true quando a API respondeu que o endpoint mudou de lugar. Repetir não
    // adianta e esperar não adianta: só uma troca de código resolve.
    this.migracao = migracao;
  }
}

/** A resposta de 403 por endpoint descontinuado é reconhecível pelo texto. */
const ehMigracao = (status, texto = '') =>
  status === 403 && /agent api|\/v1\/agent|\/v1\/responses|migrate/i.test(texto);

/**
 * 429 é esperado e não é erro do chamador: a própria API diz quando voltar, no
 * cabeçalho Retry-After. Tentar de novo na hora só queima cota.
 *
 * O tempo limite por requisição existe porque a função de citação tem 300s de
 * teto na Vercel e faz dez chamadas em sequência: uma chamada que pendura
 * derruba o lote inteiro depois de já ter gasto dinheiro nas anteriores.
 */
async function pedir(caminho, corpo, {
  fetchImpl = fetch, tentativas = 3, esperar = dormir, limiteMs = 30000,
} = {}) {
  let ultima;
  for (let i = 0; i < tentativas; i++) {
    const cancelar = AbortSignal.timeout ? AbortSignal.timeout(limiteMs) : undefined;
    let res;
    try {
      res = await fetchImpl(`${BASE}${caminho}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${chave()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(corpo),
        ...(cancelar ? { signal: cancelar } : {}),
      });
    } catch (err) {
      ultima = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? new ErroPerplexity(`Perplexity não respondeu em ${limiteMs / 1000}s em ${caminho}`)
        : err;
      if (i < tentativas - 1) { await esperar(1000 * (i + 1)); continue; }
      throw ultima;
    }

    if (res.ok) return res.json();

    const texto = await res.text().catch(() => '');
    const migracao = ehMigracao(res.status, texto);
    ultima = new ErroPerplexity(
      `Perplexity ${res.status} em ${caminho}: ${texto.slice(0, 200)}`,
      { statusCode: res.status, migracao });

    if (res.status === 429 && i < tentativas - 1) {
      // Retry-After vem em segundos; sem ele, recuo exponencial modesto.
      const diz = Number(res.headers?.get?.('retry-after'));
      await esperar(Number.isFinite(diz) && diz > 0 ? diz * 1000 : 2000 * (i + 1));
      continue;
    }
    // 401 é problema de chave e 403 de migração é problema de código. Nenhum
    // dos dois melhora com repetição.
    throw ultima;
  }
  throw ultima;
}

/** Mesma página escrita de dois jeitos não é duas fontes. */
export function normalizarUrl(u = '') {
  try {
    const url = new URL(String(u));
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const p of [...url.searchParams.keys()]) {
      if (/^utm_|^fbclid$|^gclid$/i.test(p)) url.searchParams.delete(p);
    }
    const caminho = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.hostname}${caminho}${url.search}`;
  } catch {
    return String(u).trim();
  }
}

const LIMITE_CONSULTAS = 5;

/**
 * Resultados ranqueados da web, como dado estruturado.
 *
 * @param {string|string[]} query  uma consulta, ou até cinco — cada uma é
 *        processada de forma independente pela API, e o resultado vem junto.
 * @param {object} opts  max_results (1–20), country (ISO 3166-1 alpha-2),
 *        search_domain_filter, search_recency_filter e os demais filtros da
 *        referência. Passados adiante com o nome que a API usa.
 * @returns {Promise<{id:string, results:Array}>} resultados sem URL repetida,
 *          na ordem em que vieram — a ordem É o ranking.
 */
export async function buscar(query, {
  max_results = 10, fetchImpl, tentativas, esperar, limiteMs, ...filtros
} = {}) {
  const consultas = [].concat(query).map((q) => String(q).trim()).filter(Boolean);
  if (!consultas.length) throw new Error('buscar() precisa de ao menos uma consulta');
  if (consultas.length > LIMITE_CONSULTAS) {
    throw new Error(`a Search aceita até ${LIMITE_CONSULTAS} consultas por requisição, vieram ${consultas.length}`);
  }
  if (!(max_results >= 1 && max_results <= 20)) {
    throw new Error('max_results precisa estar entre 1 e 20');
  }

  const dados = await pedir('/search', {
    query: consultas.length === 1 ? consultas[0] : consultas,
    max_results,
    ...filtros,
  }, { fetchImpl, tentativas, esperar, limiteMs });

  // Consultas diferentes trazem as mesmas páginas; a primeira aparição ganha,
  // porque é a melhor colocada.
  const vistos = new Set();
  const results = [];
  for (const r of dados.results || []) {
    const chaveUrl = normalizarUrl(r.url);
    if (vistos.has(chaveUrl)) continue;
    vistos.add(chaveUrl);
    results.push(r);
  }

  return { id: dados.id, server_time: dados.server_time ?? null, results };
}

/**
 * Lê a resposta da Agent API.
 *
 * O corpo traz um array `output` com itens tipados: o texto está no item
 * `message`, e as fontes no item `search_results`. Substituiu os campos
 * `choices`, `citations` e `search_results` de topo da Sonar.
 */
export function lerResposta(dados = {}) {
  const saida = Array.isArray(dados.output) ? dados.output : [];

  const mensagem = saida.find((o) => o?.type === 'message');
  const partes = Array.isArray(mensagem?.content) ? mensagem.content : [];
  const answer = partes.map((p) => p?.text || '').filter(Boolean).join('\n').trim();

  const busca = saida.find((o) => o?.type === 'search_results');
  const fontes = (Array.isArray(busca?.results) ? busca.results : [])
    .map((r) => r?.url).filter(Boolean);

  return { answer, fontes };
}

/**
 * Resposta gerada e as fontes que ela citou — o que o Citation Engine mede.
 *
 * `preset: 'fast'` é o equivalente da Sonar na Agent API: resposta curta com
 * busca na web. Trocar por `model` daria acesso a modelo de fronteira sem
 * ancoragem na web, que é o contrário do que se quer medir aqui.
 *
 * @returns {Promise<{answer:string, fontes:string[]}>}
 */
export async function responder(pergunta, {
  preset = 'fast', fetchImpl, tentativas, esperar, limiteMs, ...resto
} = {}) {
  const dados = await pedir('/v1/agent', {
    preset,
    input: String(pergunta),
    ...resto,
  }, { fetchImpl, tentativas, esperar, limiteMs });

  return lerResposta(dados);
}

/**
 * Em que posição o domínio aparece entre as fontes. 0 = não aparece.
 * Compara por host, não por substring: "posthink.com.br" dentro de
 * "naoposthink.com.br" não é o mesmo site.
 */
export function posicaoDoDominio(fontes = [], dominio = '') {
  const alvo = String(dominio).toLowerCase().replace(/^www\./, '');
  if (!alvo) return 0;
  for (let i = 0; i < fontes.length; i++) {
    try {
      const host = new URL(fontes[i]).hostname.toLowerCase().replace(/^www\./, '');
      if (host === alvo || host.endsWith(`.${alvo}`)) return i + 1;
    } catch { /* fonte sem URL válida */ }
  }
  return 0;
}
