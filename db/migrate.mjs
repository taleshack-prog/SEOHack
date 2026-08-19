#!/usr/bin/env node
// Migrações. Usa DATABASE_URL_UNPOOLED: DDL via PgBouncer em transaction mode
// dá problema com statements que não podem rodar dentro de transação.
//
// Uso: node --env-file=.env db/migrate.mjs
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from '@neondatabase/serverless';

const dir = fileURLToPath(new URL('./migrations/', import.meta.url));
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL_UNPOOLED ausente'); process.exit(1); }

const pool = new Pool({ connectionString: url });
const c = await pool.connect();

try {
  await c.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  const { rows: done } = await c.query('SELECT filename, checksum FROM schema_migrations');
  const applied = new Map(done.map((r) => [r.filename, r.checksum]));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const f of files) {
    const sqlText = await readFile(dir + f, 'utf8');
    const checksum = createHash('sha256').update(sqlText).digest('hex');

    if (applied.has(f)) {
      if (applied.get(f) !== checksum) {
        console.error(`✗ ${f} foi alterada depois de aplicada. Crie uma migração nova em vez de editar esta.`);
        process.exit(1);
      }
      console.log(`· ${f} (já aplicada)`);
      continue;
    }
    console.log(`→ aplicando ${f}`);
    await c.query(sqlText);
    await c.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1,$2)', [f, checksum]);
    count++;
  }
  console.log(count ? `\n✓ ${count} migração(ões) aplicada(s)` : '\n✓ banco já está atualizado');
} finally {
  c.release();
  await pool.end();
}
