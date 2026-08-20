#!/usr/bin/env node
// Diagnóstico local. Mesmas checagens do /api/health?deep=1, mas rodando na
// sua máquina — útil para descobrir credencial errada antes do deploy.
//
// Uso: npm run doctor
import { sql, getClient } from '../lib/db.mjs';
import { checkEnv, checkLlm, checkAdapter } from '../lib/checks.mjs';

const ok = (s) => `\x1b[32m✓\x1b[0m ${s}`;
const no = (s) => `\x1b[31m✗\x1b[0m ${s}`;
const wa = (s) => `\x1b[33m!\x1b[0m ${s}`;
let falhas = 0;

try {
  await sql`SELECT 1`;
  console.log(ok('Neon responde'));
} catch (e) { falhas++; console.log(no(`Neon: ${e.message}`)); process.exit(1); }

const client = await getClient();
console.log(ok(`Cliente ${client.name} · adapter "${client.publish_adapter}"`));

const env = checkEnv(client.publish_adapter);
if (env.missing.length) { falhas++; console.log(no(`Faltando: ${env.missing.join(', ')}`)); }
else console.log(ok('Variáveis obrigatórias presentes'));
if (env.optionalMissing.length) console.log(wa(`Opcionais vazias: ${env.optionalMissing.join(', ')}`));

process.stdout.write('  testando o LLM… ');
const llm = await checkLlm();
console.log('\r' + (llm.ok ? ok(`LLM autenticou · ${llm.model}`) : no(`LLM: ${llm.reason}`)));
if (llm.providerSaid) console.log(`    provedor respondeu: ${llm.providerSaid}`);
if (llm.droppedParams?.length) console.log(wa(`  parâmetros removidos por incompatibilidade: ${llm.droppedParams.join(', ')}`));
if (!llm.ok) falhas++;

process.stdout.write('  testando o destino de publicação… ');
const alvo = await checkAdapter(client);
console.log('\r' + (alvo.ok ? ok(`Destino acessível · ${alvo.repo || alvo.adapter}`) : no(`Destino: ${alvo.reason}`)));
if (alvo.targetSaid) console.log(`    destino respondeu: ${alvo.targetSaid}`);
if (!alvo.ok) falhas++;

const [b] = await sql`SELECT * FROM v_budget_status WHERE client_id = ${client.id}`;
console.log(ok(`Orçamento: US$ ${Number(b.spent_usd).toFixed(2)} de ${b.monthly_budget_usd}`));

const [f] = await sql`SELECT count(*)::int AS n FROM topics
                       WHERE client_id = ${client.id} AND status = 'approved'`;
console.log(f.n ? ok(`${f.n} tópicos prontos para produção`) : wa('Fila vazia — rode npm run seed'));

console.log(falhas ? `\n${falhas} problema(s). Corrija antes de gerar artigo.` : '\nTudo pronto.');
process.exit(falhas ? 1 : 0);
