// Disparo de geração pelo painel.
//
// A geração leva de 2 a 5 minutos — tempo demais para segurar uma requisição de
// navegador. O `waitUntil` da Vercel resolve: a resposta sai na hora e a função
// continua trabalhando em segundo plano. Sem isso, o runtime mataria o processo
// assim que a resposta fosse enviada, e o artigo ficaria pela metade.
//
// O acompanhamento é feito pela tabela pipeline_runs, que o runStage já
// alimenta. A fila lê de lá — não há estado em memória para se perder.
import { waitUntil } from '@vercel/functions';
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { getClient, sql } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { generateBatch } from '../../lib/content-engine.mjs';

export default requireAuth(async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const { topic_id } = await readBody(req);
  const client = await getClient();

  // Sem tópico aprovado não há o que gerar — e dizer "produção iniciada, leva
  // de 2 a 5 minutos" nesse caso faz o operador esperar por algo que terminou
  // em milissegundos sem fazer nada. Aconteceu: ficou um dia inteiro aguardando.
  const aprovados = topic_id
    ? await sql`SELECT id FROM topics WHERE client_id = ${client.id}
                  AND id = ${topic_id} AND status = 'approved'`
    : await sql`SELECT id FROM topics WHERE client_id = ${client.id}
                  AND status = 'approved' LIMIT 1`;

  if (!aprovados.length) {
    res.statusCode = 302;
    res.setHeader('Location', topic_id ? '/?aviso=topico-indisponivel' : '/?aviso=fila-vazia');
    return res.end();
  }

  // Uma execução por vez. Duas em paralelo competiriam pelos mesmos tópicos e
  // gastariam orçamento em duplicidade.
  const [rodando] = await sql`
    SELECT id FROM pipeline_runs
     WHERE client_id = ${client.id} AND stage = 'content' AND status = 'running'
       AND started_at > NOW() - INTERVAL '15 minutes'`;

  if (!rodando) {
    waitUntil(
      runStage(client.id, 'content',
        () => generateBatch(client, { topicIds: topic_id ? [topic_id] : [], limite: topic_id ? 1 : undefined }))
        .catch((err) => console.error('[generate]', err.stack || err.message)));
  }

  res.statusCode = 302;
  res.setHeader('Location', rodando ? '/?aviso=ja-rodando' : '/?iniciado=1');
  res.end();
});
