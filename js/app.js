/* ================= UTILITÁRIOS ================= */
function money(v){
  return (v||0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function formatDate(iso){
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/* Escapa texto pra embutir dentro de uma string JS de aspas simples,
   usada em atributos onclick="..." (atributo em aspas duplas). */
function jsAttrEscape(str){
  return String(str).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;').replace(/\n/g,' ');
}
function currentMonthKey(){ return todayISO().slice(0,7); }

/* ================= BOOT (chamado depois do login) ================= */
let currentUserRole = 'consultora';

async function bootApp(){
  try{
    await refreshAll();
  }catch(err){
    alert('Não foi possível carregar os dados do Supabase: ' + err.message);
    return;
  }
  const myProfile = state.profiles.find(p=>p.id === currentUser.id);
  currentUserRole = myProfile ? myProfile.role : 'consultora';
  document.getElementById('navEquipe').style.display = currentUserRole === 'diretora' ? '' : 'none';

  document.getElementById('saleItemsWrap').innerHTML = '';
  addSaleItemRow();
  document.getElementById('poItemsWrap').innerHTML = '';
  addPoItemRow();
  renderDashboard();
  renderProducts();
  renderCustomers();
  renderCustomerOptions();
  renderSales();
  loadAutomationForm();
}

/* ---------- Navegação ---------- */
document.querySelectorAll('nav button').forEach(btn=>{
  btn.addEventListener('click', ()=> showView(btn.dataset.view));
});
function showView(name){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active', b.dataset.view===name));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active', v.id==='view-'+name));
  if(name==='dashboard') renderDashboard();
  if(name==='produtos') renderProducts();
  if(name==='vendas'){ renderCustomerOptions(); renderSales(); }
  if(name==='clientes') renderCustomers();
  if(name==='campanhas') renderCampaigns();
  if(name==='pedidos') renderPurchaseView();
  if(name==='relatorios') renderReportDefaults();
  if(name==='automacao') loadAutomationForm();
  if(name==='equipe') renderTeamManagement();
}

/* ================= PRODUTOS ================= */
document.getElementById('productForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const id = document.getElementById('productId').value;
  const name = document.getElementById('productName').value.trim();
  const price = parseFloat(document.getElementById('productPrice').value);
  const stock = parseInt(document.getElementById('productStock').value, 10);
  const minStock = parseInt(document.getElementById('productMinStock').value || '5', 10);
  const replenishDaysRaw = document.getElementById('productReplenishDays').value;
  const replenishDays = replenishDaysRaw ? parseInt(replenishDaysRaw, 10) : null;
  if(!name || isNaN(price) || isNaN(stock)) return;

  try{
    if(id){
      await apiUpdateProduct({id: Number(id), name, price, stock, minStock, replenishDays});
    } else {
      await apiCreateProduct({name, price, stock, minStock, replenishDays});
    }
    await refreshAll();
    resetProductForm();
    renderProducts();
  }catch(err){
    alert('Erro ao salvar produto: ' + err.message);
  }
});
document.getElementById('cancelProductEdit').addEventListener('click', resetProductForm);

function resetProductForm(){
  document.getElementById('productForm').reset();
  document.getElementById('productId').value = '';
  document.getElementById('productFormTitle').textContent = 'Novo produto';
  document.getElementById('cancelProductEdit').style.display = 'none';
  document.getElementById('productMinStock').value = 5;
  document.getElementById('productReplenishDays').value = '';
}

function editProduct(id){
  const p = state.products.find(p=>p.id===id);
  if(!p) return;
  document.getElementById('productId').value = p.id;
  document.getElementById('productName').value = p.name;
  document.getElementById('productPrice').value = p.price;
  document.getElementById('productStock').value = p.stock;
  document.getElementById('productMinStock').value = p.minStock || 5;
  document.getElementById('productReplenishDays').value = p.replenishDays || '';
  document.getElementById('productFormTitle').textContent = 'Editar produto';
  document.getElementById('cancelProductEdit').style.display = 'inline-block';
  showView('produtos');
  window.scrollTo(0,0);
}

async function deleteProduct(id){
  if(!confirm('Excluir este produto?')) return;
  try{
    await apiDeleteProduct(id);
    await refreshAll();
    renderProducts();
  }catch(err){
    alert('Erro ao excluir produto: ' + err.message);
  }
}

function renderProducts(){
  const body = document.getElementById('productsBody');
  body.innerHTML = '';
  document.getElementById('productsEmpty').style.display = state.products.length ? 'none' : 'block';
  state.products.forEach(p=>{
    const low = p.stock <= (p.minStock ?? 5);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>R$ ${money(p.price)}</td>
      <td>R$ ${money(p.cost)}</td>
      <td>${p.stock} ${low ? '<span class="badge baixo">estoque baixo</span>' : ''}</td>
      <td>${p.replenishDays ? `${p.replenishDays} dias` : '-'}</td>
      <td class="actions-cell">
        <button class="btn small secondary" onclick="editProduct(${p.id})">Editar</button>
        <button class="btn small danger" onclick="deleteProduct(${p.id})">Excluir</button>
      </td>`;
    body.appendChild(tr);
  });
  renderStockSummary();
  populateMovementProductOptions();
  renderStockMovements();
  refreshSaleItemProductOptions();
}

function refreshSaleItemProductOptions(){
  document.querySelectorAll('.sale-item-product').forEach(sel=>{
    const current = sel.value;
    sel.innerHTML = productOptionsHtml(current);
    sel.value = current;
  });
}

/* --- Controle de estoque: entrada/saída --- */
function renderStockSummary(){
  const el = document.getElementById('stockSummaryCards');
  if(!el) return;
  const unidades = state.products.reduce((sum,p)=>sum+(p.stock||0), 0);
  const valorEstoque = state.products.reduce((sum,p)=>sum+(p.stock||0)*(p.price||0), 0);
  const baixo = state.products.filter(p=>p.stock <= (p.minStock ?? 5)).length;
  el.innerHTML = `
    <div class="card"><div class="label">Valor do estoque</div><div class="value">R$ ${money(valorEstoque)}</div></div>
    <div class="card"><div class="label">Unidades em estoque</div><div class="value">${unidades}</div></div>
    <div class="card"><div class="label">Produtos com estoque baixo</div><div class="value ${baixo>0?'danger':''}">${baixo}</div></div>
  `;
}

function populateMovementProductOptions(){
  const sel = document.getElementById('movementProduct');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = state.products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (estoque: ${p.stock})</option>`).join('');
  if(current) sel.value = current;
}

document.getElementById('stockMovementForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const productId = parseInt(document.getElementById('movementProduct').value, 10);
  const type = document.getElementById('movementType').value;
  const qty = parseInt(document.getElementById('movementQty').value || '0', 10);
  const reason = document.getElementById('movementReason').value.trim();
  if(!productId || !qty || qty <= 0) return;

  try{
    await apiCreateStockMovement(productId, type, qty, reason);
    await refreshAll();
    document.getElementById('stockMovementForm').reset();
    document.getElementById('movementQty').value = 1;
    renderProducts();
  }catch(err){
    alert(err.message);
  }
});

function renderStockMovements(){
  const body = document.getElementById('stockMovementsBody');
  if(!body) return;
  body.innerHTML = '';
  const list = state.stockMovements.slice().reverse();
  document.getElementById('stockMovementsEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach(m=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(m.date)}</td>
      <td>${escapeHtml(m.productName)}</td>
      <td><span class="badge ${m.type==='entrada'?'pago':'pendente'}">${m.type==='entrada'?'Entrada':'Saída'}</span></td>
      <td>${m.qty}</td>
      <td>${escapeHtml(m.reason||'-')}</td>
      <td>${m.stockAfter}</td>`;
    body.appendChild(tr);
  });
}

/* ================= CLIENTES ================= */
document.getElementById('customerForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const id = document.getElementById('customerId').value;
  const name = document.getElementById('customerName').value.trim();
  const phone = document.getElementById('customerPhone').value.trim();
  const email = document.getElementById('customerEmail').value.trim();
  const birthDate = document.getElementById('customerBirthDate').value;
  const skinType = document.getElementById('customerSkinType').value;
  const address = document.getElementById('customerAddress').value.trim();
  const notes = document.getElementById('customerNotes').value.trim();
  const businessProspect = document.getElementById('customerBusinessProspect').checked;
  if(!name) return;

  try{
    if(id){
      await apiUpdateCustomer({id: Number(id), name, phone, email, birthDate, skinType, address, notes, businessProspect});
    } else {
      await apiCreateCustomer({name, phone, email, birthDate, skinType, address, notes, businessProspect});
    }
    await refreshAll();
    resetCustomerForm();
    renderCustomers();
  }catch(err){
    alert('Erro ao salvar cliente: ' + err.message);
  }
});
document.getElementById('cancelCustomerEdit').addEventListener('click', resetCustomerForm);

function resetCustomerForm(){
  document.getElementById('customerForm').reset();
  document.getElementById('customerId').value = '';
  document.getElementById('customerFormTitle').textContent = 'Novo cliente';
  document.getElementById('cancelCustomerEdit').style.display = 'none';
  document.getElementById('customerBirthDate').value = '';
  document.getElementById('customerSkinType').value = '';
  document.getElementById('customerAddress').value = '';
  document.getElementById('customerNotes').value = '';
  document.getElementById('customerBusinessProspect').checked = false;
}

function editCustomer(id){
  const c = state.customers.find(c=>c.id===id);
  if(!c) return;
  document.getElementById('customerId').value = c.id;
  document.getElementById('customerName').value = c.name;
  document.getElementById('customerPhone').value = c.phone || '';
  document.getElementById('customerEmail').value = c.email || '';
  document.getElementById('customerBirthDate').value = c.birthDate || '';
  document.getElementById('customerSkinType').value = c.skinType || '';
  document.getElementById('customerAddress').value = c.address || '';
  document.getElementById('customerNotes').value = c.notes || '';
  document.getElementById('customerBusinessProspect').checked = !!c.businessProspect;
  document.getElementById('customerFormTitle').textContent = 'Editar cliente';
  document.getElementById('cancelCustomerEdit').style.display = 'inline-block';
  showView('clientes');
  window.scrollTo(0,0);
}

async function deleteCustomer(id){
  if(!confirm('Excluir este cliente?')) return;
  try{
    await apiDeleteCustomer(id);
    await refreshAll();
    renderCustomers();
  }catch(err){
    alert('Erro ao excluir cliente: ' + err.message);
  }
}

function renderCustomers(){
  const body = document.getElementById('customersBody');
  body.innerHTML = '';
  document.getElementById('customersEmpty').style.display = state.customers.length ? 'none' : 'block';
  state.customers.forEach(c=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone||'-')}</td>
      <td>${escapeHtml(c.email||'-')}</td>
      <td>${c.birthDate ? formatDate(c.birthDate) : '-'}</td>
      <td>${escapeHtml(c.skinType || '-')}</td>
      <td class="actions-cell">
        <button class="btn small secondary" onclick="openClientDetail(${c.id})">Ver histórico</button>
        <button class="btn small whatsapp" onclick="openComposer({customerId:${c.id}})">WhatsApp</button>
        <button class="btn small secondary" onclick="editCustomer(${c.id})">Editar</button>
        <button class="btn small danger" onclick="deleteCustomer(${c.id})">Excluir</button>
      </td>`;
    body.appendChild(tr);
  });
  renderReplenishReminders();
  renderInactiveCustomers();
  renderBusinessProspects();
  renderFollowups();
  populateAppointmentCustomerSelect();
  renderAppointments();
}

