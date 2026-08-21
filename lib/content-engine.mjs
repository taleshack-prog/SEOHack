// CONTENT ENGINE — lógica de geração
//
// Extraído de api/cron/content.mjs para que o cron e o painel disparem o MESMO
// código. Antes só existia como handler de cron; gerar artigo pelo painel
// exigiria duplicar a lógica, e duas cópias divergem.
//
// Fluxo: orçamento -> outline -> validação do outline -> artigo -> validação
// completa -> F8. Chain-of-thought preservado do PRD §38: validar o esboço
// antes de gastar tokens no texto inteiro corta a maior parte do retrabalho.
//
// Corrige o bloqueador A2. No v4 a IA era instruída a inserir
// [NOTA PARA O OPERADOR] (PRD §8.2) e o build abortava com exit 1 ao encontrá-lo
// (PRD §6.1) — o caminho feliz derrubava o pipeline. Agora o artigo com marcador
// entra no Git como draft:true, o build ignora, e o operador destrava no
// dashboard. "Intervenção humana zero" era falso; o número honesto é ~85%.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql } from './db.mjs';
import { complete, parseJson } from './llm.mjs';
import { assertBudget, recordUsage } from './budget.mjs';
import { validateArticle } from './validate.mjs';
import { parseNotes } from './notes.mjs';
import { publish as publishViaAdapter } from './adapters/index.mjs';

const root = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const MAX_PER_RUN = Number(process.env.MAX_ARTICLES_PER_RUN || 2);

// C4: o v4 gerava 5 por dia mirando 60 artigos em 90 dias. Esse é exatamente o
// padrão que o core update de março de 2026 nomeou como scaled content abuse.
// 2 por execução, 3x por semana, todos com gate humano.

const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

