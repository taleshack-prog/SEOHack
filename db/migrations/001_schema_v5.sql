-- =============================================================================
-- Automated SEO+GEO Content Engine — Schema v5
-- Neon (PostgreSQL 16) — Hack Tech Farm
--
-- Consolida e corrige os DDLs divergentes do Plano Técnico §4.1 e do PRD §4.2.
-- Correções aplicadas: D1..D9, D14 da auditoria (00-auditoria-e-correcoes.md).
-- Ordem de criação respeita as dependências de FK. Idempotente.
--
-- VALIDADO em PostgreSQL 16 real: executa limpo, é idempotente (re-executável),
-- e os testes de constraint passaram (difficulty=100 aceito, tópico duplicado
-- rejeitado, status inválido rejeitado, upsert de métrica não duplica linha,
-- artigo sem métrica aparece na view, rewrite_count>3 rejeitado, publicação com
-- nota pendente rejeitada, RLS isola por tenant e falha fechada sem SET LOCAL).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- domínio case-insensitive

-- -----------------------------------------------------------------------------
-- 1. CLIENTS — multi-tenant desde o dia 1 (D7)
--    Mesmo com uma única linha hoje, evita migração destrutiva quando o PRD §40
--    (SEO-as-a-Service) for executado.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(120) NOT NULL,
  domain         CITEXT UNIQUE NOT NULL,          -- hacktechfarm.com.br
  gsc_property   TEXT NOT NULL,                   -- sc-domain:hacktechfarm.com.br
  publish_url    TEXT NOT NULL,                   -- https://.../api/f8/publish
  monthly_budget_usd NUMERIC(8,2) NOT NULL DEFAULT 50.00,  -- D9 / PRD §38
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. PROMPTS — versionamento por hash. O texto vive no Git (B11); aqui fica
--    apenas a identidade, para atribuir performance de ranking a uma versão.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prompts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(60) NOT NULL,              -- system-prompt
  version      VARCHAR(20) NOT NULL,              -- v4.0, v4.1
  content_sha  CHAR(64) NOT NULL,                 -- sha256 do arquivo .md
  variant      VARCHAR(20) NOT NULL DEFAULT 'control',  -- teste A/B (PRD §38)
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, version, variant)
);

-- -----------------------------------------------------------------------------
-- 3. TOPICS — fila de produção
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topics (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  topic              VARCHAR(255) NOT NULL,
  -- D3: chave natural normalizada evita reinserção diária do mesmo tópico
  topic_norm         VARCHAR(255) GENERATED ALWAYS AS (lower(btrim(topic))) STORED,

  -- A1: modo Seed vs modo GSC. Sem isto o Research Engine não funciona no dia 0.
  source             VARCHAR(10) NOT NULL DEFAULT 'seed'
                     CHECK (source IN ('seed','gsc','manual','gap')),

  cluster            VARCHAR(100),
  is_pillar          BOOLEAN NOT NULL DEFAULT FALSE,     -- PRD §34
  keyword_type       VARCHAR(20)
                     CHECK (keyword_type IN ('informational','commercial','transactional','navigational')),

  search_volume      INTEGER CHECK (search_volume >= 0),
  difficulty_score   NUMERIC(4,1)                         -- D1: era DECIMAL(3,1),
                     CHECK (difficulty_score BETWEEN 0 AND 100),  -- não comportava 100.0
  current_position   NUMERIC(5,2) CHECK (current_position > 0),
  opportunity_score  NUMERIC(6,2),                        -- PRD §24

  -- D5: estados fechados por CHECK
  status             VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','writing','needs_human',
                                       'published','rejected','archived')),
  status_reason      TEXT,

  discovered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at        TIMESTAMPTZ,
  assigned_at        TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,

  CONSTRAINT topics_unique_per_client UNIQUE (client_id, topic_norm)
);

-- -----------------------------------------------------------------------------
-- 4. ARTICLES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  topic_id          UUID REFERENCES topics(id) ON DELETE SET NULL,

  slug              VARCHAR(255) NOT NULL,
  title             VARCHAR(500) NOT NULL,
  description       TEXT,
  cluster           VARCHAR(100),
  is_pillar         BOOLEAN NOT NULL DEFAULT FALSE,
  word_count        INTEGER,
  reading_time_minutes INTEGER,

  -- A2: 'needs_human' é o estado que resolve a contradição autonomia-vs-marcador.
  -- 'quarantined' é onde a F8 põe o que reprovou na validação (A3).
  status            VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','needs_human','ready','published',
                                      'archived','quarantined')),

  -- D5/PRD §27: trava de 3 reescritas, agora com coluna real
  rewrite_count     SMALLINT NOT NULL DEFAULT 0 CHECK (rewrite_count BETWEEN 0 AND 3),

  -- Gate humano (PRD §8.2)
  operator_note_required   BOOLEAN NOT NULL DEFAULT FALSE,
  operator_note_filled_at  TIMESTAMPTZ,
  reviewed_by              VARCHAR(120),
  reviewed_at              TIMESTAMPTZ,

  -- Rastreabilidade da geração
  llm_provider      VARCHAR(30),                  -- B10/C9: sem nome fixo de modelo no PRD
  llm_model         VARCHAR(60),
  prompt_id         UUID REFERENCES prompts(id),
  content_sha       CHAR(64),                     -- sha256 do markdown publicado
  github_commit_sha CHAR(40),

  first_published_at  TIMESTAMPTZ,
  content_updated_at  TIMESTAMPTZ,                -- alimenta dateModified (PRD §37)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT articles_unique_slug_per_client UNIQUE (client_id, slug),
  CONSTRAINT articles_note_consistency
    CHECK (status <> 'published' OR operator_note_required = FALSE
                                 OR operator_note_filled_at IS NOT NULL)
);

