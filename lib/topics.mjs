// Leitura dos tópicos digitados no painel.
//
// Abastecer a fila era a única operação que ainda exigia terminal: editar um
// CSV e rodar `npm run seed`. Numa quinta à noite, com a fila vazia, isso
// significa abrir o notebook para digitar três linhas de texto.
//
// O formato aceito aqui é o que alguém escreveria à mão, não um CSV:
//
//   Como fazer o quadro de Punnett
//   * Genética da cor da pelagem em gatos: guia completo
//   Coeficiente de endogamia de Wright | 320
//   Simulador de genética online | 210 | 35
//
// O `*` no começo marca página pilar. Depois da barra vêm, em ordem, o volume
// de busca mensal e a dificuldade (0 a 100) — os dois opcionais, porque nem
// sempre se tem o número do Keyword Planner na hora.
import { opportunityScore } from './score.mjs';

export const TIPOS = ['informational', 'commercial', 'transactional', 'navigational'];

// Origem gravada em topics.source. A coluna tem CHECK (source IN
// ('seed','gsc','manual','gap')) desde a migração 001, e o valor precisa sair
// dessa lista: 'painel', que parecia mais descritivo, derrubou a tela inteira
// com 23514 depois de o formulário já estar preenchido. Constante aqui para
// que o teste possa conferir contra o próprio arquivo de migração.
export const FONTE_PAINEL = 'manual';
const LIMITE_TOPICO = 200;

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[^\d.,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {string} texto  uma linha por tópico
 * @param {{cluster?:string, tipo?:string, afinidade?:number}} padrao
 * @returns {{topicos:Array, erros:Array<string>}}
 */
export function parseTopicos(texto = '', padrao = {}) {
  const cluster = String(padrao.cluster || '').trim().toLowerCase().replace(/\s+/g, '-') || null;
  const tipo = TIPOS.includes(padrao.tipo) ? padrao.tipo : 'informational';
  const afinidade = (() => {
    const n = Number(padrao.afinidade);
    return Number.isFinite(n) && n >= 0.5 && n <= 2 ? n : 1;
  })();

  const topicos = [];
  const erros = [];
  const vistos = new Set();

  for (const cru of String(texto).split(/\r?\n/)) {
    const linha = cru.trim();
    if (!linha) continue;

    // Cabeçalho de CSV colado por engano: ignora em vez de virar tópico.
    if (/^cluster\s*,\s*topic\b/i.test(linha)) continue;

    const [primeiro, ...resto] = linha.split('|');
    let nome = primeiro.trim();
    const isPillar = nome.startsWith('*');
    if (isPillar) nome = nome.slice(1).trim();

    if (nome.length < 10) { erros.push(`"${linha}" — curto demais para ser um tópico`); continue; }
    if (nome.length > LIMITE_TOPICO) { erros.push(`"${nome.slice(0, 40)}…" — passa de ${LIMITE_TOPICO} caracteres`); continue; }

    const chave = nome.toLowerCase();
    if (vistos.has(chave)) { erros.push(`"${nome}" — repetido na lista`); continue; }
    vistos.add(chave);

    const volume = num(resto[0]);
    const dificuldade = (() => {
      const d = num(resto[1]);
      return d !== null && d <= 100 ? d : null;
    })();

    topicos.push({
      topic: nome,
      cluster,
      isPillar,
      tipo,
      volume,
      dificuldade,
      score: opportunityScore({
        impressions: volume || 0,
        position: 100,
        difficulty: dificuldade ?? 50,
        affinity: afinidade,
        isPillar,
      }),
    });
  }

  return { topicos, erros };
}
