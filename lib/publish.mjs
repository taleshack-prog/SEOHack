// DEPRECADO — mantido só para compatibilidade de import.
//
// A publicação agora passa por lib/adapters/. Este arquivo era o cliente da F8,
// que assumia que todo cliente instalaria um endpoint no próprio site — premissa
// que inviabilizava a comercialização. Ver db/migrations/002 e lib/adapters/.
export { sign, verify, publish as publishWebhook } from './adapters/webhook.mjs';
export { publish as publishBatch, getAdapter, healthCheck } from './adapters/index.mjs';
export const MAX_BATCH = 5;