-- -----------------------------------------------------------------------------
-- 5. SEO_METRICS — série temporal por URL
--    C5: metric_date (data do dado no GSC, D-3) é distinta de collected_at.
--    D4: chave natural permite UPSERT idempotente na recoleta.
--    D6: ctr guardado como fração crua, exatamente como o GSC devolve.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seo_metrics (
  id            BIGSERIAL PRIMARY KEY,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  article_id    UUID REFERENCES articles(id) ON DELETE CASCADE,
  page_url      TEXT NOT NULL,
  metric_date   DATE NOT NULL,
  search_type   VARCHAR(10) NOT NULL DEFAULT 'web',
  position      NUMERIC(5,2),
  impressions   INTEGER NOT NULL DEFAULT 0,
  clicks        INTEGER NOT NULL DEFAULT 0,
  ctr           NUMERIC(6,4),
  is_stale      BOOLEAN NOT NULL DEFAULT FALSE,   -- PRD §32 stale-while-revalidate
  collected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seo_metrics_natural_key UNIQUE (client_id, page_url, metric_date, search_type)
);

-- -----------------------------------------------------------------------------
-- 6. GSC_QUERY_METRICS — granularidade page × query, coletada SEMANALMENTE
--    C6: é a consulta mais cara em quota de carga; não deve rodar diariamente.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gsc_query_metrics (
  id            BIGSERIAL PRIMARY KEY,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  page_url      TEXT NOT NULL,
  query         VARCHAR(500) NOT NULL,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  position      NUMERIC(5,2),
  impressions   INTEGER NOT NULL DEFAULT 0,
  clicks        INTEGER NOT NULL DEFAULT 0,
  ctr           NUMERIC(6,4),
  collected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gsc_query_natural_key UNIQUE (client_id, page_url, query, period_start)
);

-- -----------------------------------------------------------------------------
-- 7. AI_CITATIONS — GEO
--    C7: 'method' separa o que veio de API oficial do que foi verificado à mão.
--    Misturar as duas séries num só gráfico produz conclusão falsa.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_citations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  article_id        UUID REFERENCES articles(id) ON DELETE SET NULL,
  engine            VARCHAR(30) NOT NULL
                    CHECK (engine IN ('chatgpt','perplexity','gemini','claude','copilot')),
  method            VARCHAR(10) NOT NULL DEFAULT 'api'
                    CHECK (method IN ('api','manual')),
  query             VARCHAR(500) NOT NULL,
  cited             BOOLEAN NOT NULL DEFAULT FALSE,
  source_rank       SMALLINT,                     -- posição da HTF na lista de fontes
  citation_snippet  TEXT,
  raw_sources       JSONB,                        -- lista completa de fontes retornadas
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 8. AI_CRAWLER_HITS — sinal barato e confiável de elegibilidade a citação (C7)
--    Alimentado por Vercel Log Drain. Se OAI-SearchBot não passa, citação
--    é impossível — e isso é detectável sem tocar em SERP.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_crawler_hits (
  id          BIGSERIAL PRIMARY KEY,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_agent  VARCHAR(60) NOT NULL,               -- OAI-SearchBot, PerplexityBot, ...
  path        TEXT NOT NULL,
  status_code SMALLINT,
  hit_date    DATE NOT NULL,
  hit_count   INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT crawler_hits_natural_key UNIQUE (client_id, user_agent, path, hit_date)
);

-- -----------------------------------------------------------------------------
-- 9. OPTIMIZATION_LOG — D8: agora responde "a reescrita funcionou?"
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS optimization_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  article_id        UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  attempt_number    SMALLINT NOT NULL,
  trigger_reason    VARCHAR(40) NOT NULL
                    CHECK (trigger_reason IN ('position_drop','low_ctr','stale_content',
                                              'no_ai_citation','broken_links','content_gap')),
  old_position      NUMERIC(5,2),
  old_impressions   INTEGER,
  changes_summary   TEXT,
  old_content_sha   CHAR(64),
  new_content_sha   CHAR(64),
  -- preenchido pelo Tracking 30 dias depois: é o que fecha o feedback loop
  new_position      NUMERIC(5,2),
  new_impressions   INTEGER,
  outcome           VARCHAR(20) DEFAULT 'pending'
                    CHECK (outcome IN ('pending','improved','neutral','worsened')),
  evaluated_at      TIMESTAMPTZ,
  optimized_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 10. LLM_USAGE — D9 / PRD §38 Token Budgeting
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS llm_usage (
  id             BIGSERIAL PRIMARY KEY,
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  article_id     UUID REFERENCES articles(id) ON DELETE SET NULL,
  stage          VARCHAR(20) NOT NULL
                 CHECK (stage IN ('outline','draft','rewrite','citation_check')),
  provider       VARCHAR(30) NOT NULL,
  model          VARCHAR(60) NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd       NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 11. PIPELINE_RUNS — observabilidade
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE,
  correlation_id    UUID NOT NULL,                -- amarra estágios da mesma execução
  stage             VARCHAR(20) NOT NULL
                    CHECK (stage IN ('research','content','publish','tracking',
                                     'optimization','citation')),
  status            VARCHAR(10) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','success','partial','failed','skipped')),
  items_processed   INTEGER NOT NULL DEFAULT 0,
  items_succeeded   INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ
);

