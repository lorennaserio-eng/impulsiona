/* ================= AUTENTICAÇÃO (login da equipe) ================= */

let currentUser = null;

async function initAuth(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  if(session){
    currentUser = session.user;
    await onLoggedIn();
  } else {
    showAuthScreen();
  }

  supabaseClient.auth.onAuthStateChange((_event, session)=>{
    if(session && (!currentUser || currentUser.id !== session.user.id)){
      currentUser = session.user;
      onLoggedIn();
    } else if(!session){
      currentUser = null;
      showAuthScreen();
    }
  });
}

function showAuthScreen(){
  document.getElementById('authOverlay').classList.add('active');
  document.getElementById('appRoot').style.display = 'none';
}

async function onLoggedIn(){
  document.getElementById('authOverlay').classList.remove('active');
  document.getElementById('appRoot').style.display = 'flex';
  document.getElementById('currentUserLabel').textContent = currentUser.email;
  document.getElementById('authMessage').textContent = '';
  await bootApp();
}

function traduzErroAuth(msg){
  if(/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if(/User already registered/i.test(msg)) return 'Já existe uma conta com este e-mail. Clique em "Já tenho conta" para entrar.';
  if(/Password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if(/Unable to validate email address/i.test(msg)) return 'E-mail inválido.';
  return msg;
}

document.getElementById('authForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const fullName = document.getElementById('authName').value.trim();
  const phone = document.getElementById('authPhone').value.trim();
  const isDirector = document.getElementById('authIsDirector').checked;
  const mode = document.getElementById('authMode').value; // 'login' ou 'signup'
  const msg = document.getElementById('authMessage');
  msg.textContent = '';
  msg.style.color = '';

  if(mode === 'signup'){
    const { error } = await supabaseClient.auth.signUp({
      email, password,
      options: { data: {
        full_name: fullName || email,
        phone: phone || null,
        role: isDirector ? 'diretora' : 'consultora'
      } }
    });
    if(error){ msg.textContent = traduzErroAuth(error.message); return; }
    msg.style.color = 'var(--primary-dark)';
    msg.textContent = 'Conta criada! Se a confirmação por e-mail estiver ativada no seu Supabase, verifique sua caixa de entrada antes de entrar.';
  } else {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error){ msg.textContent = traduzErroAuth(error.message); return; }
  }
});

document.getElementById('toggleAuthMode').addEventListener('click', ()=>{
  const modeInput = document.getElementById('authMode');
  const isLogin = modeInput.value === 'login';
  modeInput.value = isLogin ? 'signup' : 'login';
  document.getElementById('authSubmitBtn').textContent = isLogin ? 'Criar conta' : 'Entrar';
  document.getElementById('authNameField').style.display = isLogin ? 'block' : 'none';
  document.getElementById('authPhoneField').style.display = isLogin ? 'block' : 'none';
  document.getElementById('authRoleField').style.display = isLogin ? 'block' : 'none';
  document.getElementById('toggleAuthMode').textContent = isLogin ? 'Já tenho conta' : 'Criar uma conta nova';
  document.getElementById('authTitle').textContent = isLogin ? 'Criar conta' : 'Entrar no Impulsiona';
  document.getElementById('authMessage').textContent = '';
});

const EYE_ICON = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"></path><circle cx="12" cy="12" r="3"></circle>';
const EYE_OFF_ICON = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';

document.getElementById('togglePasswordBtn').addEventListener('click', ()=>{
  const input = document.getElementById('authPassword');
  const icon = document.getElementById('passwordEyeIcon');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  icon.innerHTML = showing ? EYE_ICON : EYE_OFF_ICON;
  document.getElementById('togglePasswordBtn').setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
});

document.getElementById('logoutBtn').addEventListener('click', async ()=>{
  await supabaseClient.auth.signOut();
});
