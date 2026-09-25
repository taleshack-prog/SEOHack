// Recebimento público de contato.
//
// Nasceu de um defeito com custo direto: o formulário de hacktechfarm.com.br é
// estático e não tinha destino — respondia "A mensagem não foi enviada" a quem
// escrevesse. Quem chegava pelo blog, ou pela tela de diagnóstico, era perdido
// em silêncio.
//
// A mensagem é gravada no banco ANTES de qualquer tentativa de e-mail. O aviso
// por e-mail é conveniência; o contato não pode depender dele.
//
// Serve os três sites (hacktechfarm, genbreed, posthink) pelo mesmo endereço,
// com CORS restrito a essa lista — o formulário de cada site é uma página de
// outro domínio, então o navegador exige a permissão explícita.
//
// POST /api/contato   { nome, email, assunto, mensagem, origem, site_alvo }
import { sql } from '../lib/db.mjs';
import { readBody } from '../lib/auth.mjs';
import { validarContato, hashIp, avisarPorEmail } from '../lib/leads.mjs';

const ORIGENS = new Set([
  'https://hacktechfarm.com.br', 'https://www.hacktechfarm.com.br',
  'https://genbreed.com.br', 'https://www.genbreed.com.br',
  'https://posthink.com.br', 'https://www.posthink.com.br',
  ...(process.env.CONTATO_ORIGENS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

function cors(req, res) {
  const origem = req.headers?.origin;
  if (origem && ORIGENS.has(origem)) {
    res.setHeader('access-control-allow-origin', origem);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '86400');
}

const json = (res, status, corpo) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(corpo));
};

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'Use POST.' });

  const corpo = await readBody(req);
  const check = validarContato(corpo);

  // Armadilha de robô: responde sucesso e não grava nada. Erro ensinaria o
  // robô a tentar outro formato.
  if (!check.ok && check.erro === 'silencioso') return json(res, 200, { ok: true });
  if (!check.ok) return json(res, 422, { ok: false, erro: check.erro });

  const { lead } = check;
  let id = null;
  try {
    const [row] = await sql`
      INSERT INTO leads (nome, email, assunto, mensagem, origem, site_alvo, ip_hash)
      VALUES (${lead.nome}, ${lead.email}, ${lead.assunto}, ${lead.mensagem},
              ${lead.origem || req.headers?.origin || null}, ${lead.siteAlvo}, ${hashIp(req)})
      RETURNING id`;
    id = row?.id || null;
  } catch (err) {
    // O índice anti-enxurrada rejeita mensagem idêntica do mesmo IP no mesmo
    // minuto. Para quem enviou, isso é duplo clique — e duplo clique não é erro.
    if (/duplicate key|unique/i.test(err.message)) return json(res, 200, { ok: true, duplicado: true });
    console.error('[contato] falha ao gravar:', err.message);
    return json(res, 500, { ok: false, erro: 'Não consegui registrar agora. Tente de novo em instantes.' });
  }

  const aviso = await avisarPorEmail(lead);
  if (!aviso.enviado && id) {
    try {
      await sql`UPDATE leads SET email_erro = ${aviso.motivo} WHERE id = ${id}`;
    } catch { /* o contato já está salvo; anotar a falha do aviso é secundário */ }
  }

  return json(res, 200, { ok: true });
}
