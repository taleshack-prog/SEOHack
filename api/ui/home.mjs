// Fila. A pergunta que esta tela responde é uma só: o que está parado esperando
// o Tales? Depois disso, o que ele pode mandar produzir.
import { requireAuth } from '../../lib/auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { parseNotes } from '../../lib/notes.mjs';
import { page, send, esc } from '../../lib/ui.mjs';

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

export default requireAuth(async (req, res) => {
  const client = await getClient();

  const held = await sql`
    SELECT id, slug, title, cluster, is_pillar, word_count, markdown, created_at
      FROM articles
     WHERE client_id = ${client.id} AND status = 'needs_human'
     ORDER BY created_at ASC`;

  const topics = await sql`
    SELECT id, topic, cluster, is_pillar, status, opportunity_score
      FROM topics
     WHERE client_id = ${client.id} AND status IN ('pending','approved')
     ORDER BY is_pillar DESC, opportunity_score DESC NULLS LAST
     LIMIT 12`;

  const [budget] = await sql`SELECT * FROM v_budget_status WHERE client_id = ${client.id}`;

  // Estado da produção, lido de pipeline_runs — não há estado em memória.
  const [run] = await sql`
    SELECT status, items_processed, items_succeeded, error_message, started_at, finished_at
      FROM pipeline_runs
     WHERE client_id = ${client.id} AND stage = 'content'
     ORDER BY started_at DESC LIMIT 1`;

  const rodando = run?.status === 'running'
    && (Date.now() - new Date(run.started_at)) < 15 * 60 * 1000;

  const publicados = await sql`
    SELECT COUNT(*)::int AS n FROM articles
     WHERE client_id = ${client.id} AND status = 'published'`;

  let flash = null;
  if (req.query?.iniciado) flash = { text: 'Produção iniciada. Leva de 2 a 5 minutos — atualize a página para acompanhar.' };
  else if (req.query?.aviso === 'ja-rodando') flash = { text: 'Já existe uma produção em andamento.', bad: true };
  else if (req.query?.ok) flash = { text: `Publicado. ${esc(req.query.ok)} está no ar.` };
  else if (run?.status === 'failed' && !rodando) flash = { text: `Última produção falhou: ${esc(run.error_message || 'sem detalhe')}`, bad: true };

  const cards = held.map((a) => {
    const notes = parseNotes(a.markdown || '');
    const dias = Math.floor((Date.now() - new Date(a.created_at)) / 86400000);
    return `<a class="card" href="/review/${esc(a.slug)}">
      <h3>${esc(a.title)}</h3>
      <div class="meta">
        <span>${esc(a.cluster || 'sem cluster')}</span>
        ${a.is_pillar ? '<span class="pill pillar">pilar</span>' : ''}
        <span>${a.word_count || 0} palavras</span>
        <span>${plural(notes.length, 'trecho', 'trechos')} a escrever</span>
        <span>${dias === 0 ? 'hoje' : `há ${plural(dias, 'dia', 'dias')}`}</span>
      </div>
      ${notes[0] ? `<p class="asks">“${esc(notes[0].instruction)}”</p>` : ''}
    </a>`;
  }).join('');

  const producao = rodando
    ? `<div class="running">
        <span class="dot" aria-hidden="true"></span>
        <div>
          <strong>Produzindo agora</strong>
          <span class="note">Iniciado há ${Math.round((Date.now() - new Date(run.started_at)) / 60000)} min.
          Esta página se atualiza sozinha.</span>
        </div>
      </div>`
    : `<form method="POST" action="/api/ui/generate" class="produce">
        <button type="submit">Gerar próximos artigos</button>
        <span class="note">Pega os primeiros da fila abaixo, pilares primeiro.
        Custa cerca de US$ 0,25 por artigo.</span>
      </form>`;

  const body = `
${held.length
    ? `<h1 class="lede"><em>${plural(held.length, 'artigo', 'artigos')}</em> esperando sua experiência.</h1>
       <p class="sub">A máquina escreveu o resto. Estes trechos exigem algo que ela não viveu.</p>
       ${cards}`
    : `<h1 class="lede">Nada parado.</h1>
       <p class="sub">Nenhum artigo aguarda revisão neste momento.
       ${publicados.n ? `${plural(publicados.n, 'artigo publicado', 'artigos publicados')} até agora.` : ''}</p>`}

<h2 class="sec">Produção</h2>
${producao}

<h2 class="sec">Fila de tópicos</h2>
${topics.length ? `<table>
  <thead><tr><th>Tópico</th><th>Cluster</th><th>Score</th><th></th></tr></thead>
  <tbody>${topics.map((t) => `<tr>
    <td>${esc(t.topic)} ${t.is_pillar ? '<span class="pill pillar">pilar</span>' : ''}</td>
    <td class="num">${esc(t.cluster || '—')}</td>
    <td class="num">${esc(t.opportunity_score || '—')}</td>
    <td class="num"><div class="row-actions">
      ${rodando ? '<span class="pill">aguarde</span>' : `
      <form method="POST" action="/api/ui/generate">
        <input type="hidden" name="topic_id" value="${esc(t.id)}">
        <button class="ghost mini" title="Gerar só este artigo">Gerar</button>
      </form>`}
      ${t.status === 'pending' ? `
      <form method="POST" action="/api/ui/topic">
        <input type="hidden" name="topic_id" value="${esc(t.id)}">
        <button name="acao" value="descartar" class="ghost mini">Descartar</button>
      </form>` : ''}
    </div></td>
  </tr>`).join('')}</tbody></table>`
    : '<div class="empty"><strong>Fila vazia</strong>Rode <code>npm run seed</code> para abastecer.</div>'}

<h2 class="sec">Orçamento do mês</h2>
<p class="note">US$ ${esc(Number(budget?.spent_usd || 0).toFixed(2))} gastos de
US$ ${esc(budget?.monthly_budget_usd || '0')}. A geração para automaticamente ao esgotar.</p>`;

  send(res, page({ title: 'Fila de revisão', body, flash, refresh: rodando ? 20 : 0 }));
});
