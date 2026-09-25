// Contatos recebidos pelo formulário dos sites.
//
// Existe porque e-mail não é garantia: se a chave do Brevo faltar, se a
// entrega cair no spam ou se a conta mudar, a mensagem continua aqui. Esta
// tela é a fonte de verdade do que chegou.
//
// GET  /contatos          → lista
// POST /api/ui/contatos   → marca respondido ou descartado
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { sql } from '../../lib/db.mjs';
import { page, send, esc } from '../../lib/ui.mjs';

const CSS = `
.lead{border:1px solid var(--rule);border-left:3px solid var(--proof);background:#fff;
  padding:16px 18px;margin-bottom:12px}
.lead.lido{border-left-color:var(--rule);opacity:.72}
.lead .meta{font-family:var(--mono);font-size:11px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px}
.lead p.msg{margin:0 0 12px;font-family:var(--serif);font-size:17px;line-height:1.5;white-space:pre-wrap}
.lead .acoes{display:flex;gap:8px;align-items:center}
.lead .acoes form{display:inline}
.aviso-email{font-family:var(--mono);font-size:11px;color:var(--proof)}
`;

const quando = (d) => {
  const h = Math.floor((Date.now() - new Date(d)) / 3600000);
  if (h < 1) return 'agora há pouco';
  if (h < 24) return `há ${h}h`;
  const dias = Math.floor(h / 24);
  return dias === 1 ? 'ontem' : `há ${dias} dias`;
};

function render(leads, { flash = null } = {}) {
  const novos = leads.filter((l) => l.status === 'novo');
  return page({
    title: 'Contatos',
    flash,
    body: `<style>${CSS}</style>
<h1 class="lede">${novos.length
      ? `<em>${novos.length}</em> ${novos.length === 1 ? 'mensagem esperando' : 'mensagens esperando'} resposta.`
      : 'Nenhuma mensagem nova.'}</h1>
<p class="sub">Tudo que chega pelo formulário dos sites cai aqui, mesmo quando o aviso por e-mail falha.</p>

${leads.length ? leads.map((l) => `
<div class="lead${l.status === 'novo' ? '' : ' lido'}">
  <div class="meta">
    <span>${esc(l.nome)}</span>
    <span><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></span>
    ${l.assunto ? `<span>${esc(l.assunto)}</span>` : ''}
    <span>${quando(l.created_at)}</span>
    ${l.origem ? `<span>${esc(l.origem.replace(/^https?:\/\//, ''))}</span>` : ''}
    ${l.site_alvo ? `<span class="pill">diagnosticou ${esc(l.site_alvo)}</span>` : ''}
    ${l.status !== 'novo' ? `<span class="pill">${esc(l.status)}</span>` : ''}
  </div>
  <p class="msg">${esc(l.mensagem)}</p>
  <div class="acoes">
    <a href="mailto:${esc(l.email)}?subject=${encodeURIComponent(`Re: ${l.assunto || 'seu contato'}`)}">Responder por e-mail</a>
    ${l.status === 'novo' ? `
    <form method="POST" action="/api/ui/contatos">
      <input type="hidden" name="id" value="${esc(l.id)}">
      <button name="acao" value="respondido" class="ghost mini">Marcar como respondido</button>
    </form>
    <form method="POST" action="/api/ui/contatos">
      <input type="hidden" name="id" value="${esc(l.id)}">
      <button name="acao" value="descartado" class="ghost mini">Descartar</button>
    </form>` : ''}
    ${l.email_erro ? `<span class="aviso-email">aviso por e-mail falhou: ${esc(l.email_erro)}</span>` : ''}
  </div>
</div>`).join('')
      : '<div class="empty"><strong>Nada recebido ainda</strong>O formulário dos sites envia para cá.</div>'}`,
  });
}

export default requireAuth(async (req, res) => {
  if (req.method === 'POST') {
    const body = await readBody(req);
    const acao = body.acao === 'descartado' ? 'descartado' : 'respondido';
    if (body.id) await sql`UPDATE leads SET status = ${acao}, updated_at = NOW() WHERE id = ${body.id}`;
    res.statusCode = 302;
    res.setHeader('Location', '/contatos');
    return res.end();
  }

  const leads = await sql`
    SELECT id, nome, email, assunto, mensagem, origem, site_alvo, status, email_erro, created_at
      FROM leads
     ORDER BY (status = 'novo') DESC, created_at DESC
     LIMIT 100`;

  return send(res, render(leads));
});
