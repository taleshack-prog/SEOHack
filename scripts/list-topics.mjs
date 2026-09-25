#!/usr/bin/env node
// Estado real da fila, direto do banco.
//
// O painel mostra só 'pending' e 'approved'. Quando um tópico some da tela sem
// virar artigo, é porque parou num estado que a tela não lista — e aí não há
// como descobrir pelo navegador. Este script imprime todos, agrupados.
//
// Uso: npm run topicos
import { sql, getClient } from '../lib/db.mjs';

const client = await getClient();

const linhas = await sql`
  SELECT t.status, t.topic, t.cluster, t.assigned_at, t.status_reason,
         (SELECT a.slug FROM articles a WHERE a.topic_id = t.id LIMIT 1) AS artigo
    FROM topics t
   WHERE t.client_id = ${client.id}
   ORDER BY t.status, t.cluster NULLS LAST, t.topic`;

const porStatus = new Map();
for (const l of linhas) {
  if (!porStatus.has(l.status)) porStatus.set(l.status, []);
  porStatus.get(l.status).push(l);
}

console.log(`${linhas.length} tópicos no total\n`);
for (const [status, itens] of porStatus) {
  console.log(`${status.toUpperCase()} — ${itens.length}`);
  for (const i of itens) {
    const extra = [
      i.cluster,
      i.assigned_at ? `pego em ${new Date(i.assigned_at).toLocaleString('pt-BR')}` : null,
      i.artigo ? `artigo: ${i.artigo}` : null,
      i.status_reason ? `motivo: ${i.status_reason}` : null,
    ].filter(Boolean).join(' · ');
    console.log(`  ${i.topic}\n    ${extra}`);
  }
  console.log();
}

// Últimas execuções, para cruzar com o que sumiu.
const runs = await sql`
  SELECT stage, status, items_processed, items_succeeded, error_message, started_at, finished_at
    FROM pipeline_runs
   WHERE client_id = ${client.id} AND stage = 'content'
   ORDER BY started_at DESC LIMIT 5`;

console.log('ÚLTIMAS PRODUÇÕES');
for (const r of runs) {
  console.log(`  ${new Date(r.started_at).toLocaleString('pt-BR')} · ${r.status}`
    + ` · ${r.items_succeeded}/${r.items_processed} publicados`
    + (r.error_message ? `\n    erro: ${r.error_message}` : '')
    + (r.finished_at ? '' : '\n    (nunca terminou)'));
}
