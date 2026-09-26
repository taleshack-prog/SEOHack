// Falha de tela com nome e sobrenome.
//
// Motivo de existir: /topicos começou a responder 500 FUNCTION_INVOCATION_FAILED
// em produção. A página da Vercel diz "A function needed by this page
// temporarily failed" e mais nada — nem a mensagem, nem o arquivo, nem a linha.
// Os 263 testes passavam, o banco simulado não reproduzia, e o diagnóstico
// virou adivinhação por eliminação. Já tinha acontecido antes, com o
// "Cannot access 'idade' before initialization" da tela de desempenho.
//
// A partir daqui, exceção em tela do painel vira página legível: mensagem,
// código do Postgres quando houver, e as linhas do stack que são do projeto.
// E vai para o log da Vercel em uma linha só, com método e caminho.
//
// O detalhe só aparece para quem tem sessão. Visitante vê "Erro interno" —
// stack em página pública entrega estrutura de arquivos e nome de tabela.
import { isValid, readCookie } from './auth.mjs';
import { page, send, esc } from './ui.mjs';

const CSS = `
.erro{border:1px solid var(--rule);border-left:3px solid var(--proof);background:#fff;padding:22px 24px}
.erro h2{font-family:var(--serif);font-size:22px;font-weight:400;margin:0 0 10px}
.erro .msg{font-family:var(--mono);font-size:14px;color:var(--proof);word-break:break-word;margin:0}
.erro dl{display:grid;grid-template-columns:110px 1fr;gap:6px 14px;margin:16px 0 0;
  font-family:var(--mono);font-size:12px}
.erro dt{color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-size:10px;padding-top:2px}
.erro dd{margin:0;word-break:break-word}
.erro pre{font-family:var(--mono);font-size:12px;line-height:1.7;background:var(--paper);
  border:1px solid var(--rule);padding:14px 16px;margin:16px 0 0;overflow-x:auto;white-space:pre-wrap}
`;

/** Campos que o driver do Postgres anexa ao erro e que dizem tudo. */
const CAMPOS_PG = ['code', 'detail', 'hint', 'position', 'schema', 'table', 'column',
                   'constraint', 'routine'];

/**
 * Só as linhas do projeto. O stack de dentro do node_modules e do runtime da
 * Vercel ocupa a tela inteira e nunca é onde está o defeito.
 */
export function stackDoProjeto(stack = '', limite = 6) {
  return String(stack).split('\n')
    .filter((l) => /\.mjs/.test(l) && !/node_modules|node:internal/.test(l))
    .map((l) => l.trim().replace(/\/var\/task\//g, '').replace(/file:\/\/\//g, ''))
    .slice(0, limite)
    .join('\n');
}

/** Um resumo de uma linha, para o log da Vercel. */
export function resumo(err) {
  const pg = err?.code ? ` [${err.code}]` : '';
  return `${err?.name || 'Error'}${pg}: ${err?.message || String(err)}`;
}

function corpo(err, req) {
  const extra = CAMPOS_PG
    .filter((c) => err?.[c] !== undefined && err?.[c] !== null && err?.[c] !== '')
    .map((c) => `<dt>${c}</dt><dd>${esc(String(err[c]))}</dd>`).join('');
  const linhas = stackDoProjeto(err?.stack);

  return `<style>${CSS}</style>
<p class="sub" style="margin-bottom:6px"><a href="/">← Fila</a></p>
<h1 class="lede">Esta tela <em>quebrou</em>.</h1>
<p class="sub">O erro está abaixo inteiro, do jeito que o servidor viu. Nada foi gravado
pela metade: a exceção interrompeu a página antes de qualquer resposta.</p>

<div class="erro">
  <h2>${esc(err?.name || 'Error')}</h2>
  <p class="msg">${esc(err?.message || String(err))}</p>
  <dl>
    <dt>rota</dt><dd>${esc(req?.method || '?')} ${esc(req?.url || '?')}</dd>
    ${extra}
  </dl>
  ${linhas ? `<pre>${esc(linhas)}</pre>` : ''}
</div>`;
}

/**
 * Envolve um handler. Exceção vira página 500 legível em vez de
 * FUNCTION_INVOCATION_FAILED.
 *
 * Ordem importa: comErro(requireAuth(fn)). Assim uma falha dentro da própria
 * autenticação — DASHBOARD_SECRET ausente, por exemplo — também é capturada.
 */
export function comErro(fn) {
  return async (req, res) => {
    try {
      return await fn(req, res);
    } catch (err) {
      // Uma linha no log da Vercel, para quem estiver olhando por lá.
      console.error(`[falha] ${req?.method} ${req?.url} — ${resumo(err)}`);
      if (err?.stack) console.error(err.stack);

      // Resposta já começou: não dá para trocar o corpo. Só encerra.
      if (res.headersSent || res.writableEnded) { try { res.end(); } catch { /* já foi */ } return; }

      let operador = false;
      try { operador = isValid(readCookie(req)); } catch { /* sem segredo configurado */ }

      if (!operador) {
        res.statusCode = 500;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        return res.end('Erro interno.');
      }
      return send(res, page({ title: 'Erro', operador: true, body: corpo(err, req) }), 500);
    }
  };
}
