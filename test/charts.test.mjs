import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graficoLinha, graficoBarras, distribuicaoDeRanking, eixoDeDatas } from '../lib/charts.mjs';

const serie = [{ nome: 'ClaudeBot', pontos: [
  { x: '2026-08-22', y: 30 }, { x: '2026-08-23', y: 47 }, { x: '2026-08-24', y: 12 }] }];

test('linha com dado gera SVG', () => {
  const svg = graficoLinha(serie, { titulo: 'Visitas' });
  assert.match(svg, /<svg viewBox/);
  assert.match(svg, /<path d="M/);
  assert.match(svg, /ClaudeBot/);
});

test('série toda zerada não vira gráfico', () => {
  // Eixo com zeros sugere fracasso; ausência de medição não é fracasso.
  assert.equal(graficoLinha([{ nome: 'X', pontos: [{ x: 'a', y: 0 }, { x: 'b', y: 0 }] }]), '');
  assert.equal(graficoLinha([]), '');
});

test('um ponto só não vira linha', () => {
  assert.equal(graficoLinha([{ nome: 'X', pontos: [{ x: '2026-08-22', y: 5 }] }]), '');
});

test('valores não numéricos não geram NaN no SVG', () => {
  const svg = graficoLinha([{ nome: 'X', pontos: [
    { x: 'a', y: 10 }, { x: 'b', y: null }, { x: 'c', y: undefined }, { x: 'd', y: 'lixo' }] }]);
  assert.ok(!svg.includes('NaN'), 'gerou NaN nas coordenadas');
});

test('barras com valor zerado são omitidas', () => {
  assert.equal(graficoBarras([{ rotulo: 'a', valor: 0 }]), '');
  const svg = graficoBarras([{ rotulo: 'a', valor: 5 }, { rotulo: 'b', valor: 0 }]);
  assert.match(svg, /rotulo">a/);
  assert.ok(!svg.includes('rotulo">b'), 'incluiu barra de valor zero');
});

test('rótulo malicioso é escapado', () => {
  const svg = graficoBarras([{ rotulo: '<script>alert(1)</script>', valor: 5 }]);
  assert.ok(!svg.includes('<script>'));
  assert.match(svg, /&lt;script&gt;/);
});

test('distribuição ignora artigo sem posição medida', () => {
  // Artigo sem dado não é "posição ruim" — somá-lo à última faixa mentiria.
  const r = distribuicaoDeRanking([
    { position: 2 }, { position: 8 }, { position: 45 }, { position: null }, {}]);
  assert.equal(r.total, 3);
  assert.equal(r.faixas.find((f) => f.rotulo === 'Top 3').valor, 1);
  assert.equal(r.faixas.find((f) => f.rotulo === 'Top 10').valor, 1);
  assert.equal(r.faixas.find((f) => f.rotulo === 'Além do Top 20').valor, 1);
});

test('sem nenhuma posição medida, não há distribuição', () => {
  assert.equal(distribuicaoDeRanking([{ position: null }, {}]).total, 0);
  assert.deepEqual(distribuicaoDeRanking([]).faixas, []);
});

test('eixo de datas não pula dia sem dado', () => {
  const d = eixoDeDatas('2026-08-22', '2026-08-25');
  assert.deepEqual(d, ['2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25']);
});

test('regressão: posição nula não é contada como Top 3', () => {
  // Number(null) é 0 e Number.isFinite(0) é true — artigo sem medição virava
  // primeiro colocado na distribuição.
  const r = distribuicaoDeRanking([{ position: null }, { position: 0 }, { position: '' }]);
  assert.equal(r.total, 0, 'contou artigo sem posição medida');
});
