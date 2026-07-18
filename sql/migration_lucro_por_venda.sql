-- ================================================================
-- Migração: Lucro por venda (custo do produto + snapshot de custo
-- em cada item vendido).
-- Rode este script INTEIRO no SQL Editor do Supabase (uma vez só).
-- Seguro mesmo já tendo rodado as migrações anteriores — só adiciona
-- o que ainda não existe, sem apagar nada.
--
-- IMPORTANTE: produtos que você nunca reabasteceu por um Pedido MK
-- desde que instalou o app ficam com custo R$ 0,00 até o próximo
-- pedido — o lucro deles vai aparecer igual ao faturamento até lá.
-- ================================================================

alter table products add column if not exists cost numeric(10,2) not null default 0;
alter table sale_items add column if not exists cost numeric(10,2) not null default 0;

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

  return v_sale_id;
end;
$$;

create or replace function register_purchase_order(
  p_date date, p_order_number text, p_items jsonb -- [{name, qty, unit_cost}]
) returns bigint
language plpgsql security definer as $$
declare
  v_po_id bigint;
  v_total numeric := 0;
  v_item jsonb;
  v_product_id bigint;
  v_new_stock int;
begin
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_total := v_total + (v_item->>'unit_cost')::numeric * (v_item->>'qty')::int;
  end loop;

  insert into purchase_orders (order_date, order_number, total_cost)
  values (p_date, p_order_number, v_total)
  returning id into v_po_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select id into v_product_id from products where lower(name) = lower(v_item->>'name') limit 1;
    if v_product_id is null then
      insert into products (name, price, cost, stock, min_stock)
      values (v_item->>'name', (v_item->>'unit_cost')::numeric, (v_item->>'unit_cost')::numeric, 0, 5)
      returning id into v_product_id;
    end if;

    update products set stock = stock + (v_item->>'qty')::int, cost = (v_item->>'unit_cost')::numeric
      where id = v_product_id
      returning stock into v_new_stock;

    insert into purchase_order_items (purchase_order_id, name, qty, unit_cost)
    values (v_po_id, v_item->>'name', (v_item->>'qty')::int, (v_item->>'unit_cost')::numeric);

    insert into stock_movements (move_date, product_id, product_name, type, qty, reason, stock_after)
    values (p_date, v_product_id, v_item->>'name', 'entrada', (v_item->>'qty')::int,
      case when p_order_number is not null and p_order_number <> '' then 'Pedido Mary Kay #' || p_order_number else 'Pedido Mary Kay' end,
      v_new_stock);
  end loop;

  return v_po_id;
end;
$$;
