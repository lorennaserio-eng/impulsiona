-- ================================================================
-- Schema do Controle de Vendas Mary Kay - Supabase
-- Como usar: abra seu projeto em supabase.com > SQL Editor > New query,
-- cole este arquivo inteiro e clique em "Run". Pode rodar de uma vez só.
-- ================================================================

-- Perfis (nome de cada pessoa da equipe, ligado ao login dela)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'consultora', -- 'consultora' ou 'diretora'
  phone text,
  created_at timestamptz default now()
);

-- Cria o perfil automaticamente quando alguém cria uma conta
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'consultora'),
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Produtos (catálogo compartilhado por toda a equipe)
create table if not exists products (
  id bigint generated always as identity primary key,
  name text not null,
  price numeric(10,2) not null default 0,
  cost numeric(10,2) not null default 0, -- preenchido automaticamente pelo último Pedido MK
  stock integer not null default 0,
  min_stock integer not null default 5,
  created_at timestamptz default now()
);

-- Clientes (cadastro compartilhado)
create table if not exists customers (
  id bigint generated always as identity primary key,
  name text not null,
  phone text,
  email text,
  birth_date date,
  created_at timestamptz default now()
);

-- Vendas
create table if not exists sales (
  id bigint generated always as identity primary key,
  sale_date date not null default current_date,
  customer_id bigint references customers(id) on delete set null,
  total numeric(10,2) not null default 0,
  payment text,
  status text not null default 'Pago',
  seller_id uuid references auth.users(id) default auth.uid(),
  legacy_seller_name text, -- nome do vendedor de vendas importadas do app antigo
  notified_at date,
  created_at timestamptz default now()
);

-- Itens de cada venda
create table if not exists sale_items (
  id bigint generated always as identity primary key,
  sale_id bigint references sales(id) on delete cascade,
  product_id bigint references products(id),
  name text not null,
  qty integer not null,
  price numeric(10,2) not null,
  cost numeric(10,2) not null default 0 -- custo do produto no momento da venda (para calcular lucro)
);

-- Movimentações de estoque (entrada/saída manual)
create table if not exists stock_movements (
  id bigint generated always as identity primary key,
  move_date date not null default current_date,
  product_id bigint references products(id),
  product_name text,
  type text not null, -- 'entrada' ou 'saida'
  qty integer not null,
  reason text,
  stock_after integer,
  created_at timestamptz default now()
);

-- Pedidos Mary Kay (compras)
create table if not exists purchase_orders (
  id bigint generated always as identity primary key,
  order_date date not null default current_date,
  order_number text,
  total_cost numeric(10,2) not null default 0,
  created_at timestamptz default now()
);

create table if not exists purchase_order_items (
  id bigint generated always as identity primary key,
  purchase_order_id bigint references purchase_orders(id) on delete cascade,
  name text not null,
  qty integer not null,
  unit_cost numeric(10,2) not null
);

-- Campanhas de marketing
create table if not exists campaigns (
  id bigint generated always as identity primary key,
  name text not null,
  start_date date,
  end_date date,
  forced_inactive boolean default false,
  created_at timestamptz default now()
);

-- Agenda de treinamentos (criada pela diretora, visível para toda a equipe)
create table if not exists trainings (
  id bigint generated always as identity primary key,
  title text not null,
  description text,
  training_date date not null,
  training_time time,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz default now()
);

-- Configurações gerais (meta mensal, automação WhatsApp)
create table if not exists settings (
  id text primary key default 'global',
  monthly_goal numeric(10,2) default 0,
  meta_phone_id text,
  meta_token text,
  meta_template_name text,
  meta_template_lang text default 'pt_BR',
  auto_days integer default 3
);
insert into settings (id) values ('global') on conflict (id) do nothing;

-- ================================================================
-- FUNÇÕES: centralizam as regras de negócio no banco, para que
-- "vender" ou "registrar pedido" sejam operações únicas e seguras
-- (ou tudo acontece, ou nada acontece — sem estoque "pela metade").
-- ================================================================

-- Registrar venda: valida estoque, cria a venda, os itens e dá baixa no estoque
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

