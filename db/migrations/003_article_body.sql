-- =============================================================================
-- Migração 003 — Corpo do artigo no banco
--
-- Motivo: a fila de revisão humana precisa exibir e editar o texto do artigo,
-- mas o schema v5 guardava só metadados. O Markdown ia direto para o destino
-- (Git ou WordPress) e nunca ficava no Neon, então a única forma de ler um
-- artigo em 'needs_human' era buscar no repositório — e isso nem existe no
-- adapter WordPress. Sem esta coluna não há tela de revisão possível.
-- =============================================================================

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS markdown    TEXT,
  ADD COLUMN IF NOT EXISTS frontmatter JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Texto que o operador escreveu, preservado separado do corpo. Permite
  -- auditar depois o que foi humano e o que foi gerado.
  ADD COLUMN IF NOT EXISTS operator_notes JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_articles_review
  ON articles (client_id, status, created_at DESC)
  WHERE status = 'needs_human';

COMMENT ON COLUMN articles.markdown IS
  'Corpo em Markdown. Fonte de verdade para a fila de revisão e para reescrita.';
