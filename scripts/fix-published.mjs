#!/usr/bin/env node
// Conserta os artigos que foram para o site mas continuaram 'ready' no banco,
// e regera índice e sitemap com a lista completa.
//
// O defeito: o Content Engine gravava o commit do artigo publicado sem mudar
// articles.status. Como quase todas as consultas filtram por 'published', o
// artigo existia no site e em nenhum outro lugar — fora do índice do blog,
// fora do sitemap, fora do painel, fora da lista que o validador usa para
// permitir links internos.
//
// Uso: npm run corrigir-publicados
import { sql, getClient } from '../lib/db.mjs';
import { publish as publishViaAdapter } from '../lib/adapters/index.mjs';

const client = await getClient();

// Critério: tem commit no repositório e não é rascunho pendente de revisão.
const corrigidos = await sql`
  UPDATE articles
     SET status = 'published',
         first_published_at = COALESCE(first_published_at, content_updated_at, updated_at),
         updated_at = NOW()
   WHERE client_id = ${client.id}
     AND github_commit_sha IS NOT NULL
     AND status = 'ready'
  RETURNING slug, first_published_at`;

if (!corrigidos.length) {
  console.log('Nenhum artigo fora de status. Nada a corrigir.');
} else {
  console.log(`✓ ${corrigidos.length} artigo(s) marcados como publicados:`);
  for (const a of corrigidos) console.log(`  ${a.slug}`);
}

const publicados = await sql`
  SELECT slug, title, description, cluster, is_pillar, frontmatter,
         first_published_at, content_updated_at
    FROM articles
   WHERE client_id = ${client.id} AND status = 'published'
   ORDER BY first_published_at DESC`;

console.log(`\nRegerando índice e sitemap com ${publicados.length} artigos…`);
const r = await publishViaAdapter(client, [], publicados);
console.log(`✓ commit ${r.commitSha?.slice(0, 7) || '(sem alteração)'}`);
console.log('\nConfira o sitemap em alguns minutos, depois do build da Vercel.');
