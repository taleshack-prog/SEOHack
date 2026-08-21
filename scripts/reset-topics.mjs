#!/usr/bin/env node
// Devolve à fila os tópicos que falharam, limpando o motivo antigo.
//
// Tópico que falha volta para 'pending' com status_reason preenchido — mas o
// Content Engine só pega os que estão em 'approved'. Sem isto, uma falha tira
// o tópico da produção para sempre.
//
// Uso: node --env-file=.env scripts/reset-topics.mjs
import { sql, getClient } from '../lib/db.mjs';

const client = await getClient();
const r = await sql`
  UPDATE topics
     SET status = 'approved', status_reason = NULL, assigned_at = NULL
   WHERE client_id = ${client.id} AND status = 'pending' AND status_reason IS NOT NULL
  RETURNING topic`;

if (!r.length) console.log('Nenhum tópico com falha para devolver à fila.');
else {
  console.log(`✓ ${r.length} tópico(s) de volta à fila:`);
  for (const t of r) console.log(`  ${t.topic}`);
}