/* --- Atendimentos (VIP / skincare) --- */
const APPOINTMENT_TYPE_LABELS = { vip: 'Atendimento VIP', skincare: 'Sessão de skincare' };

function populateAppointmentCustomerSelect(){
  const sel = document.getElementById('appointmentCustomer');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Selecione...</option>';
  state.customers.forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    sel.appendChild(opt);
  });
  sel.value = current;
}

document.getElementById('appointmentForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const customerId = document.getElementById('appointmentCustomer').value;
  const type = document.getElementById('appointmentType').value;
  const date = document.getElementById('appointmentDate').value;
  const time = document.getElementById('appointmentTime').value;
  const notes = document.getElementById('appointmentNotes').value.trim();
  if(!customerId || !date) return;
  try{
    await apiCreateAppointment({customerId: Number(customerId), type, date, time, notes});
    await refreshAll();
    document.getElementById('appointmentForm').reset();
    renderAppointments();
  }catch(err){
    alert('Erro ao agendar atendimento: ' + err.message);
  }
});

async function setAppointmentStatus(id, status){
  try{
    await apiUpdateAppointmentStatus(id, status);
    await refreshAll();
    renderAppointments();
  }catch(err){
    alert('Erro ao atualizar atendimento: ' + err.message);
  }
}

async function deleteAppointment(id){
  if(!confirm('Excluir este atendimento?')) return;
  try{
    await apiDeleteAppointment(id);
    await refreshAll();
    renderAppointments();
  }catch(err){
    alert('Erro ao excluir atendimento: ' + err.message);
  }
}

function renderAppointments(){
  const body = document.getElementById('appointmentsBody');
  if(!body) return;
  body.innerHTML = '';
  const list = state.appointments.filter(a=>a.status==='agendado').slice().sort((a,b)=>a.date.localeCompare(b.date));
  document.getElementById('appointmentsEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach(a=>{
    const c = state.customers.find(c=>c.id===a.customerId);
    const podeGerenciar = currentUser && a.sellerId === currentUser.id;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c ? c.name : 'Cliente removido')}</td>
      <td>${APPOINTMENT_TYPE_LABELS[a.type] || a.type}</td>
      <td>${formatDate(a.date)}${a.time ? ' às '+a.time.slice(0,5) : ''}</td>
      <td><span class="badge pendente">Agendado</span></td>
      <td class="actions-cell">
        ${c && c.phone ? `<button class="btn small whatsapp" onclick="openComposer({customerId:${c.id}, scenario:'atendimento', extra:{tipoAtendimento:'${jsAttrEscape(APPOINTMENT_TYPE_LABELS[a.type]||a.type)}', dataAtendimento:'${jsAttrEscape(formatDate(a.date))}'}})">WhatsApp</button>` : ''}
        ${podeGerenciar ? `<button class="btn small secondary" onclick="setAppointmentStatus(${a.id}, 'concluido')">Concluir</button>` : ''}
        ${podeGerenciar ? `<button class="btn small secondary" onclick="setAppointmentStatus(${a.id}, 'cancelado')">Cancelar</button>` : ''}
        ${podeGerenciar ? `<button class="btn small danger" onclick="deleteAppointment(${a.id})">Excluir</button>` : ''}
      </td>`;
    body.appendChild(tr);
  });
}

/* --- Acompanhamento pós-venda (Método 2+2+2) --- */
const FOLLOWUP_STAGES = {
  '2_dias': {due:'due2Dias', done:'done2Dias', note:'note2Dias', label:'2 dias'},
  '2_semanas': {due:'due2Semanas', done:'done2Semanas', note:'note2Semanas', label:'2 semanas'},
  '2_meses': {due:'due2Meses', done:'done2Meses', note:'note2Meses', label:'2 meses'}
};

function getPendingFollowups(){
  const hoje = todayISO();
  const pendentes = [];

  state.followups.forEach(f=>{
    const c = state.customers.find(c=>c.id===f.customerId);
    if(!c) return;
    const s = state.sales.find(s=>s.id===f.saleId);
    Object.entries(FOLLOWUP_STAGES).forEach(([stage, keys])=>{
      if(f[keys.due] <= hoje && !f[keys.done]){
        pendentes.push({followup:f, stage, keys, customer:c, sale:s});
      }
    });
  });

  pendentes.sort((a,b)=> a.followup[a.keys.due].localeCompare(b.followup[b.keys.due]));
  return pendentes;
}

function renderFollowups(){
  const body = document.getElementById('followupsBody');
  if(!body) return;
  body.innerHTML = '';
  const hoje = todayISO();
  const pendentes = getPendingFollowups();

  document.getElementById('followupsEmpty').style.display = pendentes.length ? 'none' : 'block';
  pendentes.forEach(p=>{
    const due = p.followup[p.keys.due];
    const dias = Math.floor((new Date(hoje) - new Date(due)) / (1000*60*60*24));
    const situacao = dias <= 0 ? 'Hoje' : `${dias} dia(s) atrasado`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.customer.name)}</td>
      <td>${p.sale ? formatDate(p.sale.date) : '-'}</td>
      <td>${p.keys.label}</td>
      <td>${situacao}</td>
      <td class="actions-cell">
        <button class="btn small secondary" onclick="openFollowupRegister(${p.followup.id}, '${p.stage}')">Registrar contato</button>
        ${p.customer.phone ? `<button class="btn small whatsapp" onclick="openComposer({customerId:${p.customer.id}, saleId:${p.sale ? p.sale.id : 'null'}, scenario:'acompanhamento', extra:{estagio:'${p.keys.label}'}})">WhatsApp</button>` : ''}
      </td>`;
    body.appendChild(tr);
  });
}

let followupCtx = {};
function openFollowupRegister(followupId, stage){
  const f = state.followups.find(f=>f.id===followupId);
  if(!f) return;
  const c = state.customers.find(c=>c.id===f.customerId);
  followupCtx = {followupId, stage};
  document.getElementById('followupRegisterInfo').textContent = `${c ? c.name : 'Cliente'} — contato de ${FOLLOWUP_STAGES[stage].label}`;
  document.getElementById('followupRegisterNote').value = '';
  document.getElementById('followupRegisterOverlay').classList.add('active');
}
document.getElementById('closeFollowupRegister').addEventListener('click', ()=>{
  document.getElementById('followupRegisterOverlay').classList.remove('active');
});
document.getElementById('followupRegisterForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const note = document.getElementById('followupRegisterNote').value.trim();
  try{
    await apiCompleteFollowupStage(followupCtx.followupId, followupCtx.stage, note);
    await refreshAll();
    document.getElementById('followupRegisterOverlay').classList.remove('active');
    renderFollowups();
  }catch(err){
    alert('Erro ao registrar contato: ' + err.message);
  }
});

