// Tela de revisão: o artigo aparece como manuscrito, com as lacunas abertas
// exatamente onde a IA parou. O operador escreve dentro do texto, não num
// formulário separado — ele precisa ver o contexto para saber o que contar.
//
// GET  /review/<slug>   → manuscrito com lacunas
// POST /api/ui/review   → costura as notas, valida, publica pelo adapter
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { splitForReview, applyNotes, parseNotes } from '../../lib/notes.mjs';
import { validateArticle } from '../../lib/validate.mjs';
import { publish as publishViaAdapter } from '../../lib/adapters/index.mjs';
import { page, send, esc } from '../../lib/ui.mjs';

async function load(clientId, slug) {
  const [a] = await sql`
    SELECT * FROM articles WHERE client_id = ${clientId} AND slug = ${slug}`;
  return a;
}

function render(article, { erro = null } = {}) {
  const parts = splitForReview(article.markdown || '');
  const corpo = parts.map((p) => p.type === 'text'
    ? esc(p.content)
    : `<span class="gap">
        <span class="ask">Falta aqui — ${esc(p.instruction)}</span>
        <textarea name="nota" rows="3" placeholder="Escreva do seu jeito, em primeira pessoa."></textarea>
        <span class="hint">Deixe vazio para remover este trecho do artigo.</span>
      </span>`).join('');

  const total = parseNotes(article.markdown || '').length;

  return page({
    title: article.title,
    flash: erro ? { text: erro, bad: true } : null,
    body: `
<p class="sub" style="margin-bottom:6px"><a href="/">← Fila</a></p>
<h1 class="lede" style="font-size:28px;max-width:34ch">${esc(article.title)}</h1>
<p class="sub">${total === 1 ? 'Um trecho aguarda' : `${total} trechos aguardam`} sua experiência.
Publique quando estiver pronto — o artigo vai para o site com as suas palavras no lugar das lacunas.</p>

<form method="POST" action="/api/ui/review">
  <input type="hidden" name="slug" value="${esc(article.slug)}">
  <div class="ms">${corpo}</div>
  <div class="actions">
    <button type="submit" name="acao" value="publicar">Publicar artigo</button>
    <button type="submit" name="acao" value="salvar" class="ghost">Salvar sem publicar</button>
    <span class="note">Publicar envia para o site e torna a página visível para buscadores.</span>
  </div>
</form>`,
  });
}

export default requireAuth(async (req, res) => {
  const client = await getClient();

  if (req.method === 'GET') {
    const slug = req.query?.slug;
    const article = slug && await load(client.id, slug);
    if (!article) return send(res, page({ title: 'Não encontrado',
      body: '<h1 class="lede">Este artigo não existe.</h1><p class="sub"><a href="/">Voltar para a fila</a></p>' }), 404);
    return send(res, render(article));
  }

  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const body = await readBody(req);
  const article = await load(client.id, body.slug);
  if (!article) return send(res, page({ title: 'Não encontrado',
    body: '<h1 class="lede">Este artigo não existe.</h1>' }), 404);

  const notas = [].concat(body.nota ?? []);
  const markdown = applyNotes(article.markdown || '', notas);

  if (body.acao === 'salvar') {
    await sql`
      UPDATE articles SET markdown = ${markdown}, operator_notes = ${JSON.stringify(notas)},
                          updated_at = NOW()
       WHERE id = ${article.id}`;
    const fresh = await load(client.id, body.slug);
    return send(res, render(fresh));
  }

  // Publicar: o artigo deixa de ser rascunho, então a validação passa a exigir
  // que nenhum marcador tenha sobrado (regra operator_note_unresolved).
  const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const frontmatter = { ...article.frontmatter, draft: false, updatedAt: agora };

  // A lista de artigos já publicados PRECISA vir junto: sem ela o validador
  // volta a exigir 2 links internos, o que é impossível num blog vazio. O
  // content-engine já fazia isso; aqui ficou de fora, e o artigo passou na
  // geração para reprovar só na hora de publicar.
  const publicados = await sql`
    SELECT slug, title, first_published_at, content_updated_at FROM articles
     WHERE client_id = ${client.id} AND status = 'published'`;

  const check = validateArticle({ slug: article.slug, frontmatter, markdown },
    { ...client.adapter_config, existingSlugs: publicados.map((a) => a.slug) });
  if (!check.valid) {
    const motivo = check.errors.map((e) => e.detail).join('; ');
    return send(res, render({ ...article, markdown }, { erro: `Não publicado: ${motivo}` }), 422);
  }

  try {
    const r = await publishViaAdapter(client, [{ slug: article.slug, markdown, frontmatter }], publicados);
    await sql`
      UPDATE articles
         SET markdown = ${markdown}, frontmatter = ${JSON.stringify(frontmatter)},
             operator_notes = ${JSON.stringify(notas)},
             status = 'published', word_count = ${check.stats.words},
             operator_note_filled_at = NOW(), reviewed_at = NOW(), reviewed_by = 'dashboard',
             github_commit_sha = ${r.commitSha}, external_url = ${r.url || null},
             first_published_at = COALESCE(first_published_at, NOW()),
             content_updated_at = NOW(), updated_at = NOW()
       WHERE id = ${article.id}`;
    await sql`UPDATE topics SET status='published', published_at=NOW() WHERE id=${article.topic_id}`;
  } catch (err) {
    return send(res, render({ ...article, markdown },
      { erro: `O site recusou a publicação: ${err.message}` }), 502);
  }

  res.statusCode = 302;
  res.setHeader('Location', `/?ok=${encodeURIComponent(article.title)}`);
  res.end();
});
