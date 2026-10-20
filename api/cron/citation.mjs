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
//
// 20/10/2026 — as dez medições falharam em bloco com 403 (a Sonar Chat
// Completions foi desligada em 27/09). O `catch` daqui registrava a falha no
// console e seguia em frente, então o lote terminou com "0 citações" e o painel
// mostrou zero — indistinguível de uma medição legítima que não achou nada. Só
// o log da Vercel contava a verdade. Duas correções:
//
//   1. A falha sobe no resultado do estágio, e portanto em pipeline_runs.
//      `succeeded: 0` com `processed: 10` passa a significar o que significa.
//   2. Erro de migração interrompe o lote. Se o endpoint mudou de lugar, as
//      outras nove vão falhar igual — insistir só gasta tempo de função.
import { cronHandler } from '../../lib/cron-auth.mjs';
import { sql, getClient } from '../../lib/db.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { responder, posicaoDoDominio, temChave } from '../../lib/perplexity.mjs';

const MAX_QUERIES = 10;

export default cronHandler(async () => {
  const client = await getClient();
  if (!temChave()) {
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

    let checked = 0;
    let cited = 0;
    const falhas = [];
    let interrompido = null;

    for (const t of targets) {
      const question = t.topic || t.title;
      try {
        const { answer, fontes } = await responder(question);
        // Comparação por host, não por substring: `includes(domain)` dava
        // positivo para "naoposthink.com.br" e para qualquer URL que tivesse o
        // domínio no caminho ou na query — inflando a única métrica de GEO.
        const rank = posicaoDoDominio(fontes, client.domain);
        const wasCited = rank > 0;

        await sql`
          INSERT INTO ai_citations (client_id, article_id, engine, method, query,
                                    cited, source_rank, citation_snippet, raw_sources)
          VALUES (${client.id}, ${t.id}, 'perplexity', 'api', ${question},
                  ${wasCited}, ${wasCited ? rank : null},
                  ${wasCited ? answer.slice(0, 500) : null},
                  ${JSON.stringify(fontes)})`;

        checked++;
        if (wasCited) cited++;
      } catch (err) {
        console.error(`[citation] "${question}": ${err.message}`);
        falhas.push(err.message);

        if (err.migracao) {
          interrompido = 'a API da Perplexity mudou de endereço — o cliente precisa ser '
            + `atualizado antes de medir de novo (${err.message.slice(0, 160)})`;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1500)); // educado com a API
    }

    // O estágio só é "sem erro" quando todas as perguntas foram medidas. Zero
    // citações em dez medições é resultado; zero medições em dez tentativas é
    // defeito, e os dois não podem chegar à tela do mesmo jeito.
    const error = interrompido
      || (falhas.length
        ? `${falhas.length} de ${targets.length} falharam: ${falhas[0].slice(0, 180)}`
        : null);

    return { processed: targets.length, succeeded: checked, cited, ...(error ? { error } : {}) };
  });
});
