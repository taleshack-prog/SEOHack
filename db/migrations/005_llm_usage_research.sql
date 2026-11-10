-- =============================================================================
-- Migração 005 — o estágio 'research' no custo do LLM
--
-- Motivo: em 06/11/2026 o cron de pesquisa passou a gerar a pauta chamando o
-- modelo, e grava esse gasto em llm_usage como qualquer outro estágio. O CHECK
-- da migração 001 só previa outline, draft, rewrite e citation_check — porque
-- até então a pesquisa não custava nada, era leitura da Search Console.
--
-- O resultado apareceu na primeira execução real, segunda 09/11 às 3h: o
-- modelo foi chamado, a pauta foi gerada, e a transação morreu ao registrar o
-- custo. A chamada foi paga e nada entrou na fila. O blog ficou a semana
-- inteira sem produzir, e a tela dizia "fila vazia" como se fosse normal.
--
-- A lição é a mesma do topics_source_check em outubro: valor novo em coluna
-- com CHECK precisa da migração junto, no mesmo commit. test/pauta.test.mjs
-- agora varre o código inteiro atrás de `stage: '...'` e confere cada um
-- contra este CHECK, para não depender de alguém lembrar.
-- =============================================================================

ALTER TABLE llm_usage DROP CONSTRAINT IF EXISTS llm_usage_stage_check;

ALTER TABLE llm_usage ADD CONSTRAINT llm_usage_stage_check
  CHECK (stage IN ('outline', 'draft', 'rewrite', 'citation_check', 'research'));
