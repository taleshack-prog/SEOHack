// Recebimento de contato: validação, anti-spam e aviso por e-mail.
//
// Separado do handler HTTP para poder ser testado sem servidor e sem banco.
import { createHash } from 'node:crypto';

export const ASSUNTOS = [
  'Quero propor uma parceria',
  'Dúvida sobre um produto',
  'Quero contratar um projeto',
  'Diagnóstico do meu site',
  'Outro assunto',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const LIMITES = { nome: 120, email: 160, assunto: 120, mensagem: 4000, origem: 200, siteAlvo: 200 };

const corta = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * @returns {{ok:true, lead:object} | {ok:false, erro:string}}
 */
export function validarContato(corpo = {}) {
  // Campo-armadilha: invisível no formulário, só robô preenche. Responder
  // "enviado" a um robô é melhor que responder erro — erro ensina a tentar de
  // novo com outro formato.
  if (corta(corpo.empresa, 50)) return { ok: false, erro: 'silencioso' };

  const nome = corta(corpo.nome, LIMITES.nome);
  const email = corta(corpo.email, LIMITES.email).toLowerCase();
  const mensagem = String(corpo.mensagem ?? '').trim().slice(0, LIMITES.mensagem);

  if (nome.length < 2) return { ok: false, erro: 'Escreva o seu nome.' };
  if (!EMAIL_RE.test(email)) return { ok: false, erro: 'Confira o e-mail: ele parece incompleto.' };
  if (mensagem.length < 10) return { ok: false, erro: 'Escreva um pouco mais na mensagem.' };
  // Quebra de linha em nome ou assunto é tentativa de injetar cabeçalho de
  // e-mail. Os campos já passaram por `corta`, que colapsa espaço e quebra.

  return {
    ok: true,
    lead: {
      nome,
      email,
      assunto: corta(corpo.assunto, LIMITES.assunto) || null,
      mensagem,
      origem: corta(corpo.origem, LIMITES.origem) || null,
      siteAlvo: corta(corpo.site_alvo ?? corpo.siteAlvo, LIMITES.siteAlvo) || null,
    },
  };
}

/** IP nunca é gravado cru: serve só para conter enxurrada. */
export function hashIp(req, segredo = process.env.DASHBOARD_SECRET || 'sem-segredo') {
  const ip = (req.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress || 'desconhecido';
  return createHash('sha256').update(`${segredo}:${ip}`).digest('hex').slice(0, 32);
}

/**
 * Aviso por e-mail via Brevo. Opcional: sem chave, devolve motivo e segue.
 * O contato já está gravado quando esta função roda — e-mail que falha nunca
 * pode derrubar o recebimento.
 */
export async function avisarPorEmail(lead, { fetchImpl = fetch } = {}) {
  const chave = process.env.BREVO_API_KEY;
  const para = process.env.CONTATO_EMAIL;
  if (!chave || !para) return { enviado: false, motivo: 'BREVO_API_KEY ou CONTATO_EMAIL ausente' };

  const corpo = {
    sender: { name: 'SEOHack', email: process.env.CONTATO_REMETENTE || para },
    to: [{ email: para }],
    replyTo: { email: lead.email, name: lead.nome },
    subject: `[site] ${lead.assunto || 'Contato'} — ${lead.nome}`,
    textContent: [
      `Nome: ${lead.nome}`,
      `E-mail: ${lead.email}`,
      lead.assunto ? `Assunto: ${lead.assunto}` : null,
      lead.origem ? `Origem: ${lead.origem}` : null,
      lead.siteAlvo ? `Site diagnosticado: ${lead.siteAlvo}` : null,
      '',
      lead.mensagem,
    ].filter((l) => l !== null).join('\n'),
  };

  try {
    const r = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': chave, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) return { enviado: false, motivo: `Brevo respondeu ${r.status}` };
    return { enviado: true };
  } catch (err) {
    return { enviado: false, motivo: err.message };
  }
}
