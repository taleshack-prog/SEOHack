-- =============================================================================
-- Migração 002 — Adapters de publicação
--
-- Motivo: o desenho v5 assumia que todo cliente implementaria a função F8 no
-- próprio site. Isso é aceitável para a Hack Tech Farm, que controla o próprio
-- repositório, mas inviabiliza a venda: exigir que o cliente instale e mantenha
-- código é atrito grande demais para um SaaS.
--
-- Novo contrato: o cliente CONCEDE ACESSO uma vez (GitHub App, Application
-- Password do WordPress, chave de API), e nunca instala nada. A F8 vira o
-- adapter 'webhook' — mantida para cliente enterprise que exige perímetro
-- fechado, mas deixa de ser o padrão.
-- =============================================================================

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS publish_adapter VARCHAR(20) NOT NULL DEFAULT 'github'
    CHECK (publish_adapter IN ('github','wordpress','webhook','ghost','webflow')),
  -- Credenciais e configuração do destino. Em produção, criptografar em
  -- repouso na aplicação: a coluna guarda o ciphertext, não o segredo cru.
  ADD COLUMN IF NOT EXISTS adapter_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS adapter_verified_at TIMESTAMPTZ;

-- publish_url era específico do webhook. Vira opcional e migra para o config.
ALTER TABLE clients ALTER COLUMN publish_url DROP NOT NULL;

UPDATE clients
   SET adapter_config = adapter_config || jsonb_build_object('url', publish_url)
 WHERE publish_adapter = 'webhook' AND publish_url IS NOT NULL;

-- Onde o artigo foi parar do lado do cliente. Com adapters não-Git não existe
-- commit sha, então guardamos a referência externa genérica.
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(120),
  ADD COLUMN IF NOT EXISTS external_url TEXT;

COMMENT ON COLUMN clients.adapter_config IS
  'github: {token,repo,branch,contentDir,sitemapPath,baseUrl,blogBasePath,cssHref,shell} | '
  'wordpress: {baseUrl,username,applicationPassword} | '
  'webhook: {url,token,secret}';
