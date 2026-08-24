// Tela de revisão: o artigo aparece como manuscrito, com as lacunas abertas
// exatamente onde a IA parou. O operador escreve dentro do texto, não num
// formulário separado — ele precisa ver o contexto para saber o que contar.
//
// Atende DOIS estados:
//
//   needs_human → artigo novo esperando a experiência do operador
//   published   → artigo já no ar, aberto para correção
//
// O segundo caso nasceu de um erro real: um artigo publicado trazia
// `caches.default`, API do Cloudflare, num texto sobre Vercel. O validador
// novo pega isso na geração, mas não conserta o que já está no ar — e sem
// caminho no painel, corrigir virava operação de terminal. Encontrar erro em
// artigo publicado vai acontecer de novo.
//
// GET  /review/<slug>   → manuscrito, com lacunas quando houver
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

function render(article, { erro = null, aviso = null } = {}) {
  const jaPublicado = article.status === 'published';
  const parts = splitForReview(article.markdown || '');
  const corpo = parts.map((p) => p.type === 'text'
    ? esc(p.content)
    : `<span class="gap">
        <span class="ask">Falta aqui — ${esc(p.instruction)}</span>
        <textarea name="nota" rows="3" placeholder="Escreva do seu jeito, em primeira pessoa."></textarea>
        <span class="hint">Deixe vazio para remover este trecho do artigo.</span>
      </span>`).join('');

  const total = parseNotes(article.markdown || '').length;

  const subtitulo = jaPublicado
    ? `Este artigo já está no ar. Edite o texto direto no manuscrito e republique —
       o HTML no site é regravado no mesmo caminho, sem mudar a URL.
       <a href="${esc(article.external_url || '#')}" target="_blank" rel="noopener">Ver publicado</a>`
    : `${total === 1 ? 'Um trecho aguarda' : `${total} trechos aguardam`} sua experiência.
       Publique quando estiver pronto — o artigo vai para o site com as suas palavras no lugar das lacunas.`;

  return page({
    title: article.title,
    flash: erro ? { text: erro, bad: true } : (aviso ? { text: aviso } : null),
    body: `
<p class="sub" style="margin-bottom:6px"><a href="/">← Fila</a>${
  jaPublicado ? ' · <span class="pill">publicado</span>' : ''}</p>
<h1 class="lede" style="font-size:28px;max-width:34ch">${esc(article.title)}</h1>
<p class="sub">${subtitulo}</p>

<form method="POST" action="/api/ui/review">
  <input type="hidden" name="slug" value="${esc(article.slug)}">
  ${jaPublicado
    ? `<textarea name="markdown" class="ms editor" rows="30">${esc(article.markdown || '')}</textarea>`
    : `<div class="ms">${corpo}</div>`}
  <div class="actions">
    <button type="submit" name="acao" value="publicar">${jaPublicado ? 'Republicar' : 'Publicar artigo'}</button>
    <button type="submit" name="acao" value="salvar" class="ghost">Salvar sem publicar</button>
    <span class="note">${jaPublicado
      ? 'Republicar regrava o HTML no site. A data de publicação original é preservada.'
      : 'Publicar envia para o site e torna a página visível para buscadores.'}</span>
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
  const jaEstavaPublicado = article?.status === 'published';
  if (!article) return send(res, page({ title: 'Não encontrado',
    body: '<h1 class="lede">Este artigo não existe.</h1>' }), 404);

  const notas = [].concat(body.nota ?? []);
  // Artigo publicado é editado como texto corrido; artigo novo é costurado a
  // partir das lacunas. O editor tem precedência quando existe.
  const markdown = typeof body.markdown === 'string' && body.markdown.trim()
    ? body.markdown.replace(/\r\n/g, '\n').trim()
    : applyNotes(article.markdown || '', notas);

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
  // publishedAt é imutável: republicar um artigo não o torna novo. Só o
  // updatedAt muda, e o render só o transforma em dateModified se a diferença
  // passar de 24h — republicação minutos depois não é revisão.
  const frontmatter = {
    ...article.frontmatter,
    draft: false,
    publishedAt: article.frontmatter?.publishedAt
      || article.first_published_at?.toISOString?.().replace(/\.\d+Z$/, 'Z')
      || agora,
    updatedAt: agora,
  };

  // A lista de artigos já publicados PRECISA vir junto: sem ela o validador
  // volta a exigir 2 links internos, o que é impossível num blog vazio. O
  // content-engine já fazia isso; aqui ficou de fora, e o artigo passou na
  // geração para reprovar só na hora de publicar.
  const publicados = await sql`
    SELECT slug, title, first_published_at, content_updated_at FROM articles
     WHERE client_id = ${client.id} AND status = 'published'`;

  const contexto = { ...client.adapter_config, existingSlugs: publicados.map((a) => a.slug) };
  const check = validateArticle({ slug: article.slug, frontmatter, markdown }, contexto);

  // Correção de artigo publicado não precisa consertar tudo — só não pode piorar.
  //
  // As regras evoluem com o blog. "Mínimo 2 links internos" depende de quantos
  // artigos existem: quando este texto foi escrito havia dois no ar e a
  // exigência era menor. Republicar aplicava as regras de hoje a um texto de
  // ontem, e uma edição que só removia código quebrado — melhoria inequívoca —
  // era bloqueada por uma pendência que ela nem tocou.
  //
  // Então comparamos com o estado ANTERIOR e barramos apenas o que a edição
  // introduziu. O que já estava lá vira aviso.
  let bloqueantes = check.errors;
  let herdados = [];
  if (jaEstavaPublicado) {
    const antes = validateArticle(
      { slug: article.slug, frontmatter: article.frontmatter || frontmatter, markdown: article.markdown || '' },
      contexto);
    const antigos = new Set(antes.errors.map((e) => e.rule));
    bloqueantes = check.errors.filter((e) => !antigos.has(e.rule));
    herdados = check.errors.filter((e) => antigos.has(e.rule));
  }

  if (bloqueantes.length) {
    const motivo = bloqueantes.map((e) => e.detail).join('; ');
    return send(res, render({ ...article, markdown },
      { erro: `Sua edição introduziu um problema: ${motivo}` }), 422);
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
  const rotulo = jaEstavaPublicado ? 'republicado' : 'ok';
  const pendente = herdados.length
    ? `&pendente=${encodeURIComponent(herdados.map((e) => e.rule).join(', '))}` : '';
  res.setHeader('Location', `/?${rotulo}=${encodeURIComponent(article.title)}${pendente}`);
  res.end();
});
