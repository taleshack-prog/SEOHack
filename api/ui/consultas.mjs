// O que as pessoas digitaram para chegar aqui.
//
// A tela existe para responder a pergunta que o painel não respondia: com 28
// artigos, 16 no Top 10 e 124 impressões no mês, o que falta não é posição, é
// demanda. Esta é a única lista de demanda REAL que o projeto tem — buscas que
// de fato aconteceram, não estimativa de ferramenta.
//
// 20/10/2026, primeira coleta: a versão anterior oferecia "Virar tópico" para
// toda consulta fora do Top 10. Entre elas estava "depressão endogâmica", 12
// impressões na posição 10,1, que já tem artigo dedicado. Clicar teria criado
// um segundo artigo disputando a mesma busca com o primeiro. A coleta só olha
// /blog/, então toda consulta daqui já caiu num artigo: o que decide a ação não
// é se existe página, é se a página é sobre aquilo.
//
// GET  /consultas          → o que escrever, o que melhorar, o que já funciona
// POST /api/ui/consultas   → manda uma consulta para a fila de tópicos
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { comErro } from '../../lib/erro.mjs';
import { sql } from '../../lib/db.mjs';
import { clienteAtual } from '../../lib/tenant.mjs';
import {
  agruparPorConsulta, estadoDaConsulta, aMelhorar, paginasSobrecarregadas, resumo, slugDaUrl,
  escolherAlvo,
} from '../../lib/consultas.mjs';
import { opportunityScore } from '../../lib/score.mjs';
import { page, send, esc } from '../../lib/ui.mjs';

const CSS = `
.q{font-size:15px}
.q .pg{display:block;font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:3px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46ch}
.pill.quase{border-color:#8A6D1F;color:#8A6D1F}
.pill.longe{border-color:var(--muted)}
form.inline{display:inline}
.mira{display:block;font-size:11px;color:var(--muted);margin-top:4px;font-style:italic}
.canibal{border:1px solid var(--rule);border-left:3px solid var(--proof);background:#fff;
  padding:16px 18px;margin-bottom:12px}
.canibal h3{font-family:var(--mono);font-size:12px;color:var(--ink);margin:0 0 4px;word-break:break-all}
.canibal ul{margin:10px 0 0;padding-left:18px;font-size:14px;color:var(--muted)}
.canibal li{margin-bottom:3px}
.canibal b{color:var(--ink);font-weight:500}
`;

const pct = (v) => `${(Number(v || 0) * 100).toFixed(2)}%`;
const pos = (v) => (v == null ? '—' : Number(v).toFixed(1));

// O driver devolve DATE como objeto Date. `String(d).slice(0,10)` virava
// "Sun Sep 20" na tela. Pelo ISO não há deslocamento de fuso: a coluna é uma
// data, não um instante.
const dataBr = (v) => {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toISOString().slice(0, 10).split('-').reverse().join('/');
};

const ROTULO = { traz: 'traz', quase: 'página 2', longe: 'longe' };

// improved/neutral/worsened são o que o cron grava em optimization_log.outcome.
const VEREDITO = {
  improved: { texto: 'subiu', classe: 'traz' },
  neutral: { texto: 'sem mudança', classe: 'longe' },
  worsened: { texto: 'piorou', classe: 'quase' },
};

function linha(c, acao) {
  const estado = estadoDaConsulta(c);
  return `<tr>
  <td class="q">${esc(c.query)}
    ${c.paginas > 1 ? `<span class="pill">${c.paginas} páginas disputando</span>` : ''}
    <span class="pg">${esc(c.pagina || '—')}</span></td>
  <td class="num">${c.impressions}</td>
  <td class="num">${c.clicks}</td>
  <td class="num">${pct(c.ctr)}</td>
  <td class="num">${pos(c.position)} <span class="pill ${estado}">${ROTULO[estado]}</span></td>
  <td class="num">${acao ? acao(c) : ''}</td>
</tr>`;
}

const tabela = (linhas, acao) => `<table>
  <thead><tr><th>Consulta</th><th>Impr.</th><th>Cliques</th><th>CTR</th><th>Posição</th><th></th></tr></thead>
  <tbody>${linhas.map((c) => linha(c, acao)).join('')}</tbody></table>`;

const botaoTopico = (c) => `<form method="POST" action="/api/ui/consultas" class="inline">
  <input type="hidden" name="query" value="${esc(c.query)}">
  <input type="hidden" name="impressoes" value="${c.impressions}">
  <input type="hidden" name="posicao" value="${c.position ?? ''}">
  <button class="ghost mini" title="Entra na fila de tópicos com estas impressões no lugar do volume">Virar tópico</button>
</form>`;

