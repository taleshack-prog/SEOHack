// Diagnóstico público — a porta de entrada comercial do App.
//
// Copiado, em estrutura, do funil das agências de SEO que anunciam no
// Instagram: mostrar ao dono do site uma fraqueza medida, na tela, antes de
// pedir qualquer coisa. O que NÃO foi copiado: Domain Authority (métrica da
// Moz, que o Google não usa), promessa de percentual de tráfego sobre base
// desconhecida e "concorrente relevante" adivinhado por IA. Todo número aqui
// vem de uma requisição que qualquer pessoa pode repetir.
//
// Sem login, sem banco, sem captura de e-mail antes do resultado: o relatório
// aparece primeiro. A conversa comercial vem depois dele, e só se ele valer.
//
// GET /diagnostico            → formulário
// GET /diagnostico?site=x.com → relatório
import { auditarSite } from '../lib/audit.mjs';
import { isValid, readCookie } from '../lib/auth.mjs';
import { page, send, esc } from '../lib/ui.mjs';

const ROTULO = { ok: 'ok', alerta: 'atenção', falha: 'falha' };

const CSS = `
.nota{display:flex;align-items:baseline;gap:14px;margin:0 0 6px}
.nota b{font-family:var(--serif);font-size:54px;font-weight:400;line-height:1;letter-spacing:-.03em}
.nota span{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.item{border-top:1px solid var(--rule);padding:16px 0;display:grid;grid-template-columns:90px 1fr;gap:18px}
.item .estado{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding-top:3px}
.item.ok .estado{color:var(--ok)}
.item.alerta .estado{color:#8A6D1F}
.item.falha .estado{color:var(--proof)}
.item h3{margin:0 0 4px;font-family:var(--serif);font-size:19px;font-weight:400}
.item p{margin:0;font-size:14px}
.item p.det{font-family:var(--mono);font-size:12px;color:var(--ink);word-break:break-word}
.item p.por{color:var(--muted);margin-top:6px}
form.diag{display:flex;gap:10px;flex-wrap:wrap;margin:28px 0 8px}
form.diag input{flex:1 1 280px;font-family:var(--mono);font-size:15px;padding:13px 14px;
  border:1px solid var(--rule);background:#fff;color:var(--ink)}
form.diag input:focus{outline:none;border-color:var(--proof)}
.cta{border:1px solid var(--rule);border-left:3px solid var(--proof);background:#fff;padding:22px 24px;margin-top:40px}
.cta h3{font-family:var(--serif);font-size:22px;font-weight:400;margin:0 0 8px}
@media(max-width:640px){.item{grid-template-columns:1fr;gap:4px}}
`;

const formulario = (valor = '', erro = null) => `
<h1 class="lede">O seu site está <em>legível</em> para quem busca e para as IAs?</h1>
<p class="sub">Doze verificações feitas ao vivo no seu site, em cerca de dez segundos.
Sem cadastro, sem e-mail, sem métrica inventada.</p>
<form class="diag" method="GET" action="/diagnostico">
  <input name="site" value="${esc(valor)}" placeholder="seusite.com.br" autocomplete="url"
         inputmode="url" aria-label="Endereço do site" required>
  <button type="submit">Diagnosticar</button>
</form>
${erro ? `<p class="sub" style="color:var(--proof)">${esc(erro)}</p>` : ''}
<p class="sub" style="margin-top:22px">O que este diagnóstico <strong>não</strong> faz: não estima
tráfego, não usa Domain Authority — que é métrica da Moz e não do Google — e não promete
percentual de crescimento. Quantas páginas estão indexadas, quantas impressões o site teve e
quais robôs realmente passaram por lá só aparecem com acesso ao Search Console e ao log do
servidor, e é isso que o SEOHack passa a medir depois.</p>`;

function relatorio({ host, checks, nota, resumo }) {
  const conta = (e) => checks.filter((c) => c.estado === e).length;
  return `
<p class="sub" style="margin-bottom:10px"><a href="/diagnostico">← Outro site</a></p>
<h1 class="lede" style="max-width:30ch">${esc(host)}</h1>
<div class="nota"><b>${nota}</b><span>de 100 · ${conta('ok')} ok · ${conta('alerta')} atenção · ${conta('falha')} falha</span></div>
<p class="sub">${esc(resumo)}</p>

${checks.map((c) => `
<div class="item ${c.estado}">
  <div class="estado">${ROTULO[c.estado]}</div>
  <div>
    <h3>${esc(c.titulo)}</h3>
    <p class="det">${esc(c.detalhe)}</p>
    <p class="por">${esc(c.porque)}</p>
  </div>
</div>`).join('')}

<div class="cta">
  <h3>O que este diagnóstico não alcança</h3>
  <p>Ele olha o site de fora. O que decide venda está do lado de dentro: quais perguntas
  levam gente até você, quais páginas o Google indexou de verdade, quais robôs de IA passaram
  e com que frequência, e quanto custa cada artigo publicado. O SEOHack liga no Search Console
  e no log do servidor, mede isso toda semana e escreve o que está faltando.</p>
  <p style="margin-top:12px"><a href="https://hacktechfarm.com.br/contato">Falar com a Hack Tech Farm</a></p>
</div>`;
}

export default async function handler(req, res) {
  const site = (req.query?.site || '').trim();
  // Mesma página para todo mundo; só a barra muda para quem tem sessão.
  const operador = isValid(readCookie(req));
  const corpo = (dentro) => page({
    operador,
    title: site ? `Diagnóstico de ${site}` : 'Diagnóstico de site',
    descricao: 'Diagnóstico gratuito: sitemap, robots, dados estruturados e acesso dos robôs de IA. '
      + 'Sem cadastro e sem métrica inventada.',
    publico: true,
    body: `<style>${CSS}</style>${dentro}`,
  });

  if (!site) return send(res, corpo(formulario()));

  try {
    const resultado = await auditarSite(site);
    return send(res, corpo(relatorio(resultado)));
  } catch (err) {
    return send(res, corpo(formulario(site, err.message)), 400);
  }
}
