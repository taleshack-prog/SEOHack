// A pauta que o motor escreve sozinho.
//
// 06/11/2026. O cron de pesquisa rodava toda segunda e não criava tópico
// nenhum: ele só sai do "modo seed" quando o /blog passa de 200 impressões por
// DIA, e o site está em 1,8. O portão nunca ia abrir, então o abastecimento da
// fila era 100% manual — o operador colando tópicos quando lembrasse. O motor
// parecia parado; na verdade estava sem combustível.
//
// Esta é a entrada que faltava. Uma chamada por semana, só quando a fila está
// baixa.
//
// A regra que manda aqui: SÓ GERA TÓPICO QUE O MOTOR CONSEGUE TERMINAR.
//
// Isso não é detalhe de qualidade, é o que decide se o pipeline anda. Artigo
// com lacuna fica segurado esperando o operador, que é exatamente o que não
// queremos. E lacuna aparece quando a fonte do fato é o dono do produto, não o
// mundo: "quais os planos do Posthink" nenhum modelo responde; "como funciona
// o gene MC1R" qualquer um responde. Por isso a pauta sai do CAMPO em volta de
// cada produto, não do produto.
//
// A prova está no próprio blog: os dez artigos do cluster de genética saíram
// sem segurar nenhum, e o único guia de produto que o motor tentou escrever
// virou ficção sobre papéis de usuário e planos que não existem.
import { complete, parseJson } from './llm.mjs';
import { opportunityScore } from './score.mjs';
import { TIPOS } from './topics.mjs';
import { sondarDemanda } from './demanda.mjs';

export const ALVO_DA_FILA = 8;     // para onde a fila é reabastecida
export const MAX_POR_EXECUCAO = 6; // teto por semana, para a fila não inchar
// Sobram candidatos de propósito: a sonda de demanda reprova boa parte deles,
// e gerar 14 custa quase o mesmo que gerar 6 na mesma chamada.
export const CANDIDATOS = 14;

const slug = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '-');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** O que já está na fila ou publicado, para não repetir. */
export function jaExiste(candidato, existentes = []) {
  const c = norm(candidato);
  if (!c) return true;
  return existentes.some((e) => {
    const n = norm(e);
    return n === c || (n.length > 12 && c.length > 12 && (n.includes(c) || c.includes(n)));
  });
}

