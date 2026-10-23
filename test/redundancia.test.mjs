// Repetição: o defeito que passou pela primeira reescrita real.
//
// 23/10/2026, depressão endogâmica. O motor acertou tudo que era mecânico e
// publicou um texto que explicava a homozigose cinco vezes e tinha um FAQ
// devolvendo o corpo. Nenhuma regra de validação pega isso — repetição não é
// erro, é excesso —, então vira medida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conteudo, frases, semelhanca, trechosRepetidos, grauDeRedundancia, LIMIAR,
} from '../lib/redundancia.mjs';

const MECANISMO_1 = 'Depressão endogâmica é a perda de vigor de uma linhagem causada pelo '
  + 'aumento da homozigose de alelos recessivos deletérios ao longo das gerações.';
const MECANISMO_2 = 'A causa direta é sempre a mesma: o acasalamento entre parentes aumenta '
  + 'a homozigose de alelos recessivos deletérios dentro da linhagem.';
const OUTRO = 'Gatos siameses têm pelagem clara e extremidades escuras por causa de um '
  + 'alelo termossensível da enzima tirosinase.';

test('a mesma ideia reescrita em outras palavras é reconhecida', () => {
  assert.ok(semelhanca(MECANISMO_1, MECANISMO_2) >= LIMIAR,
    `só ${semelhanca(MECANISMO_1, MECANISMO_2).toFixed(2)} — a paráfrase escapou`);
});

test('frases distintas do mesmo assunto não são acusadas', () => {
  assert.equal(semelhanca(MECANISMO_1, OUTRO), 0);
  assert.equal(
    semelhanca('O coeficiente de endogamia mede a probabilidade de dois alelos serem '
      + 'idênticos por descendência naquele indivíduo.',
      'O cruzamento com linhagem externa introduz variabilidade nova e reduz a '
      + 'frequência de homozigotos no plantel.'), 0);
});

test('flexão diferente não engana — "aumento" e "aumenta" contam igual', () => {
  assert.deepEqual(conteudo('o aumento'), conteudo('do aumenta'));
  assert.deepEqual(conteudo('as linhagens'), conteudo('da linhagem'));
});

test('as palavras de ligação não inflam a semelhança', () => {
  // Duas frases que só compartilham "de", "a", "que" não têm nada em comum.
  assert.equal(semelhanca('A probabilidade de que isso ocorra com a ninhada é alta hoje.',
    'De todas as formas que a gente conhece, essa é a mais simples de aplicar.'), 0);
});

test('lista, título e tabela não entram na conta', () => {
  const md = `## Em resumo

- a homozigose de alelos recessivos deletérios aumenta na linhagem fechada
- a homozigose de alelos recessivos deletérios aumenta na linhagem fechada

| col | a homozigose de alelos recessivos deletérios aumenta na linhagem |
|---|---|

${MECANISMO_1}`;
  assert.equal(frases(md).length, 1, 'contou item de lista como prosa');
  assert.equal(grauDeRedundancia(md), 0, 'resumir em lista virou repetição');
});

test('bloco de código não vira repetição', () => {
  const md = '```js\nconst a = 1;\nconst a = 1;\nconst a = 1;\n```\n\n' + MECANISMO_1;
  assert.equal(grauDeRedundancia(md), 0);
});

test('o grau cresce com a repetição e some sem ela', () => {
  const inchado = [MECANISMO_1, MECANISMO_2, OUTRO].join('\n\n');
  const enxuto = [MECANISMO_1, OUTRO].join('\n\n');
  assert.ok(grauDeRedundancia(inchado) > 0);
  assert.equal(grauDeRedundancia(enxuto), 0);
});

test('texto curto demais não é julgado', () => {
  assert.equal(grauDeRedundancia(MECANISMO_1), 0);
  assert.equal(grauDeRedundancia(''), 0);
});

test('o par repetido é devolvido para o motivo da recusa fazer sentido', () => {
  const pares = trechosRepetidos([MECANISMO_1, MECANISMO_2].join('\n\n'));
  assert.equal(pares.length, 1);
  assert.match(pares[0].a + pares[0].b, /homozigose/);
  assert.ok(pares[0].semelhanca >= LIMIAR);
});
