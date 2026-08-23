import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCodeApis, extractCodeBlocks } from '../lib/code-check.mjs';

// O trecho real que foi publicado no artigo sobre custos na Vercel.
const artigoVercel = `## Cache no edge

A Vercel permite cachear respostas na borda. Veja como:

\`\`\`js
export default async function handler(req) {
  const cache = caches.default;
  const cached = await cache.match(req);
  if (cached) return cached;
  return new Response('ok', { headers: { 'Cache-Control': 's-maxage=60' } });
}
\`\`\`
`;

test('regressão: caches.default num artigo sobre Vercel é reprovado', () => {
  const r = checkCodeApis(artigoVercel);
  assert.equal(r.length, 1, JSON.stringify(r));
  assert.match(r[0].detail, /Cloudflare Workers/);
  assert.match(r[0].detail, /s-maxage/);
});

test('a mesma API num artigo sobre Cloudflare passa', () => {
  const artigoCF = artigoVercel.replace(/Vercel/g, 'Cloudflare Workers');
  assert.deepEqual(checkCodeApis(artigoCF), []);
});

test('artigo sem bloco de código não é analisado', () => {
  assert.deepEqual(checkCodeApis('## Texto sobre Vercel sem código nenhum.'), []);
});

test('artigo que não cita plataforma não é analisado', () => {
  // Sem plataforma citada não há como saber qual API é a errada — e acusar
  // no escuro reprovaria artigo legítimo.
  const md = '## Genérico\n\n```js\nconst c = caches.default;\n```';
  assert.deepEqual(checkCodeApis(md), []);
});

test('Deno.* num artigo sobre Node é reprovado', () => {
  const md = '## Node.js\n\nExemplo:\n\n```js\nconst txt = await Deno.readTextFile("a.txt");\n```';
  const r = checkCodeApis(md);
  assert.equal(r.length, 1);
  assert.match(r[0].detail, /Deno/);
});

test('__dirname em contexto ESM é apontado', () => {
  const md = '## Vercel\n\n```js\nimport x from "y";\nconst p = __dirname + "/a";\n```';
  assert.equal(checkCodeApis(md).length, 1);
});

test('__dirname passa quando o artigo trata de CommonJS', () => {
  const md = '## Node.js com CommonJS\n\n```js\nconst x = require("y");\nconst p = __dirname;\n```';
  assert.deepEqual(checkCodeApis(md), []);
});

test('localStorage em artigo de servidor é apontado', () => {
  const md = '## Vercel\n\n```js\nconst t = localStorage.getItem("token");\n```';
  assert.equal(checkCodeApis(md).length, 1);
});

test('localStorage passa em artigo de front-end', () => {
  const md = '## Front-end no navegador\n\n```js\nconst t = localStorage.getItem("token");\n```';
  assert.deepEqual(checkCodeApis(md), []);
});

test('extrai blocos com e sem linguagem declarada', () => {
  const b = extractCodeBlocks('```js\na\n```\n\ntexto\n\n```\nb\n```');
  assert.equal(b.length, 2);
  assert.equal(b[0].lang, 'js');
  assert.equal(b[1].lang, null);
});

test('regressão: a API não pode se auto-isentar pelo próprio nome', () => {
  // `Deno.readTextFile` contém "Deno". Se a detecção de plataforma olhar o
  // código, a regra conclui que o artigo é sobre Deno e libera o uso.
  const md = '## Node.js\n\n```js\nawait Deno.readTextFile("a");\n```';
  assert.equal(checkCodeApis(md).length, 1, 'a API se auto-isentou');
});

test('menção à plataforma dona precisa estar na prosa', () => {
  const naProsa = '## Rodando em Deno Deploy\n\n```js\nawait Deno.readTextFile("a");\n```';
  assert.deepEqual(checkCodeApis(naProsa), []);
});

test('código inline também não conta como menção', () => {
  const md = '## Vercel\n\nUse `caches.default` assim:\n\n```js\nconst c = caches.default;\n```';
  assert.equal(checkCodeApis(md).length, 1);
});
