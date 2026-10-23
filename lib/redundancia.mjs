// Quanto do texto repete o que já foi dito.
//
// 23/10/2026, primeira reescrita real (depressão endogâmica): o motor publicou
// e o resultado estava correto em tudo que era mecânico — alvo certo, URL
// preservada, seção dedicada no topo. Mas o mecanismo da homozigose aparecia
// cinco vezes: na abertura, no "Em resumo", no "Em outras palavras", na seção
// "em uma frase" e na seção própria sobre homozigose. O FAQ repetia o corpo
// inteiro.
//
// Isso é o efeito previsível de mandar "responda ao alvo de forma direta e
// cedo, numa seção dedicada se ainda não houver": o modelo acrescenta a seção
// em vez de reconhecer que a resposta já estava lá. A regra 5 do prompt ("não
// encha linguiça") não segura, porque do ponto de vista dele cada parágrafo
// novo responde a uma instrução diferente.
//
// Não dá para pedir ao modelo que avalie a própria repetição — seria outra
// chamada e outro palpite. Isto aqui é mecânico: frases que dizem a mesma
// coisa, medidas por sobreposição de palavras de conteúdo.
const SEM_VALOR = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem', 'que', 'e', 'ou',
  'se', 'ao', 'aos', 'à', 'às', 'é', 'são', 'ser', 'foi', 'era', 'está', 'estão',
  'como', 'mais', 'menos', 'muito', 'já', 'também', 'isso', 'esse', 'essa', 'este',
  'esta', 'seu', 'sua', 'seus', 'suas', 'pelo', 'pela', 'entre', 'quando', 'onde',
  'não', 'sim', 'mas', 'porque', 'então', 'cada', 'todo', 'toda', 'todos', 'todas',
]);

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Mesmo corte de lib/consultas.mjs: cinco letras aproximam flexão sem precisar
// de dicionário. "aumento" e "aumenta" viram a mesma coisa, que é o ponto —
// parafrasear é justamente trocar a flexão e a ordem.
const raiz = (p) => p.slice(0, 5);

/** Raízes das palavras que carregam significado, sem acento e sem ligação. */
export function conteudo(frase = '') {
  return semAcento(String(frase).toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 2 && !SEM_VALOR.has(p))
    .map(raiz);
}

/**
 * Frases do corpo, já sem o que não é prosa.
 *
 * Título de seção, item de lista, tabela e bloco de código ficam de fora: lista
 * que resume o texto acima é recurso legítimo, não repetição — o que pesa é a
 * mesma ideia reescrita como parágrafo em outro lugar.
 */
export function frases(markdown = '', { minPalavras = 8 } = {}) {
  const prosa = String(markdown)
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|\||>)/.test(l))
    .join('\n');

  return prosa
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((f) => f.replace(/\s+/g, ' ').trim())
    .filter((f) => conteudo(f).length >= minPalavras);
}

/**
 * Sobreposição de conteúdo entre duas frases, de 0 a 1.
 *
 * Divide pelo MENOR dos dois conjuntos, não pela união: a frase curta que
 * repete o miolo de uma longa é exatamente o caso a pegar, e por união ela
 * ficaria sempre abaixo de qualquer limiar útil.
 */
export function semelhanca(a = '', b = '') {
  const x = new Set(conteudo(a));
  const y = new Set(conteudo(b));
  if (x.size < MIN_COMUNS || y.size < MIN_COMUNS) return 0;
  let comuns = 0;
  for (const p of x) if (y.has(p)) comuns++;
  // Duas frases do mesmo assunto compartilham vocabulário sem dizer a mesma
  // coisa. Exigir um piso absoluto evita acusar "gato" e "gato" de repetição.
  if (comuns < MIN_COMUNS) return 0;
  return comuns / Math.min(x.size, y.size);
}

const MIN_COMUNS = 5;
// 0,5 com piso de 5 palavras em comum: o par real que escapou da reescrita de
// 23/10 marca 0,54, e frases distintas do mesmo assunto não chegam ao piso.
export const LIMIAR = 0.5;

/**
 * Pares de frases que dizem a mesma coisa.
 * @returns {Array<{a:string,b:string,semelhanca:number}>}
 */
export function trechosRepetidos(markdown = '', { limiar = LIMIAR } = {}) {
  const lista = frases(markdown);
  const achados = [];
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      const s = semelhanca(lista[i], lista[j]);
      if (s >= limiar) achados.push({ a: lista[i], b: lista[j], semelhanca: Number(s.toFixed(2)) });
    }
  }
  return achados.sort((x, y) => y.semelhanca - x.semelhanca);
}

/**
 * Fração das frases que repetem alguma anterior — 0 a 1.
 *
 * É comparável entre versões do mesmo artigo, que é o uso: texto novo com grau
 * maior que o antigo encheu linguiça, e isso o motor consegue recusar sozinho.
 */
export function grauDeRedundancia(markdown = '', { limiar = LIMIAR } = {}) {
  const lista = frases(markdown);
  if (lista.length < 2) return 0;
  const repetidas = new Set();
  for (let i = 0; i < lista.length; i++) {
    for (let j = i + 1; j < lista.length; j++) {
      if (semelhanca(lista[i], lista[j]) >= limiar) repetidas.add(j);
    }
  }
  return repetidas.size / lista.length;
}