function renderBusinessProspects(){
  const body = document.getElementById('businessProspectsBody');
  if(!body) return;
  body.innerHTML = '';
  const list = state.customers.filter(c=>c.businessProspect);
  document.getElementById('businessProspectsEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach(c=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.phone || '-')}</td>
      <td class="actions-cell">${c.phone ? `<button class="btn small whatsapp" onclick="openComposer({customerId:${c.id}, scenario:'oportunidade'})">WhatsApp</button>` : ''}</td>`;
    body.appendChild(tr);
  });
}

/* --- Ficha do cliente (histórico de compras + produtos utilizados) --- */
function openClientDetail(id){
  const c = state.customers.find(c=>c.id===id);
  if(!c) return;
  const vendas = state.sales.filter(s=>s.customerId===id).slice().sort((a,b)=>b.date.localeCompare(a.date));

  document.getElementById('clientDetailName').textContent = c.name + (c.businessProspect ? ' · 💼 potencial consultora' : '');
  const infoParts = [c.phone || 'sem telefone', c.email || 'sem e-mail'];
  if(c.birthDate) infoParts.push(`aniversário ${formatDate(c.birthDate)}`);
  if(c.skinType) infoParts.push(`pele ${c.skinType}`);
  if(c.address) infoParts.push(c.address);
  document.getElementById('clientDetailInfo').textContent = infoParts.join(' · ');

  const notesEl = document.getElementById('clientDetailNotes');
  notesEl.style.display = c.notes ? 'block' : 'none';
  notesEl.textContent = c.notes ? `Observações: ${c.notes}` : '';

  const produtos = {};
  vendas.forEach(s=>{
    s.items.forEach(i=>{
      if(!produtos[i.name]) produtos[i.name] = {qty:0, lastDate: s.date};
      produtos[i.name].qty += i.qty;
      if(s.date > produtos[i.name].lastDate) produtos[i.name].lastDate = s.date;
    });
  });
  const produtosBody = document.getElementById('clientDetailProductsBody');
  produtosBody.innerHTML = '';
  const produtosList = Object.entries(produtos).sort((a,b)=>b[1].lastDate.localeCompare(a[1].lastDate));
  document.getElementById('clientDetailProductsEmpty').style.display = produtosList.length ? 'none' : 'block';
  produtosList.forEach(([name, d])=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${d.qty}</td><td>${formatDate(d.lastDate)}</td>`;
    produtosBody.appendChild(tr);
  });

  const salesBody = document.getElementById('clientDetailSalesBody');
  salesBody.innerHTML = '';
  document.getElementById('clientDetailSalesEmpty').style.display = vendas.length ? 'none' : 'block';
  vendas.forEach(s=>{
    const itemsStr = s.items.map(i=>`${i.name} x${i.qty}`).join(', ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(s.date)}</td>
      <td>${escapeHtml(itemsStr)}</td>
      <td>R$ ${money(s.total)}</td>
      <td><span class="badge ${s.status==='Pago'?'pago':'pendente'}">${s.status}</span></td>`;
    salesBody.appendChild(tr);
  });

  const apptsBody = document.getElementById('clientDetailAppointmentsBody');
  const appts = state.appointments.filter(a=>a.customerId===id).slice().sort((a,b)=>b.date.localeCompare(a.date));
  apptsBody.innerHTML = '';
  document.getElementById('clientDetailAppointmentsEmpty').style.display = appts.length ? 'none' : 'block';
  const APPT_STATUS_BADGE = {agendado:'pendente', concluido:'pago', cancelado:'baixo'};
  const APPT_STATUS_LABEL = {agendado:'Agendado', concluido:'Concluído', cancelado:'Cancelado'};
  appts.forEach(a=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(a.date)}${a.time ? ' às '+a.time.slice(0,5) : ''}</td>
      <td>${APPOINTMENT_TYPE_LABELS[a.type] || a.type}</td>
      <td><span class="badge ${APPT_STATUS_BADGE[a.status] || 'pendente'}">${APPT_STATUS_LABEL[a.status] || a.status}</span></td>`;
    apptsBody.appendChild(tr);
  });

  document.getElementById('clientDetailOverlay').classList.add('active');
}
document.getElementById('closeClientDetail').addEventListener('click', ()=>{
  document.getElementById('clientDetailOverlay').classList.remove('active');
});

/* --- Lembrete: hora de repor --- */
function renderReplenishReminders(){
  const body = document.getElementById('replenishBody');
  if(!body) return;
  body.innerHTML = '';
  const hoje = todayISO();
  const lembretes = [];

  state.products.filter(p=>p.replenishDays).forEach(p=>{
    const vendasProduto = state.sales.filter(s=>s.status==='Pago' && s.customerId && s.items.some(i=>i.productId===p.id));
    const ultimaPorCliente = {};
    vendasProduto.forEach(s=>{
      if(!ultimaPorCliente[s.customerId] || s.date > ultimaPorCliente[s.customerId]) ultimaPorCliente[s.customerId] = s.date;
    });
    Object.entries(ultimaPorCliente).forEach(([customerId, lastDate])=>{
      const dias = Math.floor((new Date(hoje) - new Date(lastDate)) / (1000*60*60*24));
      if(dias >= p.replenishDays){
        lembretes.push({customerId: Number(customerId), productName: p.name, lastDate, dias});
      }
    });
  });

  lembretes.sort((a,b)=>b.dias-a.dias);
  document.getElementById('replenishEmpty').style.display = lembretes.length ? 'none' : 'block';
  lembretes.forEach(l=>{
    const c = state.customers.find(c=>c.id===l.customerId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c ? c.name : 'Cliente removido')}</td>
      <td>${escapeHtml(l.productName)}</td>
      <td>${formatDate(l.lastDate)}</td>
      <td>${l.dias} dias</td>
      <td class="actions-cell">${c && c.phone ? `<button class="btn small whatsapp" onclick="openComposer({customerId:${c.id}, scenario:'reposicao', extra:{produto:'${jsAttrEscape(l.productName)}'}})">WhatsApp</button>` : ''}</td>`;
    body.appendChild(tr);
  });
}

/* --- Lembrete: cliente sumida --- */
const CLIENTE_SUMIDA_DIAS = 60;
function renderInactiveCustomers(){
  const body = document.getElementById('inactiveCustomersBody');
  if(!body) return;
  body.innerHTML = '';
  const hoje = todayISO();

  const ultimaCompraPorCliente = {};
  state.sales.filter(s=>s.status==='Pago' && s.customerId).forEach(s=>{
    if(!ultimaCompraPorCliente[s.customerId] || s.date > ultimaCompraPorCliente[s.customerId]) ultimaCompraPorCliente[s.customerId] = s.date;
  });

  const sumidas = Object.entries(ultimaCompraPorCliente)
    .map(([customerId, lastDate])=>({
      customerId: Number(customerId), lastDate,
      dias: Math.floor((new Date(hoje) - new Date(lastDate)) / (1000*60*60*24))
    }))
    .filter(x=>x.dias >= CLIENTE_SUMIDA_DIAS)
    .sort((a,b)=>b.dias-a.dias);

  document.getElementById('inactiveCustomersEmpty').style.display = sumidas.length ? 'none' : 'block';
  sumidas.forEach(x=>{
    const c = state.customers.find(c=>c.id===x.customerId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c ? c.name : 'Cliente removido')}</td>
      <td>${formatDate(x.lastDate)}</td>
      <td>${x.dias} dias</td>
      <td class="actions-cell">${c && c.phone ? `<button class="btn small whatsapp" onclick="openComposer({customerId:${c.id}, scenario:'reengajamento'})">WhatsApp</button>` : ''}</td>`;
    body.appendChild(tr);
  });
}

/* --- Importar contato do celular (Contact Picker API) --- */
const contactBtn = document.getElementById('importContactBtn');
const contactHint = document.getElementById('contactApiHint');
const contactApiSupported = ('contacts' in navigator && 'ContactsManager' in window);
if(!contactApiSupported){
  contactHint.textContent = 'Este navegador/aparelho não permite importar contatos automaticamente. Isso funciona apenas em alguns celulares Android com Chrome. Use o formulário manual abaixo.';
} else {
  contactHint.textContent = 'Toque no botão acima para escolher um contato do seu celular.';
}
contactBtn.addEventListener('click', async ()=>{
  if(!contactApiSupported){
    alert('Importação automática de contatos não é suportada neste dispositivo/navegador. Preencha o formulário manualmente.');
    return;
  }
  try{
    const props = ['name','tel','email'];
    const contacts = await navigator.contacts.select(props, {multiple:false});
    if(contacts && contacts.length){
      const c = contacts[0];
      document.getElementById('customerName').value = (c.name && c.name[0]) || '';
      document.getElementById('customerPhone').value = (c.tel && c.tel[0]) || '';
      document.getElementById('customerEmail').value = (c.email && c.email[0]) || '';
    }
  }catch(err){
    alert('Não foi possível importar o contato: ' + err.message);
  }
});

/* ================= VENDAS ================= */
function renderCustomerOptions(){
  const sel = document.getElementById('saleCustomer');
  const current = sel.value;
  sel.innerHTML = '<option value="">Sem cliente identificado</option>';
  state.customers.forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    sel.appendChild(opt);
  });
  sel.value = current;
}

function productOptionsHtml(selectedId){
  let html = '<option value="">Selecione...</option>';
  state.products.forEach(p=>{
    html += `<option value="${p.id}" ${String(p.id)===String(selectedId)?'selected':''}>${escapeHtml(p.name)} (estoque: ${p.stock})</option>`;
  });
  return html;
}

function addSaleItemRow(){
  const wrap = document.getElementById('saleItemsWrap');
  const row = document.createElement('div');
  row.className = 'sale-item-row';
  row.innerHTML = `
    <div class="field" style="flex:2;">
      <label>Produto</label>
      <select class="sale-item-product">${productOptionsHtml()}</select>
    </div>
    <div class="field" style="max-width:100px;">
      <label>Qtd.</label>
      <input type="number" class="sale-item-qty" min="1" value="1">
    </div>
    <button type="button" class="btn small danger" style="height:38px;" onclick="this.parentElement.remove(); updateSaleTotal();">Remover</button>
  `;
  wrap.appendChild(row);
  row.querySelector('.sale-item-product').addEventListener('change', updateSaleTotal);
  row.querySelector('.sale-item-qty').addEventListener('input', updateSaleTotal);
  updateSaleTotal();
}
document.getElementById('addSaleItem').addEventListener('click', addSaleItemRow);

function getSaleItemsFromForm(){
  const rows = document.querySelectorAll('#saleItemsWrap .sale-item-row');
  const items = [];
  rows.forEach(row=>{
    const productId = row.querySelector('.sale-item-product').value;
    const qty = parseInt(row.querySelector('.sale-item-qty').value || '0', 10);
    if(productId && qty > 0){
      const p = state.products.find(p=>String(p.id)===String(productId));
      if(p) items.push({productId: p.id, name: p.name, qty, price: p.price});
    }
  });
  return items;
}

function updateSaleTotal(){
  const items = getSaleItemsFromForm();
  const total = items.reduce((sum,i)=> sum + i.qty*i.price, 0);
  document.getElementById('saleTotal').textContent = money(total);
}

document.getElementById('saleForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const items = getSaleItemsFromForm();
  if(!items.length){ alert('Adicione ao menos um produto à venda.'); return; }

  const customerId = document.getElementById('saleCustomer').value || null;
  const payment = document.getElementById('salePayment').value;
  const status = document.getElementById('saleStatus').value;

  try{
    await apiCreateSale(todayISO(), customerId ? Number(customerId) : null, payment, status, items);
    await refreshAll();
    document.getElementById('saleForm').reset();
    document.getElementById('saleItemsWrap').innerHTML = '';
    addSaleItemRow();
    renderSales();
    renderProducts();
  }catch(err){
    alert(err.message);
  }
});

