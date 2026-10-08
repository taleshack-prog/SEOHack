// O que as pessoas digitaram para chegar aqui.
//
// A tela existe para responder a pergunta que o painel não respondia: com 28
// artigos, 16 no Top 10 e 124 impressões no mês, o que falta não é posição, é
// demanda. Esta é a única lista de demanda REAL que o projeto tem — buscas que
// de fato aconteceram, não estimativa de ferramenta.
//
// O botão "Virar tópico" fecha o ciclo: a consulta entra na fila já com o
// número de impressões no lugar do volume, que é exatamente o que o
// opportunityScore espera receber. Tópico nascido daqui tem evidência; tópico
// digitado à mão tem palpite.
//
// GET  /consultas          → o que trouxe gente, e o que está perto
// POST /api/ui/consultas   → manda uma consulta para a fila de tópicos
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { comErro } from '../../lib/erro.mjs';
import { sql } from '../../lib/db.mjs';
import { clienteAtual } from '../../lib/tenant.mjs';
import { agruparPorConsulta, estadoDaConsulta, valemArtigo, resumo } from '../../lib/consultas.mjs';
import { opportunityScore } from '../../lib/score.mjs';
import { page, send, esc } from '../../lib/ui.mjs';

const CSS = `
.q{font-size:15px}
.q .pg{display:block;font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:3px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46ch}
.pill.quase{border-color:#8A6D1F;color:#8A6D1F}
.pill.longe{border-color:var(--muted)}
form.inline{display:inline}
`;

const pct = (v) => `${(Number(v || 0) * 100).toFixed(2)}%`;
const pos = (v) => (v == null ? '—' : Number(v).toFixed(1));

const ROTULO = { traz: 'traz', quase: 'página 2', longe: 'longe' };

function linha(c, { comBotao = true } = {}) {
  const estado = estadoDaConsulta(c);
  return `<tr>
  <td class="q">${esc(c.query)}
    ${c.paginas > 1 ? `<span class="pill">${c.paginas} páginas disputando</span>` : ''}
    <span class="pg">${esc(c.pagina || '—')}</span></td>
  <td class="num">${c.impressions}</td>
  <td class="num">${c.clicks}</td>
  <td class="num">${pct(c.ctr)}</td>
  <td class="num">${pos(c.position)} <span class="pill ${estado}">${ROTULO[estado]}</span></td>
  <td class="num">${comBotao ? `<form method="POST" action="/api/ui/consultas" class="inline">
    <input type="hidden" name="query" value="${esc(c.query)}">
    <input type="hidden" name="impressoes" value="${c.impressions}">
    <input type="hidden" name="posicao" value="${c.position ?? ''}">
    <button class="ghost mini" title="Entra na fila de tópicos com estas impressões no lugar do volume">Virar tópico</button>
  </form>` : ''}</td>
</tr>`;
}

const tabela = (linhas, opts) => `<table>
  <thead><tr><th>Consulta</th><th>Impr.</th><th>Cliques</th><th>CTR</th><th>Posição</th><th></th></tr></thead>
  <tbody>${linhas.map((c) => linha(c, opts)).join('')}</tbody></table>`;

