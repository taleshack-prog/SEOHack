#!/usr/bin/env node
// Configura o destino de publicação de um cliente (clients.adapter_config).
//
// Feito como script e não como UPDATE colado no terminal porque o config
// carrega HTML dentro de JSON dentro de SQL — três níveis de escape, e uma
// aspa errada só apareceria como página quebrada semanas depois. E feito como
// script, e não como tela, porque o token de acesso ao repositório não pode
// passar por formulário: segredo em formulário acaba em histórico de sessão,
// em log de proxy e em captura de tela.
//
// Duas correções em relação à primeira versão, ambas descobertas doendo:
//
//  1. O destino era fixo no código (Hack Tech Farm). Num motor multi-cliente
//     isso significa que rodar o script para outro domínio escrevia no cliente
//     errado — e o painel chegou a sugerir exatamente isso.
//  2. Ele gravava o adapter_config INTEIRO. Como os produtos vivem na mesma
//     coluna, desde que a tela /produtos existe, rodar o configure apagaria a
//     lista de produtos que alguém acabou de cadastrar pelo painel.
//
// Uso: npm run configure                      (usa CLIENT_DOMAIN)
//      npm run configure posthink.com.br
//      npm run configure posthink.com.br --repo usuario/outro-repo
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql, getClient } from '../lib/db.mjs';
import { healthCheck } from '../lib/adapters/index.mjs';
import { escolherRepo } from '../lib/alvo.mjs';

const caminho = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const lerJson = async (p) => JSON.parse(await readFile(caminho(p), 'utf8'));

const args = process.argv.slice(2).filter((a) => a !== '--');
const opcoes = new Map();
const soltos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { opcoes.set(args[i].slice(2), args[++i]); } else soltos.push(args[i]);
}
const opcao = (nome) => opcoes.get(nome);
const dominio = soltos[0] || process.env.CLIENT_DOMAIN;

const morrer = (...linhas) => { console.error(linhas.join('\n')); process.exit(1); };

if (!dominio) morrer('Diga de quem é o destino: npm run configure <domínio>');

const alvos = await lerJson('seeds/targets.json');
const alvo = alvos[dominio];
if (!alvo) {
  morrer(`✗ "${dominio}" não está em seeds/targets.json.`,
    `  Domínios descritos lá: ${Object.keys(alvos).filter((k) => !k.startsWith('_')).join(', ')}`,
    '  Acrescente um bloco para ele antes de rodar.');
}

// O específico ganha do genérico. Ver lib/alvo.mjs: o GITHUB_REPO do .env já
// venceu o destino descrito para um cliente e configurou o Posthink para
// publicar no repositório do site da Hack Tech Farm.
const { repo, origem, conflito } = escolherRepo({
  flag: opcao('repo'), alvo: alvo.repo, env: process.env.GITHUB_REPO });

if (alvo.adapter === 'github' && !repo) {
  morrer(`✗ Falta o repositório de ${dominio}.`,
    '  Preencha "repo" no bloco dele em seeds/targets.json, ou passe --repo usuario/repositorio.');
}
if (conflito) console.warn(`⚠ ${conflito}`);


const nomeDoToken = alvo.tokenEnv || 'GITHUB_TOKEN';
const token = process.env[nomeDoToken];
if (alvo.adapter === 'github' && !token) {
  morrer(`✗ ${nomeDoToken} ausente no .env.`,
    '  Crie um fine-grained token com acesso só ao repositório do site',
    '  e permissão Contents: Read and write.');
}

const shell = alvo.shellFile ? await lerJson(alvo.shellFile) : {};
delete shell._comment;

const client = await getClient(dominio);

// O que NÃO se toca: os produtos, que são editados pela tela /produtos.
const anterior = client.adapter_config || {};
const produtos = Array.isArray(anterior.products) ? anterior.products : [];

const config = {
  ...(alvo.adapter === 'github' ? { token, repo, branch: alvo.branch || 'main' } : {}),
  contentDir: alvo.contentDir,
  sitemapPath: alvo.sitemapPath,
  keepSource: Boolean(alvo.keepSource),
  baseUrl: alvo.baseUrl,
  blogBasePath: alvo.blogBasePath || '/blog',
  ...(alvo.cssHref ? { cssHref: alvo.cssHref } : {}),
  ...(alvo.authorUrl ? { authorUrl: alvo.authorUrl } : {}),
  ...(alvo.logoUrl ? { logoUrl: alvo.logoUrl } : {}),
  ...(Array.isArray(alvo.productPaths) ? { productPaths: alvo.productPaths } : {}),
  ...(Object.keys(shell).length ? { shell } : {}),
  products: produtos,
};

// Confere ANTES de gravar que o token enxerga o repositório e a branch. Sem
// isto, um repo com nome errado só aparece no fim de uma produção — depois de
// o texto estar escrito e pago.
try {
  const ok = await healthCheck({ publish_adapter: alvo.adapter, adapter_config: config });
  console.log(`✓ destino acessível: ${JSON.stringify(ok)}`);
} catch (err) {
  morrer(`✗ Nada foi gravado. O destino não respondeu: ${err.message}`,
    '  Confira o repositório, a branch e a permissão do token (Contents: Read and write).');
}

await sql`
  UPDATE clients
     SET publish_adapter = ${alvo.adapter},
         adapter_config = ${JSON.stringify(config)}::jsonb,
         adapter_verified_at = NOW()
   WHERE id = ${client.id}`;

console.log(`\n✓ Destino configurado — ${client.name} (${client.domain})\n`);
console.log(`  adapter      ${alvo.adapter}`);
if (repo) console.log(`  repositório  ${repo} (${config.branch}) — de ${origem}`);
console.log(`  pasta        ${config.contentDir}/`);
console.log(`  URL base     ${config.baseUrl}${config.blogBasePath}/<slug>`);
console.log(`  sitemap      ${config.baseUrl}/${String(config.sitemapPath).replace(/^public\//, '')}`);
console.log(`  moldura      ${Object.keys(shell).join(', ') || 'nenhuma (página sem cabeçalho do site)'}`);
console.log(`  produtos     ${produtos.length ? produtos.map((p) => p.name).join(', ') : 'nenhum — cadastre em /produtos'}`);
