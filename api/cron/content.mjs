// CONTENT ENGINE — gatilho por cron.
//
// A lógica vive em lib/content-engine.mjs, compartilhada com o botão do painel.
// Este arquivo só autentica o cron, instrumenta a execução e chama o módulo.
import { cronHandler } from '../../lib/cron-auth.mjs';
import { getClient } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { generateBatch } from '../../lib/content-engine.mjs';

export default cronHandler(async () => {
  const client = await getClient();
  return runStage(client.id, 'content', () => generateBatch(client));
});
