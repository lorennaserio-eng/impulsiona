-- ================================================================
-- Migração: Método 2+2+2 (acompanhamento pós-venda em 3 estágios).
-- Rode este script INTEIRO no SQL Editor do Supabase (uma vez só).
-- Cria a tabela nova e atualiza register_sale() para gerar o
-- acompanhamento automaticamente a cada venda com cliente identificado.
-- ================================================================

create table if not exists followups (
  id bigint generated always as identity primary key,
  sale_id bigint references sales(id) on delete cascade,
  customer_id bigint references customers(id) on delete cascade,
  due_2_dias date not null,
  done_2_dias boolean not null default false,
  note_2_dias text,
  due_2_semanas date not null,
  done_2_semanas boolean not null default false,
  note_2_semanas text,
  due_2_meses date not null,
  done_2_meses boolean not null default false,
  note_2_meses text,
  created_at timestamptz default now()
);

alter table followups enable row level security;

drop policy if exists "followups_all" on followups;
create policy "followups_all" on followups for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create or replace function register_sale(
  p_date date, p_customer_id bigint, p_payment text, p_status text,
  p_items jsonb -- [{product_id, qty}]
) returns bigint
language plpgsql security definer as $$
declare
  v_sale_id bigint;
  v_total numeric := 0;
  v_item jsonb;
  v_product products%rowtype;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from products where id = (v_item->>'product_id')::bigint for update;
    if v_product.stock < (v_item->>'qty')::int then
      raise exception 'Estoque insuficiente para "%": disponível %, pedido %', v_product.name, v_product.stock, (v_item->>'qty')::int;
    end if;
    v_total := v_total + v_product.price * (v_item->>'qty')::int;
  end loop;

  insert into sales (sale_date, customer_id, total, payment, status, seller_id)
  values (p_date, p_customer_id, v_total, p_payment, p_status, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from products where id = (v_item->>'product_id')::bigint;
    insert into sale_items (sale_id, product_id, name, qty, price, cost)
    values (v_sale_id, v_product.id, v_product.name, (v_item->>'qty')::int, v_product.price, v_product.cost);
    update products set stock = stock - (v_item->>'qty')::int where id = v_product.id;
  end loop;

  if p_customer_id is not null then
    insert into followups (sale_id, customer_id, due_2_dias, due_2_semanas, due_2_meses)
    values (v_sale_id, p_customer_id, p_date + 2, p_date + 14, (p_date + interval '2 months')::date);
  end if;

  return v_sale_id;
end;
$$;
