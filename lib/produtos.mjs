// Produtos de um cliente: o que os artigos existem para divulgar.
//
// Viviam só em seeds/products.json, gravados por `npm run sync-products` — que
// além de exigir terminal escrevia sempre no CLIENT_DOMAIN, ou seja, num motor
// multi-cliente só a Hack Tech Farm conseguia ter produto. Cliente novo nascia
// com a lista vazia, e a primeira geração dele era recusada por
// `product_links (0 links de produto, mínimo 1)` depois de o texto ser pago.
//
// As regras de validação ficam aqui, uma vez só, e servem ao script e à tela.

const SOBRE_MINIMO = 20;

export const ehCaminho = (p = '') =>
  /^\/[a-z0-9-/]*$/i.test(p) || /^https:\/\/[^\s]+$/i.test(p);

/** Normaliza sem julgar: tira barra final, corta espaço, ordena as chaves. */
export function limparProdutos(produtos = []) {
  return produtos.map(({ path, name, about, clusters = [], voice }) => ({
    path: String(path || '').trim().replace(/\/+$/, '') || '/',
    name: String(name || '').trim(),
    about: String(about || '').trim(),
    clusters: (Array.isArray(clusters) ? clusters : String(clusters || '').split(','))
      .map((c) => String(c).trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean),
    ...(voice && String(voice).trim() ? { voice: String(voice).trim() } : {}),
  }));
}

/**
 * @returns {Array<string>} mensagens; lista vazia significa que pode gravar.
 */
export function validarProdutos(produtos = []) {
  const erros = [];

  produtos.forEach((p, i) => {
    const onde = `produto ${i + 1} (${p.name || 'sem nome'})`;
    if (!p.name) erros.push(`${onde}: falta o nome`);
    if (!p.about || p.about.length < SOBRE_MINIMO) {
      erros.push(`${onde}: a descrição está vazia ou curta demais — é o texto que o modelo lê `
        + 'para decidir onde o link cabe');
    }
    if (!p.path || !ehCaminho(p.path)) {
      erros.push(`${onde}: o caminho precisa ser /algo ou https://dominio`);
    }
  });

  // Dois produtos no mesmo cluster: o validador exige link para "o" produto do
  // cluster, e com dois donos não há resposta certa.
  const donos = new Map();
  for (const p of produtos) {
    for (const c of p.clusters || []) {
      if (donos.has(c)) erros.push(`o cluster "${c}" está em dois produtos (${donos.get(c)} e ${p.name})`);
      else donos.set(c, p.name);
    }
  }

  const caminhos = new Set();
  for (const p of produtos) {
    if (caminhos.has(p.path)) erros.push(`o caminho ${p.path} aparece duas vezes`);
    caminhos.add(p.path);
  }

  return erros;
}

/**
 * Lê o formulário do painel, que manda um campo por coluna e uma posição por
 * produto. Linha sem nome e sem caminho é linha em branco: some sem reclamar,
 * que é como se apaga um produto pela tela.
 */
export function produtosDoFormulario(body = {}) {
  const lista = (k) => (body[k] === undefined ? [] : [].concat(body[k]));
  const nomes = lista('name');
  const cru = nomes.map((_, i) => ({
    name: nomes[i], path: lista('path')[i], about: lista('about')[i],
    clusters: lista('clusters')[i], voice: lista('voice')[i],
  })).filter((p) => String(p.name || '').trim() || String(p.path || '').trim());

  const produtos = limparProdutos(cru);
  return { produtos, erros: validarProdutos(produtos) };
}
