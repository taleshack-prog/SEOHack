import { passwordMatches, issue, setCookie, readBody, isValid, readCookie } from '../../lib/auth.mjs';
import { page, send } from '../../lib/ui.mjs';

const form = (erro) => page({
  title: 'Entrar', nav: false,
  body: `<form class="login" method="POST" action="/api/ui/login">
  <p class="lede" style="font-size:26px;margin-bottom:20px">Fila de revisão</p>
  ${erro ? '<div class="flash bad">Senha incorreta.</div>' : ''}
  <input type="password" name="password" placeholder="Senha" autofocus required
         autocomplete="current-password">
  <button type="submit">Entrar</button>
</form>`,
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (isValid(readCookie(req))) { res.statusCode = 302; res.setHeader('Location', '/'); return res.end(); }
    return send(res, form(false));
  }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const { password = '' } = await readBody(req);
  if (!passwordMatches(password)) return send(res, form(true), 401);

  setCookie(res, issue());
  res.statusCode = 302;
  res.setHeader('Location', '/');
  res.end();
}
