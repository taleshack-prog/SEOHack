#!/usr/bin/env node
// Corrige o cluster de um artigo publicado e do tópico que o gerou.
//
// Existe por causa do mc1r: o artigo nasceu da tela de consultas, que inseria
// tópico sem cluster, e foi publicado com o campo vazio. O conserto do código
// impede que aconteça de novo, mas não arruma quem já está no ar — e cluster
// vazio não é cosmético: desliga a regra que obriga o link do produto daquele
// cluster e tira o artigo da costura de pilar e satélites.
//
// Uso: npm run cluster -- <slug> <cluster>
//      npm run cluster -- --listar
import { sql, getClient } from '../lib/db.mjs';

const [slug, cluster] = process.argv.slice(2);
const client = await getClient();

if (!slug || slug === '--listar') {
  const vazios = await sql`
    SELECT slug, title, word_count FROM articles
     WHERE client_id = ${client.id} AND status = 'published'
       AND (cluster IS NULL OR cluster = '')
     ORDER BY first_published_at`;
  if (!vazios.length) console.log('✓ Nenhum artigo publicado sem cluster.');
  else {
    console.log(`${vazios.length} artigo(s) sem cluster:\n`);
    for (const a of vazios) console.log(`  ${a.slug}`);
    console.log('\nPara corrigir:  npm run cluster -- <slug> <cluster>');
  }
  process.exit(0);
}

if (!cluster) {
  console.error('Falta o cluster.  Uso: npm run cluster -- <slug> <cluster>');
  process.exit(1);
}

// Mesma normalização de lib/topics.mjs: minúsculas com hífen.
const normalizado = cluster.trim().toLowerCase().replace(/\s+/g, '-');

const [artigo] = await sql`
  UPDATE articles SET cluster = ${normalizado}, updated_at = NOW()
   WHERE client_id = ${client.id} AND slug = ${slug}
  RETURNING id, topic_id, title, cluster`;

if (!artigo) {
  console.error(`Artigo "${slug}" não encontrado para ${client.name}.`);
  process.exit(1);
}

if (artigo.topic_id) {
  await sql`UPDATE topics SET cluster = ${normalizado} WHERE id = ${artigo.topic_id}`;
}

console.log(`✓ "${artigo.title}" agora é do cluster ${artigo.cluster}.`);
console.log('\nO conteúdo não mudou, então o site não precisa de rebuild. O efeito');
console.log('aparece na próxima publicação do cluster, quando o pilar costurar os');
console.log('satélites, e na próxima validação deste artigo.');
