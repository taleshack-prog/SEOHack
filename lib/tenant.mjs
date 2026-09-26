// Qual cliente o painel está olhando agora.
//
// O App nasceu com um cliente só, lido de CLIENT_DOMAIN. O banco sempre foi
// multi-cliente (clients + isolamento por linha); o que faltava era o painel
// saber de quem é a tela. A escolha vive num cookie, não na URL, para não
// vazar de uma tela para outra nem sumir ao navegar.
import { getClient } from './db.mjs';

export const COOKIE_CLIENTE = 'htf_cliente';

export function lerClienteCookie(req) {
  const raw = req?.headers?.cookie || '';
  const hit = raw.split(';').map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_CLIENTE}=`));
  return hit ? decodeURIComponent(hit.slice(COOKIE_CLIENTE.length + 1)) : '';
}

export function gravarClienteCookie(res, dominio) {
  res.setHeader('Set-Cookie',
    `${COOKIE_CLIENTE}=${encodeURIComponent(dominio)}; Path=/; HttpOnly; SameSite=Lax; `
    + `Secure; Max-Age=${60 * 60 * 24 * 365}`);
}

/**
 * Cliente da sessão. Cai para CLIENT_DOMAIN quando o cookie aponta para um
 * cliente que não existe mais — trocar de cliente não pode quebrar o painel.
 */
export async function clienteAtual(req) {
  const escolhido = lerClienteCookie(req);
  if (escolhido) {
    try { return await getClient(escolhido); } catch { /* cai para o padrão */ }
  }
  return getClient();
}
