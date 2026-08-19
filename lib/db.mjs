// Acesso ao Neon. Duas vias, de propósito.
//
//  - sql`...`     : driver HTTP (@neondatabase/serverless). Sem pool, sem
//                   handshake TCP. É o certo para queries curtas em função
//                   serverless — o `pg` puro esgota conexões (defeito D13).
//  - withTenant() : conexão real com transação, para escrita em lote e para
//                   ativar a RLS.
import { neon, Pool } from '@neondatabase/serverless';

// Inicialização preguiçosa de propósito. Se isto validasse DATABASE_URL no
// topo do módulo, qualquer import da cadeia derrubaria a função no cold start
// com um 500 opaco — e tornaria os módulos que dependem daqui impossíveis de
// testar isoladamente. Agora o erro só acontece na primeira query, com stack
// útil, e /api/health consegue reportar o que falta.
let _sql;
function client() {
  if (!_sql) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente');
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

/** Template tag: sql`SELECT ...` */
export const sql = (strings, ...values) => client()(strings, ...values);

/**
 * Executa `fn` dentro de uma transação com o tenant ativo.
 *
 * A RLS do schema v5 lê `current_setting('app.client_id')`. Sem este bloco a
 * policy falha fechada e toda query volta 0 linhas — que é o comportamento
 * desejado, mas silencioso. Nunca consultar tabelas com client_id fora daqui.
 *
 * Atenção: `SET LOCAL app.client_id = $1` NÃO aceita placeholder no Postgres.
 * Por isso o set_config(..., true) — o `true` é o "local", que faz a config
 * morrer junto com a transação.
 */
export async function withTenant(clientId, fn) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT set_config($1, $2, true)', ['app.client_id', clientId]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

/** Resolve o tenant a partir do domínio em CLIENT_DOMAIN. */
export async function getClient(domain = process.env.CLIENT_DOMAIN) {
  const [row] = await sql`SELECT * FROM clients WHERE domain = ${domain} AND is_active`;
  if (!row) throw new Error(`Cliente não encontrado para o domínio "${domain}"`);
  return row;
}