// Botão, não link. A versão anterior mandava o operador para o editor — a tela
// diagnosticava e passava o trabalho adiante. Agora o mesmo diagnóstico vira a
// reescrita: o motor mira no termo, valida contra o texto antigo e republica.
//
// O alvo vem de escolherAlvo, a mesma função que o motor usa. Antes o rótulo
// escolhia por posição e o motor por impressão, então o botão prometia um
// termo e a reescrita mirava em outro — e três linhas da tabela que apontam
// para a MESMA página prometiam três alvos diferentes.
const botaoMelhorar = (alvos) => (c) => {
  const slug = slugDaUrl(c.pagina);
  const alvo = alvos.get(c.pagina);
  const outro = alvo && alvo.query !== c.query;
  return `<form method="POST" action="/api/ui/melhorar" class="inline">
  <input type="hidden" name="slug" value="${esc(slug)}">
  <button class="ghost mini" title="${outro
    ? `Esta página é a mesma de "${esc(alvo.query)}", que tem mais impressões — a reescrita mira naquele termo`
    : 'Reescreve mirando neste termo e republica no mesmo endereço'}">Melhorar</button>
</form>
<a href="/review/${esc(slug)}" class="pill">Abrir</a>
${outro ? `<span class="mira">mira em "${esc(alvo.query)}"</span>` : ''}`;
};

function render({ consultas, reescritas = [], jaNaFila, cliente, janela, flash = null }) {
  const r = resumo(consultas);
  const { escrever, melhorar } = aMelhorar(consultas);
  const novas = escrever.filter((c) => !jaNaFila.has(c.query.toLowerCase()));
  const trazem = consultas.filter((c) => estadoDaConsulta(c) === 'traz');
  const sobrecarregadas = paginasSobrecarregadas(consultas);

  // Um alvo por página, não por linha: a reescrita é da página.
  const porPagina = new Map();
  for (const c of consultas) {
    if (!porPagina.has(c.pagina)) porPagina.set(c.pagina, []);
    porPagina.get(c.pagina).push(c);
  }
  const alvos = new Map([...porPagina].map(([pag, lista]) => [pag, escolherAlvo(lista)]));
  const melhorarNesta = botaoMelhorar(alvos);

  return page({
    title: 'Consultas',
    flash,
    cliente,
    body: `<style>${CSS}</style>
<p class="sub" style="margin-bottom:6px"><a href="/">← Fila</a></p>
<h1 class="lede">O que as pessoas <em>digitaram</em>.</h1>
<p class="sub">${janela
      ? `Janela de ${esc(janela.inicio)} a ${esc(janela.fim)}, direto da Search Console.
         Não é estimativa de ferramenta: são buscas que aconteceram. O total aqui é menor que o
         do desempenho porque o Google omite consulta rara dos relatórios, por privacidade.`
      : 'Ainda não há coleta de consultas para este cliente.'}</p>

${reescritas.length ? `<h2 class="sec">Reescritas — ${reescritas.length}</h2>
<p class="sub" style="margin-bottom:14px">O veredito não sai no dia: o cron de otimização volta
30 dias depois da reescrita, compara a posição de antes com a de agora e grava se melhorou.
Até lá fica "aguardando medição", que é a resposta honesta.</p>
<table>
  <thead><tr><th>Artigo</th><th>O que mudou</th><th class="num">Antes</th>
    <th class="num">Agora</th><th>Quando</th></tr></thead>
  <tbody>${reescritas.map((r) => `<tr>
    <td class="q"><a href="/review/${esc(r.slug)}">${esc(r.title)}</a>
      ${Number(r.attempt_number) > 1
        ? `<span class="pill">${r.attempt_number}ª de 3</span>` : ''}</td>
    <td class="sub" style="font-size:13px">${esc(r.changes_summary || '—')}</td>
    <td class="num">${pos(r.old_position)}</td>
    <td class="num">${r.outcome === 'pending' || r.new_position == null
      ? '<span class="pill">aguardando medição</span>'
      : `${pos(r.new_position)} <span class="pill ${VEREDITO[r.outcome]?.classe || ''}">${
          VEREDITO[r.outcome]?.texto || esc(r.outcome)}</span>`}</td>
    <td class="sub" style="font-size:13px">${dataBr(r.optimized_at)}</td>
  </tr>`).join('')}</tbody></table>` : ''}

${consultas.length ? `<div class="cards">
  <div class="stat"><span class="n">${r.consultas}</span><span class="l">consultas</span></div>
  <div class="stat"><span class="n">${r.impressoes}</span><span class="l">impressões atribuídas</span></div>
  <div class="stat"><span class="n">${r.cliques}</span><span class="l">cliques</span></div>
  <div class="stat"><span class="n">${r.quase + r.longe}</span><span class="l">fora do top 10</span></div>
</div>

${sobrecarregadas.length ? `<h2 class="sec">Uma página, muitas buscas — ${sobrecarregadas.length}</h2>
<p class="sub" style="margin-bottom:14px">Uma página que o Google escolheu para várias perguntas
diferentes ganha para uma e afunda para as outras. Não se conserta escrevendo mais: ou a página se
divide, ou uma delas assume a busca e a outra para de disputá-la.</p>
${sobrecarregadas.map((p) => `<div class="canibal">
  <h3>${esc(p.pagina)}</h3>
  <ul>${p.consultas.map((c) => `<li><b>${esc(c.query)}</b> — posição ${pos(c.position)},
    ${c.impressions} ${c.impressions === 1 ? 'impressão' : 'impressões'}</li>`).join('')}</ul>
  <p style="margin:12px 0 0" class="produce">
    <form method="POST" action="/api/ui/melhorar" class="inline">
      <input type="hidden" name="slug" value="${esc(slugDaUrl(p.pagina))}">
      <button class="ghost mini">${(() => {
        const a = escolherAlvo(p.consultas);
        return a ? `Melhorar mirando em "${esc(a.query)}"` : 'Melhorar';
      })()}</button>
    </form>
    <a href="/review/${esc(slugDaUrl(p.pagina))}" class="pill">Abrir o artigo</a></p>
</div>`).join('')}` : ''}

<h2 class="sec">Vale escrever — ${novas.length}</h2>
${novas.length
      ? `<p class="sub" style="margin-bottom:14px">Buscas com demanda em que o site aparece por falta
         de opção: a página que o Google escolheu não é sobre isso. Aqui um artigo novo acrescenta,
         não canibaliza. Virar tópico leva a consulta para a fila com as impressões no lugar do
         volume de busca — que é o número que a pontuação usa.</p>
         ${tabela(novas, botaoTopico)}`
      : `<div class="empty"><strong>Nenhuma lacuna nesta janela</strong>
         Toda busca fora do top 10 já tem artigo dedicado. O caminho é melhorar o que existe.</div>`}

${melhorar.length ? `<h2 class="sec">Vale melhorar — ${melhorar.length}</h2>
<p class="sub" style="margin-bottom:14px">Estas já têm artigo próprio, e ele está mal posicionado.
Escrever outro criaria duas páginas disputando a mesma busca — foi para isso que o botão de virar
tópico sumiu daqui.</p>
${tabela(melhorar, melhorarNesta)}` : ''}

<h2 class="sec">Já trazem gente — ${trazem.length}</h2>
${trazem.length ? tabela(trazem, null)
        : '<p class="note">Nenhuma consulta no top 10 nesta janela.</p>'}`
      : `<div class="empty"><strong>Sem dado de consulta ainda</strong>
A coleta por consulta roda uma vez por semana, junto do cron de desempenho (todo dia às 20h UTC,
gravando quando a última coleta tiver mais de sete dias). Se este cliente foi cadastrado agora,
o primeiro resultado aparece na próxima execução.</div>`}`,
  });
}