async function toggleSaleStatus(id){
  const s = state.sales.find(s=>s.id===id);
  if(!s) return;
  try{
    await apiToggleSaleStatus(s);
    await refreshAll();
    renderSales();
  }catch(err){
    alert('Erro ao atualizar status: ' + err.message);
  }
}

async function deleteSale(id){
  if(!confirm('Excluir esta venda? O estoque dos produtos será devolvido.')) return;
  try{
    await apiDeleteSale(id);
    await refreshAll();
    renderSales();
    renderProducts();
  }catch(err){
    alert(err.message);
  }
}

function customerName(id){
  if(!id) return 'Sem cliente identificado';
  const c = state.customers.find(c=>c.id===id);
  return c ? c.name : 'Cliente removido';
}

function renderSales(){
  const filter = document.getElementById('filterSaleStatus').value;
  const body = document.getElementById('salesBody');
  body.innerHTML = '';
  const list = state.sales.filter(s=> !filter || s.status===filter).slice().reverse();
  document.getElementById('salesEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach(s=>{
    const itemsStr = s.items.map(i=>`${i.name} x${i.qty}`).join(', ');
    const podeEditar = currentUser && s.sellerId === currentUser.id;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(s.date)}</td>
      <td>${escapeHtml(customerName(s.customerId))}</td>
      <td>${escapeHtml(itemsStr)}</td>
      <td>R$ ${money(s.total)}</td>
      <td>R$ ${money(s.profit)}</td>
      <td>${escapeHtml(s.payment)}</td>
      <td>${escapeHtml(s.seller || '-')}</td>
      <td><span class="badge ${s.status==='Pago'?'pago':'pendente'}">${s.status}</span></td>
      <td class="actions-cell">
        ${s.status==='Pendente' && s.customerId ? `<button class="btn small whatsapp" onclick="openComposer({customerId:${s.customerId}, saleId:${s.id}, scenario:'cobranca'})">Cobrar</button>` : ''}
        ${podeEditar ? `<button class="btn small secondary" onclick="toggleSaleStatus(${s.id})">Marcar ${s.status==='Pago'?'Pendente':'Pago'}</button>` : ''}
        ${podeEditar ? `<button class="btn small danger" onclick="deleteSale(${s.id})">Excluir</button>` : ''}
      </td>`;
    body.appendChild(tr);
  });
}
document.getElementById('filterSaleStatus').addEventListener('change', renderSales);

/* ================= DASHBOARD ================= */
let salesChartInstance = null;

function renderDashboard(){
  const monthKey = currentMonthKey();
  const totalPendente = state.sales.filter(s=>s.status==='Pendente').reduce((sum,s)=>sum+s.total,0);
  const vendasCount = state.sales.length;
  const estoqueBaixo = state.products.filter(p=>p.stock <= (p.minStock ?? 5)).length;

  const vendasPagasMes = state.sales.filter(s=>s.status==='Pago' && s.date.startsWith(monthKey));
  const faturamentoMes = vendasPagasMes.reduce((sum,s)=>sum+s.total,0);
  const lucroMes = vendasPagasMes.reduce((sum,s)=>sum+s.profit,0);

  const clientesAtendidos = new Set(state.sales.map(s=>s.customerId).filter(Boolean)).size;
  const estoqueDisponivel = state.products.reduce((sum,p)=>sum+(p.stock||0), 0);

  const cards = document.getElementById('dashCards');
  cards.innerHTML = `
    <div class="card"><div class="label">Faturamento do mês</div><div class="value">R$ ${money(faturamentoMes)}</div></div>
    <div class="card"><div class="label">Lucro do mês</div><div class="value">R$ ${money(lucroMes)}</div></div>
    <div class="card"><div class="label">A receber (pendente)</div><div class="value warning">R$ ${money(totalPendente)}</div></div>
    <div class="card"><div class="label">Clientes atendidos</div><div class="value">${clientesAtendidos}</div></div>
    <div class="card"><div class="label">Estoque disponível (unid.)</div><div class="value">${estoqueDisponivel}</div></div>
    <div class="card"><div class="label">Total de vendas</div><div class="value">${vendasCount}</div></div>
    <div class="card"><div class="label">Produtos com estoque baixo</div><div class="value ${estoqueBaixo>0?'danger':''}">${estoqueBaixo}</div></div>
  `;

  renderGoalProgress(faturamentoMes);
  renderBirthdays();
  renderTeamPerformance(monthKey);
  renderUpcomingTrainings();

  const days = [];
  for(let i=13;i>=0;i--){
    const d = new Date();
    d.setDate(d.getDate()-i);
    days.push(d.toISOString().slice(0,10));
  }
  const totalsByDay = days.map(day=>
    state.sales.filter(s=>s.date===day).reduce((sum,s)=>sum+s.total,0)
  );

  const ctx = document.getElementById('salesChart').getContext('2d');
  if(salesChartInstance) salesChartInstance.destroy();
  salesChartInstance = new Chart(ctx, {
    type:'bar',
    data:{
      labels: days.map(d=>formatDate(d)),
      datasets:[{ label:'Faturamento (R$)', data: totalsByDay, backgroundColor:'#16a34a' }]
    },
    options:{
      responsive:true,
      plugins:{legend:{display:false}},
      scales:{ y:{ beginAtZero:true } }
    }
  });

  const productTotals = {};
  state.sales.forEach(s=>{
    s.items.forEach(item=>{
      if(!productTotals[item.productId]) productTotals[item.productId] = {name:item.name, qty:0, total:0};
      productTotals[item.productId].qty += item.qty;
      productTotals[item.productId].total += item.qty*item.price;
    });
  });
  const top = Object.values(productTotals).sort((a,b)=>b.qty-a.qty).slice(0,5);
  const body = document.getElementById('topProductsBody');
  body.innerHTML = '';
  if(!top.length){
    body.innerHTML = '<tr><td colspan="3" class="empty">Sem vendas registradas ainda.</td></tr>';
  } else {
    top.forEach(t=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(t.name)}</td><td>${t.qty}</td><td>R$ ${money(t.total)}</td>`;
      body.appendChild(tr);
    });
  }
}

/* --- Meta mensal --- */
function renderGoalProgress(faturamentoMes){
  const goal = state.settings.monthlyGoal || 0;
  document.getElementById('monthlyGoalInput').value = goal || '';
  const text = document.getElementById('goalProgressText');
  if(!goal){
    text.textContent = 'Defina uma meta mensal para acompanhar o percentual atingido.';
    return;
  }
  const pct = Math.min(999, (faturamentoMes / goal) * 100);
  text.textContent = `R$ ${money(faturamentoMes)} de R$ ${money(goal)} — ${pct.toFixed(1)}% da meta atingida.`;
}
document.getElementById('saveGoalBtn').addEventListener('click', async ()=>{
  const val = parseFloat(document.getElementById('monthlyGoalInput').value || '0');
  try{
    await apiSaveSettings({ monthly_goal: isNaN(val) ? 0 : val });
    await refreshAll();
    renderDashboard();
  }catch(err){
    alert('Erro ao salvar meta: ' + err.message);
  }
});

/* --- Aniversariantes --- */
function suggestGiftForCustomer(customerId){
  const comprasCliente = {};
  state.sales.filter(s=>s.customerId===customerId && s.status==='Pago').forEach(s=>{
    s.items.forEach(i=>{ comprasCliente[i.name] = (comprasCliente[i.name]||0) + i.qty; });
  });
  const favorito = Object.entries(comprasCliente).sort((a,b)=>b[1]-a[1])[0];

  const popularidadeGeral = {};
  state.sales.filter(s=>s.status==='Pago').forEach(s=>{
    s.items.forEach(i=>{ popularidadeGeral[i.name] = (popularidadeGeral[i.name]||0) + i.qty; });
  });
  const novidade = Object.entries(popularidadeGeral).sort((a,b)=>b[1]-a[1]).find(([name])=> !comprasCliente[name]);

  if(favorito && novidade) return `${favorito[0]} (ela já ama) ou ${novidade[0]} (novidade em alta)`;
  if(favorito) return `${favorito[0]}, que ela já compra bastante`;
  if(novidade) return `${novidade[0]}, um dos mais vendidos do momento`;
  return '';
}

document.getElementById('birthdayMonthSelect').addEventListener('change', ()=> renderBirthdays());

