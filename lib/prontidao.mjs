// O cliente está pronto para produzir?
//
// Motivo de existir: um lote foi disparado para um cliente recém-cadastrado,
// sem destino de publicação e sem produto. O modelo escreveu o artigo inteiro,
// o texto foi pago, e só então a validação local recusou por
// `product_links (0 links de produto, mínimo 1)` — falha garantida desde antes
// da primeira palavra. Depois disso o `publish` ainda tentaria falar com um
// repositório inexistente.
//
// A ordem estava invertida: o que dá para saber de graça, antes de gastar,
// passa a ser conferido antes de gastar. Nenhuma destas checagens faz rede.
//
// Não é health check: aqui não se pergunta se o token é válido, só se ele
// existe. Validar credencial é trabalho do /api/health?deep=1, que custa
// chamadas externas e não cabe no caminho de um clique.

/** Chaves que cada adapter precisa ter em adapter_config para publicar. */
const EXIGIDO = {
  github: [['repo', 'o repositório do site (usuario/repo)'], ['token', 'o token de acesso']],
  wordpress: [['baseUrl', 'o endereço do site'], ['username', 'o usuário'],
              ['applicationPassword', 'a Application Password']],
  webhook: [['url', 'a URL que recebe o POST'], ['token', 'o token compartilhado']],
};

const vazio = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * @param {object} client  linha da tabela clients
 * @returns {Array<{chave:string, titulo:string, detalhe:string, comando?:string}>}
 *          lista vazia = pronto para produzir
 */
export function pendenciasDoCliente(client = {}) {
  const cfg = client.adapter_config || {};
  const fora = [];

  const adapter = client.publish_adapter;
  const exigido = EXIGIDO[adapter];

  if (!adapter || !exigido) {
    fora.push({
      chave: 'adapter',
      titulo: 'Sem destino de publicação',
      detalhe: adapter
        ? `O adapter "${adapter}" não existe. Os disponíveis são ${Object.keys(EXIGIDO).join(', ')}.`
        : 'Este cliente não tem adapter definido, então o artigo pronto não teria para onde ir.',
      comando: 'npm run configure',
    });
  } else {
    const faltando = exigido.filter(([k]) => vazio(cfg[k]));
    if (faltando.length) {
      fora.push({
        chave: 'destino',
        titulo: 'Destino de publicação incompleto',
        detalhe: `Falta ${faltando.map(([, d]) => d).join(' e ')}. `
          + 'O artigo seria escrito e pago, e a publicação falharia no fim.',
        comando: `npm run configure ${client.domain || ''}`.trim(),
      });
    }
  }

  // A lista padrão de caminhos de produto do validador é da Hack Tech Farm
  // (/servicos, /neuroart…). Herdada por um cliente novo, ela garante que
  // nenhum link escrito para o site DELE conte, e o artigo é recusado.
  const caminhos = [
    ...(Array.isArray(cfg.productPaths) ? cfg.productPaths : []),
    ...(Array.isArray(cfg.products) ? cfg.products.map((p) => p?.path) : []),
  ].filter((p) => !vazio(p));

  if (!caminhos.length) {
    fora.push({
      chave: 'produto',
      titulo: 'Nenhum produto cadastrado',
      detalhe: 'Todo artigo precisa de pelo menos um link para uma página de produto, '
        + 'e sem produto cadastrado o modelo não tem para onde apontar — a validação '
        + 'recusaria o texto depois de escrito.',
      link: '/produtos',
    });
  }

  return fora;
}

/** Atalho legível no lugar de `pendencias.length === 0`. */
export const prontoParaProduzir = (client) => pendenciasDoCliente(client).length === 0;
