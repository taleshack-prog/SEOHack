// O relatório que vai até o operador, para ele não ter que ir até o painel.
//
// 06/11/2026, pedido do Tales: "não criei esse projeto para eu ficar abrindo e
// procurando o que deve ser feito". O painel responde bem a quem pergunta, e
// ninguém pergunta — a informação precisa sair daqui.
//
// A escolha dele no mesmo dia foi segurar todo artigo com lacuna. Isso é
// seguro e correto, e tem um custo: artigo segurado é artigo parado. Então o
// resumo existe para que parado nunca signifique esquecido, e diz sempre as
// três coisas: o que foi ao ar, o que está preso e esperando o quê, e se a
// fila tem com que continuar.
//
// Regra de redação: nenhum zero sem motivo. "0 publicados" não informa nada —
// "0 publicados porque os 2 artigos da semana estão esperando um dado seu"
// e "0 publicados porque a fila acabou" pedem coisas diferentes.

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

export const dataBr = (v) => {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toISOString().slice(0, 10).split('-').reverse().join('/');
};

/**
 * @param {object} d
 * @param {Array}  d.publicados   artigos que foram ao ar na janela
 * @param {Array}  d.segurados    artigos parados, com o motivo
 * @param {Array}  d.topicosPresos tópicos barrados antes de escrever
 * @param {number} d.fila         tópicos aprovados esperando
 * @param {Array}  d.reescritas   reescritas da janela
 * @param {object} d.custo        {gasto, teto}
 * @param {string} d.cliente
 * @returns {{assunto:string, texto:string, vazio:boolean}}
 */
export function montarResumo(d = {}) {
  const publicados = d.publicados || [];
  const segurados = d.segurados || [];
  const presos = d.topicosPresos || [];
  const reescritas = d.reescritas || [];
  const fila = Number(d.fila || 0);
  const cliente = d.cliente || 'o site';

  const L = [];

  // 1. O que foi ao ar.
  if (publicados.length) {
    L.push(`${plural(publicados.length, 'artigo publicado', 'artigos publicados')} esta semana:`);
    for (const a of publicados) L.push(`  • ${a.title}${a.url ? `\n    ${a.url}` : ''}`);
  } else if (segurados.length) {
    L.push('Nenhum artigo foi ao ar: os desta semana estão esperando você.');
  } else if (!fila) {
    L.push('Nenhum artigo foi ao ar, e a fila está vazia — não havia o que escrever.');
  } else {
    L.push('Nenhum artigo foi ao ar esta semana.');
  }

  // 2. O que está preso, que é a única parte que pede ação.
  if (segurados.length) {
    L.push('');
    L.push(`${plural(segurados.length, 'artigo parado', 'artigos parados')}, esperando um dado que só você tem:`);
    for (const a of segurados) {
      L.push(`  • ${a.title}`);
      L.push(`    ${a.motivo}`);
      if (a.url) L.push(`    ${a.url}`);
    }
  }

  if (presos.length) {
    L.push('');
    L.push(`${plural(presos.length, 'tópico barrado', 'tópicos barrados')} antes de escrever:`);
    for (const t of presos) {
      L.push(`  • ${t.topic}`);
      if (t.motivo) L.push(`    ${t.motivo}`);
    }
  }

  // 3. A fila tem com que continuar?
  L.push('');
  if (fila >= 3) {
    L.push(`Fila: ${plural(fila, 'tópico aprovado', 'tópicos aprovados')}. O motor segue sozinho.`);
  } else if (fila > 0) {
    L.push(`Fila: só ${plural(fila, 'tópico', 'tópicos')}. A pauta é gerada toda segunda; `
      + 'se continuar baixa, é sinal de que a geração não está entregando.');
  } else {
    L.push('Fila vazia. A pauta é gerada toda segunda — se na próxima segunda continuar '
      + 'vazia, a geração falhou e vale olhar.');
  }

  // A pauta é a entrada do motor: se ela parar, tudo para três semanas depois,
  // e o sintoma (fila vazia) aparece tarde demais.
  if (d.pauta) {
    const p = d.pauta;
    if (p.status === 'failed') {
      L.push(`Pauta de segunda: FALHOU — ${p.erro || 'sem motivo registrado'}. `
        + 'A fila não foi abastecida.');
    } else if (p.novos > 0) {
      L.push(`Pauta de segunda: ${plural(p.novos, 'tema novo', 'temas novos')} na fila`
        + (p.avaliados ? `, de ${p.avaliados} avaliados na busca` : '') + '.');
    } else if (!p.avaliados) {
      L.push('Pauta de segunda: nada gerado, a fila já estava cheia.');
    } else {
      L.push(`Pauta de segunda: nenhum tema aprovado`
        + (p.avaliados ? ` entre os ${p.avaliados} avaliados` : '')
        + '. Quando isso se repete, o problema não é o gerador — é o nicho não ter busca.');
    }
  }

  if (reescritas.length) {
    const comVeredito = reescritas.filter((r) => r.outcome && r.outcome !== 'pending');
    L.push(`Reescritas: ${reescritas.length} na semana`
      + (comVeredito.length
        ? `, ${comVeredito.length} já com veredito`
        : ', ainda aguardando medição (o cron compara 30 dias depois)') + '.');
  }

  if (d.custo && Number(d.custo.teto)) {
    const pct = Math.round((Number(d.custo.gasto || 0) / Number(d.custo.teto)) * 100);
    L.push(`Custo do mês: US$ ${Number(d.custo.gasto || 0).toFixed(2)} de US$ `
      + `${Number(d.custo.teto).toFixed(2)} (${pct}%).`);
  }

  // O assunto é o que ele lê no celular sem abrir: precisa dizer se tem ação.
  const assunto = segurados.length || presos.length
    ? `SEOHack — ${plural(publicados.length, 'publicado', 'publicados')}, `
      + `${segurados.length + presos.length} esperando você`
    : `SEOHack — ${plural(publicados.length, 'artigo publicado', 'artigos publicados')}`;

  return {
    assunto: `${assunto} · ${cliente}`,
    texto: L.join('\n'),
    // Semana sem nada que peça ação e sem nada publicado ainda é informação:
    // diz que o motor está vivo. Mas o chamador pode decidir não enviar.
    vazio: !publicados.length && !segurados.length && !presos.length && !reescritas.length,
  };
}

/** Envia pelo mesmo Brevo que já avisa os contatos do site. */
export async function enviarResumo(resumo, { fetchImpl = fetch } = {}) {
  const chave = process.env.BREVO_API_KEY;
  const para = process.env.RESUMO_EMAIL || process.env.CONTATO_EMAIL;
  if (!chave || !para) {
    return { enviado: false, motivo: 'BREVO_API_KEY ou CONTATO_EMAIL ausente' };
  }

  try {
    const r = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': chave, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'SEOHack', email: process.env.CONTATO_REMETENTE || para },
        to: [{ email: para }],
        subject: resumo.assunto,
        textContent: resumo.texto,
      }),
    });
    if (!r.ok) return { enviado: false, motivo: `Brevo respondeu ${r.status}` };
    return { enviado: true, para };
  } catch (err) {
    return { enviado: false, motivo: err.message };
  }
}
