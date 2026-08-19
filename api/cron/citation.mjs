// CITATION ENGINE (GEO)
//
// Corrige o item C7 da auditoria. O PRD §30 especificava "proxies rotativos e
// cabeçalhos de agente de usuário variados para simular consultas orgânicas" em
// ChatGPT e Perplexity. Isso é evasão deliberada de detecção de bot e viola os
// Termos de Uso dos três serviços — o custo (ban da conta, exposição jurídica)
// não compensa o dado.
//
// Aqui: API oficial da Perplexity, que devolve as fontes citadas de forma
// estruturada e legítima. O campo `method` separa o que veio de API do que foi
// verificado à mão, para as duas séries não se misturarem no dashboard.
import { cronHandler } from '../../lib/cron-auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';

const MAX_QUERIES = 10;

async function askPerplexity(question) {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [{ role: 'user', content: question }],
    }),
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    answer: data.choices?.[0]?.message?.content || '',
    citations: data.citations || data.search_results?.map((s) => s.url) || [],
  };
}

export default cronHandler(async () => {
  const client = await getClient();
  if (!process.env.PERPLEXITY_API_KEY) {
    return { skipped: true, reason: 'PERPLEXITY_API_KEY ausente' };
  }

  return runStage(client.id, 'citation', async () => {
    // Consulta o tópico do artigo como um usuário real perguntaria.
    const targets = await sql`
      SELECT a.id, a.slug, a.title, t.topic
        FROM articles a
        LEFT JOIN topics t ON t.id = a.topic_id
       WHERE a.client_id = ${client.id} AND a.status = 'published'
       ORDER BY a.first_published_at DESC
       LIMIT ${MAX_QUERIES}`;

    let checked = 0, cited = 0;
    for (const t of targets) {
      const question = t.topic || t.title;
      try {
        const { answer, citations } = await askPerplexity(question);
        const rank = citations.findIndex((u) => u.includes(client.domain));
        const wasCited = rank !== -1;

        await sql`
          INSERT INTO ai_citations (client_id, article_id, engine, method, query,
                                    cited, source_rank, citation_snippet, raw_sources)
          VALUES (${client.id}, ${t.id}, 'perplexity', 'api', ${question},
                  ${wasCited}, ${wasCited ? rank + 1 : null},
                  ${wasCited ? answer.slice(0, 500) : null},
                  ${JSON.stringify(citations)})`;

        checked++;
        if (wasCited) cited++;
      } catch (err) {
        console.error(`[citation] "${question}": ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 1500)); // educado com a API
    }

    return { processed: targets.length, succeeded: checked, cited };
  });
});
