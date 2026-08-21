# SEOHack — SEO App

O **cérebro** do Automated SEO+GEO Content Engine da Hack Tech Farm. Descobre
tópicos, gera artigos, mede performance e dispara reescritas.

## Instalação zero no site do cliente

**Nada deste sistema roda no site do cliente.** O App valida, renderiza HTML e
publica no destino por API. O cliente concede acesso uma vez e nunca instala,
mantém ou atualiza código — requisito para vender isso como produto.

A função F8 do PRD v4 foi eliminada: ela existia porque o desenho original
assumia que o site precisava *receber* um POST. Não precisa. A fronteira real é
a API do destino (GitHub, WordPress, Ghost), que é chamável de qualquer lugar.

```
SEOHack (este repo — tudo acontece aqui)          destino do cliente
──────────────────────────────────────            ──────────────────
research → content → validate → render ──┬─ github ──► commit atômico no repo
tracking ← GSC API                       ├─ wordpress ► REST API
citation ← Perplexity API                ├─ ghost/webflow (roadmap)
optimization                             └─ webhook ──► endpoint próprio
   ↕                                                    (enterprise, opcional)
 Neon
```

| Adapter | O cliente concede | O cliente instala |
|---|---|---|
| `github` | GitHub App no repo (1 clique) | **nada** |
| `wordpress` | Application Password | **nada** |
| `webhook` | — | endpoint + verificação HMAC |

O `webhook` é a antiga F8. Continua disponível para cliente enterprise que exige
perímetro fechado, mas deixou de ser o padrão.

### O que ainda exige uma ação do cliente

Não dá para prometer "zero toque" e mentir. Três coisas não são automatizáveis:

1. **`robots.txt` liberando crawlers de IA.** Sem isso o pilar GEO não roda. Com
   o adapter `github` o App pode abrir um PR com o arquivo; nos demais é uma
   edição manual, uma vez.
2. **Acesso à Search Console.** A service account precisa ser adicionada como
   usuário da propriedade. Não há como contornar.
3. **CSS do blog.** O `adapter_config.cssHref` aponta para a folha de estilo que
   o cliente já tem; o `shell` permite injetar header e footer dele.

Se este app cair inteiro, o site do cliente continua no ar — o conteúdo já
publicado é estático e não depende de nada daqui.

## Setup

### 1. Neon
Crie o projeto e pegue as **duas** connection strings. A *pooled* (com `-pooler`
no host) vai em `DATABASE_URL`; a direta em `DATABASE_URL_UNPOOLED`. Migração de
DDL via PgBouncer em transaction mode dá problema — por isso as duas.

**Node 24 é obrigatório.** A Vercel desativa o Node 20 em 1º de outubro de 2026
e a `sanitize-html` já exige >= 22.12. O `engines` do `package.json` sobrepõe a
configuração do projeto na Vercel, então basta manter os dois alinhados.

```bash
nvm install 24 && nvm use 24    # ou: corepack/fnm/asdf
node -v                         # tem que ser v24.x

cp .env.example .env            # preencher
npm install                     # deve reportar 0 vulnerabilities
npm run migrate                 # aplica 001_schema_v5 e 002_publish_adapters
```

### 2. Configurar o destino de publicação

Não há mais segredo compartilhado com o site. Configure o adapter em
`clients.adapter_config`:

```sql
UPDATE clients SET publish_adapter = 'github', adapter_config = '{
  "token": "ghp_...",
  "repo": "taleshack-prog/site",
  "branch": "main",
  "contentDir": "public/blog",
  "sitemapPath": "public/sitemap-blog.xml",
  "baseUrl": "https://hacktechfarm.com.br",
  "blogBasePath": "/blog",
  "cssHref": "/css/style.css",
  "productPaths": ["/servicos", "/contato"]
}'::jsonb WHERE domain = 'hacktechfarm.com.br';
```

