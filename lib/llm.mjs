// Wrapper de LLM agnóstico de provedor.
//
// Corrige o defeito B10 da auditoria: o Plano v4 fixava frequency_penalty e
// presence_penalty na configuração do Content Engine, mas esses parâmetros são
// específicos da API da OpenAI — a da Anthropic os rejeita. Um objeto único de
// config quebraria na primeira troca de LLM_PROVIDER. Aqui cada provedor tem
// seu próprio mapeamento de parâmetros, corpo e parser de resposta.

const PROVIDERS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    }),
    body: ({ model, system, prompt, maxTokens, temperature }) => ({
      model,
      max_tokens: maxTokens,
      // `temperature` só entra se pedido explicitamente. Os modelos com
      // pensamento adaptativo depreciaram o parâmetro e devolvem 400 se ele
      // vier. A precisão factual que o PRD §6.2 buscava com temperature 0.3
      // passa a ser responsabilidade do prompt — que já proíbe estatística
      // sem fonte e experiência fabricada.
      ...(temperature == null ? {} : { temperature }),
      system,
      messages: [{ role: 'user', content: prompt }],
      // frequency_penalty / presence_penalty NÃO existem nesta API.
    }),
    parse: (d) => ({
      text: d.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      inputTokens: d.usage.input_tokens,
      outputTokens: d.usage.output_tokens,
      stopReason: d.stop_reason,          // 'max_tokens' = resposta cortada
    }),
  },

  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    }),
    body: ({ model, system, prompt, maxTokens, temperature }) => ({
      model,
      max_completion_tokens: maxTokens,
      temperature,
      frequency_penalty: 0.3,
      presence_penalty: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
    parse: (d) => ({
      text: d.choices[0].message.content,
      inputTokens: d.usage.prompt_tokens,
      outputTokens: d.usage.completion_tokens,
      stopReason: d.choices[0].finish_reason === 'length' ? 'max_tokens' : d.choices[0].finish_reason,
    }),
  },
};

const RETRYABLE = new Set([429, 500, 502, 503, 529]);

/**
 * @returns {Promise<{text:string,inputTokens:number,outputTokens:number,provider:string,model:string}>}
 */
export async function complete({
  system,
  prompt,
  model = process.env.LLM_MODEL,
  provider = process.env.LLM_PROVIDER || 'anthropic',
  maxTokens = 8000,     // v4 usava 4000, insuficiente para pillar page em pt-BR
  temperature = null,   // ver nota no body do provedor
  maxAttempts = 4,
} = {}) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Provedor de LLM desconhecido: ${provider}`);
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY ausente');

  // Um provedor pode depreciar um parâmetro a qualquer momento — foi o que
  // aconteceu com `temperature`. Em vez de quebrar o pipeline inteiro, o campo
  // recusado é removido e a chamada refeita uma vez.
  const UNSUPPORTED = /[`'\"]?([a-z_]+)[`'\"]? is (?:deprecated|not supported|unsupported)/i;
  const removidos = [];
  let corpo = p.body({ model, system, prompt, maxTokens, temperature });

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: p.headers(key),
      body: JSON.stringify(corpo),
    });

    if (res.ok) {
      const parsed = p.parse(await res.json());
      return { ...parsed, provider, model, droppedParams: removidos };
    }

    const detail = await res.text().catch(() => '');
    lastErr = new Error(`LLM ${provider} ${res.status}: ${detail.slice(0, 300)}`);
    lastErr.status = res.status;
    lastErr.raw = detail;

    // 400 apontando um campo não suportado: remove o campo e tenta de novo.
    const campo = res.status === 400 && detail.match(UNSUPPORTED)?.[1];
    if (campo && campo in corpo && !removidos.includes(campo)) {
      console.warn(`[llm] "${campo}" recusado por ${model} — removendo e repetindo`);
      delete corpo[campo];
      removidos.push(campo);
      continue;
    }

    if (!RETRYABLE.has(res.status) || attempt === maxAttempts) throw lastErr;

    // Backoff exponencial com jitter. Respeita retry-after quando vier.
    const hinted = Number(res.headers.get('retry-after')) * 1000;
    const wait = Number.isFinite(hinted) && hinted > 0
      ? hinted
      : 2 ** attempt * 1000 + Math.random() * 500;
    await new Promise((r) => setTimeout(r, wait));
  }
  throw lastErr;
}

/**
 * Extrai o primeiro bloco JSON de uma resposta, tolerando cercas de markdown.
 *
 * `stopReason` entra aqui porque o sintoma de resposta cortada por limite de
 * tokens é um JSON truncado — e "Expected ',' or ']' at position 3333" não diz
 * nada sobre a causa. Custou um artigo para descobrir isso.
 */
export function parseJson(text, stopReason = null) {
  if (stopReason === 'max_tokens') {
    throw new Error(
      'A resposta foi cortada pelo limite de tokens antes de terminar o JSON. ' +
      'Aumente maxTokens para este estágio.');
  }
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Resposta do LLM não contém JSON');
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    throw new Error(`JSON inválido do LLM (${err.message}). Trecho final: ...${cleaned.slice(-120)}`);
  }
}
