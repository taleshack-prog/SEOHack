// Verificação de APIs em blocos de código.
//
// O caso que originou isto: um artigo sobre Vercel trazia `caches.default`,
// que é API do Cloudflare Workers e não existe no Edge Runtime da Vercel. O
// código lança TypeError na primeira execução.
//
// A confusão é compreensível — os dois rodam em isolates do V8 e são descritos
// em termos parecidos — e é justamente por isso que passa despercebida. Um
// número inventado desperta suspeita; um trecho de código plausível que não
// roda só é detectado executando.
//
// A checagem é DELIBERADAMENTE ESTREITA. Só acusa quando três coisas coincidem:
// a API é exclusiva de uma plataforma, o artigo cita outra plataforma, e o
// artigo NÃO cita a plataforma dona da API. Fora disso, o risco de falso
// positivo é maior que o benefício — e regra minha reprovando artigo legítimo
// já aconteceu vezes demais neste projeto.

const EXCLUSIVAS = [
  {
    api: /\bcaches\s*\.\s*default\b/,
    dona: 'Cloudflare Workers',
    donaRe: /\bcloudflare\b|\bworkers?\b(?!\s*flow)/i,
    alternativa: 'Na Vercel, cache no edge é via header Cache-Control com s-maxage, ou Edge Config.',
  },
  {
    api: /\bKVNamespace\b|\benv\.[A-Z_]+\.(get|put)\s*\(/,
    dona: 'Cloudflare Workers KV',
    donaRe: /\bcloudflare\b|\bworkers?\s+kv\b/i,
    alternativa: 'Na Vercel, use Edge Config, Vercel KV ou um banco externo.',
  },
  {
    api: /\bDeno\s*\.\s*\w+/,
    dona: 'Deno',
    donaRe: /\bdeno\b/i,
    alternativa: 'Em Node ou no Edge Runtime, use as APIs padrão da Web ou os módulos node:.',
  },
  {
    api: /\b__dirname\b|\b__filename\b/,
    dona: 'CommonJS',
    donaRe: /\bcommonjs\b|\brequire\s*\(/i,
    alternativa: 'Em ESM, use import.meta.url com fileURLToPath.',
  },
  {
    api: /\blocalStorage\b|\bsessionStorage\b/,
    dona: 'navegador',
    donaRe: /\bnavegador\b|\bbrowser\b|\bclient-side\b|\bfront-?end\b/i,
    alternativa: 'Não existe em runtime de servidor. Use cookie, banco ou cache.',
  },
];

// Plataformas de servidor cuja menção torna a confusão relevante.
const PLATAFORMAS = [
  ['Vercel', /\bvercel\b/i],
  ['Cloudflare Workers', /\bcloudflare\b/i],
  ['Deno Deploy', /\bdeno\s+deploy\b/i],
  ['AWS Lambda', /\baws\s+lambda\b|\blambda\b/i],
  ['Node.js', /\bnode\.?js\b/i],
];

/** Extrai o conteúdo dos blocos de código cercados. */
export function extractCodeBlocks(markdown = '') {
  const blocos = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(markdown))) blocos.push({ lang: m[1] || null, code: m[2] });
  return blocos;
}

/**
 * @returns {Array<{api:string, dona:string, plataforma:string, detail:string}>}
 */
export function checkCodeApis(markdown = '') {
  const blocos = extractCodeBlocks(markdown);
  if (!blocos.length) return [];

  // A detecção de plataforma olha SÓ A PROSA, nunca o código.
  //
  // Testar o markdown inteiro fazia a API se auto-isentar: `Deno.readTextFile`
  // contém "Deno", então a regra concluía que o artigo tratava de Deno e
  // liberava o uso. O caso do Cloudflare só não falhou por acaso — a palavra
  // "cloudflare" não aparecia dentro do trecho de código.
  const prosa = markdown.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');

  const citadas = PLATAFORMAS.filter(([, re]) => re.test(prosa)).map(([nome]) => nome);
  if (!citadas.length) return [];

  const achados = [];
  for (const { code } of blocos) {
    for (const regra of EXCLUSIVAS) {
      if (!regra.api.test(code)) continue;
      // Se o artigo fala da plataforma dona da API, o uso é legítimo.
      if (regra.donaRe.test(prosa)) continue;
      achados.push({
        api: (code.match(regra.api) || [''])[0].trim(),
        dona: regra.dona,
        plataforma: citadas[0],
        detail: `"${(code.match(regra.api) || [''])[0].trim()}" é API do ${regra.dona}, `
              + `mas o artigo trata de ${citadas.join('/')}. ${regra.alternativa}`,
      });
    }
  }
  return achados;
}