`npm run secrets` só é necessário para o adapter `webhook`.

### 3. Service account do Google
No Google Cloud: crie a service account, habilite a Search Console API, baixe o
JSON. Depois, **na Search Console**, adicione o `client_email` como usuário da
propriedade — esquecer este passo é o erro mais comum e o sintoma é 403.

`GSC_PRIVATE_KEY` vai com os `\n` literais; o código faz o replace.

### 4. Vercel
Projeto separado do site, importando este repo. Requer **plano Pro**: no Hobby
são no máximo 2 crons e frequência de 1x/dia — os 5 schedules do `vercel.json`
falham no deploy. Colar todas as env vars do `.env.example`; `CRON_SECRET` a
própria Vercel provisiona.

### 5. Alimentar a fila
```bash
cp seeds/clusters.example.csv seeds/clusters.csv   # editar com os clusters reais
npm run seed seeds/clusters.csv
```

Este passo é obrigatório e é manual de propósito. O Research Engine descobre
tópicos lendo posições 11–20 na Search Console, mas o blog ainda não existe — não
há impressões residuais para ler. Enquanto o `/blog` não passar de 200
impressões/dia, o motor opera em **modo seed** e a entrada vem daqui. O gate
seed → gsc é automático, por volume, não por data.

## O override de `htmlparser2` em `package.json`

Não remova. O `sanitize-html` é CommonJS mas passou a depender de
`htmlparser2` v12, que é ESM puro — combinação que só funciona em runtime com
suporte a `require()` de ESM. O runtime de funções da Vercel não tem, e o
deploy quebra com `ERR_REQUIRE_ESM` **apenas em produção**: local passa, os
testes passam, e a falha só aparece na primeira invocação real.

O override fixa o parser em `^9.1.0`, a última versão CommonJS. Dois testes em
`test/render.test.mjs` travam isso: um carrega o sanitizador por `require()`
reproduzindo o caminho que falhou, outro verifica que o parser resolvido não é
ESM.

## Painel de operação

O painel é onde você trabalha. URL raiz do projeto na Vercel, protegido por senha.

| Rota | O que faz |
|---|---|
| `/` | fila do que está parado esperando você, fila de tópicos e gasto do mês |
| `/review/<slug>` | o artigo como manuscrito, com lacunas abertas onde a IA parou |
| `/login` | entrada |
| `/api/health` | estado da conexão e variáveis faltando |

**A tela de revisão é o centro do sistema.** Quando o gerador precisa de um
relato real, ele escreve `[NOTA PARA O OPERADOR]` no lugar e o artigo para.
Nessa tela o texto aparece inteiro, em serifa, com uma lacuna vermelha exatamente
onde falta a sua frase — você escreve dentro do artigo, vendo o contexto, e
publica dali. Deixar a lacuna vazia remove o trecho.

Artigo com nota pendente **não** vai para o site. Fica no banco até você liberar.

Duas variáveis novas, obrigatórias:

```
DASHBOARD_PASSWORD=""    # a sua senha
DASHBOARD_SECRET=""      # openssl rand -hex 32
```

Sem elas o painel não sobe — e como a URL da Vercel é pública, sem senha
qualquer pessoa publicaria no seu site.

## Verificação

```bash
npm test                       # 19 testes, sem rede e sem banco
curl https://<projeto>.vercel.app/api/health
```

O `/api/health` reporta conexão com o Neon e quais env vars faltam. É o smoke
test do Sprint 1.

Para disparar um cron à mão:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<projeto>.vercel.app/api/cron/research
```

## Estrutura

```
api/
  health.mjs              smoke test
  cron/research.mjs       modo seed | modo gsc, gate automático por volume
  cron/content.mjs        outline → valida → artigo → valida → F8
  cron/tracking.mjs       GSC janela D-3, upsert idempotente
  cron/citation.mjs       Perplexity API oficial
  cron/optimization.mjs   avalia semanal, elegibilidade 30 dias
