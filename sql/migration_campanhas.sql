-- ================================================================
-- Migração: Campanhas de Vendas (prêmio opcional + meta individual
-- por consultora dentro de cada campanha).
-- Rode este script INTEIRO no SQL Editor do Supabase (uma vez só).
-- ================================================================

alter table campaigns add column if not exists prize text;

create table if not exists campaign_goals (
  id bigint generated always as identity primary key,
  campaign_id bigint references campaigns(id) on delete cascade,
  seller_id uuid references auth.users(id) not null,
  goal_value numeric(10,2) not null default 0,
  created_at timestamptz default now(),
  unique(campaign_id, seller_id)
);

alter table campaign_goals enable row level security;

drop policy if exists "campaign_goals_select" on campaign_goals;
drop policy if exists "campaign_goals_insert_own" on campaign_goals;
drop policy if exists "campaign_goals_update_own" on campaign_goals;
drop policy if exists "campaign_goals_delete_own" on campaign_goals;

create policy "campaign_goals_select" on campaign_goals for select using (auth.role() = 'authenticated');
create policy "campaign_goals_insert_own" on campaign_goals for insert with check (auth.uid() = seller_id);
create policy "campaign_goals_update_own" on campaign_goals for update using (auth.uid() = seller_id);
create policy "campaign_goals_delete_own" on campaign_goals for delete using (auth.uid() = seller_id);
