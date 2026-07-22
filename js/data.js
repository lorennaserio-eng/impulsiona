/* ================= CAMADA DE DADOS (Supabase) =================
   "state" substitui o antigo "db" do localStorage: é um cache em
   memória, recarregado do Supabase depois de cada alteração.
*/

let state = {
  products: [], customers: [], sales: [], campaigns: [],
  stockMovements: [], purchaseOrders: [], settings: {}, profiles: [], trainings: [], followups: [], campaignGoals: [], appointments: []
};

async function refreshAll(){
  const [products, customers, sales, saleItems, campaigns, stockMovements, purchaseOrders, poItems, settingsRow, profiles, trainings, followups, campaignGoals, appointments] = await Promise.all([
    supabaseClient.from('products').select('*').order('name'),
    supabaseClient.from('customers').select('*').order('name'),
    supabaseClient.from('sales').select('*').order('sale_date', {ascending:true}),
    supabaseClient.from('sale_items').select('*'),
    supabaseClient.from('campaigns').select('*').order('created_at'),
    supabaseClient.from('stock_movements').select('*').order('created_at'),
    supabaseClient.from('purchase_orders').select('*').order('order_date'),
    supabaseClient.from('purchase_order_items').select('*'),
    supabaseClient.from('settings').select('*').eq('id','global').maybeSingle(),
    supabaseClient.from('profiles').select('*'),
    supabaseClient.from('trainings').select('*').order('training_date'),
    supabaseClient.from('followups').select('*'),
    supabaseClient.from('campaign_goals').select('*'),
    supabaseClient.from('appointments').select('*').order('appointment_date'),
  ]);

  [products, customers, sales, saleItems, campaigns, stockMovements, purchaseOrders, poItems, settingsRow, profiles, trainings, followups, campaignGoals, appointments].forEach(r=>{
    if(r.error) console.error('Erro ao carregar dados do Supabase:', r.error.message);
  });

  const itemsBySale = {};
  (saleItems.data||[]).forEach(i=>{
    (itemsBySale[i.sale_id] = itemsBySale[i.sale_id] || []).push({
      productId: i.product_id, name: i.name, qty: i.qty, price: Number(i.price), cost: Number(i.cost || 0)
    });
  });

  const poItemsByOrder = {};
  (poItems.data||[]).forEach(i=>{
    (poItemsByOrder[i.purchase_order_id] = poItemsByOrder[i.purchase_order_id] || []).push({
      name: i.name, qty: i.qty, unitCost: Number(i.unit_cost)
    });
  });

  const profileById = {};
  (profiles.data||[]).forEach(p=> profileById[p.id] = p.full_name);
  state.profiles = (profiles.data||[]).map(p=>({
    id: p.id, fullName: p.full_name, role: p.role || 'consultora', phone: p.phone, createdAt: p.created_at
  }));

  state.products = (products.data||[]).map(p=>({
    id: p.id, name: p.name, price: Number(p.price), cost: Number(p.cost || 0), stock: p.stock, minStock: p.min_stock,
    replenishDays: p.replenish_days || null
  }));

  state.customers = (customers.data||[]).map(c=>({
    id: c.id, name: c.name, phone: c.phone, email: c.email, birthDate: c.birth_date,
    skinType: c.skin_type || '', address: c.address || '', notes: c.notes || '',
    businessProspect: !!c.business_prospect,
    lastBirthdayGreetingYear: c.last_birthday_greeting_year || null
  }));

  state.sales = (sales.data||[]).map(s=>{
    const items = itemsBySale[s.id] || [];
    const profit = items.reduce((sum,i)=> sum + i.qty*(i.price - i.cost), 0);
    return {
      id: s.id, date: s.sale_date, customerId: s.customer_id, total: Number(s.total),
      payment: s.payment, status: s.status, sellerId: s.seller_id,
      seller: s.legacy_seller_name || profileById[s.seller_id] || '-', notifiedAt: s.notified_at,
      items, profit
    };
  });

  state.campaigns = (campaigns.data||[]).map(c=>({
    id: c.id, name: c.name, startDate: c.start_date, endDate: c.end_date, forcedInactive: c.forced_inactive, prize: c.prize || '',
    productId: c.product_id || null
  }));

  state.campaignGoals = (campaignGoals.data||[]).map(g=>({
    id: g.id, campaignId: g.campaign_id, sellerId: g.seller_id, goalValue: Number(g.goal_value || 0),
    sellerName: profileById[g.seller_id] || 'Consultora'
  }));

  state.appointments = (appointments.data||[]).map(a=>({
    id: a.id, customerId: a.customer_id, type: a.type, date: a.appointment_date, time: a.appointment_time,
    notes: a.notes, status: a.status, sellerId: a.seller_id
  }));

  state.stockMovements = (stockMovements.data||[]).map(m=>({
    id: m.id, date: m.move_date, productId: m.product_id, productName: m.product_name,
    type: m.type, qty: m.qty, reason: m.reason, stockAfter: m.stock_after
  }));

  state.purchaseOrders = (purchaseOrders.data||[]).map(po=>({
    id: po.id, date: po.order_date, orderNumber: po.order_number, totalCost: Number(po.total_cost),
    items: poItemsByOrder[po.id] || []
  }));

  state.trainings = (trainings.data||[]).map(t=>({
    id: t.id, title: t.title, description: t.description, type: t.type || 'treinamento', date: t.training_date, time: t.training_time
  }));

  state.followups = (followups.data||[]).map(f=>({
    id: f.id, saleId: f.sale_id, customerId: f.customer_id,
    due2Dias: f.due_2_dias, done2Dias: f.done_2_dias, note2Dias: f.note_2_dias,
    due2Semanas: f.due_2_semanas, done2Semanas: f.done_2_semanas, note2Semanas: f.note_2_semanas,
    due2Meses: f.due_2_meses, done2Meses: f.done_2_meses, note2Meses: f.note_2_meses
  }));

  state.settings = settingsRow.data ? {
    monthlyGoal: Number(settingsRow.data.monthly_goal || 0),
    metaPhoneId: settingsRow.data.meta_phone_id || '',
    metaToken: settingsRow.data.meta_token || '',
    metaTemplateName: settingsRow.data.meta_template_name || '',
    metaBirthdayTemplateName: settingsRow.data.meta_birthday_template_name || '',
    metaTemplateLang: settingsRow.data.meta_template_lang || 'pt_BR',
    autoDays: settingsRow.data.auto_days ?? 3
  } : {};
}

