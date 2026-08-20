// Marcadores de nota do operador (PRD §8.2).
//
// A IA escreve `[NOTA PARA O OPERADOR]: <o que falta>` onde o texto exige
// experiência vivida, que ela não tem. Este módulo transforma esses marcadores
// em lacunas editáveis e depois costura de volta o que o operador escreveu.
export const MARKER = '[NOTA PARA O OPERADOR]';
const LINE = /^.*\[NOTA PARA O OPERADOR\]\s*:?\s*(.*)$/gm;

/** @returns {Array<{index:number, instruction:string, raw:string}>} */
export function parseNotes(markdown = '') {
  const out = [];
  LINE.lastIndex = 0;
  let m;
  while ((m = LINE.exec(markdown))) {
    out.push({
      index: out.length,
      instruction: (m[1] || '').trim() || 'Acrescente 2 ou 3 linhas de experiência real.',
      raw: m[0],
    });
  }
  return out;
}

/**
 * Substitui cada marcador pelo texto do operador, na ordem.
 * Texto vazio remove a linha inteira — permite descartar uma nota que não faz
 * sentido sem deixar rastro no artigo publicado.
 */
export function applyNotes(markdown, texts = []) {
  const notes = parseNotes(markdown);
  let out = markdown;
  notes.forEach((n, i) => {
    const written = (texts[i] || '').trim();
    out = out.replace(n.raw, written);
  });
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Divide o markdown em blocos de texto e lacunas, para renderizar a revisão. */
export function splitForReview(markdown = '') {
  const notes = parseNotes(markdown);
  if (!notes.length) return [{ type: 'text', content: markdown }];
  const parts = [];
  let rest = markdown;
  for (const n of notes) {
    const at = rest.indexOf(n.raw);
    parts.push({ type: 'text', content: rest.slice(0, at) });
    parts.push({ type: 'gap', index: n.index, instruction: n.instruction });
    rest = rest.slice(at + n.raw.length);
  }
  parts.push({ type: 'text', content: rest });
  return parts.filter((p) => p.type === 'gap' || p.content.trim());
}
