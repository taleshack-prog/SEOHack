// Clientes do App.
//
// O motor sempre foi multi-cliente no banco; o painel é que enxergava um só,
// lido de CLIENT_DOMAIN. Esta tela cadastra os outros sites — genbreed.com.br,
// posthink.com.br e, depois, cliente pagante — e troca qual deles as demais
// telas estão mostrando.
//
// O que NÃO fica aqui: o token de acesso ao repositório. Ele é gravado por
// `npm run configure` a partir do .env e nunca é exibido nem editado pelo
// navegador. Segredo que passa por formulário acaba em histórico de sessão,
// em log de proxy e em captura de tela.
//
// GET  /clientes          → lista + cadastro
// POST /api/ui/clientes   → cadastra ou troca o cliente da sessão
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { sql, listClients } from '../../lib/db.mjs';
import { clienteAtual, gravarClienteCookie } from '../../lib/tenant.mjs';
import { page, send, esc } from '../../lib/ui.mjs';

const CSS = `
.cli{border:1px solid var(--rule);background:#fff;padding:16px 18px;margin-bottom:12px;
  display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}
.cli.atual{border-left:3px solid var(--proof)}
.cli h3{font-family:var(--serif);font-size:20px;font-weight:400;margin:0;flex:1 1 200px}
.cli .meta{font-family:var(--mono);font-size:11px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap}
form.novo label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--muted);margin:16px 0 6px}
form.novo input{width:100%;font-family:var(--sans);font-size:15px;padding:11px 12px;
  border:1px solid var(--rule);background:#fff;color:var(--ink)}
form.novo input:focus{outline:none;border-color:var(--proof)}
.linha{display:flex;gap:12px;flex-wrap:wrap}
.linha>div{flex:1 1 200px}
`;

const numero = (v, padrao) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

function limparDominio(v = '') {
  return String(v).trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function render({ clientes, atual, contagens, flash = null, dados = {} }) {
  return page({
    title: 'Clientes',
    flash,
    cliente: atual?.name,
    body: `<style>${CSS}</style>
<h1 class="lede">${clientes.length === 1 ? 'Um site' : `${clientes.length} sites`} sob o motor.</h1>
<p class="sub">Fila, desempenho, contatos e revisão mostram sempre o cliente marcado aqui.</p>

${clientes.map((c) => {
      const n = contagens.get(c.id) || { artigos: 0, fila: 0 };
      const ehAtual = c.id === atual?.id;
      return `<div class="cli${ehAtual ? ' atual' : ''}">
  <h3>${esc(c.name)} ${ehAtual ? '<span class="pill">em uso</span>' : ''}</h3>
  <div class="meta">
    <span>${esc(c.domain)}</span>
    <span>${n.artigos} ${n.artigos === 1 ? 'artigo' : 'artigos'}</span>
    <span>${n.fila} na fila</span>
    <span>orçamento US$ ${esc(c.monthly_budget_usd)}</span>
    <span>${esc(c.publish_adapter || 'sem adapter')}</span>
  </div>
  ${ehAtual ? '' : `<form method="POST" action="/api/ui/clientes">
    <input type="hidden" name="dominio" value="${esc(c.domain)}">
    <button name="acao" value="trocar" class="ghost mini">Usar este</button>
  </form>`}
</div>`;
    }).join('')}

<h2 class="sec">Novo cliente</h2>
<form class="novo" method="POST" action="/api/ui/clientes">
  <div class="linha">
    <div>
      <label for="name">Nome</label>
      <input id="name" name="name" value="${esc(dados.name || '')}" placeholder="GenBreed" required>
    </div>
    <div>
      <label for="dominio">Domínio</label>
      <input id="dominio" name="dominio" value="${esc(dados.dominio || '')}"
             placeholder="genbreed.com.br" required>
    </div>
    <div>
      <label for="orcamento">Orçamento mensal (US$)</label>
      <input id="orcamento" name="orcamento" type="number" step="1" min="1"
             value="${esc(dados.orcamento || '50')}">
    </div>
  </div>
  <div class="actions" style="margin-top:20px">
    <button name="acao" value="criar">Cadastrar</button>
    <span class="note">A propriedade da Search Console vira
    <code>sc-domain:&lt;domínio&gt;</code>.</span>
  </div>
</form>

<p class="sub" style="margin-top:28px">Depois de cadastrar, falta uma coisa que não dá para
fazer por aqui: apontar o destino de publicação. Rode <code>npm run configure</code> com o
domínio do novo cliente — é o comando que grava o repositório e o token, e token não passa
por formulário. Na Search Console, adicione
<code>seohack-gsc@seohack-506220.iam.gserviceaccount.com</code> como usuário da propriedade,
senão o desempenho fica vazio.</p>`,
  });
}

async function estado(req) {
  const [clientes, atual, linhas] = await Promise.all([
    listClients(),
    clienteAtual(req),
    sql`SELECT c.id,
                COUNT(*) FILTER (WHERE a.status = 'published')::int AS artigos,
                (SELECT COUNT(*)::int FROM topics t
                  WHERE t.client_id = c.id AND t.status IN ('pending','approved')) AS fila
           FROM clients c LEFT JOIN articles a ON a.client_id = c.id
          GROUP BY c.id`,
  ]);
  return { clientes, atual, contagens: new Map(linhas.map((l) => [l.id, l])) };
}

export default requireAuth(async (req, res) => {
  if (req.method !== 'POST') return send(res, render(await estado(req)));

  const body = await readBody(req);
  const dominio = limparDominio(body.dominio);

  if (body.acao === 'trocar') {
    gravarClienteCookie(res, dominio);
    res.statusCode = 302;
    res.setHeader('Location', '/clientes');
    return res.end();
  }

  const nome = String(body.name || '').trim().slice(0, 120);
  const erro = !nome ? 'Escreva o nome do cliente.'
    : !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio) ? `"${body.dominio}" não parece um domínio.`
      : null;

  if (erro) {
    return send(res, render({ ...(await estado(req)), flash: { text: erro, bad: true },
                              dados: { name: body.name, dominio: body.dominio, orcamento: body.orcamento } }), 422);
  }

  try {
    await sql`
      INSERT INTO clients (name, domain, gsc_property, publish_url, monthly_budget_usd)
      VALUES (${nome}, ${dominio}, ${`sc-domain:${dominio}`}, ${`https://${dominio}`},
              ${numero(body.orcamento, 50)})`;
  } catch (err) {
    const texto = /duplicate key|unique/i.test(err.message)
      ? `${dominio} já está cadastrado.`
      : `Não consegui cadastrar: ${err.message}`;
    return send(res, render({ ...(await estado(req)), flash: { text: texto, bad: true } }), 422);
  }

  // Quem cadastra quer trabalhar nele agora.
  gravarClienteCookie(res, dominio);
  res.statusCode = 302;
  res.setHeader('Location', '/clientes');
  res.end();
});
