// Aprovar ou descartar tópico da fila (PRD §29).
// Tópico vindo da Search Console entra como 'pending' e só vira artigo depois
// que alguém disser que vale a pena. Tópico do seed já nasce aprovado, porque
// o seed é a própria curadoria humana.
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { comErro } from '../../lib/erro.mjs';
import { sql } from '../../lib/db.mjs';
import { clienteAtual } from '../../lib/tenant.mjs';
import { PILLAR_MULTIPLIER } from '../../lib/score.mjs';

export default comErro(requireAuth(async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const { topic_id, acao } = await readBody(req);
  const client = await clienteAtual(req);

  if (acao === 'aprovar') {
    await sql`UPDATE topics SET status='approved', approved_at=NOW()
               WHERE id=${topic_id} AND client_id=${client.id} AND status='pending'`;
  } else if (acao === 'pilar') {
    // A pilar só podia ser marcada na hora de cadastrar, com um `*` no começo
    // da linha. Quem esqueceu — ou quem só percebeu qual era a pilar depois de
    // ver a lista pronta — tinha que descartar e recadastrar. O multiplicador é
    // o mesmo do opportunityScore (PILLAR_MULTIPLIER), para que o score
    // continue comparável ao de um tópico cadastrado já como pilar.
    //
    // NOT is_pillar no WHERE: clicar duas vezes não multiplica duas vezes.
    await sql`UPDATE topics
                 SET is_pillar = TRUE,
                     opportunity_score = ROUND(COALESCE(opportunity_score, 0) * ${PILLAR_MULTIPLIER}, 2)
               WHERE id=${topic_id} AND client_id=${client.id} AND NOT is_pillar
                 AND status IN ('pending','approved')`;
  } else if (acao === 'descartar') {
    await sql`UPDATE topics SET status='rejected', status_reason='descartado no painel'
               WHERE id=${topic_id} AND client_id=${client.id} AND status IN ('pending','approved')`;
  }
  res.statusCode = 302;
  res.setHeader('Location', '/');
  res.end();
}));
