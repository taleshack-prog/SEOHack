// Fila. A pergunta que esta tela responde é uma só: o que está parado esperando
// o Tales? Depois disso, o que ele pode mandar produzir.
import { requireAuth } from '../../lib/auth.mjs';
import { comErro } from '../../lib/erro.mjs';
import { sql } from '../../lib/db.mjs';
import { clienteAtual } from '../../lib/tenant.mjs';
import { parseNotes } from '../../lib/notes.mjs';
import { findUnsourcedStats } from '../../lib/validate.mjs';
import { pendenciasDoCliente } from '../../lib/prontidao.mjs';
import { page, send, esc } from '../../lib/ui.mjs';

const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

export default comErro(requireAuth(async (req, res) => {
  const client = await clienteAtual(req);

  const held = await sql`
    SELECT id, slug, title, cluster, is_pillar, word_count, markdown, created_at
      FROM articles
     WHERE client_id = ${client.id} AND status = 'needs_human'
     ORDER BY created_at ASC`;

  const topics = await sql`
    SELECT id, topic, cluster, is_pillar, status, opportunity_score, status_reason
      FROM topics
     WHERE client_id = ${client.id} AND status IN ('pending','approved')
     ORDER BY is_pillar DESC, opportunity_score DESC NULLS LAST
     LIMIT 12`;

  // Tópico que entrou em produção e nunca voltou.
  //
  // O motor marca 'writing' antes de chamar o LLM. Se a função morre no meio —
  // timeout, deploy durante a execução, erro fora do try — o tópico fica nesse
  // estado para sempre. E como a fila só lista 'pending' e 'approved', ele
  // some da tela sem avisar ninguém: foi assim que quatro tópicos de genética
  // desapareceram entre a fila e os publicados.
  const presos = await sql`
    SELECT id, topic, cluster, assigned_at FROM topics
     WHERE client_id = ${client.id} AND status = 'writing'
       AND assigned_at < NOW() - INTERVAL '20 minutes'
     ORDER BY assigned_at ASC`;

  const [budget] = await sql`SELECT * FROM v_budget_status WHERE client_id = ${client.id}`;

  // Sem uma lista dos publicados não havia caminho até a tela de edição — e
  // corrigir erro em artigo no ar virava operação de terminal.
  const noAr = await sql`
    SELECT slug, title, cluster, is_pillar, first_published_at
      FROM articles
     WHERE client_id = ${client.id} AND status = 'published'
     ORDER BY first_published_at DESC`;

  // Artigo escrito, pago e em lugar nenhum.
  //
  // Status 'ready' é o do texto que passou na validação e ainda não foi ao
  // destino — porque a publicação falhou, ou porque o cliente nem tem destino
  // configurado. Nenhuma tela olhava para ele: o dinheiro saía, o texto
  // existia, e o painel dizia "nenhum artigo publicado ainda".
  const prontos = await sql`
    SELECT slug, title, cluster, is_pillar, word_count, created_at
      FROM articles
     WHERE client_id = ${client.id} AND status = 'ready'
     ORDER BY created_at ASC`;

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

  // Pilar sem seção de links é beco sem saída: recebe autoridade dos satélites
  // e não devolve. O painel precisa mostrar isso, senão a lacuna fica invisível.
  const pilaresDessincronizados = await sql`
    SELECT a.slug, a.title, a.cluster,
           (SELECT COUNT(*)::int FROM articles s
             WHERE s.client_id = a.client_id AND s.cluster = a.cluster
               AND s.status = 'published' AND NOT s.is_pillar) AS satelites
      FROM articles a
     WHERE a.client_id = ${client.id} AND a.status = 'published' AND a.is_pillar
       AND POSITION('## Continue neste cluster' IN COALESCE(a.markdown, '')) = 0`;

  const precisaSync = pilaresDessincronizados.filter((p) => p.satelites > 0);

  const pendencias = pendenciasDoCliente(client);

  let flash = null;
  if (req.query?.iniciado) flash = { text: 'Produção iniciada. Leva de 2 a 5 minutos — atualize a página para acompanhar.' };
  else if (req.query?.aviso === 'ja-rodando') flash = { text: 'Já existe uma produção em andamento.', bad: true };
  else if (req.query?.aviso === 'fila-vazia') flash = {
    text: 'Nada foi gerado: a fila de tópicos está vazia. Abasteça em Tópicos, no menu.',
    bad: true };
  else if (req.query?.fila) flash = {
    text: `Fila abastecida: ${esc(req.query.fila)}.`
        + (req.query.linhas ? ` Linhas ignoradas: ${esc(req.query.linhas)}.` : '') };
  else if (req.query?.destravados) flash = {
    text: `${req.query.destravados} tópico(s) de volta à fila. O texto que estava sendo escrito quando a produção`
        + ' morreu foi descartado; eles serão reescritos do zero.' };
  else if (req.query?.aviso === 'cliente-incompleto') flash = {
    text: 'Nada foi gerado, e nada foi cobrado: falta configuração neste cliente. '
        + 'O que está faltando está logo abaixo.', bad: true };
  else if (req.query?.aviso === 'topico-indisponivel') flash = {
    text: 'Este tópico não está mais disponível — pode ter sido publicado ou descartado.', bad: true };
  else if (req.query?.ok) flash = { text: `Publicado. ${esc(req.query.ok)} está no ar.` };
  else if (req.query?.republicado) flash = {
    text: `Republicado. ${esc(req.query.republicado)} foi regravado no site.`
        + (req.query.pendente ? ` Continua com pendências anteriores: ${esc(req.query.pendente)}.` : ''),
    bad: Boolean(req.query.pendente) };
  else if (req.query?.clusters === 'ja-sincronizado') flash = { text: 'Todos os pilares já estavam sincronizados.' };
  else if (req.query?.clusters) flash = { text: `Pilares atualizados com links para os satélites (${esc(req.query.clusters)}).` };
  else if (!rodando && run && run.items_succeeded < run.items_processed) {
    // 'partial' = rodou, gastou tokens, e nada foi publicado. Sem este aviso o
    // operador via só o contador de custo subir, sem saber o porquê.
    flash = { text: `Produção sem resultado: ${esc(run.error_message || 'sem detalhe registrado')}`, bad: true };
  } else if (run?.status === 'failed' && !rodando) {
    flash = { text: `Última produção falhou: ${esc(run.error_message || 'sem detalhe')}`, bad: true };
  }

  const cards = held.map((a) => {
    const notes = parseNotes(a.markdown || '');
    const numeros = findUnsourcedStats(a.markdown || '');
    const dias = Math.floor((Date.now() - new Date(a.created_at)) / 86400000);
    return `<a class="card" href="/review/${esc(a.slug)}">
      <h3>${esc(a.title)}</h3>
      <div class="meta">
        <span>${esc(a.cluster || 'sem cluster')}</span>
        ${a.is_pillar ? '<span class="pill pillar">pilar</span>' : ''}
        <span>${a.word_count || 0} palavras</span>
        ${notes.length ? `<span>${plural(notes.length, 'trecho', 'trechos')} a escrever</span>` : ''}
        ${numeros.length ? `<span class="pill">${plural(numeros.length, 'número', 'números')} para conferir</span>` : ''}
        <span>${dias === 0 ? 'hoje' : `há ${plural(dias, 'dia', 'dias')}`}</span>
      </div>
      ${notes[0] ? `<p class="asks">“${esc(notes[0].instruction)}”</p>`
        : numeros[0] ? `<p class="asks">Sem fonte: ${esc(numeros.slice(0, 3).map((n) => n.numero).join(', '))}</p>` : ''}
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
    : pendencias.length
      // Botão que não pode dar certo não deve existir. Este cliente ainda não
      // tem como receber o artigo, ou não tem produto para o artigo linkar —
      // gerar agora é pagar por um texto que a validação vai recusar.
      ? `<div class="empty" style="text-align:left">
          <strong>${pendencias.length === 1 ? 'Falta uma coisa antes de produzir'
            : `Faltam ${pendencias.length} coisas antes de produzir`}</strong>
          ${pendencias.map((d) => `<p style="margin:12px 0 0"><strong style="font-size:15px">${esc(d.titulo)}.</strong>
            ${esc(d.detalhe)}
            ${d.link ? `<br><a href="${esc(d.link)}">Resolver agora →</a>`
              : `<br><code>${esc(d.comando)}</code>`}</p>`).join('')}
        </div>`
      : topics.some((t) => t.status === 'approved')
      ? `<form method="POST" action="/api/ui/generate" class="produce">
          <button type="submit">Gerar próximos artigos</button>
          <span class="note">Pega os primeiros da fila abaixo, pilares primeiro.
          Custa cerca de US$ 0,25 por artigo.</span>
        </form>`
      // Botão que não pode funcionar não deve estar ativo: prometer produção
      // com a fila vazia foi o que fez o operador esperar um dia inteiro.
      : `<div class="empty" style="text-align:left">
          <strong>Nada a produzir</strong>
          A fila de tópicos está vazia, e os crons de segunda, quarta e sexta também não
          geram nada enquanto ela estiver assim.
          <p style="margin:14px 0 0"><a href="/topicos">Escrever novos tópicos →</a></p>
        </div>`;

  const body = `
${held.length
    ? `<h1 class="lede"><em>${plural(held.length, 'artigo', 'artigos')}</em> esperando sua revisão.</h1>
       <p class="sub">A máquina escreveu o resto. Estes precisam de algo que ela não tem: experiência vivida ou a sua palavra sobre um número.</p>
       ${cards}`
    : `<h1 class="lede">Nada parado.</h1>
       <p class="sub">Nenhum artigo aguarda revisão neste momento.
       ${publicados.n ? `${plural(publicados.n, 'artigo publicado', 'artigos publicados')} até agora.` : ''}</p>`}

<h2 class="sec">Produção</h2>
${producao}

${precisaSync.length ? `<h2 class="sec">Estrutura dos clusters</h2>
<div class="running" style="border-left-color:var(--proof)">
  <div>
    <strong>${precisaSync.length === 1 ? 'Um pilar sem links de saída' : `${precisaSync.length} pilares sem links de saída`}</strong>
    <span class="note">${precisaSync.map((p) => `“${esc(p.title)}” recebe link de ${p.satelites} ${p.satelites === 1 ? 'satélite' : 'satélites'} e não devolve nenhum.`).join(' ')}
    Sem os links de volta, a página que deveria distribuir autoridade do cluster vira beco sem saída.</span>
  </div>
  <form method="POST" action="/api/ui/sync-clusters" style="margin-left:auto">
    <button type="submit">Sincronizar</button>
  </form>
</div>` : ''}

${presos.length ? `<h2 class="sec">Tópicos presos</h2>
<div class="running" style="border-left-color:var(--proof)">
  <div>
    <strong>${presos.length === 1 ? 'Um tópico travado em produção' : `${presos.length} tópicos travados em produção`}</strong>
    <span class="note">${presos.map((t) => `“${esc(t.topic)}”`).join(', ')} ${presos.length === 1 ? 'entrou' : 'entraram'}
    em produção e não ${presos.length === 1 ? 'voltou' : 'voltaram'} — a execução foi interrompida antes do fim.
    Enquanto ficam assim, não aparecem na fila e nunca são gerados.</span>
  </div>
  <form method="POST" action="/api/ui/destravar" style="margin-left:auto">
    <button type="submit">Devolver à fila</button>
  </form>
</div>` : ''}

<h2 class="sec">Fila de tópicos</h2>
${topics.length ? `<table>
  <thead><tr><th>Tópico</th><th>Cluster</th><th>Score</th><th></th></tr></thead>
  <tbody>${topics.map((t) => `<tr>
    <td>${esc(t.topic)} ${t.is_pillar ? '<span class="pill pillar">pilar</span>' : ''}
      ${t.status_reason ? `<span class="failed-why">falhou: ${esc(t.status_reason)}</span>` : ''}</td>
    <td class="num">${esc(t.cluster || '—')}</td>
    <td class="num">${esc(t.opportunity_score || '—')}</td>
    <td class="num"><div class="row-actions">
      ${rodando ? '<span class="pill">aguarde</span>' : `
      <form method="POST" action="/api/ui/generate">
        <input type="hidden" name="topic_id" value="${esc(t.id)}">
        <button class="ghost mini" title="Gerar só este artigo">Gerar</button>
      </form>`}
      ${t.is_pillar ? '' : `
      <form method="POST" action="/api/ui/topic">
        <input type="hidden" name="topic_id" value="${esc(t.id)}">
        <button name="acao" value="pilar" class="ghost mini"
                title="Marcar como página pilar do cluster: vai para a frente da fila e os satélites linkam para ela">Pilar</button>
      </form>`}
      ${t.status === 'pending' ? `
      <form method="POST" action="/api/ui/topic">
        <input type="hidden" name="topic_id" value="${esc(t.id)}">
        <button name="acao" value="descartar" class="ghost mini">Descartar</button>
      </form>` : ''}
    </div></td>
  </tr>`).join('')}</tbody></table>`
    : '<div class="empty"><strong>Fila vazia</strong><a href="/topicos">Escrever novos tópicos</a></div>'}

${prontos.length ? `<h2 class="sec">Escrito e fora do ar</h2>
<table>
  <thead><tr><th>Artigo</th><th>Cluster</th><th>Escrito em</th><th></th></tr></thead>
  <tbody>${prontos.map((a) => `<tr>
    <td>${esc(a.title)} ${a.is_pillar ? '<span class="pill pillar">pilar</span>' : ''}</td>
    <td class="num">${esc(a.cluster || '—')}</td>
    <td class="num">${new Date(a.created_at).toLocaleDateString('pt-BR')}</td>
    <td class="num"><a href="/review/${esc(a.slug)}" class="pill">Abrir</a></td>
  </tr>`).join('')}</tbody></table>
<p class="note">Estes passaram na validação e foram pagos, mas não chegaram ao site — a
publicação falhou ou o destino não estava configurado. Abrir permite revisar e publicar de novo.</p>` : ''}

<h2 class="sec">No ar</h2>
${noAr.length ? `<table>
  <thead><tr><th>Artigo</th><th>Cluster</th><th>Publicado</th><th></th></tr></thead>
  <tbody>${noAr.map((a) => `<tr>
    <td>${esc(a.title)} ${a.is_pillar ? '<span class="pill pillar">pilar</span>' : ''}</td>
    <td class="num">${esc(a.cluster || '—')}</td>
    <td class="num">${new Date(a.first_published_at).toLocaleDateString('pt-BR')}</td>
    <td class="num"><a href="/review/${esc(a.slug)}" class="pill">Editar</a></td>
  </tr>`).join('')}</tbody></table>
<p class="note">Editar abre o manuscrito. Republicar regrava o HTML no mesmo caminho, sem mudar a URL.</p>`
  : '<p class="note">Nenhum artigo publicado ainda.</p>'}

<h2 class="sec">Orçamento do mês</h2>
<p class="note">US$ ${esc(Number(budget?.spent_usd || 0).toFixed(2))} gastos de
US$ ${esc(budget?.monthly_budget_usd || '0')}. A geração para automaticamente ao esgotar.</p>`;

  send(res, page({ title: 'Fila de revisão', body, flash, cliente: client.name,
                   refresh: rodando ? 20 : 0 }));
}));