function render({ consultas, jaNaFila, cliente, janela, flash = null }) {
  const r = resumo(consultas);
  const oportunidades = valemArtigo(consultas).filter((c) => !jaNaFila.has(c.query.toLowerCase()));
  const trazem = consultas.filter((c) => estadoDaConsulta(c) === 'traz');

  return page({
    title: 'Consultas',
    flash,
    cliente,
    body: `<style>${CSS}</style>
<p class="sub" style="margin-bottom:6px"><a href="/">← Fila</a></p>
<h1 class="lede">O que as pessoas <em>digitaram</em>.</h1>
<p class="sub">${janela
      ? `Janela de ${esc(janela.inicio)} a ${esc(janela.fim)}, direto da Search Console.
         Não é estimativa de ferramenta: são buscas que aconteceram.`
      : 'Ainda não há coleta de consultas para este cliente.'}</p>

${consultas.length ? `<div class="cards">
  <div class="stat"><span class="n">${r.consultas}</span><span class="l">consultas</span></div>
  <div class="stat"><span class="n">${r.impressoes}</span><span class="l">impressões</span></div>
  <div class="stat"><span class="n">${r.cliques}</span><span class="l">cliques</span></div>
  <div class="stat"><span class="n">${r.quase + r.longe}</span><span class="l">fora do top 10</span></div>
</div>

<h2 class="sec">Vale escrever — ${oportunidades.length}</h2>
${oportunidades.length
      ? `<p class="sub" style="margin-bottom:14px">Buscas em que o site aparece mas não responde bem.
         São as únicas da lista com demanda provada. Virar tópico leva a consulta para a fila com
         as impressões no lugar do volume de busca — que é o número que a pontuação usa.</p>
         ${tabela(oportunidades)}`
      : `<div class="empty"><strong>Nada fora do top 10 com repetição</strong>
         Ou tudo que aparece já está bem posicionado, ou a janela ainda tem pouca busca.</div>`}

<h2 class="sec">Já trazem gente — ${trazem.length}</h2>
${trazem.length ? tabela(trazem, { comBotao: false })
        : '<p class="note">Nenhuma consulta no top 10 nesta janela.</p>'}`
      : `<div class="empty"><strong>Sem dado de consulta ainda</strong>
A coleta por consulta roda uma vez por semana, junto do cron de desempenho (todo dia às 20h UTC,
gravando quando a última coleta tiver mais de sete dias). Se este cliente foi cadastrado agora,
o primeiro resultado aparece na próxima execução.</div>`}`,
  });
}

async function estado(client) {
  const [linhas, fila] = await Promise.all([
    sql`SELECT query, page_url, impressions, clicks, position, period_start, period_end
          FROM gsc_query_metrics
         WHERE client_id = ${client.id}
           AND period_start = (SELECT MAX(period_start) FROM gsc_query_metrics
                                WHERE client_id = ${client.id})`,
    // Consulta que já virou tópico não deve ser oferecida de novo.
    sql`SELECT topic FROM topics WHERE client_id = ${client.id}
         AND status IN ('pending','approved','writing','needs_human','published')`,
  ]);

  return {
    consultas: agruparPorConsulta(linhas),
    jaNaFila: new Set(fila.map((t) => String(t.topic).toLowerCase())),
    cliente: client.name,
    janela: linhas.length
      ? { inicio: String(linhas[0].period_start).slice(0, 10), fim: String(linhas[0].period_end).slice(0, 10) }
      : null,
  };
}

export default comErro(requireAuth(async (req, res) => {
  const client = await clienteAtual(req);

  if (req.method !== 'POST') return send(res, render(await estado(client)));

  const body = await readBody(req);
  const topico = String(body.query || '').trim();
  if (topico.length < 3) {
    return send(res, render({ ...(await estado(client)),
                              flash: { text: 'Consulta vazia.', bad: true } }), 422);
  }

  const impressoes = Number(body.impressoes) || 0;
  const posicao = Number(body.posicao) || 100;

  // source 'gsc' e não 'manual': a origem é o que distingue tópico com
  // evidência de tópico com palpite, e o CHECK da migração 001 já previa isto.
  await sql`
    INSERT INTO topics (client_id, topic, source, keyword_type, search_volume,
                        opportunity_score, status, approved_at)
    VALUES (${client.id}, ${topico}, 'gsc', 'informational', ${impressoes},
            ${opportunityScore({ impressions: impressoes, position: posicao, difficulty: 50 })},
            'approved', NOW())
    ON CONFLICT (client_id, topic_norm) DO UPDATE
      SET search_volume = EXCLUDED.search_volume,
          opportunity_score = EXCLUDED.opportunity_score,
          source = 'gsc', status = 'approved', status_reason = NULL
      WHERE topics.status IN ('pending','approved')`;

  res.statusCode = 302;
  res.setHeader('Location', `/?fila=${encodeURIComponent(`"${topico}" entrou na fila`)}`);
  res.end();
}));
