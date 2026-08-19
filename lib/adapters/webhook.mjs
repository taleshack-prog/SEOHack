// ADAPTER: Webhook — o antigo F8, agora opcional.
//
// Mantido para o cliente que exige que nada saia do perímetro dele e prefere
// implementar o endpoint. Deixa de ser a arquitetura padrão e passa a ser a
// exceção para cliente enterprise. Continua sendo o único adapter que exige
// instalação de código do outro lado.
import { createHmac, randomUUID } from 'node:crypto';

export const id = 'webhook';

export function sign(secret, rawBody, {
  timestamp = Math.floor(Date.now() / 1000).toString(),
  nonce = randomUUID(),
} = {}) {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest('hex');
  return { timestamp, nonce, signature };
}

/** Verificação — o endpoint do cliente usa exatamente esta função. */
export function verify(secret, rawBody, { timestamp, nonce, signature }, toleranceSec = 300) {
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSec) return { ok: false, reason: 'timestamp_out_of_window' };
  const expected = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${rawBody}`).digest('hex');
  const got = String(signature);
  if (expected.length !== got.length) return { ok: false, reason: 'bad_signature' };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

export async function healthCheck({ url, token }) {
  const res = await fetch(url, { method: 'OPTIONS', headers: { authorization: `Bearer ${token}` } });
  return { ok: res.status < 500, status: res.status };
}

export async function publish({ url, token, secret }, articles, { maxAttempts = 3 } = {}) {
  const rawBody = JSON.stringify({ articles });
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { timestamp, nonce, signature } = sign(secret, rawBody);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-htf-timestamp': timestamp,
        'x-htf-nonce': nonce,
        'x-htf-signature': signature,
      },
      body: rawBody,
    });
    const payload = await res.json().catch(() => ({}));
    if (res.status === 422) return { rejected: payload.rejected || [], committed: [] };
    if (res.ok || res.status === 207) {
      return { committed: payload.committed || [], rejected: payload.rejected || [], commitSha: payload.commit_sha || null };
    }
    lastErr = new Error(`Webhook ${res.status}`);
    if ((res.status === 429 || res.status === 503) && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
      continue;
    }
    throw lastErr;
  }
  throw lastErr;
}