async function loadPrompt(name) {
  try {
    return await readFile(root(`prompts/${name}`), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    // Falha de empacotamento, não de código: o arquivo existe no repositório
    // mas não foi para dentro da função. Dizer isso explicitamente evita
    // procurar bug onde não tem.
    throw new Error(
      `O prompt "${name}" não está no pacote da função. ` +
      'Confira "includeFiles": "prompts/**" no vercel.json e refaça o deploy.');
  }
}

async function generateOutline(topic, system, clientId) {
  const r = await complete({
    system,
    prompt: `Tópico: "${topic.topic}"
Cluster: ${topic.cluster || 'não definido'}
Tipo: ${topic.is_pillar ? 'PILLAR PAGE (abrangente)' : 'artigo satélite'}

Gere APENAS um objeto JSON, sem cercas de markdown e sem preâmbulo:
{
  "title": "título com no máximo 60 caracteres",
  "description": "meta description de 140 a 158 caracteres",
  "summary": "resumo de uma frase para card e Open Graph",
  "entities": ["entidade 1", "entidade 2", "entidade 3"],
  "sections": [{"h2": "...", "points": ["..."]}],
  "faq": ["pergunta 1", "pergunta 2", "pergunta 3"],
  "needsHumanExperience": true,
  "humanExperienceReason": "por que este tópico exige relato real"
}`,
    // 2000 era pouco: o esboço de uma pillar page batia exatamente no teto e o
    // JSON vinha truncado, quebrando o parser com erro que não dizia a causa.
    maxTokens: 6000,
  });
  await recordUsage(clientId, { stage: 'outline', provider: r.provider, model: r.model,
    inputTokens: r.inputTokens, outputTokens: r.outputTokens });
  return parseJson(r.text, r.stopReason);
}

/** Corta no limite de caracteres sem partir palavra ao meio. */
function trim(texto, max) {
  const t = String(texto).trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  const espaco = corte.lastIndexOf(' ');
  return (espaco > max * 0.6 ? corte.slice(0, espaco) : corte).replace(/[,;:\s]+$/, '');
}

/**
 * Ajusta o que dá para ajustar antes de reprovar.
 *
 * A versão anterior descartava o esboço inteiro se a descrição saísse fora da
 * faixa 140-158 — jogando fora uma geração já paga por causa de dois
 * caracteres. Pior, a regra estava errada: descrição curta não prejudica nada,
 * o Google só trunca acima de ~160. Agora o que é cosmético é corrigido, e só
 * o que é estrutural reprova.
 */
function normalizeOutline(o) {
  const avisos = [];
  if (o.title && o.title.length > 60) {
    avisos.push(`título tinha ${o.title.length} chars, cortado para 60`);
    o.title = trim(o.title, 60);
  }
  if (o.description && o.description.length > 158) {
    avisos.push(`descrição tinha ${o.description.length} chars, cortada para 158`);
    o.description = trim(o.description, 158);
  }
  if (o.description && o.description.length < 100) {
    avisos.push(`descrição curta (${o.description.length} chars) — perde espaço na SERP`);
  }
  return avisos;
}

/** Só reprova o que não dá para consertar sem reescrever o texto. */
function validateOutline(o) {
  const errs = [];
  if (!o.title?.trim()) errs.push('sem título');
  if (!o.description?.trim()) errs.push('sem description');
  // Acima disso não é "um pouco longo", é o modelo tendo devolvido outra coisa.
  if (o.title && o.title.length > 120) errs.push(`título absurdamente longo (${o.title.length})`);
  if (o.description && o.description.length > 400) errs.push(`description longa demais (${o.description.length})`);
  // PRD §25: pelo menos três entidades técnicas centrais.
  if (!Array.isArray(o.entities) || o.entities.length < 3) errs.push('menos de 3 entidades');
  if (!Array.isArray(o.sections) || o.sections.length < 3) errs.push('menos de 3 seções');
  return errs;
}

async function generateArticle(topic, outline, system, clientId) {
  const isPillar = topic.is_pillar;
  const r = await complete({
    system,
    model: isPillar ? (process.env.LLM_MODEL_PILLAR || process.env.LLM_MODEL) : process.env.LLM_MODEL,
    prompt: `Escreva o artigo completo em português do Brasil seguindo este esboço aprovado:

${JSON.stringify(outline, null, 2)}

Devolva APENAS o corpo em Markdown, começando no primeiro "## ". Não inclua
frontmatter, não inclua o H1 (o título vem do frontmatter), não use HTML bruto.`,
    maxTokens: isPillar ? 16000 : 8000,
  });
  await recordUsage(clientId, { stage: 'draft', provider: r.provider, model: r.model,
    inputTokens: r.inputTokens, outputTokens: r.outputTokens });
  return { markdown: r.text.trim(), model: r.model, provider: r.provider };
}

/**
 * Gera artigos e publica (ou segura para revisão humana).
 *
 * @param {object}   client    linha de clients
 * @param {string[]} topicIds  tópicos específicos; vazio = pega da fila por score
 * @param {number}   limite    máximo por execução
 */
/**
 * Monta o bloco de contexto que vai junto do system prompt.
 *
 * Sem isto, o prompt trazia caminhos que eu inventei — inclusive "/servicos",
 * que não existe no site — enquanto o validador cobrava os caminhos reais do
 * adapter_config. Duas fontes de verdade que já divergiram e reprovaram um
 * artigo inteiro depois de escrito.
 *
 * O mesmo vale para links internos: exigir 2 links para outros artigos num blog
 * vazio faz o modelo inventar URLs que dão 404.
 */
function buildContext(cfg, publicados) {
  const produtos = (cfg.productPaths || []).join(', ');
  const blog = cfg.blogBasePath || '/blog';

  const listaArtigos = publicados.length
    ? publicados.map((a) => `- ${blog}/${a.slug} — "${a.title}"`).join('\n')
    : '(nenhum artigo publicado ainda)';

  const regraInterna = publicados.length >= 2
    ? `Inclua ao menos 2 links para artigos da lista acima. Use apenas os que estão listados.`
    : publicados.length === 1
      ? `Há apenas um artigo publicado. Linke para ele uma vez, se fizer sentido.`
      : `Este é um dos primeiros artigos do blog. NÃO invente links para outros ` +
        `artigos — eles não existem e dariam 404. Use apenas links de produto e fontes externas.`;

  return `

---
# CONTEXTO DESTE SITE

## Páginas de produto e serviço (use os caminhos exatamente assim)
${produtos}

Todo artigo precisa de pelo menos um link para uma destas páginas, com âncora
descritiva. Não invente outros caminhos: qualquer coisa fora desta lista é
link quebrado.

## Artigos já publicados
${listaArtigos}

${regraInterna}
---`;
}

export async function generateBatch(client, { topicIds = [], limite = MAX_PER_RUN } = {}) {

    await assertBudget(client.id);

    // topicIds preenchido = o operador escolheu no painel. Vazio = ordem da fila.
    const topics = topicIds.length
      ? await sql`
          SELECT * FROM topics
           WHERE client_id = ${client.id} AND id = ANY(${topicIds})
             AND status IN ('approved','pending')`
      : await sql`
      SELECT * FROM topics
       WHERE client_id = ${client.id} AND status = 'approved'
       -- is_pillar primeiro: a âncora do cluster tem que existir antes dos
       -- satélites que linkam para ela (PRD §34).
       ORDER BY is_pillar DESC, opportunity_score DESC NULLS LAST, discovered_at ASC
       LIMIT ${limite}`;

    if (topics.length === 0) {
      return { processed: 0, succeeded: 0, note: 'nenhum tópico aprovado na fila' };
    }

    const publicados = await sql`
      SELECT slug, title FROM articles
       WHERE client_id = ${client.id} AND status = 'published'
       ORDER BY first_published_at DESC LIMIT 20`;

    const system = (await loadPrompt('system-prompt-v5.md'))
                 + buildContext(client.adapter_config || {}, publicados);
    const batch = [];
    const outcomes = [];

    for (const topic of topics) {
      try {
        await sql`UPDATE topics SET status='writing', assigned_at=NOW() WHERE id=${topic.id}`;

        const outline = await generateOutline(topic, system, client.id);
        const outlineErrs = validateOutline(outline);
        if (outlineErrs.length) throw new Error(`outline reprovado: ${outlineErrs.join('; ')}`);
        for (const aviso of normalizeOutline(outline)) {
          console.warn(`[content] ${topic.topic}: ${aviso}`);
        }

        const { markdown, model, provider } = await generateArticle(topic, outline, system, client.id);
        const slug = slugify(outline.title);
        const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

        // O gate: se o artigo tem marcador de nota, entra como draft.
        //
        // Usa parseNotes, o MESMO parser que a tela de revisão usa para abrir as
        // lacunas. Com `includes()` as duas podiam discordar — e discordaram: um
        // artigo entrou na fila de revisão anunciando "0 trechos a escrever".
        const needsHuman = parseNotes(markdown).length > 0;

        const frontmatter = {
          title: outline.title,
          description: outline.description,
          summary: outline.summary,
          author: 'Tales Hack',
          publishedAt: now,
          updatedAt: now,
          tags: (topic.cluster ? [topic.cluster] : []).concat(outline.entities.slice(0, 3).map(slugify)),
          draft: needsHuman,
        };

        const check = validateArticle({ slug, frontmatter, markdown },
          { ...client.adapter_config, existingSlugs: publicados.map((a) => a.slug) });
        if (!check.valid) {
          throw new Error(`validação local: ${check.errors.map((e) => e.rule).join(', ')}`);
        }
        for (const w of check.warnings) console.warn(`[content] aviso ${slug}: ${w.rule}`);

        const [article] = await sql`
          INSERT INTO articles (client_id, topic_id, slug, title, description, cluster,
                                is_pillar, word_count, reading_time_minutes, status,
                                operator_note_required, llm_provider, llm_model,
                                markdown, frontmatter)
          VALUES (${client.id}, ${topic.id}, ${slug}, ${outline.title}, ${outline.description},
                  ${topic.cluster}, ${topic.is_pillar}, ${check.stats.words},
                  ${Math.ceil(check.stats.words / 220)},
                  ${needsHuman ? 'needs_human' : 'ready'}, ${needsHuman}, ${provider}, ${model},
                  ${markdown}, ${JSON.stringify(frontmatter)})
          ON CONFLICT (client_id, slug) DO UPDATE
            SET markdown = EXCLUDED.markdown, frontmatter = EXCLUDED.frontmatter,
                updated_at = NOW()
          RETURNING id`;

        batch.push({ slug, markdown, frontmatter, _articleId: article.id, _topicId: topic.id });
        outcomes.push({ slug, needsHuman, words: check.stats.words });
      } catch (err) {
        console.error(`[content] tópico "${topic.topic}" falhou: ${err.message}`);
        await sql`UPDATE topics SET status='pending', status_reason=${err.message} WHERE id=${topic.id}`;
        outcomes.push({ topic: topic.topic, error: err.message });
      }
    }

    // Artigo com nota pendente NÃO vai para o destino agora: fica no banco
    // aguardando a fila de revisão. Publicá-lo como rascunho no repositório só
    // criaria lixo que o operador teria de limpar depois.
    const aguardando = batch.filter((b) => b.frontmatter.draft);
    const prontos = batch.filter((b) => !b.frontmatter.draft);
    if (prontos.length === 0) {
      return { processed: topics.length, succeeded: 0,
               needsHuman: aguardando.map((b) => b.slug),
               error: resumoFalhas(outcomes), outcomes };
    }

    // Renderiza e publica pelo adapter configurado do cliente. Para 'github',
    // um commit atômico com todos os arquivos (A4). Nenhum código roda do lado
    // do cliente — ver lib/adapters/index.mjs.
    const payload = prontos.map(({ slug, markdown, frontmatter }) => ({ slug, markdown, frontmatter }));
    const allPublished = await sql`
      SELECT slug, first_published_at, content_updated_at FROM articles
       WHERE client_id = ${client.id} AND status = 'published'`;
    const result = await publishViaAdapter(client, payload, allPublished);

    for (const item of prontos) {
      const rejected = result.rejected.find((r) => r.slug === item.slug);
      if (rejected) {
        // A3: a F8 valida ANTES do commit, então não há lixo no histórico.
        await sql`UPDATE articles SET status='quarantined' WHERE id=${item._articleId}`;
        await sql`UPDATE topics SET status='pending', status_reason=${rejected.rule} WHERE id=${item._topicId}`;
      } else if (result.committed.includes(item.slug)) {
        const isDraft = item.frontmatter.draft;
        await sql`
          UPDATE articles
             SET github_commit_sha = ${result.commitSha},
                 first_published_at = COALESCE(first_published_at, ${isDraft ? null : new Date()}),
                 content_updated_at = NOW(),
                 updated_at = NOW()
           WHERE id = ${item._articleId}`;
        await sql`
          UPDATE topics SET status = ${isDraft ? 'needs_human' : 'published'},
                            published_at = ${isDraft ? null : new Date()}
           WHERE id = ${item._topicId}`;
      }
    }

    return {
      processed: topics.length,
      succeeded: result.committed.length,
      commitSha: result.commitSha,
      needsHuman: outcomes.filter((o) => o.needsHuman).map((o) => o.slug),
      error: resumoFalhas(outcomes),
      outcomes,
    };
}

/**
 * Resumo legível das falhas, gravado em pipeline_runs.error_message.
 *
 * Antes, um artigo podia falhar depois de custar dinheiro e o operador via só
 * o contador de gastos subir — a razão ficava presa no log da função. Falha
 * silenciosa que custou tokens é o pior comportamento possível para esta tela.
 */
function resumoFalhas(outcomes) {
  const erros = outcomes.filter((o) => o.error);
  if (!erros.length) return null;
  return erros.map((o) => `"${o.topic || o.slug}": ${o.error}`).join(' | ');
}

export { MAX_PER_RUN };