let birthdayMonthInitialized = false;
function renderBirthdays(){
  const select = document.getElementById('birthdayMonthSelect');
  if(!birthdayMonthInitialized){
    select.value = String(new Date().getMonth() + 1);
    birthdayMonthInitialized = true;
  }
  const mes = parseInt(select.value, 10);

  const aniversariantes = state.customers
    .filter(c => c.birthDate)
    .map(c => ({ ...c, dia: parseInt(c.birthDate.split('-')[2], 10), mes: parseInt(c.birthDate.split('-')[1], 10) }))
    .filter(c => c.mes === mes)
    .sort((a,b)=>a.dia-b.dia);

  const body = document.getElementById('birthdaysBody');
  body.innerHTML = '';
  document.getElementById('birthdaysEmpty').style.display = aniversariantes.length ? 'none' : 'block';
  aniversariantes.forEach(c=>{
    const sugestao = suggestGiftForCustomer(c.id);
    const sugestaoEscaped = jsAttrEscape(sugestao);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(c.name)}</td>
      <td>Dia ${c.dia}</td>
      <td>${sugestao ? escapeHtml(sugestao) : '-'}</td>
      <td class="actions-cell">${c.phone ? `<button class="btn small whatsapp" onclick="openComposer({customerId:${c.id}, scenario:'aniversario', extra:{sugestao:'${sugestaoEscaped}'}})">Parabenizar</button>` : ''}</td>`;
    body.appendChild(tr);
  });
}

/* --- Campanhas --- */
document.getElementById('campaignForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const name = document.getElementById('campaignName').value.trim();
  const startDate = document.getElementById('campaignStart').value;
  const endDate = document.getElementById('campaignEnd').value;
  const prize = document.getElementById('campaignPrize').value.trim();
  if(!name) return;
  try{
    await apiCreateCampaign({name, startDate, endDate, prize});
    await refreshAll();
    document.getElementById('campaignForm').reset();
    renderCampaigns();
  }catch(err){
    alert('Erro ao criar campanha: ' + err.message);
  }
});

function campaignIsActive(camp){
  if(camp.forcedInactive) return false;
  const hoje = todayISO();
  if(camp.startDate && hoje < camp.startDate) return false;
  if(camp.endDate && hoje > camp.endDate) return false;
  return true;
}

async function encerrarCampanha(id){
  try{
    await apiEndCampaign(id);
    await refreshAll();
    renderCampaigns();
  }catch(err){
    alert('Erro ao encerrar campanha: ' + err.message);
  }
}

async function deleteCampaign(id){
  if(!confirm('Excluir esta campanha?')) return;
  try{
    await apiDeleteCampaign(id);
    await refreshAll();
    renderCampaigns();
  }catch(err){
    alert('Erro ao excluir campanha: ' + err.message);
  }
}

function renderCampaigns(){
  const body = document.getElementById('campaignsBody');
  if(!body) return;
  body.innerHTML = '';
  document.getElementById('campaignsEmpty').style.display = state.campaigns.length ? 'none' : 'block';
  state.campaigns.slice().reverse().forEach(camp=>{
    const ativa = campaignIsActive(camp);
    const periodo = `${camp.startDate ? formatDate(camp.startDate) : '—'} a ${camp.endDate ? formatDate(camp.endDate) : '—'}`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(camp.name)}</td>
      <td>${periodo}</td>
      <td>${escapeHtml(camp.prize || '-')}</td>
      <td><span class="badge ${ativa ? 'pago' : 'pendente'}">${ativa ? 'Ativa' : 'Encerrada'}</span></td>
      <td class="actions-cell">
        <button class="btn small secondary" onclick="openCampaignDetail(${camp.id})">Ver detalhes</button>
        ${ativa ? `<button class="btn small secondary" onclick="encerrarCampanha(${camp.id})">Encerrar agora</button>` : ''}
        <button class="btn small danger" onclick="deleteCampaign(${camp.id})">Excluir</button>
      </td>`;
    body.appendChild(tr);
  });
  if(selectedCampaignId && state.campaigns.some(c=>c.id===selectedCampaignId)){
    renderCampaignDetail(selectedCampaignId);
  } else {
    selectedCampaignId = null;
    document.getElementById('campaignDetailPanel').style.display = 'none';
  }
}

/* --- Detalhe da campanha: meta individual + ranking do período --- */
let selectedCampaignId = null;

function openCampaignDetail(id){
  selectedCampaignId = id;
  renderCampaignDetail(id);
  document.getElementById('campaignDetailPanel').style.display = 'block';
}
document.getElementById('closeCampaignDetail').addEventListener('click', ()=>{
  selectedCampaignId = null;
  document.getElementById('campaignDetailPanel').style.display = 'none';
});

function renderCampaignDetail(id){
  const camp = state.campaigns.find(c=>c.id===id);
  if(!camp) return;

  document.getElementById('campaignDetailName').textContent = camp.name;
  const periodo = `${camp.startDate ? formatDate(camp.startDate) : '—'} a ${camp.endDate ? formatDate(camp.endDate) : '—'}`;
  document.getElementById('campaignDetailInfo').textContent = camp.prize
    ? `${periodo} · 🏆 Prêmio: ${camp.prize}`
    : periodo;

  const vendasPeriodo = state.sales.filter(s=>
    s.status==='Pago' &&
    (!camp.startDate || s.date >= camp.startDate) &&
    (!camp.endDate || s.date <= camp.endDate)
  );
  const faturamentoPeriodo = vendasPeriodo.reduce((sum,s)=>sum+s.total,0);

  let diasInfo = '';
  if(camp.endDate){
    const dias = Math.floor((new Date(camp.endDate) - new Date(todayISO())) / (1000*60*60*24));
    diasInfo = dias >= 0 ? `${dias} dia(s) restantes` : 'Período encerrado';
  }

  document.getElementById('campaignDetailCards').innerHTML = `
    <div class="card"><div class="label">Faturamento da campanha</div><div class="value">R$ ${money(faturamentoPeriodo)}</div></div>
    <div class="card"><div class="label">Vendas no período</div><div class="value">${vendasPeriodo.length}</div></div>
    ${diasInfo ? `<div class="card"><div class="label">Prazo</div><div class="value">${diasInfo}</div></div>` : ''}
  `;

  const myGoal = state.campaignGoals.find(g=>g.campaignId===id && g.sellerId===currentUser.id);
  document.getElementById('campaignGoalValue').value = myGoal ? myGoal.goalValue : '';

  const ranking = state.campaignGoals.filter(g=>g.campaignId===id).map(g=>{
    const vendidoConsultora = vendasPeriodo.filter(s=>s.sellerId===g.sellerId).reduce((sum,s)=>sum+s.total,0);
    const pct = g.goalValue > 0 ? (vendidoConsultora / g.goalValue) * 100 : 0;
    return {...g, vendido: vendidoConsultora, pct};
  }).sort((a,b)=>b.pct-a.pct);

  const goalsBody = document.getElementById('campaignGoalsBody');
  goalsBody.innerHTML = '';
  document.getElementById('campaignGoalsEmpty').style.display = ranking.length ? 'none' : 'block';
  ranking.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.sellerName)}</td>
      <td>R$ ${money(r.goalValue)}</td>
      <td>R$ ${money(r.vendido)}</td>
      <td>${r.pct.toFixed(1)}%</td>`;
    goalsBody.appendChild(tr);
  });
}

document.getElementById('campaignGoalForm').addEventListener('submit', async e=>{
  e.preventDefault();
  if(!selectedCampaignId) return;
  const val = parseFloat(document.getElementById('campaignGoalValue').value || '0');
  try{
    await apiSetCampaignGoal(selectedCampaignId, isNaN(val) ? 0 : val);
    await refreshAll();
    renderCampaignDetail(selectedCampaignId);
  }catch(err){
    alert('Erro ao salvar meta: ' + err.message);
  }
});

/* --- Desempenho da equipe --- */
function renderTeamPerformance(monthKey){
  const vendasDoMes = state.sales.filter(s=>s.status==='Pago' && s.date.startsWith(monthKey) && s.seller && s.seller !== '-');
  const porVendedor = {};
  vendasDoMes.forEach(s=>{
    if(!porVendedor[s.seller]) porVendedor[s.seller] = {count:0, total:0};
    porVendedor[s.seller].count += 1;
    porVendedor[s.seller].total += s.total;
  });
  const ranking = Object.entries(porVendedor).sort((a,b)=>b[1].total-a[1].total);

  const body = document.getElementById('teamBody');
  body.innerHTML = '';
  document.getElementById('teamEmpty').style.display = ranking.length ? 'none' : 'block';
  ranking.forEach(([seller, dados])=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(seller)}</td><td>${dados.count}</td><td>R$ ${money(dados.total)}</td>`;
    body.appendChild(tr);
  });
}

/* --- Próximos eventos da equipe (visível para toda a equipe) --- */
const TRAINING_TYPE_LABELS = {
  treinamento: 'Treinamento', aula: 'Aula de maquiagem', mentoria: 'Mentoria', evento: 'Evento'
};

function renderUpcomingTrainings(){
  const body = document.getElementById('upcomingTrainingsBody');
  if(!body) return;
  body.innerHTML = '';
  const today = todayISO();
  const list = state.trainings.filter(t=>t.date >= today).slice().sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
  document.getElementById('upcomingTrainingsEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach(t=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(t.date)}${t.time ? ' às '+t.time.slice(0,5) : ''}</td>
      <td>${TRAINING_TYPE_LABELS[t.type] || t.type}</td>
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.description || '-')}</td>`;
    body.appendChild(tr);
  });
}

/* ================= GESTÃO DA EQUIPE (só diretora) ================= */
function renderTeamManagement(){
  renderTeamUnitCards();
  renderTeamRoster();
  renderNewSignups();
  renderMonthlyEvolution();
  renderTrainings();
}

function renderTeamUnitCards(){
  const monthKey = currentMonthKey();
  const vendasMes = state.sales.filter(s=>s.status==='Pago' && s.date.startsWith(monthKey));
  const faturamentoMes = vendasMes.reduce((sum,s)=>sum+s.total,0);
  const ativasIds = new Set(vendasMes.map(s=>s.sellerId).filter(Boolean));
  const cards = document.getElementById('teamUnitCards');
  cards.innerHTML = `
    <div class="card"><div class="label">Faturamento da unidade (mês)</div><div class="value">R$ ${money(faturamentoMes)}</div></div>
    <div class="card"><div class="label">Vendas da unidade (mês)</div><div class="value">${vendasMes.length}</div></div>
    <div class="card"><div class="label">Consultoras ativas</div><div class="value">${ativasIds.size} de ${state.profiles.length}</div></div>
  `;
}

function renderTeamRoster(){
  const monthKey = currentMonthKey();
  const body = document.getElementById('teamRosterBody');
  body.innerHTML = '';
  document.getElementById('teamRosterEmpty').style.display = state.profiles.length ? 'none' : 'block';
  state.profiles.slice().sort((a,b)=>a.fullName.localeCompare(b.fullName)).forEach(p=>{
    const vendasMes = state.sales.filter(s=>s.status==='Pago' && s.date.startsWith(monthKey) && s.sellerId===p.id);
    const total = vendasMes.reduce((sum,s)=>sum+s.total,0);
    const ativa = vendasMes.length > 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(p.fullName)}</td>
      <td>${escapeHtml(p.phone || '-')}</td>
      <td>${p.role === 'diretora' ? 'Diretora' : 'Consultora'}</td>
      <td>${formatDate(p.createdAt.slice(0,10))}</td>
      <td>${vendasMes.length}</td>
      <td>R$ ${money(total)}</td>
      <td><span class="badge ${ativa ? 'pago' : 'pendente'}">${ativa ? 'Ativa' : 'Inativa'}</span></td>`;
    body.appendChild(tr);
  });
}

