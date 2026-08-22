#!/usr/bin/env node
// Amarra custos órfãos aos artigos que os produziram.
//
// Chamadas gravadas antes desta correção ficaram com article_id nulo, então o
// painel mostra US$ 0,00 por artigo enquanto o total sobe. Isto reconstrói o
// vínculo por proximidade de tempo: as chamadas de outline e draft acontecem
// nos minutos que antecedem a criação da linha em `articles`.
//
// É heurística, não verdade — por isso roda uma vez e avisa o que fez.
//
// Uso: node --env-file=.env scripts/backfill-usage.mjs
import { sql, getClient } from '../lib/db.mjs';

const client = await getClient();

const orfas = await sql`
  SELECT id, stage, model, cost_usd, created_at FROM llm_usage
   WHERE client_id = ${client.id} AND article_id IS NULL
   ORDER BY created_at ASC`;

if (!orfas.length) {
  console.log('Nenhum custo órfão. Nada a fazer.');
  process.exit(0);
}

const artigos = await sql`
  SELECT id, slug, created_at FROM articles
   WHERE client_id = ${client.id} ORDER BY created_at ASC`;

let ligadas = 0;
for (const u of orfas) {
  // O artigo é criado depois das chamadas que o produziram. Pega o primeiro
  // artigo criado após a chamada, dentro de uma janela de 15 minutos.
  const alvo = artigos.find((a) => {
    const dt = new Date(a.created_at) - new Date(u.created_at);
    return dt >= 0 && dt < 15 * 60 * 1000;
  });
  if (!alvo) continue;
  await sql`UPDATE llm_usage SET article_id = ${alvo.id} WHERE id = ${u.id}`;
  ligadas++;
}

console.log(`✓ ${ligadas} de ${orfas.length} chamadas amarradas a um artigo.`);
if (ligadas < orfas.length) {
  console.log(`  ${orfas.length - ligadas} ficaram órfãs — provavelmente de gerações que falharam`);
  console.log('  antes de criar o artigo. Elas continuam no total, e isso está correto:');
  console.log('  o dinheiro foi gasto mesmo sem artigo no fim.');
}
