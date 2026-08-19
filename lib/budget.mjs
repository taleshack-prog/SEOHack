// Token Budgeting (PRD §38). O v4 exigia "orçamento mensal definido no Neon"
// mas não havia tabela onde guardar orçamento nem consumo (defeito D9).
import { sql } from './db.mjs';

// USD por 1M de tokens. Ajustar quando trocar de modelo — é a única coisa aqui
// que envelhece. Se o modelo não estiver na tabela, o custo é registrado como 0
// e um aviso vai para o log: melhor subestimar visivelmente do que travar o
// pipeline por falta de uma linha de preço.
const PRICES = {
  'claude-opus-4-5':   { in: 5.00, out: 25.00 },
  'claude-sonnet-4-5': { in: 3.00, out: 15.00 },
  'claude-haiku-4-5':  { in: 1.00, out: 5.00 },
  'gpt-5':             { in: 1.25, out: 10.00 },
  'gpt-5-mini':        { in: 0.25, out: 2.00 },
};

export function estimateCost(model, inputTokens, outputTokens) {
  const p = PRICES[model];
  if (!p) {
    console.warn(`[budget] preço desconhecido para "${model}" — registrando 0`);
    return 0;
  }
  return (inputTokens / 1e6) * p.in + (outputTokens / 1e6) * p.out;
}

/** Lança se o orçamento do mês corrente já estourou. Chamar ANTES de gerar. */
export async function assertBudget(clientId) {
  const [b] = await sql`SELECT * FROM v_budget_status WHERE client_id = ${clientId}`;
  if (!b) throw new Error('Orçamento não encontrado para o cliente');
  if (Number(b.remaining_usd) <= 0) {
    const e = new Error(
      `Orçamento mensal esgotado: US$ ${b.spent_usd} de ${b.monthly_budget_usd}`);
    e.statusCode = 402;
    throw e;
  }
  return b;
}

export async function recordUsage(clientId, { articleId = null, stage, provider, model, inputTokens, outputTokens }) {
  const cost = estimateCost(model, inputTokens, outputTokens);
  await sql`
    INSERT INTO llm_usage (client_id, article_id, stage, provider, model,
                           input_tokens, output_tokens, cost_usd)
    VALUES (${clientId}, ${articleId}, ${stage}, ${provider}, ${model},
            ${inputTokens}, ${outputTokens}, ${cost})`;
  return cost;
}
