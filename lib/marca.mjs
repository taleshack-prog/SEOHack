// O nome do produto escrito como o dono escreve.
//
// 04/11/2026: o artigo do Posthink saiu com "PostHink" em todo o texto — H
// maiúsculo no meio, que lê como outra palavra. Não é erro de validação: o
// texto está correto em tudo que a validação mede. É o nome da marca, e nome
// de marca não é escolha de estilo do modelo.
//
// Correção mecânica, não nova chamada ao modelo: o nome registrado é a fonte,
// qualquer grafia que só difira por maiúsculas vira a registrada.
//
// O que fica de fora da troca, porque ali a grafia tem outro dono:
//   - bloco de código e código inline, onde o nome pode ser um identificador;
//   - alvo de link e imagem, onde /posthink é caminho, não marca;
//   - o frontmatter, que não é prosa.

const ESCAPAR = /[.*+?^${}()|[\]\\]/g;
const escapar = (s) => s.replace(ESCAPAR, '\\$&');

// Nome curto demais vira risco: um produto chamado "Post" reescreveria
// "post", "posts" e metade do texto.
export const MIN_NOME = 4;

/** As partes do texto onde a grafia da marca é responsabilidade nossa. */
function fatiar(markdown) {
  const protegido = [
    /```[\s\S]*?```/g,       // bloco de código
    /`[^`\n]*`/g,            // código inline
    /\]\([^)]*\)/g,          // alvo de link e de imagem
    /^---\n[\s\S]*?\n---/,   // frontmatter
  ];
  const faixas = [];
  for (const re of protegido) {
    for (const m of markdown.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
      faixas.push([m.index, m.index + m[0].length]);
    }
  }
  faixas.sort((a, b) => a[0] - b[0]);

  const partes = [];
  let i = 0;
  for (const [ini, fim] of faixas) {
    if (ini < i) continue; // sobreposto; já coberto
    if (ini > i) partes.push({ texto: markdown.slice(i, ini), livre: true });
    partes.push({ texto: markdown.slice(ini, fim), livre: false });
    i = fim;
  }
  if (i < markdown.length) partes.push({ texto: markdown.slice(i), livre: true });
  return partes;
}

/**
 * Reescreve o nome de cada produto com a grafia registrada.
 *
 * @param {string} markdown
 * @param {Array<{name:string}>} produtos
 * @returns {{markdown: string, trocas: Array<{de:string,para:string,vezes:number}>}}
 */
export function corrigirMarcas(markdown = '', produtos = []) {
  const nomes = (produtos || [])
    .map((p) => String(p?.name || '').trim())
    .filter((n) => n.length >= MIN_NOME);

  if (!nomes.length || !markdown) return { markdown, trocas: [] };

  const partes = fatiar(markdown);
  const contagem = new Map();

  for (const parte of partes) {
    if (!parte.livre) continue;
    for (const nome of nomes) {
      const re = new RegExp(`(?<![\\w-])${escapar(nome)}(?![\\w-])`, 'gi');
      parte.texto = parte.texto.replace(re, (achado) => {
        if (achado === nome) return achado;
        const chave = `${achado}→${nome}`;
        contagem.set(chave, (contagem.get(chave) || 0) + 1);
        return nome;
      });
    }
  }

  const trocas = [...contagem].map(([chave, vezes]) => {
    const [de, para] = chave.split('→');
    return { de, para, vezes };
  });

  return { markdown: partes.map((p) => p.texto).join(''), trocas };
}

/** Uma linha para o log, ou vazio quando não houve troca. */
export const resumoDasTrocas = (trocas = []) => (trocas.length
  ? trocas.map((t) => `"${t.de}" → "${t.para}" (${t.vezes}x)`).join('; ')
  : '');
