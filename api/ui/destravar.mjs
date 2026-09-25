// Devolve à fila os tópicos que ficaram presos em 'writing'.
//
// O estado 'writing' é a trava contra produção duplicada: o motor marca o
// tópico antes de chamar o LLM. Quando a execução morre no meio — timeout de
// função, deploy durante a rodada, erro fora do try — a trava fica fechada
// para sempre, e a fila (que lista só 'pending' e 'approved') esconde o
// tópico. Sumiço silencioso é o pior defeito possível numa fila.
//
// O corte de 20 minutos é folgado de propósito: a geração de dois artigos
// leva de 2 a 5 minutos, e o limite da função é de 10. Nada em execução
// legítima chega perto disso.
import { requireAuth } from '../../lib/auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';

export default requireAuth(async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  const client = await getClient();

  const devolvidos = await sql`
    UPDATE topics
       SET status = 'approved', assigned_at = NULL,
           status_reason = 'produção interrompida — devolvido à fila'
     WHERE client_id = ${client.id} AND status = 'writing'
       AND assigned_at < NOW() - INTERVAL '20 minutes'
    RETURNING topic`;

  res.statusCode = 302;
  res.setHeader('Location', `/?destravados=${devolvidos.length}`);
  res.end();
});
