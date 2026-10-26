#!/usr/bin/env node
// O que o motor considera publicado, e o que cada artigo linka.
//
// 25/10/2026: o rerender refez 29 páginas e a cópia local do repositório do
// site tinha 26 artigos. A diferença não é erro de ninguém — o motor publica
// pela API do GitHub, então o clone na máquina só acompanha se alguém der
// pull. Confiar nele para auditar o site é olhar para uma foto antiga.
//
// Este script lê a fonte, que é o banco.
//
// Uso: npm run publicados
import { sql, getClient } from '../lib/db.mjs';

const client = await getClient();
const site = client.adapter_config || {};
const produtos = (site.products || []).map((p) => ({ name: p.name, path: p.path }));

const artigos = await sql`
  SELECT slug, title, cluster, markdown, word_count, rewrite_count,
         first_published_at, content_updated_at
    FROM articles
   WHERE client_id = ${client.id} AND status = 'published'
   ORDER BY first_published_at ASC`;

const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10).split('-').reverse().join('/') : '—');

console.log(`${artigos.length} artigo(s) publicado(s) para ${client.name}\n`);

for (const a of artigos) {
  const md = a.markdown || '';
  const links = [...md.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]);
  const doCluster = produtos.filter((p) => links.some((l) => l.includes(p.path.replace(/^https?:\/\//, ''))
    || l.startsWith(p.path)));
  const marca = doCluster.length ? doCluster.map((p) => p.name).join(', ') : '— sem link de produto';
  console.log(`${dia(a.first_published_at)}  ${a.slug}`);
  console.log(`            cluster=${a.cluster || '—'}  palavras=${a.word_count || '?'}`
    + `  reescritas=${a.rewrite_count || 0}  produto: ${marca}`);
}

const semProduto = artigos.filter((a) => {
  const md = a.markdown || '';
  return !produtos.some((p) => md.includes(p.path.replace(/^https?:\/\//, '')));
});
if (semProduto.length) {
  console.log(`\n⚠ ${semProduto.length} artigo(s) sem nenhum link de produto no corpo:`);
  for (const a of semProduto) console.log(`   ${a.slug}`);
} else {
  console.log('\n✓ Todo artigo publicado tem ao menos um link de produto no corpo.');
}
