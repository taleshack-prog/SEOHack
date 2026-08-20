// Verificações de saúde.
//
// A versão anterior do health check cobrava PUBLISH_URL, PUBLISH_TOKEN e
// F8_SIGNING_SECRET de todo mundo — variáveis da F8, que deixou de existir
// quando a publicação virou adapter. Pior: só olhava se a variável tinha algum
// valor, o que não distingue chave certa de chave com um caractere trocado.
//
// Agora a lista de exigências depende do adapter do cliente, e o modo profundo
// bate de verdade nas credenciais.

/** Variáveis que cada adapter realmente precisa no ambiente. */
const ENV_BASE = ['DATABASE_URL', 'CLIENT_DOMAIN', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_API_KEY',
                  'DASHBOARD_PASSWORD', 'DASHBOARD_SECRET'];

const ENV_POR_ADAPTER = {
  // github e wordpress guardam credencial em clients.adapter_config, no banco
  github: [],
  wordpress: [],
  webhook: ['PUBLISH_URL', 'PUBLISH_TOKEN', 'F8_SIGNING_SECRET'],
};

// Search Console é opcional: o modo seed funciona sem ela. Vira exigência
// quando o blog tiver volume para o modo gsc.
const ENV_OPCIONAIS = ['GSC_CLIENT_EMAIL', 'GSC_PRIVATE_KEY', 'GSC_PROPERTY',
                       'PERPLEXITY_API_KEY', 'BREVO_API_KEY'];

export function checkEnv(adapter = 'github') {
  const exigidas = [...ENV_BASE, ...(ENV_POR_ADAPTER[adapter] || [])];
  return {
    missing: exigidas.filter((k) => !process.env[k]),
    optionalMissing: ENV_OPCIONAIS.filter((k) => !process.env[k]),
  };
}

/**
 * Chamada mínima ao provedor de LLM só para saber se a chave autentica.
 * Custa frações de centavo — 1 token de saída.
 */
export async function checkLlm() {
  const provider = process.env.LLM_PROVIDER || 'anthropic';
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!key) return { ok: false, reason: 'LLM_API_KEY ausente' };
  if (!model) return { ok: false, reason: 'LLM_MODEL ausente' };

  try {
    const { complete } = await import('./llm.mjs');
    const r = await complete({ system: 'Responda apenas: ok', prompt: 'ok',
                               maxTokens: 16, maxAttempts: 1 });
    return { ok: true, provider, model,
             ...(r.droppedParams?.length ? { droppedParams: r.droppedParams } : {}) };
  } catch (err) {
    const m = err.message || '';
    // A interpretação é um palpite; a mensagem do provedor é o fato. Mostrar só
    // o palpite já apontou "modelo não existe" quando o problema real era um
    // parâmetro depreciado — e custou uma rodada de diagnóstico. Agora vão as
    // duas, e a classificação por modelo exige o código de erro certo.
    const reason = /401|authentication_error|invalid x-api-key/i.test(m) ? 'chave rejeitada pelo provedor'
      : /404|not_found_error/i.test(m) ? `modelo "${model}" não existe ou não está disponível na sua conta`
      : /credit balance|billing|insufficient/i.test(m) ? 'sem crédito na conta do provedor'
      : /invalid_request_error/i.test(m) ? 'requisição recusada — ver mensagem do provedor abaixo'
      : 'falha ao chamar o provedor';
    return { ok: false, provider, model, reason, providerSaid: (err.raw || m).slice(0, 400) };
  }
}

/** Confere se o adapter enxerga o destino (repo, site, endpoint). */
export async function checkAdapter(client) {
  const cfg = client.adapter_config || {};
  if (!Object.keys(cfg).length) {
    return { ok: false, adapter: client.publish_adapter,
             reason: 'adapter_config vazio — o destino da publicação não foi configurado' };
  }
  try {
    const { healthCheck } = await import('./adapters/index.mjs');
    const r = await healthCheck(client);
    return { ok: true, adapter: client.publish_adapter, ...r };
  } catch (err) {
    const m = err.message || '';
    const reason = /401|403|bad credentials/i.test(m) ? 'token rejeitado pelo destino'
      : /404/i.test(m) ? 'repositório ou branch não encontrado — confira "repo" e "branch"'
      : 'falha ao acessar o destino';
    return { ok: false, adapter: client.publish_adapter, reason, targetSaid: m.slice(0, 400) };
  }
}
