// "Zero" e "não medimos" são coisas diferentes.
//
// Caso real (20/10/2026): a Perplexity desligou a Sonar Chat Completions em
// 27/09. As dez medições de citação do dia voltaram 403, o cron registrou no
// console e seguiu, e o painel mostrou "0 citações em IA" — exatamente o que
// ele mostraria se a medição tivesse acontecido e não achado nada. Levou abrir
// o log da Vercel para descobrir a diferença, e no meio do caminho eu afirmei
// que aquele zero era o resultado esperado.
//
// A tela precisa dizer qual dos dois zeros ela está mostrando. Isto lê a última
// execução do estágio em pipeline_runs e devolve a frase.

const data = (d) => new Date(d).toLocaleDateString('pt-BR');

/**
 * @param {object|null} run  última linha de pipeline_runs do estágio
 * @returns {{texto:string, ruim:boolean, motivo:string|null}}
 *          `ruim` = o número ao lado não é confiável.
 */
export function estadoDaMedicao(run) {
  if (!run) return { texto: 'nunca medido', ruim: true, motivo: null };

  const quando = data(run.finished_at || run.started_at);
  const tentou = Number(run.items_processed || 0);
  const mediu = Number(run.items_succeeded || 0);
  const motivo = run.error_message || null;

  if (run.status === 'running') {
    return { texto: `medindo agora (iniciado em ${quando})`, ruim: false, motivo: null };
  }
  if (!tentou) {
    return { texto: `nada para medir em ${quando}`, ruim: false, motivo };
  }
  if (!mediu) {
    // O caso que motivou o módulo: tentou dez, mediu zero, mostrou zero.
    return { texto: `falhou em ${quando} — nenhuma das ${tentou} perguntas foi medida`,
             ruim: true, motivo };
  }
  if (mediu < tentou) {
    return { texto: `parcial em ${quando}: ${mediu} de ${tentou} perguntas`, ruim: true, motivo };
  }
  return { texto: `medido em ${quando}, ${tentou} ${tentou === 1 ? 'pergunta' : 'perguntas'}`,
           ruim: false, motivo };
}
