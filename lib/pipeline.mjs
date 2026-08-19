// Registro de execução em pipeline_runs. O correlation_id amarra os estágios de
// um mesmo ciclo, coisa que o v4 não tinha e que torna impossível responder
// "qual research gerou este artigo?".
import { randomUUID } from 'node:crypto';
import { sql } from './db.mjs';

export async function startRun(clientId, stage, correlationId = randomUUID()) {
  const [run] = await sql`
    INSERT INTO pipeline_runs (client_id, correlation_id, stage, status)
    VALUES (${clientId}, ${correlationId}, ${stage}, 'running')
    RETURNING id, correlation_id`;
  return { id: run.id, correlationId: run.correlation_id, stage };
}

export async function finishRun(run, { processed = 0, succeeded = 0, error = null }) {
  const status = error ? 'failed'
    : processed === 0 ? 'skipped'
    : succeeded < processed ? 'partial'
    : 'success';
  await sql`
    UPDATE pipeline_runs
       SET status = ${status}, items_processed = ${processed},
           items_succeeded = ${succeeded}, error_message = ${error},
           finished_at = NOW()
     WHERE id = ${run.id}`;
  return status;
}

/** Executa um estágio já instrumentado. Nunca deixa run pendurada em 'running'. */
export async function runStage(clientId, stage, fn) {
  const run = await startRun(clientId, stage);
  try {
    const r = (await fn(run)) || {};
    const status = await finishRun(run, r);
    return { correlationId: run.correlationId, status, ...r };
  } catch (err) {
    await finishRun(run, { error: err.message });
    throw err;
  }
}
