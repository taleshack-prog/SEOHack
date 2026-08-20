// Fila. A pergunta que esta tela responde é uma só: o que está parado esperando
// o Tales? Tudo o mais é secundário e fica abaixo.
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

  const flash = req.query?.ok
    ? { text: `Publicado. ${esc(req.query.ok)} está no ar.` }
    : null;

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

  const body = `
${held.length
    ? `<h1 class="lede"><em>${plural(held.length, 'artigo', 'artigos')}</em> esperando sua experiência.</h1>
       <p class="sub">A máquina escreveu o resto. Estes trechos exigem algo que ela não viveu.</p>
       ${cards}`
    : `<h1 class="lede">Nada parado.</h1>
       <p class="sub">Nenhum artigo aguarda revisão neste momento.</p>
       <div class="empty"><strong>A fila está vazia</strong>
       Quando o gerador precisar de um relato real, o artigo aparece aqui.</div>`}

<h2 class="sec">Próximos tópicos</h2>
${topics.length ? `<table>
  <thead><tr><th>Tópico</th><th>Cluster</th><th>Score</th><th></th></tr></thead>
  <tbody>${topics.map((t) => `<tr>
    <td>${esc(t.topic)} ${t.is_pillar ? '<span class="pill pillar">pilar</span>' : ''}</td>
    <td class="num">${esc(t.cluster || '—')}</td>
    <td class="num">${esc(t.opportunity_score || '—')}</td>
    <td class="num">${t.status === 'pending'
      ? `<form method="POST" action="/api/ui/topic" style="display:flex;gap:6px">
           <input type="hidden" name="topic_id" value="${esc(t.id)}">
           <button name="acao" value="aprovar" class="ghost" style="padding:4px 10px;font-size:12px">Aprovar</button>
           <button name="acao" value="descartar" class="ghost" style="padding:4px 10px;font-size:12px">Descartar</button>
         </form>`
      : '<span class="pill">na fila</span>'}</td>
  </tr>`).join('')}</tbody></table>
  <p class="note" style="margin-top:10px">Tópicos aprovados entram na produção na ordem acima: pilares primeiro.</p>`
    : '<div class="empty"><strong>Fila de tópicos vazia</strong>Rode <code>npm run seed</code> para abastecer.</div>'}

<h2 class="sec">Orçamento do mês</h2>
<p class="note">US$ ${esc(Number(budget?.spent_usd || 0).toFixed(2))} gastos de
US$ ${esc(budget?.monthly_budget_usd || '0')}. A geração para automaticamente ao esgotar.</p>`;

  send(res, page({ title: 'Fila de revisão', body, flash }));
});
