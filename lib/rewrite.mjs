// REWRITE ENGINE — melhorar artigo que já está no ar.
//
// O `api/cron/optimization.mjs` existe desde o início com um `TODO Sprint 4` no
// lugar desta função: ele avaliava reescritas antigas, listava candidatos e
// devolvia `succeeded: 0` com a nota "reescrita automática entra no Sprint 4".
// A infraestrutura de registro estava pronta — optimization_log, a view
// v_optimization_candidates, a trava de três tentativas — e o motor, não.
//
// Na prática isso significava que a tela de consultas diagnosticava e mandava o
// operador consertar à mão, o que é meia funcionalidade: o motor sabe escrever,
// validar e publicar, mas só para artigo novo.
//
// A diferença entre isto e o Content Engine é o ponto de partida. Lá se escreve
// do zero a partir de um esboço; aqui se recebe um texto que JÁ RANQUEIA — mal,
// mas ranqueia — e o risco de piorar é real. Daí três decisões:
//
//   1. Reescrita incremental, não regeneração. O texto atual vai no prompt e a
//      instrução é preservar o que funciona.
//   2. A validação compara com o estado anterior e só barra o que a reescrita
//      introduziu — a mesma regra da tela de revisão. As regras evoluem com o
//      blog, e aplicar as de hoje a um texto de ontem bloqueia melhoria por
//      pendência que ela não tocou.
//   3. O slug nunca muda. Mudar a URL de uma página que ranqueia joga fora o
//      histórico dela.
//
// O título e a descrição também ficam como estão: trocar o H1 de uma página
// posicionada é decisão com risco que não cabe a um lote automático. O operador
// faz isso no editor quando quiser.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sql } from './db.mjs';
import { complete } from './llm.mjs';
import { assertBudget, recordUsage, linkUsage } from './budget.mjs';
import { validateArticle } from './validate.mjs';
import { buildContext } from './content-engine.mjs';
import { publish as publishViaAdapter } from './adapters/index.mjs';
import { agruparPorConsulta, escolherAlvo } from './consultas.mjs';
import { grauDeRedundancia, trechosRepetidos } from './redundancia.mjs';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));

/** PRD §27: três tentativas e a decisão passa a ser humana. */
export const MAX_TENTATIVAS = 3;

/** Quanto a repetição pode crescer numa reescrita antes de ser linguiça. */
export const TOLERANCIA_REPETICAO = 0.05;

// Reexportado porque a regra mora em consultas.mjs: a tela precisa dela para
// dizer no botão o termo em que o motor vai mirar, e tela não carrega LLM.
export { escolherAlvo };

const MOTIVOS = ['position_drop', 'low_ctr', 'stale_content',
                 'no_ai_citation', 'broken_links', 'content_gap'];

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

