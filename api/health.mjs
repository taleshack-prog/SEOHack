// Estado do sistema.
//
//   GET /api/health          → rápido: banco, variáveis e configuração
//   GET /api/health?deep=1   → também autentica no LLM e no destino de publicação
//
// O modo profundo faz chamadas reais e custa frações de centavo. Fica opcional
// para que monitoramento automático não gaste dinheiro a cada minuto.
import { sql, getClient } from '../lib/db.mjs';
import { checkEnv, checkLlm, checkAdapter } from '../lib/checks.mjs';

export default async function handler(req, res) {
  const deep = req.query?.deep === '1';
  const out = { ok: false, deep, checks: {}, ts: new Date().toISOString() };

  try {
    const [row] = await sql`SELECT 1 AS ok`;
    out.checks.db = row?.ok === 1;
  } catch (err) {
    out.checks.db = false;
    out.checks.dbError = err.message;
  }

  let client = null;
  if (out.checks.db) {
    try {
      client = await getClient();
      out.checks.client = { name: client.name, domain: client.domain,
                            adapter: client.publish_adapter };
    } catch (err) {
      out.checks.clientError = err.message;
    }
  }

  const env = checkEnv(client?.publish_adapter);
  out.checks.missingEnv = env.missing;
  out.checks.optionalMissing = env.optionalMissing;

  if (deep) {
    out.checks.llm = await checkLlm();
    if (client) out.checks.publishTarget = await checkAdapter(client);
  }

  out.ok = Boolean(out.checks.db) && env.missing.length === 0
    && (!deep || (out.checks.llm?.ok && out.checks.publishTarget?.ok));

  res.statusCode = out.ok ? 200 : 503;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(out, null, 2));
}
