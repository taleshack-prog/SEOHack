// Aprovar ou descartar tópico da fila (PRD §29).
// Tópico vindo da Search Console entra como 'pending' e só vira artigo depois
// que alguém disser que vale a pena. Tópico do seed já nasce aprovado, porque
// o seed é a própria curadoria humana.
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { sql } from '../../lib/db.mjs';
import { clienteAtual } from '../../lib/tenant.mjs';

export default requireAuth(async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const { topic_id, acao } = await readBody(req);
  const client = await clienteAtual(req);

  if (acao === 'aprovar') {
    await sql`UPDATE topics SET status='approved', approved_at=NOW()
               WHERE id=${topic_id} AND client_id=${client.id} AND status='pending'`;
  } else if (acao === 'descartar') {
    await sql`UPDATE topics SET status='rejected', status_reason='descartado no painel'
               WHERE id=${topic_id} AND client_id=${client.id} AND status IN ('pending','approved')`;
  }
  res.statusCode = 302;
  res.setHeader('Location', '/');
  res.end();
});
