// Receptor de Drain da Vercel.
//
// Registra visitas de crawler nos artigos. É o sinal mais rápido do pipeline:
// aparece em horas, contra 2 a 4 semanas da Search Console. E responde a
// pergunta que o robots.txt não responde — liberar um agente não prova que ele
// visita.
//
// Dois requisitos da plataforma, ambos obrigatórios:
//   1. Responder 200 com o header `x-vercel-verify` para a Vercel validar o
//      endpoint antes de ativar o drain.
//   2. Conferir o `x-vercel-signature`, que é HMAC-SHA1 do corpo CRU com o
//      segredo do drain. Sem isso qualquer um injeta dados falsos.
//
// A assinatura é calculada sobre o corpo cru, não sobre JSON.stringify do corpo
// parseado: reserializar muda espaçamento e ordem de chaves, e a assinatura
// deixa de bater de forma intermitente.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql, getClient, withTenant } from '../lib/db.mjs';
import { aggregate } from '../lib/crawlers.mjs';

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function assinaturaValida(raw, recebida) {
  const segredo = process.env.LOG_DRAIN_SECRET;
  if (!segredo) return { ok: false, motivo: 'LOG_DRAIN_SECRET ausente' };
  if (!recebida) return { ok: false, motivo: 'sem x-vercel-signature' };
  const esperada = createHmac('sha1', segredo).update(raw).digest('hex');
  if (esperada.length !== String(recebida).length) return { ok: false, motivo: 'assinatura inválida' };
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(recebida));
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, motivo: 'assinatura inválida' };
}

/** NDJSON (uma linha por registro) ou array JSON — a Vercel usa os dois. */
function parseLogs(texto) {
  const t = texto.trim();
  if (!t) return [];
  if (t.startsWith('[')) {
    try { return JSON.parse(t); } catch { return []; }
  }
  return t.split('\n').map((linha) => {
    try { return JSON.parse(linha); } catch { return null; }
  }).filter(Boolean);
}

export default async function handler(req, res) {
  // O header de verificação vai em TODA resposta, inclusive nas de erro: a
  // Vercel valida o endpoint antes de o drain existir, quando ainda não há
  // assinatura para conferir.
  const verify = process.env.LOG_DRAIN_VERIFY;
  if (verify) res.setHeader('x-vercel-verify', verify);

  if (req.method === 'GET' || req.method === 'HEAD') {
    // Handshake de verificação.
    res.statusCode = 200;
    return res.end('ok');
  }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const raw = await rawBody(req);

  const sig = assinaturaValida(raw, req.headers['x-vercel-signature']);
  if (!sig.ok) {
    console.warn('[logs] rejeitado:', sig.motivo);
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, error: sig.motivo }));
  }

  const logs = parseLogs(raw.toString('utf8'));
  const linhas = aggregate(logs);

  // Responder rápido importa: a Vercel considera o drain com falha se o
  // endpoint demorar, e passa a reenviar o lote.
  if (!linhas.length) {
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, recebidos: logs.length, crawlers: 0 }));
  }

  try {
    const client = await getClient();
    await withTenant(client.id, async (c) => {
      for (const l of linhas) {
        await c.query(
          `INSERT INTO ai_crawler_hits (client_id, user_agent, path, status_code, hit_date, hit_count)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (client_id, user_agent, path, hit_date)
           DO UPDATE SET hit_count = ai_crawler_hits.hit_count + EXCLUDED.hit_count,
                         status_code = EXCLUDED.status_code`,
          [client.id, l.agente, l.path, l.statusCode, l.data, l.hits]);
      }
    });
  } catch (err) {
    // Erro de banco não deve fazer a Vercel reenviar o lote indefinidamente:
    // log perdido é aceitável, loop de reentrega não é.
    console.error('[logs] falha ao gravar:', err.message);
  }

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true, recebidos: logs.length, crawlers: linhas.length }));
}
