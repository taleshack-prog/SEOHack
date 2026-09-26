// Produtos do cliente selecionado.
//
// Era a segunda operação presa no terminal: editar seeds/products.json e rodar
// `npm run sync-products`, que ainda por cima só escrevia no CLIENT_DOMAIN.
// Cliente cadastrado pelo painel nascia sem produto nenhum e tinha a primeira
// geração recusada por falta de link de produto — depois de pagar pelo texto.
//
// GET  /produtos          → formulário com os produtos deste cliente
// POST /api/ui/produtos   → grava em clients.adapter_config.products
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { comErro } from '../../lib/erro.mjs';
import { sql } from '../../lib/db.mjs';
import { clienteAtual } from '../../lib/tenant.mjs';
import { produtosDoFormulario } from '../../lib/produtos.mjs';
import { page, send, esc } from '../../lib/ui.mjs';

const CSS = `
.prod{border:1px solid var(--rule);background:#fff;padding:18px 20px;margin-bottom:14px}
.prod.novo{border-style:dashed;background:transparent}
.prod label{display:block;font-family:var(--mono);font-size:11px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--muted);margin:14px 0 6px}
.prod label:first-of-type{margin-top:0}
.prod input,.prod textarea{width:100%;font-family:var(--sans);font-size:15px;padding:10px 12px;
  border:1px solid var(--rule);background:#fff;color:var(--ink)}
.prod textarea{font-size:14px;line-height:1.6;min-height:90px;resize:vertical}
.prod input:focus,.prod textarea:focus{outline:none;border-color:var(--proof)}
.linha{display:flex;gap:12px;flex-wrap:wrap}
.linha>div{flex:1 1 200px}
.ajuda{font-size:13px;color:var(--muted);margin:6px 0 0}
`;

function campos(p = {}, novo = false) {
  return `<div class="prod${novo ? ' novo' : ''}">
  <div class="linha">
    <div>
      <label>Nome</label>
      <input name="name" value="${esc(p.name || '')}" placeholder="${novo ? 'Posthink' : ''}" autocomplete="off">
    </div>
    <div>
      <label>Caminho do link</label>
      <input name="path" value="${esc(p.path || '')}" placeholder="/produtos ou https://posthink.com.br"
             autocomplete="off">
    </div>
  </div>
  <label>O que é</label>
  <textarea name="about" placeholder="O modelo lê isto para decidir onde o link cabe no texto.">${esc(p.about || '')}</textarea>
  <div class="linha">
    <div>
      <label>Clusters que existem para ele</label>
      <input name="clusters" value="${esc((p.clusters || []).join(', '))}"
             placeholder="engajamento-no-linkedin" autocomplete="off">
    </div>
  </div>
  <p class="ajuda">Artigo de um cluster listado aqui é <strong>obrigado</strong> a linkar este produto.
  Separe por vírgula. Deixe vazio se o produto não tem cluster próprio.</p>
  <label>Voz (opcional)</label>
  <textarea name="voice" placeholder="Substitui a persona de engenheiro de software nos artigos destes clusters. Use quando o público não é desenvolvedor.">${esc(p.voice || '')}</textarea>
</div>`;
}

function render({ produtos, cliente, flash = null }) {
  return page({
    title: 'Produtos',
    flash,
    cliente,
    body: `<style>${CSS}</style>
<p class="sub" style="margin-bottom:6px"><a href="/">← Fila</a></p>
<h1 class="lede">O que os artigos existem para <em>divulgar</em>.</h1>
<p class="sub">Todo artigo precisa de pelo menos um link para uma página de produto. Sem nada
aqui, o texto é escrito, pago e recusado na validação. Para apagar um produto, limpe o nome e o
caminho dele e grave.</p>

<form method="POST" action="/api/ui/produtos">
  ${produtos.map((p) => campos(p)).join('')}
  ${campos({}, true)}
  <div class="actions" style="margin-top:20px">
    <button type="submit">Gravar</button>
    <span class="note">Vale só para ${esc(cliente || 'o cliente em uso')}. Cada cliente tem os seus.</span>
  </div>
</form>`,
  });
}

const lerProdutos = (client) => {
  const p = client?.adapter_config?.products;
  return Array.isArray(p) ? p : [];
};

export default comErro(requireAuth(async (req, res) => {
  const client = await clienteAtual(req);

  if (req.method !== 'POST') {
    const n = Number(req.query?.ok);
    return send(res, render({
      produtos: lerProdutos(client),
      cliente: client.name,
      flash: Number.isFinite(n) && req.query?.ok !== undefined
        ? { text: n === 0 ? 'Lista de produtos esvaziada. Nenhum artigo vai passar na validação até haver um.'
          : `${n} ${n === 1 ? 'produto gravado' : 'produtos gravados'} para ${client.name}.`,
        bad: n === 0 }
        : null,
    }));
  }

  const body = await readBody(req);
  const { produtos, erros } = produtosDoFormulario(body);

  if (erros.length) {
    return send(res, render({
      produtos,
      cliente: client.name,
      flash: { text: erros.slice(0, 3).join(' · '), bad: true },
    }), 422);
  }

  // jsonb_set e não UPDATE do objeto inteiro: o resto do adapter_config guarda
  // o token e o repositório, que não passam por formulário nenhum.
  await sql`
    UPDATE clients
       SET adapter_config = jsonb_set(COALESCE(adapter_config, '{}'::jsonb), '{products}',
                                      ${JSON.stringify(produtos)}::jsonb)
     WHERE id = ${client.id}`;

  res.statusCode = 302;
  res.setHeader('Location', `/produtos?ok=${produtos.length}`);
  res.end();
}));