/* ---------- Produtos ---------- */
async function apiCreateProduct(p){
  const { error } = await supabaseClient.from('products').insert({
    name: p.name, price: p.price, stock: p.stock, min_stock: p.minStock, replenish_days: p.replenishDays || null
  });
  if(error) throw error;
}
async function apiUpdateProduct(p){
  const { error } = await supabaseClient.from('products').update({
    name: p.name, price: p.price, stock: p.stock, min_stock: p.minStock, replenish_days: p.replenishDays || null
  }).eq('id', p.id);
  if(error) throw error;
}
async function apiDeleteProduct(id){
  const { error } = await supabaseClient.from('products').delete().eq('id', id);
  if(error) throw error;
}

/* ---------- Clientes ---------- */
async function apiCreateCustomer(c){
  const { error } = await supabaseClient.from('customers').insert({
    name: c.name, phone: c.phone, email: c.email, birth_date: c.birthDate || null, skin_type: c.skinType || null,
    address: c.address || null, notes: c.notes || null, business_prospect: !!c.businessProspect
  });
  if(error) throw error;
}
async function apiUpdateCustomer(c){
  const { error } = await supabaseClient.from('customers').update({
    name: c.name, phone: c.phone, email: c.email, birth_date: c.birthDate || null, skin_type: c.skinType || null,
    address: c.address || null, notes: c.notes || null, business_prospect: !!c.businessProspect
  }).eq('id', c.id);
  if(error) throw error;
}
async function apiDeleteCustomer(id){
  const { error } = await supabaseClient.from('customers').delete().eq('id', id);
  if(error) throw error;
}
async function apiMarkCustomerBirthdayGreeted(customerId, year){
  const { error } = await supabaseClient.from('customers').update({ last_birthday_greeting_year: year }).eq('id', customerId);
  if(error) throw error;
}

