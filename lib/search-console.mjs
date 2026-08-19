// Cliente da Google Search Console API.
//
// Duas correções da auditoria estão embutidas aqui:
//
//  C5 — A API não devolve dado de hoje. O atraso é de 2 a 3 dias. O v4 coletava
//       "hoje" às 20:00 UTC e receberia conjunto vazio, deslocando toda a série
//       temporal. Por isso `defaultWindow()` mira D-3.
//
//  C6 — O limite real não é "200 queries por 100s" (número errado no Plano §7.1)
//       e sim CARGA: consulta agrupada por page E query é a mais cara. Por isso
//       `byPage()` roda diário e `byPageQuery()` só semanal.
import { JWT } from 'google-auth-library';

const API = 'https://searchconsole.googleapis.com/webmasters/v3';
const SCOPE = ['https://www.googleapis.com/auth/webmasters.readonly'];

let cached;
function auth() {
  if (cached) return cached;
  const key = process.env.GSC_PRIVATE_KEY;
  if (!process.env.GSC_CLIENT_EMAIL || !key) throw new Error('Credenciais GSC ausentes');
  cached = new JWT({
    email: process.env.GSC_CLIENT_EMAIL,
    key: key.replace(/\\n/g, '\n'),
    scopes: SCOPE,
  });
  return cached;
}

const iso = (d) => d.toISOString().slice(0, 10);

/** Janela padrão: D-3 a D-2. Nunca peça "hoje" — volta vazio. */
export function defaultWindow(daysBack = 3) {
  const end = new Date(Date.now() - (daysBack - 1) * 86400000);
  const start = new Date(Date.now() - daysBack * 86400000);
  return { startDate: iso(start), endDate: iso(end) };
}

async function query(body, { maxAttempts = 5 } = {}) {
  const property = encodeURIComponent(process.env.GSC_PROPERTY);
  const url = `${API}/sites/${property}/searchAnalytics/query`;
  const client = auth();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { token } = await client.getAccessToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()).rows || [];

    const detail = await res.text().catch(() => '');
    // "quota exceeded" de curto prazo: a orientação do Google é esperar 15 min.
    // Numa função serverless não dá para segurar tanto, então falhamos e o
    // stale-while-revalidate (PRD §32) mantém o dado do dia anterior.
    if (res.status === 403 && /quota/i.test(detail)) {
      const e = new Error('GSC quota excedida — reprogramar, não repetir agora');
      e.statusCode = 429;
      e.quota = true;
      throw e;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000 + Math.random() * 500));
      continue;
    }
    throw new Error(`GSC ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/** Agregado por página. Barato — pode rodar todo dia. */
export async function byPage({ startDate, endDate } = defaultWindow(), rowLimit = 1000) {
  const rows = await query({
    startDate, endDate,
    dimensions: ['page', 'date'],
    type: 'web',
    rowLimit,
  });
  return rows.map((r) => ({
    pageUrl: r.keys[0],
    metricDate: r.keys[1],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,          // fração, como o GSC devolve. Não converter (D6).
    position: r.position,
  }));
}

/** page x query. CARO em quota — semanal, e só para as URLs em análise. */
export async function byPageQuery({ startDate, endDate }, pageFilter = null, rowLimit = 5000) {
  const body = {
    startDate, endDate,
    dimensions: ['page', 'query'],
    type: 'web',
    rowLimit,
  };
  if (pageFilter) {
    body.dimensionFilterGroups = [{
      filters: [{ dimension: 'page', operator: 'contains', expression: pageFilter }],
    }];
  }
  const rows = await query(body);
  return rows.map((r) => ({
    pageUrl: r.keys[0], query: r.keys[1],
    clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
  }));
}

/**
 * Oportunidades de página 2 (PRD §7.1).
 * Só faz sentido depois que o blog tiver histórico — ver o gate do research.mjs.
 */
export async function pageTwoOpportunities({ startDate, endDate }, { min = 11, max = 20, minImpressions = 10 } = {}) {
  const rows = await query({
    startDate, endDate,
    dimensions: ['query'],
    type: 'web',
    rowLimit: 2000,
  });
  return rows
    .filter((r) => r.position >= min && r.position <= max && r.impressions >= minImpressions)
    .map((r) => ({
      query: r.keys[0],
      position: r.position,
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

/** Volume total de impressões no /blog — usado como gate seed -> gsc (A1). */
export async function blogImpressions({ startDate, endDate }) {
  const rows = await query({
    startDate, endDate,
    dimensions: ['page'],
    type: 'web',
    rowLimit: 1000,
  });
  return rows
    .filter((r) => r.keys[0].includes('/blog/'))
    .reduce((sum, r) => sum + r.impressions, 0);
}