// articles.github_commit_sha é CHAR(40). Um adapter que devolva outra coisa
// (um id de API, um caminho) derrubaria o UPDATE inteiro com 22001 depois de o
// artigo já estar no ar — e o banco ficaria sem registro de uma reescrita que
// aconteceu. Guarda o que couber, descarta o resto.
const shaDeCommit = (v) => (/^[0-9a-f]{40}$/i.test(String(v || '')) ? String(v) : null);
const palavras = (md) => String(md).trim().split(/\s+/).filter(Boolean).length;
const secoes = (md) => (String(md).match(/^##\s+/gm) || []).length;

async function carregarPrompt(nome) {
  try {
    return await readFile(root(`prompts/${nome}`), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    throw new Error(`O prompt "${nome}" não está no pacote da função. `
      + 'Confira "includeFiles": "prompts/**" no vercel.json e refaça o deploy.');
  }
}

/**
 * As buscas que esta página já recebe, da última coleta da Search Console.
 *
 * É daqui que sai o alvo: não adianta mirar num termo escolhido no olho quando
 * existe registro de qual pergunta leva gente até a página e em que posição ela
 * responde.
 */
export async function consultasDaPagina(clientId, pageUrl) {
  const linhas = await sql`
    SELECT query, page_url, impressions, clicks, position
      FROM gsc_query_metrics
     WHERE client_id = ${clientId} AND page_url = ${pageUrl}
       AND period_start = (SELECT MAX(period_start) FROM gsc_query_metrics
                            WHERE client_id = ${clientId})`;
  return agruparPorConsulta(linhas);
}

function montarPrompt({ article, alvo, outras }) {
  const lista = outras.length
    ? outras.map((c) => `- "${c.query}" — posição ${Number(c.position).toFixed(1)}, `
        + `${c.impressions} ${c.impressions === 1 ? 'impressão' : 'impressões'}`).join('\n')
    : '(nenhuma outra registrada)';

  return `Este artigo JÁ ESTÁ PUBLICADO e recebe visitas. Reescreva-o para responder
melhor à busca principal, sem perder o que já funciona.

## Busca principal (o alvo)
"${alvo.query}" — hoje a página aparece na posição ${Number(alvo.position).toFixed(1)}
com ${alvo.impressions} ${alvo.impressions === 1 ? 'impressão' : 'impressões'} no período.

## Outras buscas que já trazem gente para esta mesma página
${lista}

## O que isso significa
A página aparece para a busca principal mas não responde bem o suficiente para
subir. Normalmente é profundidade: falta a seção que responde a pergunta de
forma direta, falta exemplo concreto, ou o termo aparece de passagem quando
deveria estruturar o texto.

## Regras desta reescrita
1. PRESERVE o que já está bom. Isto não é um artigo novo — é uma revisão. Seções
   que já respondem bem devem sobreviver, com melhorias pontuais no máximo.
2. Responda à busca principal de forma direta e cedo. ANTES de criar uma seção
   nova para isso, procure a que já responde: se existir, melhore ELA. Uma
   seção nova que repete o que outra já diz derruba as duas.
3. NÃO perca as outras buscas da lista: elas já funcionam e o texto delas fica.
4. Mantenha TODOS os links internos e de produto que já existem no texto. Pode
   acrescentar, nunca remover.
5. Não encha linguiça. Se a melhor versão tiver o mesmo tamanho, tudo bem —
   texto mais longo não ranqueia melhor por ser mais longo.
   Não reescreva a mesma ideia em outras palavras num segundo lugar: nada de
   "em outras palavras", "em resumo" e "em uma frase" repetindo o parágrafo
   anterior, e nada de FAQ que devolve o que o corpo já respondeu. Cada
   pergunta do FAQ acrescenta algo que o corpo não disse, ou sai.
6. Nenhuma estatística sem fonte no próprio parágrafo, e nenhuma experiência em
   primeira pessoa inventada. As duas coisas reprovam o artigo na validação.
7. O título e a URL não mudam. Não escreva H1, não escreva frontmatter.

## Artigo atual

${article.markdown}

---
Devolva APENAS o corpo em Markdown da versão nova, começando no primeiro "## ".`;
}

/** Resumo mecânico do que mudou — sem gastar uma segunda chamada no modelo. */
export function resumirMudancas({ antes, depois, alvo }) {
  const dp = palavras(depois) - palavras(antes);
  const ds = secoes(depois) - secoes(antes);
  const partes = [`mirou em "${alvo.query}" (posição ${Number(alvo.position).toFixed(1)})`];
  if (dp) partes.push(`${dp > 0 ? '+' : ''}${dp} palavras`);
  if (ds) partes.push(`${ds > 0 ? '+' : ''}${ds} ${Math.abs(ds) === 1 ? 'seção' : 'seções'}`);
  if (!dp && !ds) partes.push('mesma extensão e estrutura');
  return partes.join('; ');
}

/**
 * Reescreve um artigo publicado mirando na busca que ele já recebe.
 *
 * @param {object} client  linha de clients
 * @param {string} slug
 * @param {object} opts    motivo (trigger_reason), consultas (pula a consulta
 *                         ao banco), alvo (força um termo)
 * @returns {Promise<object>} o que aconteceu, sempre com `publicado` booleano
 */
export async function reescreverArtigo(client, slug, { motivo = 'content_gap', consultas, alvo } = {}) {
  if (!MOTIVOS.includes(motivo)) throw new Error(`trigger_reason inválido: ${motivo}`);

  const [article] = await sql`
    SELECT id, topic_id, slug, title, cluster, markdown, frontmatter, rewrite_count
      FROM articles
     WHERE client_id = ${client.id} AND slug = ${slug} AND status = 'published'`;

  if (!article) return { publicado: false, motivo: 'artigo publicado não encontrado' };

  if (Number(article.rewrite_count || 0) >= MAX_TENTATIVAS) {
    // PRD §27: insistir uma quarta vez é teimosia, não otimização. A decisão
    // vira humana — abandonar, consolidar com outro artigo, ou aceitar.
    return { publicado: false, slug,
             motivo: `já foram ${article.rewrite_count} reescritas; a decisão agora é humana` };
  }

  const site = client.adapter_config || {};
  const base = (site.baseUrl || `https://${client.domain}`).replace(/\/$/, '');
  const pageUrl = `${base}${site.blogBasePath || '/blog'}/${article.slug}`;

  const medidas = consultas || await consultasDaPagina(client.id, pageUrl);
  const escolhido = alvo || escolherAlvo(medidas);
  if (!escolhido) {
    return { publicado: false, slug,
             motivo: 'nenhuma busca fora do Top 10 registrada para esta página — '
               + 'não há alvo, e reescrever sem alvo é risco sem retorno' };
  }

  await assertBudget(client.id);

  const publicados = await sql`
    SELECT id, slug, title, description, cluster, is_pillar, markdown,
           first_published_at, frontmatter
      FROM articles
     WHERE client_id = ${client.id} AND status = 'published'
     ORDER BY first_published_at ASC`;

  const promptBase = await carregarPrompt('system-prompt-v5.md');
  const system = promptBase + buildContext(site, publicados, article.cluster);

  const r = await complete({
    system,
    prompt: montarPrompt({
      article,
      alvo: escolhido,
      outras: medidas.filter((c) => c.query !== escolhido.query),
    }),
    maxTokens: 16000,
  });
  const uso = await recordUsage(client.id, { stage: 'rewrite', provider: r.provider, model: r.model,
    inputTokens: r.inputTokens, outputTokens: r.outputTokens });
  await linkUsage(client.id, article.id, [uso.id]);

  const novo = r.text.trim();
  if (!novo || palavras(novo) < 200) {
    return { publicado: false, slug, alvo: escolhido.query,
             motivo: `o modelo devolveu ${palavras(novo)} palavras — resposta truncada ou vazia` };
  }

  const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const frontmatter = { ...article.frontmatter, draft: false, updatedAt: agora };

  const contexto = {
    ...site,
    existingSlugs: publicados.map((a) => a.slug),
    cluster: article.cluster,
    clusterSlugs: article.cluster
      ? publicados.filter((a) => a.cluster === article.cluster && a.slug !== article.slug).map((a) => a.slug)
      : undefined,
  };

  const check = validateArticle({ slug: article.slug, frontmatter, markdown: novo }, contexto);

  // Mesma regra da tela de revisão: só barra o que a reescrita INTRODUZIU. O
  // que já estava errado no texto antigo não pode bloquear uma melhoria que
  // não o tocou.
  const antes = validateArticle(
    { slug: article.slug, frontmatter: article.frontmatter || frontmatter, markdown: article.markdown || '' },
    contexto);
  const antigos = new Set(antes.errors.map((e) => e.rule));
  const bloqueantes = check.errors.filter((e) => !antigos.has(e.rule));
  const herdados = check.errors.filter((e) => antigos.has(e.rule));

  // A reescrita de 23/10 passou em tudo que era mecânico e mesmo assim saiu
  // inchada: o mecanismo explicado cinco vezes, o FAQ devolvendo o corpo. A
  // validação não via porque repetição não é erro de regra — é excesso. Mesma
  // lógica do resto daqui: não se exige que o texto novo seja limpo, exige-se
  // que não seja MAIS repetitivo que o que já estava no ar.
  const repeticaoAntes = grauDeRedundancia(article.markdown || '');
  const repeticaoDepois = grauDeRedundancia(novo);

  if (repeticaoDepois > repeticaoAntes + TOLERANCIA_REPETICAO) {
    const exemplos = trechosRepetidos(novo).slice(0, 2)
      .map((t) => `"${t.a.slice(0, 70)}…" ≈ "${t.b.slice(0, 70)}…"`);
    return { publicado: false, slug, alvo: escolhido.query,
             motivo: `a reescrita repete mais que o texto atual `
               + `(${(repeticaoDepois * 100).toFixed(0)}% das frases contra `
               + `${(repeticaoAntes * 100).toFixed(0)}%): ${exemplos.join('; ')}`,
             repeticao: { antes: repeticaoAntes, depois: repeticaoDepois } };
  }

  if (bloqueantes.length) {
    // Não publica e não conta tentativa: o artigo no ar continua o que era. O
    // custo da chamada já foi registrado, que é o honesto — gastou.
    return { publicado: false, slug, alvo: escolhido.query,
             motivo: 'a reescrita introduziu problema: '
               + bloqueantes.map((e) => `${e.rule} (${e.detail})`).join('; '),
             bloqueios: bloqueantes.map((e) => e.rule) };
  }

  const comPublicados = await sql`
    SELECT slug, first_published_at, content_updated_at FROM articles
     WHERE client_id = ${client.id} AND status = 'published'`;
  const resultado = await publishViaAdapter(client,
    [{ slug: article.slug, markdown: novo, frontmatter }], comPublicados);

  if (!resultado.committed.includes(article.slug)) {
    const rejeitado = resultado.rejected?.find((x) => x.slug === article.slug);
    return { publicado: false, slug, alvo: escolhido.query,
             motivo: `o destino recusou: ${rejeitado?.rule || 'motivo não informado'}` };
  }

  const mudancas = resumirMudancas({ antes: article.markdown || '', depois: novo, alvo: escolhido });
  const tentativa = Number(article.rewrite_count || 0) + 1;

  await sql`
    UPDATE articles
       SET markdown = ${novo}, frontmatter = ${JSON.stringify(frontmatter)},
           word_count = ${check.stats.words},
           rewrite_count = ${tentativa},
           github_commit_sha = ${shaDeCommit(resultado.commitSha)},
           content_updated_at = NOW(), updated_at = NOW()
     WHERE id = ${article.id}`;

  // O log fecha o ciclo: o cron de otimização volta em 30 dias e compara a
  // posição de antes com a de depois para dizer se a reescrita funcionou.
  await sql`
    INSERT INTO optimization_log (client_id, article_id, attempt_number, trigger_reason,
                                  old_position, old_impressions, changes_summary,
                                  old_content_sha, new_content_sha)
    VALUES (${client.id}, ${article.id}, ${tentativa}, ${motivo},
            ${escolhido.position}, ${escolhido.impressions}, ${mudancas},
            ${sha(article.markdown || '')}, ${sha(novo)})`;

  return {
    publicado: true,
    slug,
    alvo: escolhido.query,
    posicaoAntes: escolhido.position,
    tentativa,
    mudancas,
    palavrasAntes: palavras(article.markdown || ''),
    palavrasDepois: palavras(novo),
    commitSha: resultado.commitSha,
    pendentes: herdados.map((e) => e.rule),
  };
}