-- =============================================================================
-- ÍNDICES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_topics_queue
  ON topics (client_id, status, opportunity_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_topics_cluster        ON topics (client_id, cluster);
CREATE INDEX IF NOT EXISTS idx_articles_status       ON articles (client_id, status);
CREATE INDEX IF NOT EXISTS idx_articles_stale
  ON articles (client_id, content_updated_at) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_metrics_article_date  ON seo_metrics (article_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_client_date   ON seo_metrics (client_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_query_metrics_page    ON gsc_query_metrics (client_id, page_url, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_citations_engine_date ON ai_citations (client_id, engine, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_crawler_hits_date     ON ai_crawler_hits (client_id, hit_date DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_month       ON llm_usage (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_recent       ON pipeline_runs (client_id, started_at DESC);

-- =============================================================================
-- VIEWS
-- =============================================================================

-- D2: LEFT JOIN LATERAL — artigo sem métrica ainda aparece no dashboard.
CREATE OR REPLACE VIEW v_article_performance AS
SELECT
  a.id, a.client_id, a.slug, a.title, a.cluster, a.is_pillar,
  a.status, a.rewrite_count, a.first_published_at, a.content_updated_at,
  m.metric_date, m.position, m.impressions, m.clicks,
  ROUND(m.ctr * 100, 2) AS ctr_pct,               -- fração -> % apenas na leitura (D6)
  (SELECT COUNT(*) FROM ai_citations c
    WHERE c.article_id = a.id AND c.cited) AS citation_count
FROM articles a
LEFT JOIN LATERAL (
  SELECT * FROM seo_metrics sm
  WHERE sm.article_id = a.id
  ORDER BY sm.metric_date DESC
  LIMIT 1
) m ON TRUE;

-- Elegibilidade para reescrita (PRD §27): 30 dias, sem Top 20, sem citação,
-- e ainda dentro da trava de 3 tentativas.
CREATE OR REPLACE VIEW v_optimization_candidates AS
SELECT p.*,
       (NOW() - p.content_updated_at) AS age
FROM v_article_performance p
WHERE p.status = 'published'
  AND p.rewrite_count < 3
  AND p.content_updated_at < NOW() - INTERVAL '30 days'
  AND (p.position IS NULL OR p.position > 20)
  AND p.citation_count = 0;

-- Consumo do mês corrente vs. orçamento (PRD §38)
CREATE OR REPLACE VIEW v_budget_status AS
SELECT c.id AS client_id, c.name, c.monthly_budget_usd,
       COALESCE(SUM(u.cost_usd), 0) AS spent_usd,
       c.monthly_budget_usd - COALESCE(SUM(u.cost_usd), 0) AS remaining_usd
FROM clients c
LEFT JOIN llm_usage u
       ON u.client_id = c.id
      AND u.created_at >= date_trunc('month', NOW())
GROUP BY c.id, c.name, c.monthly_budget_usd;

-- =============================================================================
-- ROW LEVEL SECURITY (PRD §40)
-- D14: com conexão pooled e role única, a policy PRECISA ler uma GUC setada
-- por transação. Sem o SET LOCAL abaixo, a RLS não isola nada.
--
--   BEGIN;
--   SET LOCAL app.client_id = '<uuid>';
--   ... queries ...
--   COMMIT;
-- =============================================================================
ALTER TABLE topics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE articles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_metrics       ENABLE ROW LEVEL SECURITY;
ALTER TABLE gsc_query_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_citations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_crawler_hits   ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimization_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_usage         ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['topics','articles','seo_metrics','gsc_query_metrics',
                           'ai_citations','ai_crawler_hits','optimization_log','llm_usage']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (client_id = NULLIF(current_setting(''app.client_id'', TRUE), '''')::uuid)', t);
  END LOOP;
END $$;

-- =============================================================================
-- SEED
-- =============================================================================
INSERT INTO clients (name, domain, gsc_property, publish_url)
VALUES ('Hack Tech Farm', 'hacktechfarm.com.br',
        'sc-domain:hacktechfarm.com.br',
        'https://hacktechfarm.com.br/api/f8/publish')
ON CONFLICT (domain) DO NOTHING;
