// Camada de apresentação do dashboard.
//
// Direção visual: prova de gráfica. O que este painel faz é revisão editorial —
// um texto que a máquina escreveu e que não pode sair sem a mão de alguém. Por
// isso o vocabulário é o do revisor: manuscrito em serifa, marcações em
// vermelho de lápis de prova, e as lacunas do artigo desenhadas como buracos
// reais no texto, no lugar exato onde falta a frase que só o Tales pode
// escrever. A lacuna é o elemento central: é o problema do sistema tornado
// visível. Todo o resto fica quieto para ela aparecer.
export const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CSS = `
:root{
  --paper:#FBFAF7; --rule:#E4E0D8; --ink:#22201C; --muted:#7C7669;
  --proof:#C6342B; --held:#F7EBE9; --ok:#2F6F4F;
  --serif:"Newsreader",Georgia,serif;
  --sans:"Space Grotesk",system-ui,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);
  font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:820px;margin:0 auto;padding:40px 24px 96px}
a{color:var(--ink)}
header.bar{display:flex;justify-content:space-between;align-items:baseline;
  border-bottom:1px solid var(--rule);padding-bottom:14px;margin-bottom:40px}
.brand{font-weight:600;letter-spacing:-.02em}
.brand span{color:var(--muted);font-weight:400}
.bar nav{font-family:var(--mono);font-size:12px;color:var(--muted)}
.bar nav a{margin-left:16px;text-decoration:none;color:var(--muted)}
.bar nav a:hover{color:var(--proof)}

.lede{font-family:var(--serif);font-size:34px;line-height:1.2;letter-spacing:-.02em;
  margin:0 0 8px;max-width:22ch}
.lede em{font-style:normal;color:var(--proof)}
.sub{color:var(--muted);margin:0 0 40px;font-size:15px}

h2.sec{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);font-weight:500;margin:48px 0 14px;
  border-bottom:1px solid var(--rule);padding-bottom:8px}

.card{display:block;text-decoration:none;border:1px solid var(--rule);border-left:3px solid var(--proof);
  background:#fff;padding:18px 20px;margin-bottom:12px;transition:border-color .12s,transform .12s}
.card:hover{border-color:var(--proof);transform:translateX(2px)}
.card h3{font-family:var(--serif);font-size:20px;margin:0 0 6px;line-height:1.3;letter-spacing:-.01em}
.card .meta{font-family:var(--mono);font-size:11px;color:var(--muted);display:flex;gap:14px;flex-wrap:wrap}
.card .asks{margin:10px 0 0;font-size:14px;color:var(--muted);font-style:italic}

.empty{border:1px dashed var(--rule);padding:32px;text-align:center;color:var(--muted)}
.empty strong{display:block;color:var(--ink);font-family:var(--serif);font-size:19px;
  font-weight:400;margin-bottom:6px}

table{width:100%;border-collapse:collapse;font-size:14px}
th{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);text-align:left;font-weight:500;padding:0 10px 8px 0}
td{padding:10px 10px 10px 0;border-top:1px solid var(--rule);vertical-align:top}
td.num{font-family:var(--mono);color:var(--muted);white-space:nowrap}
.pill{font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;
  border:1px solid var(--rule);padding:2px 7px;color:var(--muted)}
.pill.pillar{border-color:var(--proof);color:var(--proof)}

/* ---- manuscrito em revisão ---- */
.ms{font-family:var(--serif);font-size:19px;line-height:1.72;white-space:pre-wrap;
  background:#fff;border:1px solid var(--rule);padding:36px 40px}
.ms h2,.ms h3{font-family:var(--sans);letter-spacing:-.01em}
.gap{display:block;background:var(--held);border-left:3px solid var(--proof);
  margin:22px 0;padding:16px 18px}
.gap .ask{font-family:var(--mono);font-size:11px;color:var(--proof);letter-spacing:.05em;
  text-transform:uppercase;margin-bottom:10px}
.gap textarea{width:100%;font-family:var(--serif);font-size:18px;line-height:1.6;
  border:0;border-bottom:1px solid var(--proof);background:transparent;color:var(--ink);
  padding:4px 0 8px;resize:vertical;min-height:76px}
.gap textarea:focus{outline:none;background:#fff}
.gap .hint{font-size:12px;color:var(--muted);margin-top:8px}

.actions{position:sticky;bottom:0;background:var(--paper);border-top:1px solid var(--rule);
  padding:16px 0;margin-top:28px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
button{font-family:var(--sans);font-size:14px;font-weight:500;padding:10px 20px;
  border:1px solid var(--ink);background:var(--ink);color:var(--paper);cursor:pointer}
button:hover{background:var(--proof);border-color:var(--proof)}
button.ghost{background:transparent;color:var(--ink)}
button.ghost:hover{background:transparent;color:var(--proof);border-color:var(--proof)}
button:focus-visible,a:focus-visible,textarea:focus-visible{outline:2px solid var(--proof);outline-offset:2px}
.note{font-size:13px;color:var(--muted)}

/* produção em curso: o ponto pulsando é o único movimento da tela,
   justamente porque é a única coisa acontecendo. */
.running{display:flex;gap:14px;align-items:center;border:1px solid var(--rule);
  border-left:3px solid var(--proof);background:#fff;padding:16px 20px}
.running strong{display:block;font-family:var(--serif);font-size:19px;font-weight:400}
.running .dot{width:9px;height:9px;border-radius:50%;background:var(--proof);flex:none;
  animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}}
.produce{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.row-actions{display:flex;gap:6px;justify-content:flex-end}
button.mini{padding:4px 10px;font-size:12px}
.failed-why{display:block;font-family:var(--mono);font-size:11px;color:var(--proof);margin-top:4px}

/* editor de artigo publicado: mesma caixa do manuscrito, agora editável */
textarea.editor{width:100%;font-family:var(--mono);font-size:13px;line-height:1.7;
  border:1px solid var(--rule);background:#fff;color:var(--ink);padding:24px 26px;
  resize:vertical;min-height:60vh;white-space:pre}
textarea.editor:focus{outline:none;border-color:var(--proof)}
a.pill{text-decoration:none}
a.pill:hover{border-color:var(--proof);color:var(--proof)}
.sub-line{display:block;font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:3px}

/* números grandes só quando existem números — a tela não finge dado */
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 28px}
.stat{flex:1 1 130px;border:1px solid var(--rule);background:#fff;padding:16px 18px}
.stat .n{display:block;font-family:var(--serif);font-size:30px;line-height:1.1}
.stat .l{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--muted);margin-top:6px}

.pending{border:1px dashed var(--rule);padding:18px 20px;margin-bottom:8px}
.pending strong{font-family:var(--serif);font-size:18px;font-weight:400;display:block;margin-bottom:8px}
.pending ul{margin:0;padding-left:18px;font-size:14px;color:var(--muted)}
.pending li{margin-bottom:5px}

.flash{border-left:3px solid var(--ok);background:#F0F5F2;padding:12px 16px;margin-bottom:24px;font-size:14px}
.flash.bad{border-color:var(--proof);background:var(--held)}

form.login{max-width:340px;margin:14vh auto;text-align:left}
form.login input{width:100%;font-family:var(--mono);font-size:15px;padding:11px 13px;
  border:1px solid var(--rule);background:#fff;color:var(--ink);margin-bottom:14px}
form.login input:focus{outline:none;border-color:var(--proof)}
form.login button{width:100%}

@media (max-width:640px){
  .wrap{padding:24px 16px 80px}
  .lede{font-size:26px}
  .ms{padding:22px 20px;font-size:17px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

export function page({ title, body, flash = null, nav = true, refresh = 0 }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${esc(title)} · SEOHack</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Space+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div class="wrap">
${nav ? `<header class="bar">
  <div class="brand">SEOHack <span>· revisão</span></div>
  <nav><a href="/">Fila</a><a href="/desempenho">Desempenho</a><a href="/api/health">Estado</a><a href="/logout">Sair</a></nav>
</header>` : ''}
${flash ? `<div class="flash${flash.bad ? ' bad' : ''}">${esc(flash.text)}</div>` : ''}
${body}
</div></body></html>`;
}

export function send(res, html, status = 200) {
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(html);
}
