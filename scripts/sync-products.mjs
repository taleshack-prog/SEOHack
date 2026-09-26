#!/usr/bin/env node
// Grava seeds/products.json em clients.adapter_config.products.
//
// Só mexe na chave "products". O resto do adapter_config (token do GitHub,
// repositório, shell) fica intacto — por isso NÃO usa configure-target, que
// regrava tudo e exige o token no .env.
//
// A tela /produtos do painel faz o mesmo, por cliente e sem terminal. Este
// script fica para carga grande e para reaplicar um arquivo versionado.
//
// Uso: npm run sync-products                          (CLIENT_DOMAIN, seeds/products.json)
//      npm run sync-products outro.json
//      npm run sync-products outro.json genbreed.com.br
//      npm run sync-products -- --cliente genbreed.com.br
import { readFile } from 'node:fs/promises';
import { sql, getClient } from '../lib/db.mjs';
import { limparProdutos, validarProdutos } from '../lib/produtos.mjs';

// O motor é multi-cliente; este script escrevia sempre no CLIENT_DOMAIN, então
// só a Hack Tech Farm conseguia ter produto — e cliente sem produto tem todo
// artigo recusado pela regra product_links depois de o texto ser pago.
const args = process.argv.slice(2).filter((a) => a !== '--');
const iCliente = args.findIndex((a) => a === '--cliente');
const dominio = iCliente >= 0 ? args[iCliente + 1]
  : args.find((a) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(a) && !a.endsWith('.json'));
const file = args.find((a) => a.endsWith('.json')) || 'seeds/products.json';
const { products = [] } = JSON.parse(await readFile(file, 'utf8'));

const limpos = limparProdutos(products);
const erros = validarProdutos(limpos);
if (erros.length) {
  console.error('✗ Nada foi gravado:\n  ' + erros.join('\n  '));
  process.exit(1);
}

const client = await getClient(dominio || process.env.CLIENT_DOMAIN);
await sql`
  UPDATE clients
     SET adapter_config = jsonb_set(COALESCE(adapter_config, '{}'::jsonb), '{products}',
                                    ${JSON.stringify(limpos)}::jsonb)
   WHERE id = ${client.id}`;

console.log(`✓ ${limpos.length} produto(s) gravado(s) em ${client.name} (${client.domain}):`);
for (const p of limpos) {
  const c = (p.clusters.length ? `  → clusters: ${p.clusters.join(', ')}` : '')
    + (p.voice ? ' (voz própria)' : '');
  console.log(`  ${p.name.padEnd(14)} ${p.path}${c}`);
}