export function montarPrompt({ produtos = [], clusters = [], existentes = [], quantos }) {
  const catalogo = produtos.length
    ? produtos.map((p) => `- ${p.name} (cluster "${p.clusters?.[0] || 'sem cluster'}")`
        + `: ${p.about || 'sem descrição'}`).join('\n')
    : '(nenhum produto cadastrado)';

  const mapa = clusters.length
    ? clusters.map((c) => `- "${c.cluster}": ${c.artigos} artigo(s). Exemplos: `
        + c.exemplos.slice(0, 4).map((t) => `"${t}"`).join(', ')).join('\n')
    : '(nenhum artigo publicado ainda)';

  return `Você é o editor de pauta de um blog técnico. Proponha ${quantos} temas novos.

## Produtos da casa
${catalogo}

## Clusters já existentes no blog
${mapa}

## O que já está escrito ou na fila — NÃO repita nem reformule
${existentes.slice(0, 60).map((t) => `- ${t}`).join('\n') || '(nada ainda)'}

## A regra que decide tudo
Cada tema precisa ser respondível por quem conhece a ÁREA, sem conhecer os
produtos da casa por dentro. Escreva sobre o campo em volta do produto, nunca
sobre o produto.

PROIBIDO propor tema que exija saber:
- recursos, telas, planos, preços, limites ou integrações de um produto da casa;
- qualquer coisa que comece com "guia do <produto>", "como usar o <produto>",
  "<produto> vale a pena", "<produto> vs concorrente".
Esses temas dependem de informação que só o dono tem, e o artigo trava.

BOM: a dúvida real de quem tem o problema que o produto resolve, respondida
com conhecimento público da área — conceito, cálculo, comparação técnica,
erro comum, procedimento. Quem lê isso é exatamente quem precisa do produto,
e o link para ele entra naturalmente no meio do texto.

## Prefira termo com gente, não termo sem ninguém
Este blog tem 29 artigos, 21 deles na primeira página do Google, e recebe
quatro cliques por mês. O problema não é ranquear, é escolher busca que
alguém faz. Termo ultraespecífico é fácil de ganhar e não traz ninguém.

Então proponha a busca COMUM, a que muita gente já escreveu a respeito —
mesmo que pareça disputada. É melhor chegar em quinto numa busca que mil
pessoas fazem do que em primeiro numa que três fazem.

Evite: termo que só um especialista digitaria, nome de gene ou de protocolo
sem contexto, sigla solta, pergunta que ninguém formula desse jeito.
Prefira: a forma como uma pessoa comum digita a dúvida.

## Formato
Devolva SÓ este objeto JSON, sem cercas de markdown:
{ "temas": [
  {
    "topico": "a busca como a pessoa digitaria, em minúsculas, 3 a 10 palavras",
    "cluster": "um dos clusters existentes, ou um novo em minúsculas-com-hífen",
    "tipo": "informational | commercial | transactional | navigational",
    "dificuldade": 0-100,
    "afinidade": 0.5-2,
    "porque": "no máximo 12 palavras: que dúvida resolve"
  }
] }

"dificuldade": seu palpite de quão disputado o termo é (0 a 100). É só reserva
— a dificuldade real é medida na SERP depois, e o seu número só vale se a
medição falhar.
"afinidade": 2 quando quem busca isso é candidato direto a usar um produto da
casa; 1 quando é do tema mas não compra; 0.5 quando é curiosidade solta.`;
}

/**
 * Valida e normaliza o que o modelo devolveu.
 *
 * Aceita `{temas:[...]}` e também um array solto. O pedido é pelo objeto
 * porque o parseJson compartilhado recorta de `{` até `}`: com um array no
 * topo ele devolvia o PRIMEIRO item como se fosse a resposta inteira, e a
 * pauta sumia sem erro nenhum — zero aceitos, zero recusados, cron verde.
 */
export function normalizarPauta(bruto, { existentes = [], limite = MAX_POR_EXECUCAO } = {}) {
  const lista = Array.isArray(bruto) ? bruto
    : (Array.isArray(bruto?.temas) ? bruto.temas
      : (Array.isArray(bruto?.topicos) ? bruto.topicos : []));
  const aceitos = [];
  const recusados = [];
  const vistos = [...existentes];

  for (const item of lista) {
    const topico = String(item?.topico || '').trim().toLowerCase();

    if (topico.split(/\s+/).length < 3 || topico.length > 200) {
      recusados.push({ topico, motivo: 'tamanho fora do aceitável' });
      continue;
    }
    if (jaExiste(topico, vistos)) {
      recusados.push({ topico, motivo: 'já está na fila ou publicado' });
      continue;
    }

    const dificuldade = Number(item?.dificuldade);
    const afinidade = Number(item?.afinidade);

    aceitos.push({
      topico,
      cluster: slug(item?.cluster) || null,
      tipo: TIPOS.includes(item?.tipo) ? item.tipo : 'informational',
      dificuldade: Number.isFinite(dificuldade) && dificuldade >= 0 && dificuldade <= 100
        ? dificuldade : 50,
      afinidade: Number.isFinite(afinidade) && afinidade >= 0.5 && afinidade <= 2
        ? afinidade : 1,
      porque: String(item?.porque || '').trim().slice(0, 300),
      // Score provisório, com o palpite do modelo. Quem sonda a SERP
      // recalcula com a dificuldade medida — ver pontuarComSinais.
      score: opportunityScore({
        impressions: 0,
        position: 100,
        difficulty: Number.isFinite(dificuldade) ? dificuldade : 50,
        affinity: Number.isFinite(afinidade) ? afinidade : 1,
      }),
    });
    vistos.push(topico);
    if (aceitos.length >= limite) break;
  }

  return { aceitos: aceitos.sort((a, b) => b.score - a.score), recusados };
}

