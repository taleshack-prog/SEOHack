#!/usr/bin/env node
// Republica as páginas dos artigos com o shell atual, sem reescrever nada.
//
// O `corrigir-publicados` regera índice e sitemap, mas passa lote VAZIO de
// artigos: as páginas já no ar continuam com o cabeçalho e o rodapé do dia em
// que foram geradas. Quando o shell do site muda — produto novo no rodapé,
// link que mudou de caminho —, as páginas antigas ficam para trás e nada
// avisa. Foi o que aconteceu com o GenBreed: 26 páginas publicadas com quatro
// produtos no rodapé depois de o site passar a listar cinco.
//
// Aqui não há modelo, não há custo e não há mudança de conteúdo: o markdown e
// o frontmatter saem do banco como estão, só o HTML em volta é refeito. Por
// isso `updatedAt` não muda e o "atualizado em" das páginas continua certo.
//
// Uso: npm run rerender
import { sql, getClient } from '../lib/db.mjs';
import { publish as publishViaAdapter } from '../lib/adapters/index.mjs';

const client = await getClient();

const publicados = await sql`
  SELECT slug, title, description, cluster, is_pillar, markdown, frontmatter,
         first_published_at, content_updated_at
    FROM articles
   WHERE client_id = ${client.id} AND status = 'published'
   ORDER BY first_published_at DESC`;

if (!publicados.length) {
  console.log('Nenhum artigo publicado para este cliente.');
  process.exit(0);
}

const semCorpo = publicados.filter((a) => !a.markdown);
if (semCorpo.length) {
  // Artigo sem markdown no banco não pode ser re-renderizado sem buscar o
  // arquivo do repositório — e sobrescrever com página vazia seria pior do que
  // deixar o rodapé velho.
  console.log(`⚠ ${semCorpo.length} artigo(s) sem corpo no banco, serão pulados:`);
  for (const a of semCorpo) console.log(`   ${a.slug}`);
}

const refazer = publicados
  .filter((a) => a.markdown)
  .map((a) => ({ slug: a.slug, markdown: a.markdown, frontmatter: a.frontmatter }));

console.log(`Refazendo ${refazer.length} página(s) com o shell atual…`);
const r = await publishViaAdapter(client, refazer, publicados);

const feitos = r.committed?.length || 0;
console.log(`✓ ${feitos} página(s) no commit ${r.commitSha?.slice(0, 7) || '(sem alteração)'}`);

if (r.rejected?.length) {
  console.log(`\n⚠ ${r.rejected.length} recusada(s) pelo destino:`);
  for (const x of r.rejected) console.log(`   ${x.slug}: ${x.rule || 'motivo não informado'}`);
}
console.log('\nO site reconstrói em alguns minutos, depois do build da Vercel.');