-- Excluir venda (só quem registrou) e devolver o estoque
create or replace function delete_sale(p_sale_id bigint) returns void
language plpgsql security definer as $$
declare v_item record;
begin
  if not exists (select 1 from sales where id = p_sale_id and seller_id = auth.uid()) then
    raise exception 'Você só pode excluir vendas registradas por você.';
  end if;
  for v_item in select * from sale_items where sale_id = p_sale_id loop
    update products set stock = stock + v_item.qty where id = v_item.product_id;
  end loop;
  delete from sales where id = p_sale_id; -- os itens somem junto (cascade)
end;
$$;

-- Registrar pedido Mary Kay: cria produto novo se precisar e dá entrada no estoque
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

-- Movimentação manual de estoque (entrada ou saída avulsa)
create or replace function register_stock_movement(
  p_product_id bigint, p_type text, p_qty int, p_reason text
) returns void
language plpgsql security definer as $$
declare
  v_product products%rowtype;
  v_new_stock int;
begin
  select * into v_product from products where id = p_product_id for update;
  if p_type = 'saida' and v_product.stock < p_qty then
    raise exception 'Estoque insuficiente. Disponível: % unidade(s).', v_product.stock;
  end if;
  v_new_stock := v_product.stock + (case when p_type = 'entrada' then p_qty else -p_qty end);
  update products set stock = v_new_stock where id = p_product_id;
  insert into stock_movements (move_date, product_id, product_name, type, qty, reason, stock_after)
  values (current_date, p_product_id, v_product.name, p_type, p_qty, p_reason, v_new_stock);
end;
$$;

-- Importação única dos dados do app antigo (localStorage). Recebe o JSON
-- inteiro exportado e insere tudo de uma vez (produtos, clientes, vendas,
-- estoque, pedidos, campanhas). Não mexe no estoque atual dos produtos
-- além do valor já informado, pois o histórico antigo já está refletido nele.
create or replace function import_legacy_data(p_payload jsonb) returns void
language plpgsql security definer as $$
declare
  v_item jsonb;
  v_sale_item jsonb;
  v_po_item jsonb;
  v_new_id bigint;
  v_customer_id bigint;
  v_seller_name text;
begin
  create temporary table if not exists _import_customer_map(old_name text, new_id bigint) on commit drop;
  create temporary table if not exists _import_product_map(old_name text, new_id bigint) on commit drop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'products', '[]'::jsonb)) loop
    insert into products (name, price, stock, min_stock)
    values (v_item->>'name', (v_item->>'price')::numeric, (v_item->>'stock')::int, coalesce((v_item->>'minStock')::int, 5))
    returning id into v_new_id;
    insert into _import_product_map values (lower(v_item->>'name'), v_new_id);
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'customers', '[]'::jsonb)) loop
    insert into customers (name, phone, email, birth_date)
    values (v_item->>'name', v_item->>'phone', v_item->>'email', nullif(v_item->>'birthDate','')::date)
    returning id into v_new_id;
    insert into _import_customer_map values (lower(v_item->>'name'), v_new_id);
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'sales', '[]'::jsonb)) loop
    v_customer_id := null;
    select new_id into v_customer_id from _import_customer_map
      where old_name = lower(coalesce((
        select c->>'name' from jsonb_array_elements(coalesce(p_payload->'customers','[]'::jsonb)) c
        where (c->>'id')::text = (v_item->>'customerId')::text limit 1
      ), ''))
      limit 1;

    v_seller_name := nullif(v_item->>'seller', '');

    insert into sales (sale_date, customer_id, total, payment, status, seller_id, legacy_seller_name, notified_at)
    values (
      (v_item->>'date')::date, v_customer_id, (v_item->>'total')::numeric,
      v_item->>'payment', coalesce(v_item->>'status','Pago'), auth.uid(), v_seller_name,
      nullif(v_item->>'notifiedAt','')::date
    )
    returning id into v_new_id;

    for v_sale_item in select * from jsonb_array_elements(coalesce(v_item->'items', '[]'::jsonb)) loop
      insert into sale_items (sale_id, product_id, name, qty, price)
      values (
        v_new_id,
        (select new_id from _import_product_map where old_name = lower(v_sale_item->>'name') limit 1),
        v_sale_item->>'name', (v_sale_item->>'qty')::int, (v_sale_item->>'price')::numeric
      );
    end loop;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'campaigns', '[]'::jsonb)) loop
    insert into campaigns (name, start_date, end_date, forced_inactive)
    values (v_item->>'name', nullif(v_item->>'startDate','')::date, nullif(v_item->>'endDate','')::date,
      coalesce((v_item->>'forcedInactive')::boolean, false));
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'stockMovements', '[]'::jsonb)) loop
    insert into stock_movements (move_date, product_id, product_name, type, qty, reason, stock_after)
    values (
      (v_item->>'date')::date,
      (select new_id from _import_product_map where old_name = lower(v_item->>'productName') limit 1),
      v_item->>'productName', v_item->>'type', (v_item->>'qty')::int, v_item->>'reason', (v_item->>'stockAfter')::int
    );
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'purchaseOrders', '[]'::jsonb)) loop
    insert into purchase_orders (order_date, order_number, total_cost)
    values ((v_item->>'date')::date, v_item->>'orderNumber', (v_item->>'totalCost')::numeric)
    returning id into v_new_id;

    for v_po_item in select * from jsonb_array_elements(coalesce(v_item->'items', '[]'::jsonb)) loop
      insert into purchase_order_items (purchase_order_id, name, qty, unit_cost)
      values (v_new_id, v_po_item->>'name', (v_po_item->>'qty')::int, (v_po_item->>'unitCost')::numeric);
    end loop;
  end loop;

  if p_payload ? 'settings' then
    update settings set
      monthly_goal = coalesce((p_payload->'settings'->>'monthlyGoal')::numeric, monthly_goal),
      auto_days = coalesce((p_payload->'settings'->>'autoDays')::int, auto_days)
    where id = 'global';
  end if;