function renderNewSignups(){
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate()-30);
  const cutoffISO = cutoff.toISOString().slice(0,10);
  const recentes = state.profiles.filter(p=>p.createdAt.slice(0,10) >= cutoffISO)
    .slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const body = document.getElementById('newSignupsBody');
  body.innerHTML = '';
  document.getElementById('newSignupsEmpty').style.display = recentes.length ? 'none' : 'block';
  recentes.forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(p.fullName)}</td><td>${formatDate(p.createdAt.slice(0,10))}</td>`;
    body.appendChild(tr);
  });
}

let monthlyEvolutionChartInstance = null;
function renderMonthlyEvolution(){
  const months = [];
  for(let i=5;i>=0;i--){
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth()-i);
    months.push(d.toISOString().slice(0,7));
  }
  const totals = months.map(m=>
    state.sales.filter(s=>s.status==='Pago' && s.date.startsWith(m)).reduce((sum,s)=>sum+s.total,0)
  );
  const labels = months.map(m=>{
    const [y,mo] = m.split('-');
    return new Date(Number(y), Number(mo)-1, 1).toLocaleDateString('pt-BR',{month:'short', year:'2-digit'});
  });
  const canvas = document.getElementById('monthlyEvolutionChart');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  if(monthlyEvolutionChartInstance) monthlyEvolutionChartInstance.destroy();
  monthlyEvolutionChartInstance = new Chart(ctx, {
    type:'line',
    data:{ labels, datasets:[{ label:'Faturamento (R$)', data: totals, borderColor:'#16a34a', backgroundColor:'rgba(22,163,74,.15)', fill:true, tension:.3 }] },
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{ y:{ beginAtZero:true } } }
  });
}

document.getElementById('trainingForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const title = document.getElementById('trainingTitle').value.trim();
  const type = document.getElementById('trainingType').value;
  const date = document.getElementById('trainingDate').value;
  const time = document.getElementById('trainingTime').value;
  const description = document.getElementById('trainingDescription').value.trim();
  if(!title || !date) return;
  try{
    await apiCreateTraining({title, type, date, time, description});
    await refreshAll();
    document.getElementById('trainingForm').reset();
    renderTrainings();
    renderUpcomingTrainings();
  }catch(err){
    alert('Erro ao criar evento: ' + err.message);
  }
});

async function deleteTraining(id){
  if(!confirm('Excluir este evento?')) return;
  try{
    await apiDeleteTraining(id);
    await refreshAll();
    renderTrainings();
    renderUpcomingTrainings();
  }catch(err){
    alert('Erro ao excluir treinamento: ' + err.message);
  }
}

function renderTrainings(){
  const body = document.getElementById('trainingsBody');
  if(!body) return;
  body.innerHTML = '';
  const list = state.trainings.slice().sort((a,b)=>a.date.localeCompare(b.date));
  document.getElementById('trainingsEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach(t=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(t.date)}${t.time ? ' às '+t.time.slice(0,5) : ''}</td>
      <td>${TRAINING_TYPE_LABELS[t.type] || t.type}</td>
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.description || '-')}</td>
      <td class="actions-cell"><button class="btn small danger" onclick="deleteTraining(${t.id})">Excluir</button></td>`;
    body.appendChild(tr);
  });
}

/* ================= PEDIDOS MARY KAY ================= */
function renderPurchaseView(){
  if(!document.getElementById('poDate').value){
    document.getElementById('poDate').value = todayISO();
  }
  if(!document.querySelectorAll('#poItemsWrap .sale-item-row').length){
    addPoItemRow();
  }
  populateProductNamesDatalist();
  renderPurchaseOrders();
  renderPurchaseSummary();
}

function populateProductNamesDatalist(){
  const list = document.getElementById('productNamesList');
  if(!list) return;
  list.innerHTML = state.products.map(p=>`<option value="${escapeHtml(p.name)}">`).join('');
}

function addPoItemRow(){
  const wrap = document.getElementById('poItemsWrap');
  const row = document.createElement('div');
  row.className = 'sale-item-row';
  row.innerHTML = `
    <div class="field" style="flex:2;">
      <label>Produto</label>
      <input type="text" class="po-item-product" list="productNamesList" placeholder="Nome do produto (novo ou existente)">
    </div>
    <div class="field" style="max-width:100px;">
      <label>Qtd.</label>
      <input type="number" class="po-item-qty" min="1" value="1">
    </div>
    <div class="field" style="max-width:130px;">
      <label>Custo unit. (R$)</label>
      <input type="number" class="po-item-cost" min="0" step="0.01" value="0">
    </div>
    <button type="button" class="btn small danger" style="height:38px;" onclick="this.parentElement.remove(); updatePoTotal();">Remover</button>
  `;
  wrap.appendChild(row);
  row.querySelector('.po-item-qty').addEventListener('input', updatePoTotal);
  row.querySelector('.po-item-cost').addEventListener('input', updatePoTotal);
  updatePoTotal();
}
document.getElementById('addPoItem').addEventListener('click', addPoItemRow);

function getPoItemsFromForm(){
  const rows = document.querySelectorAll('#poItemsWrap .sale-item-row');
  const items = [];
  rows.forEach(row=>{
    const name = row.querySelector('.po-item-product').value.trim();
    const qty = parseInt(row.querySelector('.po-item-qty').value || '0', 10);
    const unitCost = parseFloat(row.querySelector('.po-item-cost').value || '0');
    if(name && qty > 0){
      items.push({name, qty, unitCost: isNaN(unitCost) ? 0 : unitCost});
    }
  });
  return items;
}

function updatePoTotal(){
  const items = getPoItemsFromForm();
  const total = items.reduce((sum,i)=> sum + i.qty*i.unitCost, 0);
  document.getElementById('poTotal').textContent = money(total);
}

document.getElementById('purchaseOrderForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const items = getPoItemsFromForm();
  if(!items.length){ alert('Adicione ao menos um item ao pedido.'); return; }

  const date = document.getElementById('poDate').value || todayISO();
  const orderNumber = document.getElementById('poNumber').value.trim();

  try{
    await apiCreatePurchaseOrder(date, orderNumber, items);
    await refreshAll();
    document.getElementById('purchaseOrderForm').reset();
    document.getElementById('poDate').value = todayISO();
    document.getElementById('poItemsWrap').innerHTML = '';
    addPoItemRow();
    renderPurchaseOrders();
    renderPurchaseSummary();
    populateProductNamesDatalist();
    renderProducts();
  }catch(err){
    alert(err.message);
  }
});

function renderPurchaseOrders(){
  const body = document.getElementById('purchaseOrdersBody');
  if(!body) return;
  body.innerHTML = '';
  const list = state.purchaseOrders.slice().reverse();
  document.getElementById('purchaseOrdersEmpty').style.display = list.length ? 'none' : 'block';
  list.forEach(po=>{
    const itemsStr = po.items.map(i=>`${i.name} x${i.qty}`).join(', ');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(po.date)}</td>
      <td>${escapeHtml(po.orderNumber || '-')}</td>
      <td>${escapeHtml(itemsStr)}</td>
      <td>R$ ${money(po.totalCost)}</td>`;
    body.appendChild(tr);
  });
}

function renderPurchaseSummary(){
  const el = document.getElementById('purchaseSummaryCards');
  if(!el) return;
  const monthKey = currentMonthKey();
  const pedidosDoMes = state.purchaseOrders.filter(po=>po.date.startsWith(monthKey));
  const investidoMes = pedidosDoMes.reduce((sum,po)=>sum+po.totalCost,0);
  const investidoTotal = state.purchaseOrders.reduce((sum,po)=>sum+po.totalCost,0);
  el.innerHTML = `
    <div class="card"><div class="label">Pedidos este mês</div><div class="value">${pedidosDoMes.length}</div></div>
    <div class="card"><div class="label">Investido este mês</div><div class="value">R$ ${money(investidoMes)}</div></div>
    <div class="card"><div class="label">Total investido (todos os pedidos)</div><div class="value">R$ ${money(investidoTotal)}</div></div>
  `;
}

/* ================= RELATORIOS ================= */
function renderReportDefaults(){
  if(!document.getElementById('reportFrom').value){
    const d = new Date();
    d.setDate(d.getDate()-30);
    document.getElementById('reportFrom').value = d.toISOString().slice(0,10);
    document.getElementById('reportTo').value = todayISO();
  }
  runReport();
  renderReportStock();
  renderReportCustomers();
  renderReportFollowups();
  renderReportTeam();
  renderReportGoals();
}

function renderReportStock(){
  const unidades = state.products.reduce((sum,p)=>sum+(p.stock||0), 0);
  const valorEstoque = state.products.reduce((sum,p)=>sum+(p.stock||0)*(p.price||0), 0);
  const baixo = state.products.filter(p=>p.stock <= (p.minStock ?? 5)).length;
  document.getElementById('reportStockCards').innerHTML = `
    <div class="card"><div class="label">Valor do estoque</div><div class="value">R$ ${money(valorEstoque)}</div></div>
    <div class="card"><div class="label">Unidades em estoque</div><div class="value">${unidades}</div></div>
    <div class="card"><div class="label">Produtos com estoque baixo</div><div class="value ${baixo>0?'danger':''}">${baixo}</div></div>
  `;
}

function renderReportCustomers(){
  const hoje = todayISO();
  const ultimaCompraPorCliente = {};
  state.sales.filter(s=>s.status==='Pago' && s.customerId).forEach(s=>{
    if(!ultimaCompraPorCliente[s.customerId] || s.date > ultimaCompraPorCliente[s.customerId]) ultimaCompraPorCliente[s.customerId] = s.date;
  });
  let ativos = 0, inativos = 0;
  Object.values(ultimaCompraPorCliente).forEach(lastDate=>{
    const dias = Math.floor((new Date(hoje) - new Date(lastDate)) / (1000*60*60*24));
    if(dias >= CLIENTE_SUMIDA_DIAS) inativos++; else ativos++;
  });
  const semCompra = state.customers.length - Object.keys(ultimaCompraPorCliente).length;
  document.getElementById('reportCustomersCards').innerHTML = `
    <div class="card"><div class="label">Clientes ativos</div><div class="value">${ativos}</div></div>
    <div class="card"><div class="label">Clientes inativos (60+ dias)</div><div class="value ${inativos>0?'warning':''}">${inativos}</div></div>
    <div class="card"><div class="label">Nunca compraram</div><div class="value">${semCompra}</div></div>
  `;
}

function renderReportFollowups(){
  const pendentes = getPendingFollowups();
  const atrasados = pendentes.filter(p=>{
    const dias = Math.floor((new Date(todayISO()) - new Date(p.followup[p.keys.due])) / (1000*60*60*24));
    return dias > 0;
  }).length;
  document.getElementById('reportFollowupsCards').innerHTML = `
    <div class="card"><div class="label">Contatos pendentes</div><div class="value ${pendentes.length>0?'warning':''}">${pendentes.length}</div></div>
    <div class="card"><div class="label">Atrasados</div><div class="value ${atrasados>0?'danger':''}">${atrasados}</div></div>
  `;
}

function renderReportTeam(){
  const monthKey = currentMonthKey();
  const vendasMes = state.sales.filter(s=>s.status==='Pago' && s.date.startsWith(monthKey));
  const faturamentoMes = vendasMes.reduce((sum,s)=>sum+s.total,0);
  const vendedoresAtivos = new Set(vendasMes.map(s=>s.sellerId).filter(Boolean)).size;
  document.getElementById('reportTeamCards').innerHTML = `
    <div class="card"><div class="label">Faturamento da equipe (mês)</div><div class="value">R$ ${money(faturamentoMes)}</div></div>
    <div class="card"><div class="label">Vendas da equipe (mês)</div><div class="value">${vendasMes.length}</div></div>
    <div class="card"><div class="label">Vendedoras com venda no mês</div><div class="value">${vendedoresAtivos}</div></div>
  `;
}

function renderReportGoals(){
  const goal = state.settings.monthlyGoal || 0;
  const body = document.getElementById('reportGoalsBody');
  body.innerHTML = '';
  document.getElementById('reportGoalsEmpty').style.display = goal ? 'none' : 'block';
  if(!goal) return;

  const months = [];
  for(let i=5;i>=0;i--){
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth()-i);
    months.push(d.toISOString().slice(0,7));
  }
  months.slice().reverse().forEach(m=>{
    const faturamentoMes = state.sales
      .filter(s=>s.status==='Pago' && s.date.startsWith(m))
      .reduce((sum,s)=>sum+s.total,0);
    const bateu = faturamentoMes >= goal;
    const [y,mo] = m.split('-');
    const label = new Date(Number(y), Number(mo)-1, 1).toLocaleDateString('pt-BR',{month:'long', year:'numeric'});
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td>R$ ${money(faturamentoMes)}</td>
      <td>R$ ${money(goal)}</td>
      <td><span class="badge ${bateu ? 'pago' : 'pendente'}">${bateu ? '✅ Bateu a meta' : '❌ Não bateu'}</span></td>`;
    body.appendChild(tr);
  });
}