/**
 * Recalcula o score com o que a SERP mostrou.
 *
 * `search_volume` continua ZERO e assim é gravado: a Perplexity devolve a
 * página de resultados, não volume de busca, e inventar um número aqui o
 * transformaria em "volume" na tela de tópicos dois cliques adiante. O que a
 * evidência faz é entrar no score, que já é um número de ordenação e não uma
 * medida do mundo.
 */
export function pontuarComSinais(t) {
  if (!t.sinais) return t;
  const base = opportunityScore({
    impressions: 0,
    position: 100,
    difficulty: t.sinais.dificuldade,
    affinity: t.afinidade,
  });
  // Evidência de 0,3 (o piso de aprovação) a 1,0 multiplica de 1,0 a 1,7:
  // entre dois termos igualmente difíceis, ganha aquele para o qual mais
  // gente já escreveu.
  return { ...t, score: Number((base * (1 + (t.sinais.evidencia - 0.3))).toFixed(2)) };
}

/**
 * Gera a pauta: uma chamada ao modelo e, quando há busca disponível, uma
 * sondagem da SERP por candidato.
 */
export async function gerarPauta(
  { produtos, clusters, existentes, quantos = MAX_POR_EXECUCAO },
  { clientId, completeImpl = complete, buscarImpl = null } = {},
) {
  const r = await completeImpl({
    system: 'Você responde apenas com JSON válido, sem comentários e sem cercas de markdown. '
      + 'Comece a resposta com { e termine com }. Nenhuma palavra antes ou depois.',
    prompt: montarPrompt({ produtos, clusters, existentes, quantos: CANDIDATOS }),
    // 10/11/2026: com 2000 a resposta de 14 temas vinha cortada e o parseJson
    // reclamava de "não contém JSON", que é a mensagem para falta de chave e
    // não para resposta truncada. Catorze temas com justificativa passam
    // folgado de 2000 tokens.
    maxTokens: 6000,
  });

  let bruto;
  try {
    // O stopReason faz o parseJson distinguir "veio errado" de "foi cortado".
    bruto = parseJson(r.text, r.stopReason);
  } catch (err) {
    // Pauta malformada não derruba o cron: a fila só não é abastecida nesta
    // semana. Mas o motivo precisa vir junto — "resposta ilegível" sozinho não
    // diz se o modelo recusou, divagou ou foi cortado, e sem isso o conserto
    // vira adivinhação, que foi o que aconteceu aqui.
    const amostra = String(r.text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    return {
      aceitos: [],
      recusados: [],
      erro: `resposta do modelo ilegível: ${err.message}`
        + ` | stop_reason=${r.stopReason || '?'} | ${r.text ? `começo: "${amostra}…"` : 'texto vazio'}`,
      uso: r,
    };
  }

  const { aceitos, recusados } = normalizarPauta(bruto, { existentes, limite: CANDIDATOS });

  // Sem busca configurada o motor continua funcionando, só às cegas — era o
  // comportamento até 06/11, e é o que produziu 21 artigos no Top 10 com
  // quatro cliques no mês.
  if (!buscarImpl) {
    return { aceitos: aceitos.slice(0, quantos), recusados, uso: r, clientId, sondado: false };
  }

  const sonda = await sondarDemanda(aceitos, { buscarImpl, teto: CANDIDATOS });

  const pontuados = sonda.aprovados
    .map(pontuarComSinais)
    .sort((a, b) => b.score - a.score)
    .slice(0, quantos);

  return {
    aceitos: pontuados,
    recusados: [...recusados, ...sonda.reprovados],
    uso: r,
    clientId,
    sondado: true,
    sondados: sonda.sondados,
  };
}
