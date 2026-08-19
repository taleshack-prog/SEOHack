// A Vercel envia `Authorization: Bearer ${CRON_SECRET}` nas invocações de cron.
// Sem esta checagem, a rota é um endpoint público que qualquer um dispara —
// e disparar /api/cron/content à vontade queima orçamento de LLM.
export function assertCron(req) {
  const expected = process.env.CRON_SECRET;
  if (!expected) throw new Error('CRON_SECRET não configurado');
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (got !== expected) {
    const e = new Error('Não autorizado');
    e.statusCode = 401;
    throw e;
  }
}

/** Envelopa um handler de cron: autentica, captura erro e devolve JSON. */
export function cronHandler(fn) {
  return async (req, res) => {
    try {
      assertCron(req);
      const result = await fn(req);
      res.status(200).json({ ok: true, ...result });
    } catch (err) {
      const code = err.statusCode || 500;
      console.error('[cron]', err.stack || err.message);
      res.status(code).json({ ok: false, error: err.message });
    }
  };
}