function getFilteredSales(){
  const from = document.getElementById('reportFrom').value;
  const to = document.getElementById('reportTo').value;
  return state.sales.filter(s => (!from || s.date>=from) && (!to || s.date<=to));
}

function runReport(){
  const list = getFilteredSales();
  const totalPago = list.filter(s=>s.status==='Pago').reduce((sum,s)=>sum+s.total,0);
  const totalPendente = list.filter(s=>s.status==='Pendente').reduce((sum,s)=>sum+s.total,0);
  const lucroTotal = list.reduce((sum,s)=>sum+s.profit,0);
  const count = list.length;
  const ticketMedio = count ? (totalPago+totalPendente)/count : 0;

  document.getElementById('reportCards').innerHTML = `
    <div class="card"><div class="label">Faturamento pago</div><div class="value">R$ ${money(totalPago)}</div></div>
    <div class="card"><div class="label">Lucro</div><div class="value">R$ ${money(lucroTotal)}</div></div>
    <div class="card"><div class="label">Pendente</div><div class="value warning">R$ ${money(totalPendente)}</div></div>
    <div class="card"><div class="label">Nº de vendas</div><div class="value">${count}</div></div>
    <div class="card"><div class="label">Ticket médio</div><div class="value">R$ ${money(ticketMedio)}</div></div>
  `;

  const body = document.getElementById('reportSalesBody');
  body.innerHTML = '';
  document.getElementById('reportEmpty').style.display = list.length ? 'none' : 'block';
  list.slice().reverse().forEach(s=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(s.date)}</td>
      <td>${escapeHtml(customerName(s.customerId))}</td>
      <td>R$ ${money(s.total)}</td>
      <td>R$ ${money(s.profit)}</td>
      <td>${escapeHtml(s.payment)}</td>
      <td><span class="badge ${s.status==='Pago'?'pago':'pendente'}">${s.status}</span></td>`;
    body.appendChild(tr);
  });
}
document.getElementById('runReport').addEventListener('click', runReport);

function setReportRange(from, to){
  document.getElementById('reportFrom').value = from;
  document.getElementById('reportTo').value = to;
  runReport();
}
document.getElementById('reportPresetHoje').addEventListener('click', ()=>{
  setReportRange(todayISO(), todayISO());
});
document.getElementById('reportPresetSemana').addEventListener('click', ()=>{
  const d = new Date();
  const diaSemana = d.getDay(); // 0 = domingo
  const inicio = new Date(d);
  inicio.setDate(d.getDate() - diaSemana);
  setReportRange(inicio.toISOString().slice(0,10), todayISO());
});
document.getElementById('reportPresetMes').addEventListener('click', ()=>{
  const d = new Date();
  const inicio = new Date(d.getFullYear(), d.getMonth(), 1);
  setReportRange(inicio.toISOString().slice(0,10), todayISO());
});

document.getElementById('exportCsv').addEventListener('click', ()=>{
  const list = getFilteredSales();
  let csv = 'Data,Cliente,Itens,Total,Lucro,Pagamento,Vendedor,Status\n';
  list.forEach(s=>{
    const itemsStr = s.items.map(i=>`${i.name} x${i.qty}`).join(' | ');
    csv += `${formatDate(s.date)},"${customerName(s.customerId)}","${itemsStr}",${s.total.toFixed(2)},${s.profit.toFixed(2)},${s.payment},"${s.seller||''}",${s.status}\n`;
  });
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vendas_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ================= WHATSAPP: envio manual (wa.me) ================= */
const MESSAGE_TEMPLATES = {
  cobranca: {
    profissional: d => `Olá ${d.nome}, tudo bem? Passando para lembrar que há um pagamento pendente de R$ ${d.valor} referente à sua compra (${d.itens}). Poderia verificar a possibilidade de regularização? Qualquer dúvida, estou à disposição.`,
    amigavel: d => `Oi ${d.nome}! 😊 Só passando pra lembrar do pagamentinho de R$ ${d.valor} da sua compra (${d.itens}) que ainda tá em aberto. Consegue dar uma olhadinha quando puder? Qualquer coisa, me chama!`,
    direto: d => `Olá ${d.nome}, você tem um pagamento em aberto de R$ ${d.valor} (${d.itens}). Por favor, regularize assim que possível. Obrigado.`
  },
  agradecimento: {
    profissional: d => `Olá ${d.nome}, gostaríamos de agradecer pela sua compra (${d.itens}) no valor de R$ ${d.valor}. Foi um prazer atendê-lo(a)!`,
    amigavel: d => `Oii ${d.nome}! Muito obrigado pela compra (${d.itens})! 🎉 Espero que aproveite bastante. Qualquer coisa, é só chamar!`,
    direto: d => `Obrigado pela compra, ${d.nome}. Itens: ${d.itens}. Valor: R$ ${d.valor}.`
  },
  promocao: {
    profissional: d => `Olá ${d.nome}, temos novidades e condições especiais disponíveis para você. Gostaríamos de convidá-lo(a) a conhecer nossas ofertas atuais.`,
    amigavel: d => `Oi ${d.nome}! Temos uma promoção especial rolando e pensamos em você! Dá uma olhada quando puder 😉`,
    direto: d => `Olá ${d.nome}, promoção disponível. Confira nossas ofertas.`
  },
  reposicao: {
    profissional: d => `Olá ${d.nome}, tudo bem? Faz um tempinho que você comprou ${d.produto} e imagino que deve estar acabando. Posso te ajudar a repor?`,
    amigavel: d => `Oi ${d.nome}! 😊 Lembrei de você — faz um tempo que comprou ${d.produto}, deve estar quase no fim, né? Bora repor?`,
    direto: d => `Olá ${d.nome}, hora de repor ${d.produto}. Posso providenciar?`
  },
  reengajamento: {
    profissional: d => `Olá ${d.nome}, faz um tempo que não tenho notícias suas! Gostaria de saber se posso ajudar com alguma novidade ou reposição de produtos.`,
    amigavel: d => `Oi ${d.nome}! Tava com saudade 💕 Bora dar uma olhada nas novidades?`,
    direto: d => `Olá ${d.nome}, faz tempo que você não compra. Posso te mostrar as novidades?`
  },
  oportunidade: {
    profissional: d => `Olá ${d.nome}, tudo bem? Notei seu interesse pelos produtos Mary Kay e gostaria de te convidar para conhecer a oportunidade de se tornar uma consultora de beleza independente. Posso te contar mais detalhes?`,
    amigavel: d => `Oi ${d.nome}! 😊 Já pensou em ganhar uma renda extra vendendo os produtos que você já ama? Bora bater um papo sobre a carreira Mary Kay?`,
    direto: d => `Olá ${d.nome}, tenho uma oportunidade de carreira Mary Kay que pode te interessar. Podemos conversar?`
  },
  acompanhamento: {
    profissional: d => `Olá ${d.nome}, tudo bem? Já se passaram ${d.estagio} desde sua compra (${d.itens}) e gostaria de saber como está sendo sua experiência com os produtos. Ficou com alguma dúvida?`,
    amigavel: d => `Oi ${d.nome}! 😊 Faz ${d.estagio} que você comprou (${d.itens}) — como tá sendo usar os produtos? Qualquer dúvida, só chamar!`,
    direto: d => `Olá ${d.nome}, como está sua experiência com ${d.itens}? Alguma dúvida?`
  },
  aniversario: {
    profissional: d => `Parabéns pelo seu dia, ${d.nome}! 🎉 Desejo muitas felicidades. Para comemorar, que tal conhecer ${d.sugestao || 'nossos produtos'}? Se quiser, te conto mais.`,
    amigavel: d => `Parabéns, ${d.nome}! 🎂🎉 Muitas felicidades! Separei uma ideia de presentinho pra você: ${d.sugestao || 'dá uma olhada nas novidades'} 💕`,
    direto: d => `Parabéns, ${d.nome}! 🎉 Sugestão de presente: ${d.sugestao || 'nossos produtos'}.`
  },
  atendimento: {
    profissional: d => `Olá ${d.nome}, tudo bem? Passando para confirmar seu ${d.tipoAtendimento} agendado para ${d.dataAtendimento}. Podemos confirmar o horário?`,
    amigavel: d => `Oi ${d.nome}! 😊 Só lembrando do seu ${d.tipoAtendimento} marcado pra ${d.dataAtendimento} — te espero!`,
    direto: d => `Olá ${d.nome}, lembrete: ${d.tipoAtendimento} em ${d.dataAtendimento}.`
  },
  livre: {
    profissional: d => `Olá ${d.nome}, `,
    amigavel: d => `Oi ${d.nome}! `,
    direto: d => `${d.nome}, `
  }
};

let composerCtx = {};

function normalizePhone(phone){
  let digits = String(phone||'').replace(/\D/g,'');
  if(!digits) return '';
  if(digits.length <= 11) digits = '55' + digits;
  return digits;
}

function buildComposerData(customerId, saleId, extra){
  const c = state.customers.find(c=>c.id===customerId);
  const nome = c ? c.name.split(' ')[0] : 'cliente';
  let valor = '0,00', itens = '-';
  if(saleId){
    const s = state.sales.find(s=>s.id===saleId);
    if(s){
      valor = money(s.total);
      itens = s.items.map(i=>`${i.name} x${i.qty}`).join(', ');
    }
  } else if(customerId){
    const pendentes = state.sales.filter(s=>s.customerId===customerId && s.status==='Pendente');
    if(pendentes.length){
      valor = money(pendentes.reduce((sum,s)=>sum+s.total,0));
      itens = pendentes.map(s=>s.items.map(i=>i.name).join(', ')).join(' | ');
    }
  }
  return {nome, valor, itens, ...(extra||{})};
}

function openComposer({customerId, saleId, scenario, extra}){
  const c = state.customers.find(c=>c.id===customerId);
  if(!c){ alert('Cliente não encontrado.'); return; }
  if(!c.phone){ alert('Este cliente não tem telefone cadastrado. Edite o cliente e adicione um telefone antes de enviar.'); return; }
  composerCtx = {customerId, saleId, extra};
  document.getElementById('composerCustomerInfo').textContent = `Para: ${c.name} (${c.phone})`;
  document.getElementById('composerScenario').value = scenario || 'cobranca';
  document.getElementById('composerText').value = '';
  document.getElementById('composerOverlay').classList.add('active');
}

function applyTone(tone){
  const scenario = document.getElementById('composerScenario').value;
  const data = buildComposerData(composerCtx.customerId, composerCtx.saleId, composerCtx.extra);
  const fn = (MESSAGE_TEMPLATES[scenario] || MESSAGE_TEMPLATES.livre)[tone];
  document.getElementById('composerText').value = fn ? fn(data) : '';
}

document.getElementById('composerScenario').addEventListener('change', ()=> applyTone('profissional'));
document.getElementById('closeComposer').addEventListener('click', ()=>{
  document.getElementById('composerOverlay').classList.remove('active');
});
document.getElementById('copyComposerText').addEventListener('click', async ()=>{
  const text = document.getElementById('composerText').value;
  try{
    await navigator.clipboard.writeText(text);
    alert('Mensagem copiada!');
  }catch(e){
    alert('Não foi possível copiar automaticamente. Selecione o texto manualmente.');
  }
});
document.getElementById('sendComposerWhatsapp').addEventListener('click', ()=>{
  const c = state.customers.find(c=>c.id===composerCtx.customerId);
  if(!c || !c.phone) return;
  const phone = normalizePhone(c.phone);
  const text = document.getElementById('composerText').value;
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
  document.getElementById('composerOverlay').classList.remove('active');
});

/* ================= WHATSAPP: automação (API oficial Meta) ================= */
function loadAutomationForm(){
  const s = state.settings || {};
  document.getElementById('metaPhoneId').value = s.metaPhoneId || '';
  document.getElementById('metaToken').value = s.metaToken || '';
  document.getElementById('metaTemplateName').value = s.metaTemplateName || '';
  document.getElementById('metaBirthdayTemplateName').value = s.metaBirthdayTemplateName || '';
  document.getElementById('metaTemplateLang').value = s.metaTemplateLang || 'pt_BR';
  document.getElementById('autoDays').value = s.autoDays ?? 3;
  document.getElementById('automationLog').innerHTML = '';
}

document.getElementById('automationForm').addEventListener('submit', async e=>{
  e.preventDefault();
  try{
    await apiSaveSettings({
      meta_phone_id: document.getElementById('metaPhoneId').value.trim(),
      meta_token: document.getElementById('metaToken').value.trim(),
      meta_template_name: document.getElementById('metaTemplateName').value.trim(),
      meta_birthday_template_name: document.getElementById('metaBirthdayTemplateName').value.trim(),
      meta_template_lang: document.getElementById('metaTemplateLang').value.trim() || 'pt_BR',
      auto_days: parseInt(document.getElementById('autoDays').value || '3', 10)
    });
    await refreshAll();
    alert('Configuração salva.');
  }catch(err){
    alert('Erro ao salvar configuração: ' + err.message);
  }
});

function logAutomation(msg){
  const log = document.getElementById('automationLog');
  const line = document.createElement('div');
  line.className = 'log-line';
  line.textContent = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  log.prepend(line);
}

async function sendWhatsAppTemplate(settings, phone, templateName, variables){
  const url = `https://graph.facebook.com/v19.0/${settings.metaPhoneId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: settings.metaTemplateLang },
      components: [{
        type: 'body',
        parameters: variables.map(v => ({ type: 'text', text: v }))
      }]
    }
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${settings.metaToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(json?.error?.message || `Erro HTTP ${res.status}`);
  return json;
}

