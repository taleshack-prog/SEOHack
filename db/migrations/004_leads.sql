-- =============================================================================
-- Migração 004 — Contatos recebidos (leads)
--
-- Motivo: o formulário de contato do site é estático e não tinha para onde
-- enviar — testado em 25/09/2026, respondeu "A mensagem não foi enviada". Todo
-- visitante que tentasse falar com a Hack Tech Farm era perdido em silêncio, e
-- a tela de diagnóstico público acabava de ganhar um botão que apontava
-- justamente para lá.
--
-- A mensagem passa a ser gravada aqui. E-mail é notificação, não armazenamento:
-- se a chave do Brevo não estiver configurada, ou a entrega falhar, o contato
-- continua no banco e aparece no painel.
--
-- client_id é opcional de propósito: o mesmo endpoint atende os sites dos
-- produtos (genbreed.com.br, posthink.com.br), que não são clientes do motor
-- de conteúdo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS leads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE SET NULL,

  nome        TEXT NOT NULL,
  email       TEXT NOT NULL,
  assunto     TEXT,
  mensagem    TEXT NOT NULL,

  -- De onde veio: domínio do formulário e, quando houver, o site que a pessoa
  -- diagnosticou antes de escrever. Contato vindo do diagnóstico é o mais
  -- quente que existe, e sem isto não dá para saber que veio de lá.
  origem      TEXT,
  site_alvo   TEXT,

  -- Atendimento. Sem workflow: ou está aberto, ou foi respondido/descartado.
  status      TEXT NOT NULL DEFAULT 'novo'
              CHECK (status IN ('novo', 'respondido', 'descartado')),

  -- Diagnóstico da entrega do aviso por e-mail. NULL = não houve tentativa.
  email_erro  TEXT,

  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_novos
  ON leads (created_at DESC)
  WHERE status = 'novo';

-- O freio de enxurrada fica no código (api/contato.mjs), não aqui: índice de
-- unicidade precisa de expressão IMMUTABLE, e date_trunc sobre timestamptz
-- depende do fuso da sessão — o Postgres recusa com 42P17. Este índice serve
-- à consulta que o endpoint faz antes de gravar.
CREATE INDEX IF NOT EXISTS idx_leads_flood
  ON leads (ip_hash, created_at DESC);

COMMENT ON TABLE leads IS
  'Contatos recebidos pelo endpoint público /api/contato. O e-mail é aviso; a fonte de verdade é esta tabela.';
COMMENT ON COLUMN leads.site_alvo IS
  'Domínio que a pessoa diagnosticou antes de escrever, quando o contato veio da tela de diagnóstico.';