lib/
  db.mjs                  Neon: sql`` HTTP + withTenant() para RLS
  validate.mjs            regras de qualidade e segurança (só aqui)
  render.mjs              Markdown -> HTML sanitizado + JSON-LD
  adapters/index.mjs      registro e orquestração
  adapters/github.mjs     Git Data API, commit atômico
  adapters/wordpress.mjs  REST API
  adapters/webhook.mjs    antiga F8, opcional
  publish.mjs             deprecado, re-export de compatibilidade
  llm.mjs                 wrapper agnóstico de provedor
  budget.mjs              token budgeting
  search-console.mjs      GSC com backoff
  pipeline.mjs            pipeline_runs + correlation_id
  cron-auth.mjs           valida CRON_SECRET
  auth.mjs                sessão do painel (cookie HMAC)
  notes.mjs               marcadores do operador -> lacunas editáveis
  ui.mjs                  layout e estilos do painel
api/ui/
  home.mjs                fila
  review.mjs              revisão e publicação
  login.mjs, logout.mjs, topic.mjs
db/migrations/            schema v5, validado em PostgreSQL 16
prompts/                  system-prompt-v5.md
scripts/                  seed-topics.mjs, gen-secrets.mjs
```

## `lib/validate.mjs` roda só aqui

Numa versão anterior deste README havia um aviso sobre manter três cópias
sincronizadas de `validate.mjs` — no App, na F8 e no build do cliente. Esse
problema deixou de existir junto com a F8: a validação acontece uma vez, antes
da renderização, dentro do App. Uma cópia, uma fonte de verdade.

## Decisões que parecem estranhas mas são intencionais

| Decisão | Por quê |
|---|---|
| 2 artigos por execução, 3x/semana | O core update de março de 2026 mirou scaled content abuse. A meta original de 60 artigos em 90 dias é exatamente esse padrão. |
| Artigo com nota do operador entra como `draft: true` | No v4 a IA era instruída a inserir o marcador e o build abortava ao encontrá-lo. O caminho feliz derrubava o pipeline. |
| Tracking coleta D-3, nunca "hoje" | A GSC tem 2–3 dias de atraso. Coletar hoje devolve conjunto vazio. |
| Sem proxy rotativo para medir citação | Violaria os Termos de Google, OpenAI e Perplexity. A API oficial da Perplexity devolve as fontes de forma estruturada e legítima. |
| `page × query` só semanal | É a consulta mais cara em quota de carga da GSC. O gargalo é carga, não QPM. |
| Renderização no App, não no site | Se o cliente precisar rodar o build do blog, ele precisa instalar e manter código. Inviabiliza a venda. |
| Artigo em draft não vira HTML | O gate humano funciona sem precisar de nenhum build gate no destino. |
| HMAC só no adapter webhook | Nem Vercel nem Railway têm IP de egresso estável sem Secure Compute — mas isso só importa em quem usa webhook. |
| `client_id` em tudo com uma linha só | Adicionar tenant depois é migração destrutiva. |

## Estado

- ✅ Sprint 1 — fundação, schema, health, cliente HMAC
- ✅ Sprint 2 — content engine com gate humano, budget, seed
- ✅ Publicação por adapter — github, wordpress, webhook; renderização no App
- 🟡 Sprint 3 — tracking e citation prontos; falta o Log Drain de crawlers de IA
- ✅ Painel de operação — fila de revisão, lacunas editáveis, aprovação de tópicos, login
- 🟡 Sprint 4 — optimization avalia e lista candidatos; a reescrita via LLM está marcada como TODO
- 🔴 Painel de métricas — ranking, citações em IA e histórico de custo ainda não têm tela
- 🔴 Multi-cliente — onboarding, cadastro e isolamento por login não existem

Contexto completo em `00-auditoria-e-correcoes.md` e `02-plano-desenvolvimento-v5.md`.
