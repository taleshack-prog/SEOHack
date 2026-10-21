// Disparo da reescrita pelo painel.
//
// O botão que faltava. A tela de consultas sabia dizer "esta página está em 23
// para este termo" e oferecia um link para o editor — ou seja, diagnosticava e
// mandava o operador consertar à mão. Com o motor de reescrita pronto
// (lib/rewrite.mjs), o mesmo diagnóstico vira a ação.
//
// `waitUntil` pelo mesmo motivo do /api/ui/generate: a reescrita leva de um a
// três minutos e nenhum navegador segura isso. A resposta sai na hora e a
// função continua trabalhando; o acompanhamento é por pipeline_runs, que o
// runStage alimenta.
//
// POST /api/ui/melhorar  { slug }
import { waitUntil } from '@vercel/functions';
import { requireAuth, readBody } from '../../lib/auth.mjs';
import { comErro } from '../../lib/erro.mjs';
import { sql } from '../../lib/db.mjs';
import { clienteAtual } from '../../lib/tenant.mjs';
import { runStage } from '../../lib/pipeline.mjs';
import { reescreverArtigo, MAX_TENTATIVAS } from '../../lib/rewrite.mjs';
import { pendenciasDoCliente } from '../../lib/prontidao.mjs';

export default comErro(requireAuth(async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }

  const { slug } = await readBody(req);
  const client = await clienteAtual(req);
  const volta = (q) => { res.statusCode = 302; res.setHeader('Location', `/consultas?${q}`); res.end(); };

  if (!slug) return volta('erro=' + encodeURIComponent('Sem artigo para melhorar.'));

  // Mesmo pré-voo da geração: cliente sem destino de publicação escreveria o
  // texto, pagaria por ele e falharia na hora de publicar.
  const pendencias = pendenciasDoCliente(client);
  if (pendencias.length) {
    return volta('erro=' + encodeURIComponent(
      `Falta configuração neste cliente: ${pendencias.map((p) => p.titulo).join('; ')}.`));
  }

  const [artigo] = await sql`
    SELECT slug, title, rewrite_count FROM articles
     WHERE client_id = ${client.id} AND slug = ${slug} AND status = 'published'`;

  if (!artigo) return volta('erro=' + encodeURIComponent('Artigo publicado não encontrado.'));

  if (Number(artigo.rewrite_count || 0) >= MAX_TENTATIVAS) {
    return volta('erro=' + encodeURIComponent(
      `"${artigo.title}" já foi reescrito ${artigo.rewrite_count} vezes. `
      + 'A partir daqui a decisão é sua: abandonar, consolidar com outro artigo, ou aceitar como está.'));
  }

  // Uma reescrita por vez. Duas em paralelo no mesmo cliente competiriam pelo
  // orçamento e poderiam publicar commits concorrentes no mesmo arquivo.
  const [rodando] = await sql`
    SELECT id FROM pipeline_runs
     WHERE client_id = ${client.id} AND stage = 'optimization' AND status = 'running'
       AND started_at > NOW() - INTERVAL '15 minutes'`;

  if (rodando) return volta('erro=' + encodeURIComponent('Já existe uma reescrita em andamento.'));

  waitUntil(
    runStage(client.id, 'optimization', async () => {
      const r = await reescreverArtigo(client, slug, { motivo: 'content_gap' });
      return {
        processed: 1,
        succeeded: r.publicado ? 1 : 0,
        ...(r.publicado ? {} : { error: r.motivo }),
        resultado: r,
      };
    }).catch((err) => console.error('[melhorar]', err.stack || err.message)));

  volta('melhorando=' + encodeURIComponent(artigo.title));
}));
