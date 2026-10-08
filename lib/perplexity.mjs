// Cliente da Perplexity — duas superfícies, propósitos diferentes.
//
// `buscar()`  → POST /search. Devolve resultados ranqueados (title, url,
//               snippet, date) como dado estruturado. NÃO devolve resposta
//               gerada nem citação: a documentação é explícita, e o corpo da
//               resposta só traz `results`, `id` e `server_time`.
//
// `responder()` → POST /chat/completions com o modelo `sonar`. Devolve a
//               resposta em prosa E as fontes que ela citou. É esta, e não a
//               Search, que mede o que o Citation Engine existe para medir:
//               se o domínio do cliente aparece como fonte de uma resposta
//               gerada. Procurar o domínio em `/search` responderia outra
//               pergunta — "o domínio está no índice da Perplexity" —, que é
//               parente de posição em buscador, não de citação em IA.
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
      + 'https://console.perplexity.ai e exporte no ambiente');
  }
  return k;
}

/** Há chave configurada? Só presença — o valor não sai daqui. */
export const temChave = () => Boolean(process.env.PERPLEXITY_API_KEY);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 429 é esperado e não é erro do chamador: a própria API diz quando voltar,
 * no cabeçalho Retry-After. Tentar de novo na hora só queima cota.
 */
async function pedir(caminho, corpo, { fetchImpl = fetch, tentativas = 3, esperar = dormir } = {}) {
  let ultima;
  for (let i = 0; i < tentativas; i++) {
    const res = await fetchImpl(`${BASE}${caminho}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${chave()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(corpo),
    });

    if (res.ok) return res.json();

    const texto = await res.text().catch(() => '');
    ultima = new Error(`Perplexity ${res.status} em ${caminho}: ${texto.slice(0, 200)}`);
    ultima.statusCode = res.status;

    if (res.status === 429 && i < tentativas - 1) {
      // Retry-After vem em segundos; sem ele, recuo exponencial modesto.
      const diz = Number(res.headers?.get?.('retry-after'));
      await esperar(Number.isFinite(diz) && diz > 0 ? diz * 1000 : 2000 * (i + 1));
      continue;
    }
    // 401 é problema de chave e não melhora com repetição.
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
export async function buscar(query, { max_results = 10, fetchImpl, tentativas, esperar, ...filtros } = {}) {
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
  }, { fetchImpl, tentativas, esperar });

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
 * Resposta gerada e as fontes que ela citou — o que o Citation Engine mede.
 *
 * @returns {Promise<{answer:string, fontes:string[]}>}
 */
export async function responder(pergunta, { model = 'sonar', fetchImpl, tentativas, esperar, ...resto } = {}) {
  const dados = await pedir('/chat/completions', {
    model,
    messages: [{ role: 'user', content: String(pergunta) }],
    ...resto,
  }, { fetchImpl, tentativas, esperar });

  // O campo mudou de nome entre versões da API: `citations` é a forma antiga,
  // `search_results` a atual. Aceitar as duas evita uma série de medição que
  // zera sem ninguém entender por quê.
  const fontes = dados.citations
    || (dados.search_results || []).map((s) => s.url).filter(Boolean)
    || [];

  return { answer: dados.choices?.[0]?.message?.content || '', fontes };
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
