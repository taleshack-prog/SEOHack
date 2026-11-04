// Artigo SOBRE um produto da casa é outro gênero.
//
// 04/11/2026: o motor escreveu um guia do Posthink com papéis de usuário,
// fluxo de aprovação, histórico de versões, integração via API com CMS e
// estrutura de planos. Nada disso existe — o Posthink publica post no
// LinkedIn. O modelo recebeu uma linha de descrição e uma instrução de
// escrever 2.000 palavras, e preencheu o resto com o que um produto desse
// nome costuma ter.
//
// Pior que a invenção isolada: ele abriu marcadores pedindo a lista real de
// recursos e de planos E escreveu, logo acima, uma descrição genérica deles.
// Quem lê o rascunho vê texto plausível e some com a pergunta.
//
// A diferença entre este caso e os outros que o motor acerta é a fonte. Para
// um artigo de genética, a fonte é o mundo, que o modelo conhece. Para um
// artigo sobre o produto do cliente, a única fonte é o cliente — e uma linha
// de cadastro não sustenta um guia.

/** Descrição curta demais para sustentar um artigo sobre o próprio produto. */
export const MIN_DESCRICAO = 280;

const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * O produto da casa sobre o qual este tópico fala — não o que ele apenas cita.
 *
 * "guia do Posthink", "o que é o Posthink", "Posthink vale a pena": o produto
 * é o assunto. "automação de LinkedIn sem violar os termos": o produto é
 * destino de link, e o assunto é do mundo.
 */
export function produtoDoTema(topico = '', produtos = []) {
  const t = semAcento(topico);
  return (produtos || []).find((p) => {
    const nome = semAcento(p?.name || '');
    if (nome.length < 4) return false;
    return new RegExp(`(?<![\\w-])${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)
      .test(t);
  }) || null;
}

/**
 * Por que este tópico não pode ser escrito agora — ou null, se pode.
 *
 * @returns {{produto: string, motivo: string} | null}
 */
export function faltaMaterial(topico = '', produtos = [], { minDescricao = MIN_DESCRICAO } = {}) {
  const p = produtoDoTema(topico, produtos);
  if (!p) return null;

  const about = String(p.about || '').trim();
  if (about.length >= minDescricao) return null;

  return {
    produto: p.name,
    motivo: `Este tópico é sobre o ${p.name}, e a única fonte sobre o ${p.name} é você. `
      + `O cadastro tem ${about.length} caractere${about.length === 1 ? '' : 's'} de descrição, `
      + `e abaixo de ${minDescricao} o modelo preenche o resto inventando — foi assim que saiu `
      + 'um guia com planos, papéis de usuário e integrações que não existem. '
      + `Descreva em Produtos o que o ${p.name} faz, para quem, o que ele tem hoje e o que `
      + 'ele não faz, e aprove o tópico de novo.',
  };
}
