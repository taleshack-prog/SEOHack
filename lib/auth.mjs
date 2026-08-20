// Sessão do dashboard.
//
// O projeto tem URL pública na Vercel; sem isto, qualquer pessoa publica no
// site. Cookie assinado com HMAC, sem estado no servidor: não há sessão para
// invalidar, e trocar DASHBOARD_SECRET derruba todas de uma vez.
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const COOKIE = 'htf_session';
const MAX_AGE = 60 * 60 * 12;   // 12h

function secret() {
  const s = process.env.DASHBOARD_SECRET;
  if (!s) throw new Error('DASHBOARD_SECRET ausente');
  return s;
}

const digest = (payload) => createHmac('sha256', secret()).update(payload).digest('hex');

export function issue() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const jti = randomBytes(8).toString('hex');
  const payload = `${exp}.${jti}`;
  return `${payload}.${digest(payload)}`;
}

export function isValid(token = '') {
  const parts = String(token).split('.');
  if (parts.length !== 3) return false;
  const [exp, jti, sig] = parts;
  const expected = digest(`${exp}.${jti}`);
  if (expected.length !== sig.length) return false;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
  return Number(exp) > Math.floor(Date.now() / 1000);
}

/** Compara a senha em tempo constante — evita descobrir o tamanho por timing. */
export function passwordMatches(given = '') {
  const real = process.env.DASHBOARD_PASSWORD;
  if (!real) throw new Error('DASHBOARD_PASSWORD ausente');
  const a = createHmac('sha256', secret()).update(String(given)).digest();
  const b = createHmac('sha256', secret()).update(real).digest();
  return timingSafeEqual(a, b);
}

export function readCookie(req) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  return hit ? decodeURIComponent(hit.slice(COOKIE.length + 1)) : '';
}

export function setCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`);
}

export function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

/** Envolve um handler exigindo sessão. Redireciona para /login se não houver. */
export function requireAuth(fn) {
  return async (req, res) => {
    if (!isValid(readCookie(req))) {
      res.statusCode = 302;
      res.setHeader('Location', '/login');
      return res.end();
    }
    return fn(req, res);
  };
}

/** Lê o corpo cru — não depender do parser automático da plataforma. */
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] || '').includes('json')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}
