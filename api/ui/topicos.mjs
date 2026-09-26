// Abastecer a fila pelo painel.
//
// Era a última operação presa no terminal: editar seeds/clusters.csv e rodar
// `npm run seed`. O script continua existindo para carga grande; esta tela é
// para o uso normal — a fila esvaziou, você tem três temas em mente, escreve
// e manda. O `npm run seed` e esta tela gravam exatamente a mesma coisa.
//
// GET  /topicos          → formulário + o que já está na fila
// POST /api/ui/topicos   → grava
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { parseTopicos, TIPOS } from '../../lib/topics.mjs';
import { page, send, esc } from '../../lib/ui.mjs';

const CSS = `
form.novo{margin:0 0 8px}
form.novo label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--muted);margin:16px 0 6px}
form.novo input,form.novo select,form.novo textarea{width:100%;font-family:var(--sans);font-size:15px;
  padding:11px 12px;border:1px solid var(--rule);background:#fff;color:var(--ink)}
form.novo textarea{font-family:var(--mono);font-size:14px;line-height:1.7;min-height:170px;resize:vertical}
form.novo input:focus,form.novo select:focus,form.novo textarea:focus{outline:none;border-color:var(--proof)}
.linha{display:flex;gap:12px;flex-wrap:wrap}
.linha>div{flex:1 1 150px}
.ajuda{font-size:14px;color:var(--muted);margin:8px 0 0}
.ajuda code{font-family:var(--mono);font-size:13px;background:#fff;border:1px solid var(--rule);padding:1px 5px}
`;

const EXEMPLO = `* Guia completo de criação de gatos bengal
Quanto custa castrar um gato em Porto Alegre | 480
Herança da cor dos olhos em felinos | 210 | 30`;

function render({ clusters, fila, flash = null, texto = '', padrao = {} }) {
  return page({
    title: 'Novos tópicos',
    flash,
    body: `<style>${CSS}</style>
<p class="sub" style="margin-bottom:6px"><a href="/">← Fila</a></p>
<h1 class="lede">O que você quer <em>responder</em> a seguir?</h1>
<p class="sub">Um tópico por linha. Eles entram já aprovados e saem na ordem da pontuação,
pilares primeiro.</p>

<form class="novo" method="POST" action="/api/ui/topicos">
  <div class="linha">
    <div>
      <label for="cluster">Cluster</label>
      <input id="cluster" name="cluster" list="clusters" placeholder="genetica"
             value="${esc(padrao.cluster || '')}" autocomplete="off">
      <datalist id="clusters">${clusters.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    </div>
    <div>
      <label for="tipo">Intenção de busca</label>
      <select id="tipo" name="tipo">
        ${TIPOS.map((t) => `<option value="${t}"${padrao.tipo === t ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
    </div>
    <div>
      <label for="afinidade">Afinidade comercial</label>
      <input id="afinidade" name="afinidade" type="number" step="0.1" min="0.5" max="2"
             value="${esc(padrao.afinidade || '1.0')}">
    </div>
  </div>

  <label for="topicos">Tópicos</label>
  <textarea id="topicos" name="topicos" placeholder="${esc(EXEMPLO)}">${esc(texto)}</textarea>
  <p class="ajuda">
    <code>*</code> no começo marca a página pilar do cluster.
    Depois da barra vêm o volume de busca mensal e a dificuldade:
    <code>Tópico | 480 | 30</code>. Os dois são opcionais — sem eles, o tópico entra
    com pontuação baixa e fica atrás de quem tem número do Keyword Planner.
  </p>

  <div class="actions" style="margin-top:20px">
    <button type="submit">Adicionar à fila</button>
    <span class="note">Nada é gerado agora. Você decide quando produzir, na fila.</span>
  </div>
</form>

<h2 class="sec">Já na fila — ${fila.length}</h2>
${fila.length ? `<table>
  <thead><tr><th>Tópico</th><th>Cluster</th><th>Score</th></tr></thead>
  <tbody>${fila.map((t) => `<tr>
    <td>${esc(t.topic)} ${t.is_pillar ? '<span class="pill pillar">pilar</span>' : ''}</td>
    <td class="num">${esc(t.cluster || '—')}</td>
    <td class="num">${esc(t.opportunity_score || '—')}</td>
  </tr>`).join('')}</tbody></table>`
      : '<div class="empty"><strong>Fila vazia</strong>Nada esperando produção.</div>'}`,
  });
}

async function estado(clientId) {
  const [clusters, fila] = await Promise.all([
    sql`SELECT DISTINCT cluster FROM topics
         WHERE client_id = ${clientId} AND cluster IS NOT NULL ORDER BY cluster`,
    sql`SELECT topic, cluster, is_pillar, opportunity_score FROM topics
         WHERE client_id = ${clientId} AND status IN ('pending','approved')
         ORDER BY is_pillar DESC, opportunity_score DESC NULLS LAST`,
  ]);
  return { clusters: clusters.map((c) => c.cluster), fila };
}

export default requireAuth(async (req, res) => {
  const client = await getClient();

  if (req.method !== 'POST') {
    return send(res, render(await estado(client.id)));
  }

  const body = await readBody(req);
  const padrao = { cluster: body.cluster, tipo: body.tipo, afinidade: body.afinidade };
  const { topicos, erros } = parseTopicos(body.topicos || '', padrao);

  if (!topicos.length) {
    return send(res, render({
      ...(await estado(client.id)),
      texto: body.topicos || '',
      padrao,
      flash: { text: erros[0] || 'Escreva ao menos um tópico.', bad: true },
    }), 422);
  }

  // Mesmo INSERT do script de seed, inclusive o ON CONFLICT: tópico repetido
  // é atualizado enquanto não entrou em produção, e ignorado depois disso.
  let novos = 0;
  let atualizados = 0;
  let ignorados = 0;
  for (const t of topicos) {
    const r = await sql`
      INSERT INTO topics (client_id, topic, source, cluster, is_pillar, keyword_type,
                          search_volume, difficulty_score, opportunity_score, status, approved_at)
      VALUES (${client.id}, ${t.topic}, 'painel', ${t.cluster}, ${t.isPillar}, ${t.tipo},
              ${t.volume}, ${t.dificuldade}, ${t.score}, 'approved', NOW())
      ON CONFLICT (client_id, topic_norm) DO UPDATE
        SET cluster = EXCLUDED.cluster, is_pillar = EXCLUDED.is_pillar,
            keyword_type = EXCLUDED.keyword_type, search_volume = EXCLUDED.search_volume,
            difficulty_score = EXCLUDED.difficulty_score,
            opportunity_score = EXCLUDED.opportunity_score,
            status = 'approved', status_reason = NULL
        WHERE topics.status IN ('pending','approved')
      RETURNING (xmax = 0) AS was_insert`;
    if (!r.length) ignorados++;
    else if (r[0].was_insert) novos++;
    else atualizados++;
  }

  const partes = [
    novos ? `${novos} ${novos === 1 ? 'tópico novo' : 'tópicos novos'}` : null,
    atualizados ? `${atualizados} atualizado(s)` : null,
    ignorados ? `${ignorados} ignorado(s) por já estar em produção` : null,
  ].filter(Boolean);

  res.statusCode = 302;
  res.setHeader('Location', `/?fila=${encodeURIComponent(partes.join(', '))}`
    + (erros.length ? `&linhas=${encodeURIComponent(erros.slice(0, 2).join(' · '))}` : ''));
  res.end();
});
