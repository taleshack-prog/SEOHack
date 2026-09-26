// Pré-voo: o que dá para saber de graça tem que ser sabido antes de gastar.
//
// Caso real (26/09/2026): um lote foi disparado para um cliente recém-cadastrado
// pelo painel. O modelo escreveu o artigo, o texto foi pago, e a validação local
// recusou com "product_links (0 links de produto, mínimo 1)" — porque ninguém
// tinha cadastrado produto nenhum para aquele cliente. Falha garantida desde
// antes da primeira palavra, cobrada como se fosse acidente. E, se tivesse
// passado, o publish ainda tentaria escrever num repositório inexistente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendenciasDoCliente, prontoParaProduzir } from '../lib/prontidao.mjs';
import { limparProdutos, validarProdutos, produtosDoFormulario } from '../lib/produtos.mjs';

const COMPLETO = {
  name: 'Hack Tech Farm', domain: 'hacktechfarm.com.br', publish_adapter: 'github',
  adapter_config: { repo: 'taleshack-prog/site', token: 'ghp_x',
                    products: [{ path: '/neuroart', name: 'NeuroArt', about: 'a'.repeat(30), clusters: [] }] },
};

test('cliente completo não tem pendência', () => {
  assert.deepEqual(pendenciasDoCliente(COMPLETO), []);
  assert.equal(prontoParaProduzir(COMPLETO), true);
});

test('cliente recém-cadastrado acusa destino e produto', () => {
  const novo = { name: 'Posthink', domain: 'posthink.com.br',
                 publish_adapter: 'github', adapter_config: {} };
  const p = pendenciasDoCliente(novo);
  assert.equal(p.length, 2);
  assert.deepEqual(p.map((x) => x.chave).sort(), ['destino', 'produto']);
  assert.match(p.find((x) => x.chave === 'destino').detalhe, /repositório|token|Falta/i);
  assert.match(p.find((x) => x.chave === 'destino').comando, /posthink\.com\.br/);
});

test('token sem repositório ainda é destino incompleto', () => {
  const p = pendenciasDoCliente({ ...COMPLETO,
    adapter_config: { ...COMPLETO.adapter_config, repo: '  ' } });
  assert.deepEqual(p.map((x) => x.chave), ['destino']);
});

test('productPaths sozinho já conta como produto cadastrado', () => {
  const p = pendenciasDoCliente({ ...COMPLETO,
    adapter_config: { repo: 'a/b', token: 't', productPaths: ['/planos'] } });
  assert.deepEqual(p, []);
});

test('a lista padrão do validador NÃO conta como produto deste cliente', () => {
  // DEFAULT_PRODUCT_PATHS é da Hack Tech Farm (/servicos, /neuroart…). Herdada
  // por um cliente novo, ela garante que nenhum link do site dele conte.
  const p = pendenciasDoCliente({ ...COMPLETO, adapter_config: { repo: 'a/b', token: 't' } });
  assert.deepEqual(p.map((x) => x.chave), ['produto']);
  assert.equal(p[0].link, '/produtos');
});

test('wordpress e webhook cobram as credenciais que usam', () => {
  const wp = pendenciasDoCliente({ publish_adapter: 'wordpress',
    adapter_config: { baseUrl: 'https://x.com', products: [{ path: '/p' }] } });
  assert.match(wp[0].detalhe, /usuário/);
  assert.match(wp[0].detalhe, /Application Password/);

  const hook = pendenciasDoCliente({ publish_adapter: 'webhook',
    adapter_config: { url: 'https://x.com/h', products: [{ path: '/p' }] } });
  assert.match(hook[0].detalhe, /token/);
});

test('adapter aceito pelo banco mas sem implementação é pendência, não 500', () => {
  // O CHECK da migração 002 aceita 'ghost' e 'webflow', que não existem em
  // lib/adapters. Gerar para eles quebraria no fim, depois de pagar.
  const p = pendenciasDoCliente({ publish_adapter: 'ghost',
    adapter_config: { products: [{ path: '/p' }] } });
  assert.deepEqual(p.map((x) => x.chave), ['adapter']);
  assert.match(p[0].detalhe, /ghost/);
});

// --- produtos ---

test('produto sem descrição não grava', () => {
  const erros = validarProdutos(limparProdutos([{ name: 'X', path: '/x', about: 'curto' }]));
  assert.equal(erros.length, 1);
  assert.match(erros[0], /descrição/);
});

test('dois produtos no mesmo cluster é ambiguidade, não preferência', () => {
  const erros = validarProdutos(limparProdutos([
    { name: 'A', path: '/a', about: 'a'.repeat(30), clusters: ['genetica'] },
    { name: 'B', path: '/b', about: 'b'.repeat(30), clusters: ['genetica'] }]));
  assert.equal(erros.length, 1);
  assert.match(erros[0], /genetica/);
});

test('o formulário aceita um produto só e normaliza o cluster', () => {
  const { produtos, erros } = produtosDoFormulario({
    name: 'Posthink', path: 'https://posthink.com.br/',
    about: 'agente que escreve e agenda posts no LinkedIn',
    clusters: ' Engajamento no LinkedIn , ', voice: '' });
  assert.deepEqual(erros, []);
  assert.equal(produtos.length, 1);
  assert.equal(produtos[0].path, 'https://posthink.com.br', 'não tirou a barra final');
  assert.deepEqual(produtos[0].clusters, ['engajamento-no-linkedin']);
  assert.equal('voice' in produtos[0], false, 'gravou voz vazia');
});

test('linha em branco do formulário é ignorada, e limpar o nome apaga o produto', () => {
  const { produtos } = produtosDoFormulario({
    name: ['Posthink', '', ''],
    path: ['https://posthink.com.br', '', ''],
    about: ['agente que escreve e agenda posts no LinkedIn', '', ''],
    clusters: ['', '', ''], voice: ['', '', ''] });
  assert.equal(produtos.length, 1);

  const vazio = produtosDoFormulario({ name: ['', ''], path: ['', ''],
                                       about: ['sobrou texto aqui', ''], clusters: ['', ''] });
  assert.deepEqual(vazio.produtos, []);
  assert.deepEqual(vazio.erros, []);
});

test('caminho inválido é recusado antes de chegar ao banco', () => {
  const { erros } = produtosDoFormulario({ name: 'X', path: 'posthink.com.br',
                                           about: 'a'.repeat(30), clusters: '' });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /\/algo ou https:/);
});
