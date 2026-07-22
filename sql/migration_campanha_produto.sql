-- ================================================================
-- Migração: Campanha por produto específico.
-- Permite associar uma campanha a um produto: quando preenchido, o
-- faturamento da campanha passa a somar só os itens daquele produto
-- dentro das vendas do período (em vez da venda inteira).
-- Rode este script INTEIRO no SQL Editor do Supabase (uma vez só).
-- ================================================================

alter table campaigns add column if not exists product_id bigint references products(id) on delete set null;
