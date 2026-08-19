// Health check. Público de propósito — não expõe nada sensível e serve de
// smoke test do Sprint 1: se isto responde 200 com db:true, o Neon e as env
// vars estão de pé.
import { sql } from '../lib/db.mjs';

export default async function handler(req, res) {
  const checks = { db: false, env: [] };
  const required = [
    'DATABASE_URL', 'CLIENT_DOMAIN', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY',
    'PUBLISH_URL', 'PUBLISH_TOKEN', 'F8_SIGNING_SECRET',
    'GSC_CLIENT_EMAIL', 'GSC_PRIVATE_KEY', 'GSC_PROPERTY',
  ];
  checks.env = required.filter((k) => !process.env[k]);

  try {
    const [row] = await sql`SELECT 1 AS ok`;
    checks.db = row?.ok === 1;
  } catch (err) {
    checks.dbError = err.message;
  }

  const healthy = checks.db && checks.env.length === 0;
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    checks: { db: checks.db, missingEnv: checks.env, dbError: checks.dbError },
    ts: new Date().toISOString(),
  });
}
