#!/usr/bin/env node
// Busca na web pela Search API da Perplexity, do terminal.
//
// Serve para duas coisas: o teste de fumaça da chave (sem escrever código) e o
// uso que a Search tem neste projeto — ver quem já responde a uma pergunta
// antes de pagar por um texto sobre ela.
//
// O que ela NÃO dá: volume de busca. A Search devolve quem ranqueia, não
// quantos procuram. O gargalo de demanda continua sendo outro problema.
//
// Uso: npm run buscar "quanto custa castrar um gato"
//      npm run buscar "pergunta A" "pergunta B"            (até 5, um pedido só)
//      npm run buscar "x" -- --dominios gov.br,scielo.br --pais BR --n 5
//      npm run buscar "x" -- --json                        (saída crua)
import { buscar, temChave } from '../lib/perplexity.mjs';

const args = process.argv.slice(2).filter((a) => a !== '--');
const opcoes = new Map();
const consultas = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) opcoes.set(args[i].slice(2), args[++i]);
  else consultas.push(args[i]);
}
const temOpcao = (n) => opcoes.has(n);
const json = temOpcao('json');

if (!consultas.length) {
  console.error('Uso: npm run buscar "sua consulta"');
  process.exit(1);
}
if (!temChave()) {
  console.error('✗ PERPLEXITY_API_KEY ausente.');
  console.error('  Crie a chave em https://console.perplexity.ai e exporte no seu ambiente');
  console.error('  (ou grave no .env, que é de onde o npm run a lê).');
  process.exit(1);
}

const filtros = {};
if (opcoes.get('dominios')) filtros.search_domain_filter = opcoes.get('dominios').split(',').map((d) => d.trim());
if (opcoes.get('pais')) filtros.country = opcoes.get('pais').toUpperCase();
if (opcoes.get('desde')) filtros.search_recency_filter = opcoes.get('desde');

let r;
try {
  r = await buscar(consultas, { max_results: Number(opcoes.get('n')) || 10, ...filtros });
} catch (err) {
  // A mensagem do cliente já traz o status; a chave nunca aparece nela.
  console.error(`✗ ${err.message}`);
  if (err.statusCode === 401) console.error('  401 é a chave: confira o valor e se há saldo na conta.');
  if (err.statusCode === 429) console.error('  429 é limite de uso: veja docs.perplexity.ai/docs/admin/rate-limits-usage-tiers');
  process.exit(1);
}

if (json) {
  console.log(JSON.stringify(r, null, 2));
} else {
  console.log(`\n${r.results.length} resultado(s) · ${consultas.length} consulta(s) · id ${r.id}\n`);
  r.results.forEach((x, i) => {
    const quando = x.date || x.last_updated;
    console.log(`${String(i + 1).padStart(2)}. ${x.title}`);
    console.log(`    ${x.url}${quando ? `  ·  ${quando}` : ''}`);
    if (x.snippet) console.log(`    ${x.snippet.replace(/\s+/g, ' ').slice(0, 160)}…`);
    console.log('');
  });
}
