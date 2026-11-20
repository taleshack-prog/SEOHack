#!/usr/bin/env node
// O que cada cron fez — e por que não fez.
//
// 10/11/2026: a fila amanheceu vazia na terça. O cron de pesquisa de segunda
// às 3h ou não rodou, ou rodou e não aprovou nenhum tema. Os dois casos
// pedem ações opostas, e não havia onde olhar: pipeline_runs guarda status e
// mensagem de erro, e nenhuma tela lia essa tabela.
//
// Uso: npm run execucoes
import { sql, getClient } from '../lib/db.mjs';

const client = await getClient();

const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

const runs = await sql`
  SELECT stage, status, started_at, finished_at,
         items_processed, items_succeeded, error_message
    FROM pipeline_runs
   WHERE client_id = ${client.id}
     AND started_at > NOW() - INTERVAL '14 days'
   ORDER BY started_at DESC
   LIMIT 40`;

if (!runs.length) {
  console.log('Nenhuma execução registrada nos últimos 14 dias.');
  console.log('Se os crons estão declarados no vercel.json, isso significa que');
  console.log('eles não estão sendo disparados — veja Cron Jobs no painel da Vercel.');
  process.exit(0);
}

const SINAL = { success: '✓', partial: '~', skipped: '·', failed: '✗', running: '…' };

console.log(`${runs.length} execução(ões) nos últimos 14 dias, da mais recente:\n`);
for (const r of runs) {
  const dur = r.finished_at && r.started_at
    ? `${Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000)}s` : '—';
  console.log(`${SINAL[r.status] || '?'} ${quando(r.started_at)}  ${r.stage.padEnd(12)}`
    + ` ${String(r.status).padEnd(8)} ${r.items_succeeded}/${r.items_processed}  ${dur}`);
  if (r.error_message) console.log(`    erro: ${r.error_message}`);
}

// A pergunta que motivou o script.
const pesquisa = runs.filter((r) => r.stage === 'research');
console.log('\n--- pauta ---');
if (!pesquisa.length) {
  console.log('O cron de pesquisa NÃO rodou nos últimos 14 dias.');
  console.log('Ele é o único que abastece a fila. Confira em Cron Jobs na Vercel se');
  console.log('/api/cron/research está listado e quando foi a última execução.');
} else {
  const u = pesquisa[0];
  console.log(`Última: ${quando(u.started_at)} — ${u.status}, `
    + `${u.items_succeeded} tema(s) aprovado(s) de ${u.items_processed} avaliado(s).`);
  if (u.status === 'failed') console.log(`Falhou: ${u.error_message}`);
  else if (!u.items_processed) console.log('Nada avaliado: a fila já estava cheia naquele momento.');
  else if (!u.items_succeeded) {
    console.log('Avaliou e reprovou todos. Se repetir, o problema não é o gerador —');
    console.log('é não haver busca suficiente nos nichos dos produtos cadastrados.');
  }
}