document.getElementById('runAutomationBtn').addEventListener('click', async ()=>{
  const s = state.settings || {};
  if(!s.metaPhoneId || !s.metaToken){
    alert('Preencha e salve a configuração (Phone Number ID e Token) antes de disparar.');
    return;
  }
  if(!s.metaTemplateName && !s.metaBirthdayTemplateName){
    alert('Preencha ao menos um template (cobrança ou aniversário) antes de disparar.');
    return;
  }

  const hoje = new Date();

  if(s.metaTemplateName){
    const candidatos = state.sales.filter(sale=>{
      if(sale.status!=='Pendente' || sale.notifiedAt || !sale.customerId) return false;
      const dias = Math.floor((hoje - new Date(sale.date)) / (1000*60*60*24));
      return dias >= (s.autoDays ?? 3);
    });

    if(!candidatos.length){
      logAutomation('Nenhuma venda pendente atingiu o prazo configurado para disparo.');
    }

    for(const sale of candidatos){
      const c = state.customers.find(c=>c.id===sale.customerId);
      if(!c || !c.phone){
        logAutomation(`Pulado: venda #${sale.id} sem telefone de cliente cadastrado.`);
        continue;
      }
      const phone = normalizePhone(c.phone);
      try{
        await sendWhatsAppTemplate(s, phone, s.metaTemplateName, [c.name.split(' ')[0], money(sale.total)]);
        await apiMarkSaleNotified(sale.id, todayISO());
        logAutomation(`✅ Cobrança enviada para ${c.name} (venda #${sale.id}).`);
      }catch(err){
        logAutomation(`❌ Falha ao enviar cobrança para ${c.name}: ${err.message}. (Verifique token, template aprovado e possíveis bloqueios de CORS no navegador.)`);
      }
    }
  }

  if(s.metaBirthdayTemplateName){
    const anoAtual = hoje.getFullYear();
    const mesHoje = hoje.getMonth() + 1;
    const diaHoje = hoje.getDate();
    const aniversariantes = state.customers.filter(c=>{
      if(!c.birthDate || c.lastBirthdayGreetingYear === anoAtual) return false;
      const [, m, d] = c.birthDate.split('-').map(Number);
      return m === mesHoje && d === diaHoje;
    });

    if(!aniversariantes.length){
      logAutomation('Nenhuma cliente faz aniversário hoje (ou já foi parabenizada este ano).');
    }

    for(const c of aniversariantes){
      if(!c.phone){
        logAutomation(`Pulado: ${c.name} faz aniversário hoje mas não tem telefone cadastrado.`);
        continue;
      }
      const phone = normalizePhone(c.phone);
      try{
        await sendWhatsAppTemplate(s, phone, s.metaBirthdayTemplateName, [c.name.split(' ')[0]]);
        await apiMarkCustomerBirthdayGreeted(c.id, anoAtual);
        logAutomation(`🎂 Parabéns enviado para ${c.name}.`);
      }catch(err){
        logAutomation(`❌ Falha ao enviar parabéns para ${c.name}: ${err.message}.`);
      }
    }
  }

  await refreshAll();
});

document.getElementById('downloadBackupBtn').addEventListener('click', ()=>{
  const backup = {
    exportedAt: new Date().toISOString(),
    source: 'Controle de Vendas Mary Kay',
    data: {
      products: state.products,
      customers: state.customers,
      sales: state.sales,
      campaigns: state.campaigns,
      campaignGoals: state.campaignGoals,
      stockMovements: state.stockMovements,
      purchaseOrders: state.purchaseOrders,
      trainings: state.trainings,
      followups: state.followups,
      appointments: state.appointments,
      profiles: state.profiles,
      settings: state.settings
    }
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:'application/json;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_controle_vendas_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});
