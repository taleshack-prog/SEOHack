// DESEMPENHO
//
// A pergunta que esta tela responde: o dinheiro e o esforço estão produzindo
// resultado? Até agora o painel media só o custo — o retorno não tinha onde
// aparecer, e "não tem onde ver" é indistinguível de "não está funcionando".
//
// Ela é honesta sobre o que ainda não sabe. Enquanto a Search Console não
// estiver ligada, a coluna de ranking mostra o motivo em vez de zeros, porque
// zero sugere fracasso e ausência de dado não é fracasso.
import { requireAuth } from '../../lib/auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { page, send, esc } from '../../lib/ui.mjs';
import { ESSENCIAIS_GEO } from '../../lib/crawlers.mjs';

const dinheiro = (v) => `US$ ${Number(v || 0).toFixed(2)}`;
const dias = (d) => Math.floor((Date.now() - new Date(d)) / 86400000);

export default requireAuth(async (req, res) => {
  const client = await getClient();

  const artigos = await sql`
    SELECT p.slug, p.title, p.cluster, p.is_pillar, p.status,
           p.first_published_at, p.content_updated_at,
           p.metric_date, p.position, p.impressions, p.clicks, p.ctr_pct,
           p.citation_count,
           COALESCE((SELECT SUM(u.cost_usd) FROM llm_usage u WHERE u.article_id = p.id), 0) AS custo
      FROM v_article_performance p
     WHERE p.client_id = ${client.id} AND p.status = 'published'
     ORDER BY p.is_pillar DESC, p.first_published_at ASC`;

  const [orcamento] = await sql`SELECT * FROM v_budget_status WHERE client_id = ${client.id}`;

  const [totalCusto] = await sql`
    SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_usage WHERE client_id = ${client.id}`;

  const [crawlers] = await sql`
    SELECT COUNT(DISTINCT user_agent)::int AS agentes, COALESCE(SUM(hit_count), 0)::int AS visitas
      FROM ai_crawler_hits
     WHERE client_id = ${client.id} AND hit_date > CURRENT_DATE - 30`;

  const porAgente = await sql`
    SELECT user_agent, SUM(hit_count)::int AS hits, MAX(hit_date) AS ultima
      FROM ai_crawler_hits
     WHERE client_id = ${client.id} AND hit_date > CURRENT_DATE - 30
     GROUP BY user_agent ORDER BY hits DESC`;

  const vistos = new Set(porAgente.map((a) => a.user_agent));
  const faltando = ESSENCIAIS_GEO.filter((a) => !vistos.has(a));

  const temGsc = artigos.some((a) => a.metric_date);
  const primeiro = artigos[0]?.first_published_at;
  const idade = primeiro ? dias(primeiro) : 0;

  // Agregados só fazem sentido quando há dado.
  const somaImp = artigos.reduce((s, a) => s + Number(a.impressions || 0), 0);
  const somaCliques = artigos.reduce((s, a) => s + Number(a.clicks || 0), 0);
  const citacoes = artigos.reduce((s, a) => s + Number(a.citation_count || 0), 0);

  const linhas = artigos.map((a) => `<tr>
    <td>${esc(a.title)} ${a.is_pillar ? '<span class="pill pillar">pilar</span>' : ''}
      <span class="sub-line">${esc(a.cluster || '—')} · publicado há ${dias(a.first_published_at)}d</span></td>
    <td class="num">${a.position ? Number(a.position).toFixed(1) : '—'}</td>
    <td class="num">${a.impressions ?? '—'}</td>
    <td class="num">${a.clicks ?? '—'}</td>
    <td class="num">${a.ctr_pct ? `${a.ctr_pct}%` : '—'}</td>
    <td class="num">${a.citation_count || 0}</td>
    <td class="num">${dinheiro(a.custo)}</td>
  </tr>`).join('');

  // O que falta para cada sinal existir, dito na ordem em que acontece.
  const pendencias = [];
  if (!process.env.GSC_CLIENT_EMAIL) {
    pendencias.push('Credenciais da Search Console ausentes no ambiente.');
  } else if (!temGsc) {
    pendencias.push('Search Console configurada, mas ainda sem dados coletados. '
      + 'A API tem 2 a 3 dias de atraso, e um artigo novo leva de 2 a 4 semanas para acumular impressões.');
  }
  if (!process.env.PERPLEXITY_API_KEY) {
    pendencias.push('Sem chave da Perplexity: citações em IA não são verificadas.');
  }
  if (!crawlers.agentes) {
    pendencias.push('Nenhuma visita de crawler de IA registrada — o Log Drain da Vercel não está enviando dados.');
  }

  const body = `
<h1 class="lede">Desempenho</h1>
<p class="sub">${artigos.length} ${artigos.length === 1 ? 'artigo publicado' : 'artigos publicados'}${
  primeiro ? `, o primeiro há ${idade} ${idade === 1 ? 'dia' : 'dias'}` : ''}.
Custo total até agora: <strong>${dinheiro(totalCusto.total)}</strong>${
  artigos.length ? ` (${dinheiro(Number(totalCusto.total) / artigos.length)} por artigo)` : ''}.</p>

${temGsc ? `<div class="cards">
  <div class="stat"><span class="n">${somaImp}</span><span class="l">impressões</span></div>
  <div class="stat"><span class="n">${somaCliques}</span><span class="l">cliques</span></div>
  <div class="stat"><span class="n">${citacoes}</span><span class="l">citações em IA</span></div>
  <div class="stat"><span class="n">${crawlers.agentes}</span><span class="l">crawlers de IA ativos</span></div>
</div>` : ''}

${pendencias.length ? `<div class="pending">
  <strong>O que ainda não está sendo medido</strong>
  <ul>${pendencias.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
  ${idade < 21 && idade > 0 ? `<p class="note">Mesmo com tudo ligado, ${idade} dias é cedo:
  ranking costuma levar de 8 a 12 semanas para estabilizar. Números baixos agora não indicam fracasso.</p>` : ''}
</div>` : ''}

<h2 class="sec">Por artigo</h2>
${artigos.length ? `<table>
  <thead><tr>
    <th>Artigo</th><th>Posição</th><th>Impr.</th><th>Cliques</th><th>CTR</th><th>Citações</th><th>Custo</th>
  </tr></thead>
  <tbody>${linhas}</tbody>
</table>
${!temGsc ? '<p class="note">As colunas de busca ficam vazias até a Search Console entregar dados.</p>' : ''}`
  : '<div class="empty"><strong>Nenhum artigo publicado</strong>Publique pelo menos um para haver o que medir.</div>'}

<h2 class="sec">Crawlers de IA (30 dias)</h2>
${porAgente.length ? `<table>
  <thead><tr><th>Agente</th><th>Visitas</th><th>Última</th></tr></thead>
  <tbody>${porAgente.map((a) => `<tr>
    <td>${esc(a.user_agent)} ${ESSENCIAIS_GEO.includes(a.user_agent) ? '<span class="pill">essencial</span>' : ''}</td>
    <td class="num">${a.hits}</td>
    <td class="num">${new Date(a.ultima).toLocaleDateString('pt-BR')}</td>
  </tr>`).join('')}</tbody></table>
${faltando.length ? `<p class="note">Nunca visitaram: <strong>${faltando.map(esc).join(', ')}</strong>.
Sem a visita desses agentes, citação em resposta de IA é impossível — mesmo com o robots.txt liberado.</p>`
  : '<p class="note">Os três agentes essenciais para citação em IA estão visitando o site.</p>'}`
  : `<div class="empty"><strong>Nenhuma visita registrada</strong>
     O Drain da Vercel precisa estar apontando para <code>/api/logs</code>.
     Liberar um agente no robots.txt não prova que ele visita — este é o único sinal que prova.</div>`}

<h2 class="sec">Orçamento</h2>
<p class="note">${dinheiro(orcamento?.spent_usd)} de ${dinheiro(orcamento?.monthly_budget_usd)} neste mês.
A geração para automaticamente ao esgotar.</p>`;

  send(res, page({ title: 'Desempenho', body }));
});
