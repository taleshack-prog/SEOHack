#!/usr/bin/env node
// Grava seeds/products.json em clients.adapter_config.products.
//
// Só mexe na chave "products". O resto do adapter_config (token do GitHub,
// repositório, shell) fica intacto — por isso NÃO usa configure-target, que
// regrava tudo e exige o token no .env.
//
// Uso: npm run sync-products              (lê seeds/products.json)
//      npm run sync-products outro.json
import { readFile } from 'node:fs/promises';
import { sql, getClient } from '../lib/db.mjs';

const file = process.argv[2] || 'seeds/products.json';
const { products = [] } = JSON.parse(await readFile(file, 'utf8'));

const erros = [];
products.forEach((p, i) => {
  const onde = `produto ${i + 1} (${p.name || 'sem nome'})`;
  if (!p.name) erros.push(`${onde}: falta "name"`);
  if (!p.about || p.about.length < 20) erros.push(`${onde}: "about" vazio ou curto demais — é o que o modelo lê`);
  if (!p.path || !(/^\/[a-z0-9-/]*$/i.test(p.path) || /^https:\/\/[^\s]+$/i.test(p.path))) {
    erros.push(`${onde}: "path" precisa ser /caminho ou https://dominio`);
  }
  if (p.clusters && !Array.isArray(p.clusters)) erros.push(`${onde}: "clusters" precisa ser lista, ex.: ["genetica"]`);
});
const donos = new Map();
for (const p of products) for (const c of (Array.isArray(p.clusters) ? p.clusters : [])) {
  if (donos.has(c)) erros.push(`cluster "${c}" ligado a dois produtos (${donos.get(c)} e ${p.name})`);
  donos.set(c, p.name);
}
if (erros.length) {
  console.error('✗ Nada foi gravado:\n  ' + erros.join('\n  '));
  process.exit(1);
}

const limpos = products.map(({ path, name, about, clusters = [], voice }) =>
  ({ path: path.replace(/\/+$/, '') || '/', name, about, clusters, ...(voice ? { voice } : {}) }));

const client = await getClient();
await sql`
  UPDATE clients
     SET adapter_config = jsonb_set(COALESCE(adapter_config, '{}'::jsonb), '{products}',
                                    ${JSON.stringify(limpos)}::jsonb)
   WHERE id = ${client.id}`;

console.log(`✓ ${limpos.length} produto(s) gravado(s):`);
for (const p of limpos) {
  const c = (p.clusters.length ? `  → clusters: ${p.clusters.join(', ')}` : '')
    + (p.voice ? ' (voz própria)' : '');
  console.log(`  ${p.name.padEnd(14)} ${p.path}${c}`);
}