async function estado(client) {
  const [linhas, fila, reescritas] = await Promise.all([
    sql`SELECT query, page_url, impressions, clicks, position, period_start, period_end
          FROM gsc_query_metrics
         WHERE client_id = ${client.id}
           AND period_start = (SELECT MAX(period_start) FROM gsc_query_metrics
                                WHERE client_id = ${client.id})`,
    // Consulta que já virou tópico não deve ser oferecida de novo.
    sql`SELECT topic FROM topics WHERE client_id = ${client.id}
         AND status IN ('pending','approved','writing','needs_human','published')`,
    // O que já foi reescrito. Sem isto, optimization_log era escrito e nunca
    // lido: o operador clicava em Melhorar e a única prova de que algo
    // aconteceu era abrir o site.
    sql`SELECT o.attempt_number, o.trigger_reason, o.old_position, o.old_impressions,
               o.changes_summary, o.new_position, o.outcome, o.optimized_at,
               a.slug, a.title
          FROM optimization_log o
          JOIN articles a ON a.id = o.article_id
         WHERE o.client_id = ${client.id}
           AND o.optimized_at > NOW() - INTERVAL '60 days'
         ORDER BY o.optimized_at DESC
         LIMIT 10`,
  ]);

  return {
    consultas: agruparPorConsulta(linhas),
    reescritas,
    jaNaFila: new Set(fila.map((t) => String(t.topic).toLowerCase())),
    cliente: client.name,
    janela: linhas.length
      ? { inicio: dataBr(linhas[0].period_start), fim: dataBr(linhas[0].period_end) }
      : null,
  };
}

function flashDaUrl(q = {}) {
  if (q.melhorando) {
    return { text: `Reescrevendo "${q.melhorando}". Leva de um a três minutos — `
      + 'quando terminar, a linha aparece em Reescritas aqui mesmo. '
      + 'Nada foi publicado ainda.' };
  }
  if (q.erro) return { text: String(q.erro), bad: true };
  return null;
}

export default comErro(requireAuth(async (req, res) => {
  const client = await clienteAtual(req);

  if (req.method !== 'POST') {
    return send(res, render({ ...(await estado(client)), flash: flashDaUrl(req.query) }));
  }

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