end;
$$;

grant execute on function register_sale(date, bigint, text, text, jsonb) to authenticated;
grant execute on function delete_sale(bigint) to authenticated;
grant execute on function register_purchase_order(date, text, jsonb) to authenticated;
grant execute on function register_stock_movement(bigint, text, int, text) to authenticated;
grant execute on function import_legacy_data(jsonb) to authenticated;

-- ================================================================
-- SEGURANÇA (Row Level Security)
-- Regra geral: só quem está logado enxerga os dados.
-- Catálogo (produtos/clientes/estoque/pedidos/campanhas/config): toda
-- a equipe compartilha e pode mexer.
-- Vendas: toda a equipe VÊ (para o dashboard e ranking), mas só quem
-- registrou pode editar ou excluir a própria venda.
-- ================================================================

alter table profiles enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table stock_movements enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;
alter table campaigns enable row level security;
alter table settings enable row level security;
alter table trainings enable row level security;

create policy "profiles_select" on profiles for select using (auth.role() = 'authenticated');
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

create policy "products_all" on products for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "customers_all" on customers for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "stock_movements_all" on stock_movements for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "purchase_orders_all" on purchase_orders for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "purchase_order_items_all" on purchase_order_items for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "campaigns_all" on campaigns for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "settings_all" on settings for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "sales_select" on sales for select using (auth.role() = 'authenticated');
create policy "sales_insert_own" on sales for insert with check (auth.uid() = seller_id);
create policy "sales_update_own" on sales for update using (auth.uid() = seller_id);
create policy "sales_delete_own" on sales for delete using (auth.uid() = seller_id);

create policy "sale_items_select" on sale_items for select using (auth.role() = 'authenticated');
create policy "sale_items_insert_own" on sale_items for insert with check (
  exists (select 1 from sales s where s.id = sale_id and s.seller_id = auth.uid())
);
create policy "sale_items_delete_own" on sale_items for delete using (
  exists (select 1 from sales s where s.id = sale_id and s.seller_id = auth.uid())
);

-- Treinamentos: toda a equipe vê a agenda, só quem é diretora cria/edita/exclui.
create policy "trainings_select" on trainings for select using (auth.role() = 'authenticated');
create policy "trainings_insert_diretora" on trainings for insert with check (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'diretora')
);
create policy "trainings_update_diretora" on trainings for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'diretora')
);
create policy "trainings_delete_diretora" on trainings for delete using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'diretora')
);
