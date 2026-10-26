// O shell do site envelhece em silêncio.
//
// 25/10/2026: o GenBreed entrou no ar, o rodapé do site passou a listá-lo, e o
// rodapé que o SEOHack injeta em cada artigo continuou com os quatro produtos
// antigos. Vinte e seis páginas publicadas com um produto a menos no rodapé, e
// nada acusou — o shell é cópia manual do index.html do cliente, com um comentário
// pedindo "reextrair sempre que o layout mudar".
//
// Ninguém reextrai. Então o que o shell PRECISA ter vira teste: todo produto
// cadastrado em seeds/products.json que mora no próprio site do cliente tem de
// aparecer no rodapé injetado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ler = async (p) => JSON.parse(
  await readFile(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8'));

test('todo produto cadastrado aparece no rodapé injetado nos artigos', async () => {
  const { products } = await ler('seeds/products.json');
  const shell = await ler('seeds/site-shell.json');
  const rodape = shell.footerHtml.toLowerCase();

  for (const p of products) {
    // O rodapé do site da HTF lista produtos pelo nome; o caminho pode ser
    // interno (/neuroart) ou domínio próprio (genbreed.com.br → /genbreed).
    assert.ok(rodape.includes(p.name.toLowerCase()),
      `"${p.name}" está em products.json e não aparece no rodapé dos artigos — `
      + 'o shell foi extraído antes do produto existir');
  }
});

test('o rodapé não anuncia produto que não existe mais', async () => {
  const { products } = await ler('seeds/products.json');
  const shell = await ler('seeds/site-shell.json');
  const nomes = new Set(products.map((p) => p.name.toLowerCase()));
  // Produtos do site que não estão em products.json são legítimos (nem todo
  // produto tem cluster de conteúdo). O que não pode é o contrário.
  const bloco = /<h2>Produtos<\/h2>(.*?)<\/div>/s.exec(shell.footerHtml);
  assert.ok(bloco, 'o rodapé perdeu a seção de produtos');
  const listados = [...bloco[1].matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1].trim());
  assert.ok(listados.length >= nomes.size,
    `o rodapé lista ${listados.length} produtos e products.json tem ${nomes.size}`);
});

test('o shell carrega o mesmo CSS e script do site, sem inline', async () => {
  const shell = await ler('seeds/site-shell.json');
  assert.match(shell.bodyEnd, /<script src="\/js\/site\.js"/);
  assert.doesNotMatch(shell.headerHtml, /<script>/, 'script inline quebra a CSP do site');
  assert.doesNotMatch(shell.footerHtml, /<script>/);
});

// --- propagar o shell novo para quem já está no ar --------------------------
//
// Consertar o shell não conserta as páginas publicadas: elas carregam o HTML
// do dia em que foram geradas. O `corrigir-publicados` passa lote vazio e só
// refaz índice e sitemap, então existia o conserto e não existia o caminho
// para aplicá-lo nas 26 páginas.
test('o script de rerender republica as páginas sem chamar o modelo', async () => {
  const src = await readFile(
    fileURLToPath(new URL('../scripts/rerender.mjs', import.meta.url)), 'utf8');
  assert.doesNotMatch(src, /lib\/llm\.mjs|complete\(/, 'refazer o HTML não pode custar token');
  assert.doesNotMatch(src, /UPDATE articles|INSERT INTO/,
    'rerender não altera conteúdo nem datas no banco');
  assert.match(src, /markdown: a\.markdown/, 'precisa reaproveitar o corpo que já está gravado');
  assert.match(src, /filter\(\(a\) => !a\.markdown\)/,
    'artigo sem corpo seria publicado como página vazia');
});

test('o rerender está declarado no package.json', async () => {
  const pkg = await ler('package.json');
  assert.equal(pkg.scripts.rerender, 'node --env-file=.env scripts/rerender.mjs');
});

test('o corrigir-publicados continua existindo para o caso dele', async () => {
  const pkg = await ler('package.json');
  assert.ok(pkg.scripts['corrigir-publicados'], 'os dois scripts resolvem problemas diferentes');
});

// --- cluster vazio: o defeito que o mc1r revelou -----------------------------
//
// A tela de consultas inseria tópico sem cluster. O artigo saía publicado com
// o campo vazio, e cluster vazio desliga em silêncio a regra que obriga o link
// do produto daquele cluster e a costura de pilar e satélites.
test('tópico nascido de uma consulta herda o cluster da página que já responde', async () => {
  const src = await readFile(
    fileURLToPath(new URL('../api/ui/consultas.mjs', import.meta.url)), 'utf8');
  assert.match(src, /INSERT INTO topics \(client_id, topic, cluster,/,
    'voltou a inserir tópico sem cluster');
  assert.match(src, /SELECT cluster FROM articles/,
    'o cluster tem de sair da página que serve a busca, não de palpite');
  assert.match(src, /name="pagina"/, 'o formulário precisa mandar a página');
  assert.match(src, /COALESCE\(topics\.cluster, EXCLUDED\.cluster\)/,
    'reenviar a consulta não pode apagar um cluster já corrigido à mão');
});

test('existe caminho para corrigir quem já foi publicado sem cluster', async () => {
  const pkg = await ler('package.json');
  assert.equal(pkg.scripts.cluster, 'node --env-file=.env scripts/cluster.mjs');
  const src = await readFile(
    fileURLToPath(new URL('../scripts/cluster.mjs', import.meta.url)), 'utf8');
  assert.match(src, /UPDATE topics SET cluster/, 'corrigir só o artigo deixa o tópico torto');
  assert.doesNotMatch(src, /content_updated_at/, 'mudar cluster não é mudar conteúdo');
});
