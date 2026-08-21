#!/usr/bin/env node
// Configura o destino de publicação do cliente (clients.adapter_config).
//
// Feito como script e não como UPDATE colado no terminal porque o config
// carrega HTML dentro de JSON dentro de SQL — três níveis de escape, e um
// aspas errada só apareceria como página quebrada semanas depois.
//
// Uso: node --env-file=.env scripts/configure-target.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sql, getClient } from '../lib/db.mjs';

const shellPath = fileURLToPath(new URL('../seeds/site-shell.json', import.meta.url));
const shell = JSON.parse(await readFile(shellPath, 'utf8'));
delete shell._comment;

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN ausente no .env.');
  console.error('Crie um fine-grained token com acesso só ao repositório do site');
  console.error('e permissão Contents: Read and write.');
  process.exit(1);
}

const config = {
  // --- destino ---
  token,
  repo: process.env.GITHUB_REPO || 'taleshack-prog/Hack-Tech-Farm-site',
  branch: 'main',

  // Site serve da raiz, sem build: o HTML entra direto em blog/.
  contentDir: 'blog',
  sitemapPath: 'sitemap-blog.xml',

  // O Markdown fonte NÃO vai para o repositório. Com cleanUrls ligado ele
  // viraria URL pública e competiria com o artigo. O texto vive no Neon.
  keepSource: false,

  // --- identidade do site ---
  baseUrl: 'https://hacktechfarm.com.br',
  blogBasePath: '/blog',
  cssHref: '/css/styles.css',
  authorUrl: 'https://hacktechfarm.com.br/sobre',

  // --- links exigidos pelo PRD §20 ---
  // Só o conjunto comercial. /parceiros e /roadmap existem, mas linkar para
  // eles não cumpre a intenção da regra, que é ligar conteúdo técnico a algo
  // vendável. Caminhos sem .html porque o site usa cleanUrls.
  productPaths: ['/produtos', '/posthink', '/neuroart', '/asphalt', '/galeria', '/contato'],

  shell,
};

const client = await getClient();
await sql`
  UPDATE clients
     SET publish_adapter = 'github',
         adapter_config = ${JSON.stringify(config)}::jsonb,
         adapter_verified_at = NULL
   WHERE id = ${client.id}`;

const [c] = await sql`SELECT publish_adapter, adapter_config FROM clients WHERE id = ${client.id}`;
const cfg = c.adapter_config;
console.log('✓ Destino configurado\n');
console.log(`  adapter      ${c.publish_adapter}`);
console.log(`  repositório  ${cfg.repo} (${cfg.branch})`);
console.log(`  pasta        ${cfg.contentDir}/`);
console.log(`  URL base     ${cfg.baseUrl}${cfg.blogBasePath}/<slug>`);
console.log(`  CSS          ${cfg.cssHref}`);
console.log(`  shell        ${Object.keys(cfg.shell).join(', ')}`);
console.log(`  produtos     ${cfg.productPaths.join(' ')}`);
console.log(`  token        ${'*'.repeat(12)}${cfg.token.slice(-4)}`);
console.log('\nRode "npm run doctor" para validar o acesso ao repositório.');