/* ---------- Vendas (via função no banco, tudo ou nada) ---------- */
async function apiCreateSale(date, customerId, payment, status, items){
  const { data, error } = await supabaseClient.rpc('register_sale', {
    p_date: date, p_customer_id: customerId, p_payment: payment, p_status: status,
    p_items: items.map(i=>({ product_id: i.productId, qty: i.qty }))
  });
  if(error) throw error;
  return data;
}
async function apiDeleteSale(saleId){
  const { error } = await supabaseClient.rpc('delete_sale', { p_sale_id: saleId });
  if(error) throw error;
}
async function apiToggleSaleStatus(sale){
  const newStatus = sale.status === 'Pago' ? 'Pendente' : 'Pago';
  const { error } = await supabaseClient.from('sales').update({ status: newStatus }).eq('id', sale.id);
  if(error) throw error;
}
async function apiMarkSaleNotified(saleId, date){
  const { error } = await supabaseClient.from('sales').update({ notified_at: date }).eq('id', saleId);
  if(error) throw error;
}

/* ---------- Estoque ---------- */
async function apiCreateStockMovement(productId, type, qty, reason){
  const { error } = await supabaseClient.rpc('register_stock_movement', {
    p_product_id: productId, p_type: type, p_qty: qty, p_reason: reason
  });
  if(error) throw error;
}

/* ---------- Pedidos Mary Kay ---------- */
async function apiCreatePurchaseOrder(date, orderNumber, items){
  const { data, error } = await supabaseClient.rpc('register_purchase_order', {
    p_date: date, p_order_number: orderNumber || null,
    p_items: items.map(i=>({ name: i.name, qty: i.qty, unit_cost: i.unitCost }))
  });
  if(error) throw error;
  return data;
}

/* ---------- Campanhas ---------- */
async function apiCreateCampaign(c){
  const { error } = await supabaseClient.from('campaigns').insert({
    name: c.name, start_date: c.startDate || null, end_date: c.endDate || null, prize: c.prize || null,
    product_id: c.productId || null
  });
  if(error) throw error;
}
async function apiEndCampaign(id){
  const { error } = await supabaseClient.from('campaigns').update({ forced_inactive: true }).eq('id', id);
  if(error) throw error;
}
async function apiDeleteCampaign(id){
  const { error } = await supabaseClient.from('campaigns').delete().eq('id', id);
  if(error) throw error;
}
async function apiSetCampaignGoal(campaignId, goalValue){
  const { error } = await supabaseClient.from('campaign_goals').upsert(
    { campaign_id: campaignId, seller_id: currentUser.id, goal_value: goalValue },
    { onConflict: 'campaign_id,seller_id' }
  );
  if(error) throw error;
}

/* ---------- Configurações ---------- */
async function apiSaveSettings(patch){
  const { error } = await supabaseClient.from('settings').update(patch).eq('id', 'global');
  if(error) throw error;
}

/* ---------- Treinamentos (agenda da equipe) ---------- */
async function apiCreateTraining(t){
  const { error } = await supabaseClient.from('trainings').insert({
    title: t.title, description: t.description || null, type: t.type || 'treinamento',
    training_date: t.date, training_time: t.time || null
  });
  if(error) throw error;
}
async function apiDeleteTraining(id){
  const { error } = await supabaseClient.from('trainings').delete().eq('id', id);
  if(error) throw error;
}

/* ---------- Atendimentos (VIP / skincare) ---------- */
async function apiCreateAppointment(a){
  const { error } = await supabaseClient.from('appointments').insert({
    customer_id: a.customerId, type: a.type, appointment_date: a.date, appointment_time: a.time || null,
    notes: a.notes || null, seller_id: currentUser.id
  });
  if(error) throw error;
}
async function apiUpdateAppointmentStatus(id, status){
  const { error } = await supabaseClient.from('appointments').update({ status }).eq('id', id);
  if(error) throw error;
}
async function apiDeleteAppointment(id){
  const { error } = await supabaseClient.from('appointments').delete().eq('id', id);
  if(error) throw error;
}

/* ---------- Acompanhamento pós-venda (Método 2+2+2) ---------- */
async function apiCompleteFollowupStage(followupId, dbColumnSuffix, note){
  const patch = {};
  patch[`done_${dbColumnSuffix}`] = true;
  patch[`note_${dbColumnSuffix}`] = note || null;
  const { error } = await supabaseClient.from('followups').update(patch).eq('id', followupId);
  if(error) throw error;
}

/* ---------- Importação única dos dados do app antigo ---------- */
async function apiImportLegacyData(payload){
  const { error } = await supabaseClient.rpc('import_legacy_data', { p_payload: payload });
  if(error) throw error;
}
