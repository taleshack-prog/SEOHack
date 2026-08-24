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
import { AGENTES_BUSCA, readCrawlerStatus } from '../../lib/crawlers.mjs';
import { graficoLinha, graficoBarras, distribuicaoDeRanking } from '../../lib/charts.mjs';

const dinheiro = (v) => `US$ ${Number(v || 0).toFixed(2)}`;
const dias = (d) => Math.floor((Date.now() - new Date(d)) / 86400000);

export default requireAuth(async (req, res) => {
  const client = await getClient();

  const artigos = (await sql`
    SELECT p.slug, p.title, p.cluster, p.is_pillar, p.status,
           p.first_published_at, p.content_updated_at,
           p.metric_date, p.position, p.impressions, p.clicks, p.ctr_pct,
           p.citation_count,
           COALESCE((SELECT SUM(u.cost_usd) FROM llm_usage u WHERE u.article_id = p.id), 0) AS custo
      FROM v_article_performance p
     WHERE p.client_id = ${client.id} AND p.status = 'published'
     ORDER BY p.is_pillar DESC, p.first_published_at ASC`) || [];

  const [orcamento = {}] = await sql`SELECT * FROM v_budget_status WHERE client_id = ${client.id}`;

  const [totalCusto = { total: 0 }] = await sql`
    SELECT COALESCE(SUM(cost_usd), 0) AS total FROM llm_usage WHERE client_id = ${client.id}`;

  const [crawlers = { agentes: 0, visitas: 0 }] = await sql`
    SELECT COUNT(DISTINCT user_agent)::int AS agentes, COALESCE(SUM(hit_count), 0)::int AS visitas
      FROM ai_crawler_hits
     WHERE client_id = ${client.id} AND hit_date > CURRENT_DATE - 30`;

  const porAgente = (await sql`
    SELECT user_agent, SUM(hit_count)::int AS hits, MAX(hit_date) AS ultima
      FROM ai_crawler_hits
     WHERE client_id = ${client.id} AND hit_date > CURRENT_DATE - 30
     GROUP BY user_agent ORDER BY hits DESC`) || [];

  const temGsc = artigos.some((a) => a.metric_date);
  const primeiro = artigos[0]?.first_published_at;
  const idade = primeiro ? dias(primeiro) : 0;

  // `idade` precisa estar declarada ANTES desta linha. A versão anterior usava
  // uma função-ponte declarada depois, e `const` não permite acesso antes da
  // inicialização — a tela quebrava com ReferenceError em produção.
  const statusCrawler = readCrawlerStatus(porAgente.map((a) => a.user_agent), idade);

  // --- séries para os gráficos ---
  const crawlerPorDia = await sql`
    SELECT user_agent, hit_date::text AS dia, SUM(hit_count)::int AS hits
      FROM ai_crawler_hits
     WHERE client_id = ${client.id} AND hit_date > CURRENT_DATE - 30
     GROUP BY user_agent, hit_date ORDER BY hit_date`;

  const buscaPorDia = await sql`
    SELECT metric_date::text AS dia,
           SUM(impressions)::int AS impressoes,
           SUM(clicks)::int AS cliques
      FROM seo_metrics
     WHERE client_id = ${client.id} AND metric_date > CURRENT_DATE - 30
     GROUP BY metric_date ORDER BY metric_date`;

  const agentes = [...new Set((crawlerPorDia || []).map((r) => r.user_agent))];
  const serieCrawlers = agentes.map((nome) => ({
    nome,
    pontos: (crawlerPorDia || []).filter((r) => r.user_agent === nome).map((r) => ({ x: r.dia, y: r.hits })),
  }));

  const serieBusca = [
    { nome: 'Impressões', pontos: (buscaPorDia || []).map((r) => ({ x: r.dia, y: r.impressoes })) },
    { nome: 'Cliques', pontos: (buscaPorDia || []).map((r) => ({ x: r.dia, y: r.cliques })) },
  ];

  const ranking = distribuicaoDeRanking(artigos);

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

${graficoLinha(serieBusca, { titulo: 'Impressões e cliques', unidade: 'últimos 30 dias' })}

${ranking.total ? graficoBarras(ranking.faixas, {
  titulo: `Distribuição de ranking — ${ranking.total} ${ranking.total === 1 ? 'artigo medido' : 'artigos medidos'}`,
  formata: (v) => `${v}`,
}) : ''}

<h2 class="sec">Por artigo</h2>
${artigos.length ? `<table>
  <thead><tr>
    <th>Artigo</th><th>Posição</th><th>Impr.</th><th>Cliques</th><th>CTR</th><th>Citações</th><th>Custo</th>
  </tr></thead>
  <tbody>${linhas}</tbody>
</table>
${!temGsc ? '<p class="note">As colunas de busca ficam vazias até a Search Console entregar dados.</p>' : ''}`
  : '<div class="empty"><strong>Nenhum artigo publicado</strong>Publique pelo menos um para haver o que medir.</div>'}

${graficoBarras(artigos.map((a) => {
  const t = String(a.title || a.slug || 'sem título');
  return { rotulo: t.length > 44 ? `${t.slice(0, 42)}…` : t, valor: Number(a.custo) || 0 };
}), { titulo: 'Custo por artigo', formata: (v) => `US$ ${Number(v).toFixed(2)}` })}

<h2 class="sec">Crawlers de IA (30 dias)</h2>
<p class="note" style="margin-bottom:16px">Visita de crawler é um robô baixando suas páginas para o índice dele —
não é alguém buscando pelo site. É pré-condição para aparecer em resultados, não resultado.
Quem mede busca de pessoa é a coluna <strong>Impr.</strong> na tabela de artigos, que vem da Search Console.</p>
${graficoLinha(serieCrawlers, { titulo: 'Visitas por dia', unidade: 'o número na legenda é o total do período' })}
${porAgente.length ? `<table>
  <thead><tr><th>Agente</th><th>Visitas no período</th><th>Última</th></tr></thead>
  <tbody>${porAgente.map((a) => `<tr>
    <td>${esc(a.user_agent)} ${AGENTES_BUSCA.includes(a.user_agent) ? '<span class="pill">busca de IA</span>' : ''}</td>
    <td class="num">${a.hits}</td>
    <td class="num">${new Date(a.ultima).toLocaleDateString('pt-BR')}</td>
  </tr>`).join('')}</tbody></table>
<p class="note">${esc(statusCrawler.texto)}</p>`
  : `<div class="empty"><strong>Nenhuma visita registrada</strong>
     ${esc(statusCrawler.texto)}
     Se o Drain da Vercel não estiver apontando para <code>/api/logs</code>, nada é registrado.</div>`}

<h2 class="sec">Orçamento</h2>
<p class="note">${dinheiro(orcamento?.spent_usd)} de ${dinheiro(orcamento?.monthly_budget_usd)} neste mês.
A geração para automaticamente ao esgotar.</p>`;

  send(res, page({ title: 'Desempenho', body }));
});
