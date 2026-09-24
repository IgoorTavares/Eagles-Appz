// =====================================================================
// ---------- Tema (claro / escuro) ----------
// =====================================================================

function aplicarTemaSalvo() {
  let tema = 'light';
  try { tema = localStorage.getItem('eagles_tema') || 'light'; } catch (e) {}
  document.documentElement.setAttribute('data-theme', tema);
}

function definirTema(tema) {
  try { localStorage.setItem('eagles_tema', tema); } catch (e) {}
  document.documentElement.setAttribute('data-theme', tema);
  fecharTodosDropdowns();
}

aplicarTemaSalvo();

// =====================================================================
// ---------- PWA: Service Worker, instalação e indicador offline ----------
// =====================================================================

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.error('Erro ao registrar Service Worker:', err);
    });
  });
}

let DEFERRED_INSTALL_PROMPT = null;

function exibirBotoesInstalarApp(mostrar) {
  document.querySelectorAll('.btn-instalar-app').forEach((btn) => {
    btn.style.display = mostrar ? '' : 'none';
  });
}

function estaRodandoComoPWA() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

if (estaRodandoComoPWA()) {
  document.addEventListener('DOMContentLoaded', () => exibirBotoesInstalarApp(false));
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  DEFERRED_INSTALL_PROMPT = e;
  exibirBotoesInstalarApp(true);
});

window.addEventListener('appinstalled', () => {
  DEFERRED_INSTALL_PROMPT = null;
  exibirBotoesInstalarApp(false);
});

function instalarApp() {
  if (!DEFERRED_INSTALL_PROMPT) {
    alert('A instalação não está disponível agora. No Chrome/Edge (Android e desktop), o botão aparece automaticamente quando o app pode ser instalado. No iPhone, use "Compartilhar" → "Adicionar à Tela de Início" no Safari.');
    return;
  }
  DEFERRED_INSTALL_PROMPT.prompt();
  DEFERRED_INSTALL_PROMPT.userChoice.finally(() => {
    DEFERRED_INSTALL_PROMPT = null;
    exibirBotoesInstalarApp(false);
  });
}

function atualizarStatusConexao() {
  const el = document.getElementById('offline-banner');
  if (!el) return;
  el.classList.toggle('show', !navigator.onLine);
}

function initOfflineIndicator() {
  atualizarStatusConexao();
  window.addEventListener('online', atualizarStatusConexao);
  window.addEventListener('offline', atualizarStatusConexao);
}

initOfflineIndicator();

// =====================================================================
// ---------- Utilitários gerais ----------
// =====================================================================

// Impede que texto digitado por qualquer usuário (nome, endereço,
// observações...) seja interpretado como HTML/JavaScript quando exibido
// na tela de outra pessoa (proteção contra XSS armazenado). Deve
// envolver QUALQUER valor vindo de dado salvo, sempre que ele for
// colocado dentro de innerHTML.
function escapeHtml(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Pra quando um valor digitado pelo usuário precisa ir dentro de um
// onclick="funcao('valor')" — dois níveis de escape ao mesmo tempo: pra
// não quebrar a string JavaScript (aspa simples) E pra não quebrar o
// atributo HTML que envolve o onclick (aspa dupla).
function escapeParaOnclick(valor) {
  return String(valor || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function initials(name) {
  const parts = (name || '').trim().split(' ').filter(Boolean);
  if (!parts.length) return '--';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDatePt(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function genId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function lsLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      localStorage.setItem(key, JSON.stringify(fallback));
      return JSON.parse(JSON.stringify(fallback));
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Erro ao carregar "' + key + '", usando padrão.', err);
    return JSON.parse(JSON.stringify(fallback));
  }
}

function lsSave(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function popularSelectNomes(select, nomes, opts) {
  if (!select) return;
  opts = opts || {};
  const atual = select.value;
  let html = '';
  if (opts.includeTodos) html += `<option value="todos">${opts.todosLabel || 'Todos'}</option>`;
  if (opts.placeholder) html += `<option value="">${opts.placeholder}</option>`;
  html += nomes.map((n) => `<option value="${n}">${n}</option>`).join('');
  select.innerHTML = html;
  if (nomes.includes(atual) || atual === 'todos' || atual === '') select.value = atual;
}

// ---------- Validação de CPF/CNPJ (dígito verificador de verdade) ----------

function limparNumeros(v) { return (v || '').toString().replace(/\D/g, ''); }

function validarCPF(cpf) {
  cpf = limparNumeros(cpf);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === parseInt(cpf[10], 10);
}

function validarCNPJ(cnpj) {
  cnpj = limparNumeros(cnpj);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  let tam = cnpj.length - 2;
  let numeros = cnpj.substring(0, tam);
  const digitos = cnpj.substring(tam);
  let soma = 0;
  let pos = tam - 7;
  for (let i = tam; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tam - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== parseInt(digitos.charAt(0), 10)) return false;
  tam++;
  numeros = cnpj.substring(0, tam);
  soma = 0;
  pos = tam - 7;
  for (let i = tam; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tam - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  return resultado === parseInt(digitos.charAt(1), 10);
}

function formatarCPF(v) {
  v = limparNumeros(v).slice(0, 11);
  return v.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

function formatarCNPJ(v) {
  v = limparNumeros(v).slice(0, 14);
  return v.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2}\.\d{3})(\d)/, '$1.$2').replace(/^(\d{2}\.\d{3}\.\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

function checarDocumento(inputId, hintId, tipo) {
  const input = document.getElementById(inputId);
  const hint = document.getElementById(hintId);
  if (!input || !hint) return;
  const bruto = input.value;
  input.value = tipo === 'cpf' ? formatarCPF(bruto) : formatarCNPJ(bruto);
  const numeros = limparNumeros(input.value);
  if (!numeros.length) { hint.className = 'field-hint'; hint.textContent = ''; return; }
  const valido = tipo === 'cpf' ? validarCPF(numeros) : validarCNPJ(numeros);
  const completo = tipo === 'cpf' ? numeros.length === 11 : numeros.length === 14;
  if (!completo) {
    hint.className = 'field-hint';
    hint.textContent = `Faltam dígitos (${numeros.length}/${tipo === 'cpf' ? 11 : 14}).`;
  } else if (valido) {
    hint.className = 'field-ok';
    hint.textContent = '✓ ' + tipo.toUpperCase() + ' com formato e dígito verificador válidos.';
  } else {
    hint.className = 'field-hint';
    hint.style.color = 'var(--danger)';
    hint.textContent = '✗ ' + tipo.toUpperCase() + ' inválido — confira os números digitados.';
  }
}

// ---------- Modal genérico ----------

function openModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.add('open');
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach((el) => el.classList.remove('open'));
  }
});

// ---------- Upload de arquivo ----------

function initFileDrop(inputId, dropId) {
  const input = document.getElementById(inputId);
  const drop = document.getElementById(dropId);
  if (!input || !drop) return;
  const label = drop.querySelector('.file-drop-label');
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) {
      drop.classList.add('has-file');
      if (label) label.textContent = input.files[0].name;
    } else {
      drop.classList.remove('has-file');
      if (label) label.textContent = 'Clique para enviar o arquivo';
    }
  });
}

// ---------- Campo genérico (usado em todos os modais de cadastro) ----------

function renderCampoHtml(f, value, editavel) {
  const disabledAttr = editavel ? '' : 'disabled';
  const fullClass = f.full ? 'full' : '';
  let control = '';
  if (f.type === 'textarea') {
    control = `<textarea data-key="${f.key}" rows="2" placeholder="${escapeHtml(f.placeholder || '')}" ${disabledAttr}>${escapeHtml(value || '')}</textarea>`;
  } else if (f.type === 'select') {
    const opts = f.options.map((o) => {
      const val = typeof o === 'object' ? o.value : o;
      const label = typeof o === 'object' ? o.label : o;
      const sel = String(val) === String(value) ? 'selected' : '';
      return `<option value="${escapeHtml(val)}" ${sel}>${escapeHtml(label)}</option>`;
    }).join('');
    control = `<select data-key="${f.key}" ${disabledAttr}>${opts}</select>`;
  } else if (f.type === 'checkbox') {
    const checked = value ? 'checked' : '';
    control = `<div class="ficha-check-linha"><input type="checkbox" data-key="${f.key}" ${checked} ${disabledAttr} style="width:auto;"> <span>${escapeHtml(f.checkboxLabel || '')}</span></div>`;
  } else {
    control = `<input type="${f.type}" data-key="${f.key}" placeholder="${escapeHtml(f.placeholder || '')}" value="${value !== undefined && value !== null ? escapeHtml(value) : ''}" ${disabledAttr}>`;
  }
  return `<div class="field ${fullClass}"><label>${escapeHtml(f.label)}</label>${control}</div>`;
}

function lerCamposModal(containerSelector) {
  const dados = {};
  document.querySelectorAll(`${containerSelector} [data-key]`).forEach((el) => {
    if (el.type === 'checkbox') dados[el.getAttribute('data-key')] = el.checked;
    else dados[el.getAttribute('data-key')] = el.value;
  });
  return dados;
}

// ---------- Estado vazio de cadastros (ícone + texto + botão) ----------

function emptyCadastroHtml(onclickAttr, colspan) {
  return `<tr><td colspan="${colspan}">
    <div class="empty-cadastro">
      <svg class="empty-cadastro-icon" viewBox="0 0 64 64" fill="none">
        <rect x="6" y="6" width="52" height="52" rx="12" stroke="currentColor" stroke-width="3"/>
        <line x1="6" y1="22" x2="58" y2="22" stroke="currentColor" stroke-width="2" opacity="0.4"/>
        <line x1="22" y1="6" x2="22" y2="58" stroke="currentColor" stroke-width="2" opacity="0.4"/>
        <path d="M32 26v12M26 32h12" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
      </svg>
      <div class="empty-cadastro-titulo">Nenhum item registrado</div>
      <div class="empty-cadastro-texto">Ainda não existem cadastros no seu sistema, comece agora mesmo</div>
      <button type="button" class="btn btn-primary" onclick="${onclickAttr}">+ Incluir cadastro</button>
    </div>
  </td></tr>`;
}

// =====================================================================
// ---------- Sincronização na nuvem (Firebase Firestore) ----------
// =====================================================================

let firestoreDb = null;
let FIREBASE_PRONTO = false;

function initFirebase() {
  try {
    if (typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey === 'COLE_AQUI') {
      atualizarIndicadorSincronizacao('local');
      return false;
    }
    if (typeof firebase === 'undefined') {
      console.error('SDK do Firebase não carregou.');
      atualizarIndicadorSincronizacao('erro');
      return false;
    }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firestoreDb = firebase.firestore();

    firestoreDb.enablePersistence({ synchronizeTabs: true }).catch((err) => {
      console.warn('Persistência offline não ativada:', err.code || err);
    });

    FIREBASE_PRONTO = true;
    return true;
  } catch (err) {
    console.error('Erro ao conectar ao Firebase:', err);
    atualizarIndicadorSincronizacao('erro');
    return false;
  }
}

function atualizarIndicadorSincronizacao(status) {
  const el = document.getElementById('sync-indicador');
  if (!el) return;
  if (status === 'ok') { el.textContent = '● Sincronizado na nuvem'; el.style.color = 'var(--success)'; }
  else if (status === 'local') { el.textContent = '● Modo local (sem nuvem configurada)'; el.style.color = 'var(--text-soft)'; }
  else { el.textContent = '● Sem conexão com o banco'; el.style.color = 'var(--danger)'; }
}

// Cada empresa (tenant) tem seus próprios documentos, isolados dos outros:
// tenants/{tenantId}/dados/{key}. O cache local também é separado por
// tenant, pra não misturar dados se o mesmo navegador logar em contas
// de empresas diferentes.

function chaveLocalTenant(key) {
  return (TENANT_ID || 'sem-empresa') + '::' + key;
}

function caminhoTenantDoc(key) {
  return firestoreDb.collection('tenants').doc(TENANT_ID).collection('dados').doc(key);
}

function cloudWatch(key, fallback, onChange) {
  if (!FIREBASE_PRONTO || !TENANT_ID) {
    onChange(lsLoad(chaveLocalTenant(key), fallback));
    return;
  }
  caminhoTenantDoc(key).onSnapshot((snap) => {
    if (snap.exists) {
      const valor = snap.data().valor;
      lsSave(chaveLocalTenant(key), valor);
      onChange(valor);
    } else {
      caminhoTenantDoc(key).set({ valor: fallback });
      onChange(fallback);
    }
    atualizarIndicadorSincronizacao('ok');
  }, (err) => {
    console.error('Erro de sincronização em "' + key + '":', err);
    atualizarIndicadorSincronizacao('erro');
    onChange(lsLoad(chaveLocalTenant(key), fallback));
  });
}

function cloudSet(key, data) {
  lsSave(chaveLocalTenant(key), data);
  if (!FIREBASE_PRONTO || !TENANT_ID) return;
  caminhoTenantDoc(key).set({ valor: data }).then(() => {
    atualizarIndicadorSincronizacao('ok');
  }).catch((err) => {
    console.error('Erro ao salvar "' + key + '" na nuvem:', err);
    atualizarIndicadorSincronizacao('erro');
  });
}

async function cloudGetForce(key, fallback) {
  if (!FIREBASE_PRONTO || !TENANT_ID) return lsLoad(chaveLocalTenant(key), fallback);
  const snap = await caminhoTenantDoc(key).get();
  const valor = snap.exists ? snap.data().valor : fallback;
  lsSave(chaveLocalTenant(key), valor);
  return valor;
}

// =====================================================================
// ---------- Autenticação (Firebase Auth — e-mail e senha) ----------
// =====================================================================

let TENANT_ID = null;
let USUARIO_ROLE = null;
let USUARIO_NOME = null;
let USUARIO_UID = null;

function protegerPagina(callback) {
  if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
    esconderCarregandoAuth();
    initPerfilWatch();
    initBuscaGlobalWatch();
    callback();
    return;
  }
  firebase.auth().onAuthStateChanged((user) => {
    if (user) {
      resolverTenantDoUsuario(user).then((ok) => {
        if (!ok) return; // resolverTenantDoUsuario já tratou o erro e deslogou
        exibirUsuarioLogado(user);
        esconderCarregandoAuth();
        iniciarMonitorInatividade();
        aplicarGatingPorRole();
        initPerfilWatch();
        initBuscaGlobalWatch();
        callback();
      });
    } else {
      window.location.href = 'login.html';
    }
  });
}

// Depois do login, busca em qual empresa (tenant) esse usuário está e qual
// o papel dele. Esse documento é o "elo" entre a conta do Firebase Auth
// (que não sabe nada sobre empresas) e os dados da empresa no Firestore.
async function resolverTenantDoUsuario(user) {
  try {
    console.log('[EaglesLabz] Buscando usuarios/' + user.uid + ' (projeto: ' + (firebase.app().options.projectId || '?') + ')...');
    const snap = await firestoreDb.collection('usuarios').doc(user.uid).get();

    if (!snap.exists) {
      console.error('[EaglesLabz] Documento NÃO encontrado em usuarios/' + user.uid + '. Confira: 1) é este o UID exato em Authentication → Users; 2) a coleção se chama "usuarios" (minúsculo, sem acento); 3) o documento está no projeto "' + (firebase.app().options.projectId || '?') + '".');
      alert('Sua conta ainda não foi vinculada a nenhuma empresa neste sistema. Fale com o administrador.');
      await firebase.auth().signOut();
      window.location.href = 'login.html';
      return false;
    }

    const dados = snap.data();
    console.log('[EaglesLabz] Documento encontrado:', dados);
    USUARIO_ROLE = dados.role || 'TenantUser';
    USUARIO_NOME = dados.nome || user.email;
    USUARIO_UID = user.uid;

    // SuperAdmin não é OBRIGADO a ter empresa (continua entrando mesmo sem
    // uma), mas se ele tiver uma vinculada — porque também usa o sistema
    // pro próprio negócio — usa ela normalmente, com sincronização na
    // nuvem, igual qualquer outro usuário.
    if (USUARIO_ROLE === 'SuperAdmin') {
      TENANT_ID = dados.tenantId || null;
      return true;
    }

    // Para utilizadores normais, verifica o tenantId
    TENANT_ID = dados.tenantId || null;
    if (!TENANT_ID) {
      alert('Sua conta não está vinculada a uma empresa. Fale com o administrador.');
      await firebase.auth().signOut();
      window.location.href = 'login.html';
      return false;
    }

    // Empresa suspensa (ex: falta de pagamento) — bloqueia mesmo com login válido.
    const tenantSnap = await firestoreDb.collection('tenants').doc(TENANT_ID).get();
    if (tenantSnap.exists && tenantSnap.data().ativo === false) {
      alert('O acesso desta empresa está temporariamente suspenso. Fale com o suporte para regularizar.');
      await firebase.auth().signOut();
      window.location.href = 'login.html';
      return false;
    }

    return true;
  } catch (err) {
    console.error("Erro ao resolver tenant:", err);
    alert('Não foi possível carregar os dados da sua conta. Tente entrar novamente.');
    await firebase.auth().signOut();
    window.location.href = 'login.html';
    return false;
  }
}

function aplicarGatingPorRole() {
  const admin = USUARIO_ROLE === 'TenantAdmin' || USUARIO_ROLE === 'SuperAdmin';
  document.querySelectorAll('[data-somente-admin]').forEach((el) => { el.style.display = admin ? '' : 'none'; });
  document.querySelectorAll('[data-somente-superadmin]').forEach((el) => { el.style.display = USUARIO_ROLE === 'SuperAdmin' ? '' : 'none'; });
}

function esconderCarregandoAuth() {
  const el = document.getElementById('auth-loading');
  if (el) el.style.display = 'none';
}

function exibirUsuarioLogado(user) {
  const el = document.getElementById('usuario-logado');
  if (el) el.textContent = (USUARIO_NOME || user.email) + (USUARIO_ROLE ? ' · ' + traduzirRole(USUARIO_ROLE) : '');
}

function traduzirRole(role) {
  const mapa = { SuperAdmin: 'Super Admin', TenantAdmin: 'Administrador', TenantUser: 'Operacional' };
  return mapa[role] || role;
}

function logout() {
  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
    firebase.auth().signOut().then(() => { window.location.href = 'login.html'; });
  } else {
    window.location.href = 'login.html';
  }
}

function mensagemErroLogin(code) {
  const mapa = {
    'auth/invalid-email': 'E-mail inválido.',
    'auth/user-disabled': 'Este usuário foi desativado.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/missing-password': 'Digite a senha.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente de novo.',
    'auth/network-request-failed': 'Falha de conexão. Verifique a internet.',
  };
  return mapa[code] || 'Não foi possível entrar. Tente novamente.';
}

// Mensagens pra quando o erro é ao CRIAR uma conta nova (admin de empresa,
// usuário da equipe) — são causas bem diferentes das de login, por isso
// não reaproveita mensagemErroLogin. O fallback mostra o código bruto do
// erro pra nunca mais esconder a causa real de quem está usando o sistema.
function mensagemErroCriacaoConta(code) {
  const mapa = {
    'auth/email-already-in-use': 'Já existe uma conta com esse e-mail no sistema (de outra empresa ou de um teste anterior). Use outro e-mail, ou primeiro remova/exclua a conta antiga.',
    'auth/invalid-email': 'Esse e-mail não é válido.',
    'auth/weak-password': 'Essa senha é fraca demais para o Firebase aceitar. Tente uma com letras e números, mínimo 6 caracteres.',
    'auth/operation-not-allowed': 'O login por e-mail/senha não está habilitado no projeto do Firebase. Veja em Authentication → Sign-in method → Email/Password.',
    'auth/network-request-failed': 'Falha de conexão. Verifique a internet e tente de novo.',
    'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
  };
  return mapa[code] || `Erro inesperado do Firebase (código: "${code || 'desconhecido'}"). Copie esse código e me avise.`;
}

const INATIVIDADE_LIMITE_MS = 20 * 60 * 1000;
let INATIVIDADE_TIMER = null;

function iniciarMonitorInatividade() {
  const resetarTimer = () => {
    if (INATIVIDADE_TIMER) clearTimeout(INATIVIDADE_TIMER);
    INATIVIDADE_TIMER = setTimeout(() => {
      alert('Sua sessão expirou após 20 minutos de inatividade. Faça login novamente.');
      logout();
    }, INATIVIDADE_LIMITE_MS);
  };
  ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach((evento) => {
    document.addEventListener(evento, resetarTimer, { passive: true });
  });
  resetarTimer();
}

// =====================================================================
// ---------- Barra superior (topbar) ----------
// =====================================================================

const NAV_ITEMS = [
  { key: 'painel', href: 'index.html', label: 'Painel' },
  { key: 'meu-negocio', href: 'meu-negocio.html', label: 'Meu Negócio' },
  {
    key: 'cadastros', label: 'Cadastros',
    children: [
      { key: 'produtos', href: 'produtos.html', label: 'Produtos' },
      { key: 'clientes-fornecedores', href: 'clientes-fornecedores.html', label: 'Clientes e Fornecedores' },
      { key: 'vendedores', href: 'vendedores.html', label: 'Vendedores' },
      { key: 'funcionarios', href: 'funcionarios.html', label: 'Funcionários' },
    ],
  },
  {
    key: 'vendas', label: 'Vendas',
    children: [
      { key: 'pedidos-venda', href: 'pedidos-venda.html', label: 'Pedidos de vendas' },
      { key: 'objetos-postagem', href: 'objetos-postagem.html', label: 'Objetos de postagens' },
      { key: 'contratos', href: 'contratos.html', label: 'Contratos' },
    ],
  },
  {
    key: 'estoque', label: 'Estoque',
    columns: [
      {
        title: 'Compras', items: [
          { key: 'pedido-compras', href: 'pedido-compras.html', label: 'Pedido de compras' },
          { key: 'notas-fiscais-entrada', href: 'notas-fiscais-entrada.html', label: 'Notas fiscais de entrada' },
          { key: 'fornecedores-atalho', href: 'clientes-fornecedores.html?tipo=fornecedor', label: 'Fornecedores' },
        ],
      },
      {
        title: 'Estoque', items: [
          { key: 'lancamentos-estoque', href: 'lancamentos-estoque.html', label: 'Lançamentos de estoque' },
          { key: 'conferencia-estoque', href: 'conferencia-estoque.html', label: 'Conferência de estoque' },
        ],
      },
    ],
  },
  { key: 'financeiro', href: 'financeiro.html', label: 'Financeiro' },
];

function renderTopbar(activeKey) {
  const nav = document.getElementById('topbar-nav');
  if (!nav) return;

  let html = '';
  NAV_ITEMS.forEach((item) => {
    if (item.type === 'meu-negocio') {
      html += `<div class="topbar-item">
        <button type="button" class="topbar-menu-btn" onclick="toggleDropdown('menu-meu-negocio')">${item.label} <span class="chevron">▾</span></button>
        <div class="mega-menu" id="menu-meu-negocio">
          <button type="button" class="mega-link" onclick="irParaRelatorio(1)">Dados do mês atual</button>
          <button type="button" class="mega-link" onclick="irParaRelatorio(3)">Últimos 3 meses</button>
          <button type="button" class="mega-link" onclick="irParaRelatorio(6)">Últimos 6 meses</button>
          <button type="button" class="mega-link" onclick="irParaRelatorio(12)">Últimos 12 meses</button>
        </div>
      </div>`;
    } else if (item.children) {
      const isOpen = item.children.some((c) => c.key === activeKey);
      html += `<div class="topbar-item">
        <button type="button" class="topbar-menu-btn ${isOpen ? 'active' : ''}" onclick="toggleDropdown('menu-${item.key}')">${item.label} <span class="chevron">▾</span></button>
        <div class="mega-menu" id="menu-${item.key}">
          ${item.children.map((c) => `<a href="${c.href}" class="${c.key === activeKey ? 'active' : ''}">${c.label}</a>`).join('')}
        </div>
      </div>`;
    } else if (item.columns) {
      const isOpen = item.columns.some((col) => col.items.some((c) => c.key === activeKey));
      html += `<div class="topbar-item">
        <button type="button" class="topbar-menu-btn ${isOpen ? 'active' : ''}" onclick="toggleDropdown('menu-${item.key}')">${item.label} <span class="chevron">▾</span></button>
        <div class="mega-menu" id="menu-${item.key}">
          <div class="mega-menu-cols">
            ${item.columns.map((col) => `<div><div class="mega-menu-col-title">${col.title}</div>${col.items.map((c) => `<a href="${c.href}" class="${c.key === activeKey ? 'active' : ''}">${c.label}</a>`).join('')}</div>`).join('')}
          </div>
        </div>
      </div>`;
    } else {
      html += `<div class="topbar-item"><a href="${item.href}" class="topbar-link ${item.key === activeKey ? 'active' : ''}">${item.label}</a></div>`;
    }
  });
  nav.innerHTML = html;
}

function toggleDropdown(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const isOpen = el.classList.contains('open');
  fecharTodosDropdowns();
  if (!isOpen) {
    el.classList.add('open');
    const btn = el.previousElementSibling;
    if (btn && btn.classList) btn.classList.add('active');
  }
}

function fecharTodosDropdowns() {
  document.querySelectorAll('.mega-menu.open').forEach((m) => m.classList.remove('open'));
  const results = document.getElementById('topbar-search-results');
  if (results) results.classList.remove('open');
  fecharMenuAcoesGlobal();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('.row-menu-btn') || e.target.closest('#acoes-menu-global')) return;
  if (!e.target.closest('.topbar-item') && !e.target.closest('.topbar-search')) {
    fecharTodosDropdowns();
  }
});

function toggleMobileNav() {
  const topbar = document.getElementById('app-topbar');
  if (topbar) topbar.classList.toggle('nav-open');
}

function irParaRelatorio(qtd) {
  fecharTodosDropdowns();
  if (window.location.pathname.endsWith('financeiro.html') && typeof gerarRelatorioPeriodo === 'function') {
    gerarRelatorioPeriodo(qtd);
  } else {
    window.location.href = 'financeiro.html?relatorio=' + qtd;
  }
}

// =====================================================================
// ---------- Meu Perfil (dados da empresa) ----------
// =====================================================================

const PERFIL_KEY = 'eagles_perfil_empresa_v1';

function perfilSeed() {
  return {
    nomeEmpresa: '',
    nomeFantasia: '',
    logoUrl: '',
    tipoPessoa: 'PJ',
    cnpj: '',
    cpf: '',
    inscricaoEstadual: '',
    isento: false,
    email: '',
    telefone1: '',
    telefone2: '',
    whatsapp: '',
    endereco: '',
    numero: '',
    bairro: '',
    cidade: '',
    estado: '',
    cep: '',
    responsavel: '',
  };
}

let PERFIL_DATA = perfilSeed();

function initPerfilWatch() {
  cloudWatch(PERFIL_KEY, perfilSeed(), (data) => {
    PERFIL_DATA = Object.assign(perfilSeed(), data);
    renderProfileBox();
  });
}

function renderProfileBox() {
  const nomeEl = document.getElementById('profile-empresa-nome');
  if (nomeEl) nomeEl.textContent = PERFIL_DATA.nomeFantasia || PERFIL_DATA.nomeEmpresa || 'Minha Empresa';
  const avatarEl = document.getElementById('profile-avatar-letter');
  if (avatarEl) {
    if (PERFIL_DATA.logoUrl) {
      avatarEl.innerHTML = `<img src="${PERFIL_DATA.logoUrl}" alt="Logo" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
    } else {
      avatarEl.textContent = (PERFIL_DATA.nomeFantasia || PERFIL_DATA.nomeEmpresa || 'E').trim().charAt(0).toUpperCase();
    }
  }
}

function initMeuPerfilPage() {
  cloudWatch(PERFIL_KEY, perfilSeed(), (data) => {
    PERFIL_DATA = Object.assign(perfilSeed(), data);
    renderProfileBox();
    preencherFormPerfil();
  });
}

function preencherFormPerfil() {
  const d = PERFIL_DATA;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('perfil-tipo-pessoa', d.tipoPessoa || 'PJ');
  set('perfil-responsavel', d.responsavel);
  set('perfil-nome-empresa', d.nomeEmpresa);
  set('perfil-nome-fantasia', d.nomeFantasia);
  set('perfil-cnpj', d.cnpj);
  set('perfil-cpf', d.cpf);
  set('perfil-ie', d.inscricaoEstadual);
  const isentoEl = document.getElementById('perfil-isento');
  if (isentoEl) isentoEl.checked = !!d.isento;
  set('perfil-email', d.email);
  set('perfil-telefone1', d.telefone1);
  set('perfil-telefone2', d.telefone2);
  set('perfil-whatsapp', d.whatsapp);
  set('perfil-endereco', d.endereco);
  set('perfil-numero', d.numero);
  set('perfil-bairro', d.bairro);
  set('perfil-cidade', d.cidade);
  set('perfil-estado', d.estado);
  set('perfil-cep', d.cep);
  alternarTipoPessoaPerfil();
  atualizarPreviewLogoPerfil();

  const cnpjEl = document.getElementById('perfil-cnpj');
  if (cnpjEl) cnpjEl.addEventListener('input', () => checarDocumento('perfil-cnpj', 'perfil-hint-cnpj', 'cnpj'));
  const cpfEl = document.getElementById('perfil-cpf');
  if (cpfEl) cpfEl.addEventListener('input', () => checarDocumento('perfil-cpf', 'perfil-hint-cpf', 'cpf'));
}

function alternarTipoPessoaPerfil() {
  const tipo = document.getElementById('perfil-tipo-pessoa').value;
  document.getElementById('perfil-campo-cnpj').style.display = tipo === 'PJ' ? '' : 'none';
  document.getElementById('perfil-campo-cpf').style.display = tipo === 'PF' ? '' : 'none';
}

function salvarPerfilEmpresa() {
  const get = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  PERFIL_DATA = {
    logoUrl: PERFIL_DATA.logoUrl || '',
    tipoPessoa: get('perfil-tipo-pessoa'),
    responsavel: get('perfil-responsavel'),
    nomeEmpresa: get('perfil-nome-empresa'),
    nomeFantasia: get('perfil-nome-fantasia') || get('perfil-nome-empresa'),
    cnpj: get('perfil-cnpj'),
    cpf: get('perfil-cpf'),
    inscricaoEstadual: get('perfil-ie'),
    isento: document.getElementById('perfil-isento').checked,
    email: get('perfil-email'),
    telefone1: get('perfil-telefone1'),
    telefone2: get('perfil-telefone2'),
    whatsapp: get('perfil-whatsapp'),
    endereco: get('perfil-endereco'),
    numero: get('perfil-numero'),
    bairro: get('perfil-bairro'),
    cidade: get('perfil-cidade'),
    estado: get('perfil-estado'),
    cep: get('perfil-cep'),
  };
  cloudSet(PERFIL_KEY, PERFIL_DATA);
  renderProfileBox();
  const aviso = document.getElementById('perfil-salvo-aviso');
  if (aviso) {
    aviso.style.display = 'inline';
    setTimeout(() => { aviso.style.display = 'none'; }, 2500);
  }
}

function mostrarSecaoPerfil(secao, btn) {
  document.getElementById('secao-perfil-dados').style.display = secao === 'dados' ? '' : 'none';
  document.getElementById('secao-perfil-tema').style.display = secao === 'tema' ? '' : 'none';
  document.getElementById('secao-perfil-seguranca').style.display = secao === 'seguranca' ? '' : 'none';
  document.querySelectorAll('#tabs-perfil button').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ---------- Trocar a própria senha ----------
// O Firebase exige que o login tenha sido "recente" pra deixar trocar a
// senha — por isso pedimos a senha ATUAL aqui: ela é usada só pra
// reautenticar a conta na hora, não fica guardada em lugar nenhum.

async function trocarMinhaSenha() {
  const senhaAtual = document.getElementById('senha-atual').value;
  const senhaNova = document.getElementById('senha-nova').value;
  const senhaNovaConfirmar = document.getElementById('senha-nova-confirmar').value;
  const erroEl = document.getElementById('trocar-senha-erro');
  const sucessoEl = document.getElementById('trocar-senha-sucesso');
  const btn = document.getElementById('btn-trocar-senha');

  erroEl.style.display = 'none';
  sucessoEl.style.display = 'none';

  if (senhaNova !== senhaNovaConfirmar) {
    erroEl.textContent = 'A nova senha e a confirmação não são iguais.';
    erroEl.style.display = '';
    return;
  }
  if (senhaNova.length < 6) {
    erroEl.textContent = 'A nova senha precisa ter pelo menos 6 caracteres.';
    erroEl.style.display = '';
    return;
  }

  const user = firebase.auth().currentUser;
  if (!user) return;

  btn.disabled = true;
  btn.textContent = 'Salvando...';

  try {
    const credencial = firebase.auth.EmailAuthProvider.credential(user.email, senhaAtual);
    await user.reauthenticateWithCredential(credencial);
    await user.updatePassword(senhaNova);

    document.getElementById('form-trocar-senha').reset();
    sucessoEl.style.display = '';
  } catch (err) {
    console.error('Erro ao trocar senha:', err);
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
      erroEl.textContent = 'A senha atual informada está incorreta.';
    } else if (err.code === 'auth/weak-password') {
      erroEl.textContent = 'Essa nova senha é considerada fraca demais pelo sistema. Tente uma diferente.';
    } else if (err.code === 'auth/too-many-requests') {
      erroEl.textContent = 'Muitas tentativas seguidas. Espere um pouco e tente de novo.';
    } else {
      erroEl.textContent = 'Não foi possível trocar a senha agora. Tente novamente.';
    }
    erroEl.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar nova senha';
  }
}

// ---------- Upload da logo da empresa ----------

function selecionarLogoEmpresa(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { alert('Selecione um arquivo de imagem (PNG ou JPG).'); return; }
  if (file.size > 8 * 1024 * 1024) { alert('Imagem muito grande (máximo 8 MB).'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const tamanho = 160;
      const canvas = document.createElement('canvas');
      canvas.width = tamanho;
      canvas.height = tamanho;
      const ctx = canvas.getContext('2d');
      const escala = Math.max(tamanho / img.width, tamanho / img.height);
      const w = img.width * escala;
      const h = img.height * escala;
      ctx.drawImage(img, (tamanho - w) / 2, (tamanho - h) / 2, w, h);
      const dataUrl = canvas.toDataURL('image/png', 0.85);

      PERFIL_DATA.logoUrl = dataUrl;
      cloudSet(PERFIL_KEY, PERFIL_DATA);
      renderProfileBox();
      atualizarPreviewLogoPerfil();
    };
    img.onerror = () => alert('Não foi possível ler essa imagem. Tente outro arquivo.');
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removerLogoEmpresa() {
  PERFIL_DATA.logoUrl = '';
  cloudSet(PERFIL_KEY, PERFIL_DATA);
  renderProfileBox();
  atualizarPreviewLogoPerfil();
  const input = document.getElementById('perfil-logo-input');
  if (input) input.value = '';
}

function atualizarPreviewLogoPerfil() {
  const img = document.getElementById('perfil-logo-preview-img');
  const letra = document.getElementById('perfil-logo-preview-letra');
  if (!img || !letra) return;
  if (PERFIL_DATA.logoUrl) {
    img.src = PERFIL_DATA.logoUrl;
    img.style.display = 'block';
    letra.style.display = 'none';
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    letra.style.display = '';
    letra.textContent = (PERFIL_DATA.nomeFantasia || PERFIL_DATA.nomeEmpresa || 'E').trim().charAt(0).toUpperCase();
  }
}

// =====================================================================
// ---------- Busca global (barra de pesquisa da topbar) ----------
// =====================================================================

const CLIENTES_FORN_KEY = 'eagles_clientes_fornecedores_v1';
let CLIENTES_FORN_DATA = [];

function initBuscaGlobalWatch() {
  cloudWatch(CLIENTES_FORN_KEY, clientesFornSeed(), (data) => {
    CLIENTES_FORN_DATA = data;
  });
  cloudWatch('eagles_produtos_v1', produtosSeed(), (data) => {
    CADASTROS_DATA['produto'] = data;
  });
}

function executarBuscaGlobal(termoBruto) {
  const termo = (termoBruto || '').toLowerCase().trim();
  const resultados = [];
  if (termo.length < 2) return resultados;

  (CLIENTES_FORN_DATA || []).forEach((c) => {
    const alvo = `${c.nome || ''} ${c.cnpj || ''} ${c.cpf || ''}`.toLowerCase();
    if (alvo.includes(termo)) resultados.push({ tag: 'Cliente/Fornecedor', nome: c.nome, href: 'clientes-fornecedores.html' });
  });

  Object.keys(CADASTROS_REGISTRO).forEach((moduloKey) => {
    const def = CADASTROS_REGISTRO[moduloKey];
    (CADASTROS_DATA[moduloKey] || []).forEach((item) => {
      const valor = (item[def.campoNome] || '').toString().toLowerCase();
      if (valor.includes(termo)) resultados.push({ tag: def.tituloItem, nome: item[def.campoNome], href: def.href });
    });
  });

  return resultados.slice(0, 12);
}

function onBuscaGlobalInput(valor) {
  const resultadosEl = document.getElementById('topbar-search-results');
  if (!resultadosEl) return;
  const resultados = executarBuscaGlobal(valor);
  if (!resultados.length) {
    resultadosEl.classList.remove('open');
    resultadosEl.innerHTML = '';
    return;
  }
  resultadosEl.innerHTML = resultados.map((r) =>
    `<a class="topbar-search-result-item" href="${r.href}"><div class="topbar-search-result-tag">${escapeHtml(r.tag)}</div>${escapeHtml(r.nome)}</a>`
  ).join('');
  resultadosEl.classList.add('open');
}

// =====================================================================
// ---------- Central de Atendimento (chatbot por regras) ----------
// =====================================================================

const CHATBOT_KB = [
  { padroes: ['cadastrar cliente', 'novo cliente', 'adicionar cliente', 'incluir cliente'], resposta: 'Vá em Cadastros → Clientes e Fornecedores e clique em "+ Incluir cadastro". Preencha os dados e salve.' },
  { padroes: ['fornecedor'], resposta: 'Fornecedores ficam na mesma lista de Clientes e Fornecedores — marque o tipo de cadastro como "Fornecedor". Também dá pra acessar direto por Estoque → Compras → Fornecedores.' },
  { padroes: ['marcar pago', 'receber pagamento', 'confirmar pagamento', 'cobranca', 'cobrança'], resposta: 'No Financeiro, aba Cobranças, encontre o lançamento e clique em "Marcar pago".' },
  { padroes: ['tema', 'cor', 'escuro', 'claro', 'modo noturno'], resposta: 'Clique no seu perfil no canto superior esquerdo — lá tem a opção de tema Claro ou Escuro. Também dá pra trocar em Meu Perfil → aba Tema.' },
  { padroes: ['exportar', 'relatorio', 'relatório', 'pdf'], resposta: 'Clique em "Meu Negócio" na barra superior, vá na aba Dashboard e escolha o período (mês atual, 3, 6 ou 12 meses). O relatório abre com gráficos e um botão para baixar em PDF.' },
  { padroes: ['produto', 'estoque de produto'], resposta: 'Vá em Cadastros → Produtos para cadastrar, e em Estoque → Lançamentos de estoque para entradas/saídas.' },
  { padroes: ['conferencia', 'conferência', 'contagem'], resposta: 'A conferência de estoque fica em Estoque → Conferência de estoque, onde você registra a contagem física.' },
  { padroes: ['nota fiscal', 'nf-e', 'nfe', 'nota de entrada'], resposta: 'Notas fiscais de entrada ficam em Estoque → Notas fiscais de entrada.' },
  { padroes: ['trocar senha', 'mudar senha', 'alterar senha', 'esqueci', 'esqueci a senha'], resposta: 'Vá no seu perfil (canto superior esquerdo) → Dados da empresa → aba Segurança. Lá você troca sua própria senha a qualquer momento, sem precisar de ajuda de ninguém.' },
  { padroes: ['criar usuario', 'criar acesso', 'novo usuario', 'adicionar usuario', 'equipe', 'convidar'], resposta: 'Se você é administrador da empresa, vá no seu perfil → Usuários, e clique em "+ Novo usuário". Dá pra cadastrar até 5 pessoas da sua equipe, cada uma com e-mail e senha próprios.' },
  { padroes: ['duplicar'], resposta: 'No Financeiro, use o botão "Duplicar" para copiar todos os lançamentos do mês atual para o mês seguinte.' },
  { padroes: ['vendedor'], resposta: 'Cadastre vendedores em Cadastros → Vendedores. Você pode vincular um vendedor a cada cliente.' },
  { padroes: ['funcionario', 'funcionário'], resposta: 'Cadastre a equipe em Cadastros → Funcionários.' },
  { padroes: ['pedido de venda', 'pedido de vendas'], resposta: 'Pedidos de venda ficam em Vendas → Pedidos de vendas. Clique em "+ Novo pedido de venda" pra abrir o formulário completo, com itens, totais e forma de pagamento.' },
  { padroes: ['lançar', 'lancar', 'lançamento a receber'], resposta: 'Na lista de Pedidos de venda, clique nos 3 pontinhos (⋮) do pedido e escolha "Lançar" — isso cria o lançamento a receber no Financeiro, já dividido em parcelas se a condição de pagamento indicar (ex: "30/60" ou "3x").' },
  { padroes: ['mapa', 'vendas por estado', 'vendas por cidade'], resposta: 'Em Meu Negócio → Vendas, tem um mapa do Brasil: cada estado fica mais escuro conforme vendeu mais. Clique num estado pra dar zoom e ver as vendas por cidade.' },
  { padroes: ['contrato'], resposta: 'Contratos ficam em Vendas → Contratos.' },
  { padroes: ['compra', 'pedido de compra'], resposta: 'Pedidos de compra ficam em Estoque → Pedido de compras.' },
  { padroes: ['instalar', 'aplicativo', 'app', 'pwa'], resposta: 'Dá pra instalar o sistema como um app de verdade. O botão fica em Meu Perfil → Tema, ou direto no menu do seu perfil. No iPhone, use "Compartilhar" → "Adicionar à Tela de Início" no Safari.' },
  { padroes: ['oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite'], resposta: 'Oi! Como posso ajudar? Você pode perguntar sobre cadastros, financeiro, vendas, estoque, senha ou usuários.' },
];

let CHATBOT_INICIADO = false;

function montarChatbotWidget() {
  if (document.getElementById('chatbot-launcher')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <button class="chatbot-launcher" id="chatbot-launcher" onclick="toggleChatbot()" title="Central de Atendimento"><svg style="width:26px;height:26px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></button>
    <div class="chatbot-window" id="chatbot-window">
      <div class="chatbot-header"><span>Central de Atendimento</span><button type="button" onclick="toggleChatbot()">&times;</button></div>
      <div class="chatbot-body" id="chatbot-body"></div>
      <div class="chatbot-suggestions">
        <button type="button" onclick="chatbotPerguntaRapida('Como cadastrar um cliente?')">Cadastrar cliente</button>
        <button type="button" onclick="chatbotPerguntaRapida('Como mudar o tema?')">Mudar tema</button>
        <button type="button" onclick="chatbotPerguntaRapida('Como exportar relatório?')">Exportar relatório</button>
      </div>
      <div class="chatbot-input-row">
        <input type="text" id="chatbot-input" placeholder="Digite sua dúvida..." onkeydown="if(event.key==='Enter'){chatbotEnviar();}">
        <button type="button" onclick="chatbotEnviar()"><svg style="width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
}

function abrirChatbot() {
  fecharTodosDropdowns();
  const win = document.getElementById('chatbot-window');
  if (win) win.classList.add('open');
  chatbotIniciarSeNecessario();
}

function toggleChatbot() {
  const win = document.getElementById('chatbot-window');
  if (!win) return;
  win.classList.toggle('open');
  if (win.classList.contains('open')) chatbotIniciarSeNecessario();
}

function chatbotIniciarSeNecessario() {
  if (CHATBOT_INICIADO) return;
  CHATBOT_INICIADO = true;
  chatbotAdicionarMsg('bot', 'Oi! Eu sou o assistente da Eagles Labz 🦅. Posso ajudar com dúvidas sobre cadastros, financeiro, vendas e estoque. O que você precisa?');
}

function chatbotAdicionarMsg(tipo, texto) {
  const body = document.getElementById('chatbot-body');
  if (!body) return;
  const div = document.createElement('div');
  div.className = 'chatbot-msg ' + tipo;
  div.textContent = texto;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

function chatbotResponder(pergunta) {
  const p = pergunta.toLowerCase();
  for (const item of CHATBOT_KB) {
    if (item.padroes.some((padrao) => p.includes(padrao))) return item.resposta;
  }
  return 'Não tenho certeza sobre isso ainda 🤔. Você pode consultar a Central de Ajuda (no ícone "?") ou falar com o Suporte pelo WhatsApp — é só clicar em "Suporte" no mesmo menu.';
}

function chatbotEnviar() {
  const input = document.getElementById('chatbot-input');
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) return;
  chatbotAdicionarMsg('user', texto);
  input.value = '';
  setTimeout(() => {
    chatbotAdicionarMsg('bot', chatbotResponder(texto));
  }, 350);
}

function chatbotPerguntaRapida(texto) {
  const input = document.getElementById('chatbot-input');
  if (input) input.value = texto;
  chatbotEnviar();
}

function abrirSuporteWhatsApp() {
  fecharTodosDropdowns();
  const numero = '5511946784626';
  const texto = encodeURIComponent('PRECISO DE AJUDA COM A PLATAFORMA EAGLES');
  window.open(`https://wa.me/${numero}?text=${texto}`, '_blank');
}

// =====================================================================
// ---------- Inicialização comum de página ----------
// =====================================================================

// Trava o zoom por pinça/duplo-toque no celular. Só faz efeito em telas de
// toque de verdade — no computador esses eventos de toque nunca disparam,
// então isso nunca interfere no zoom do navegador (Ctrl +/-) de quem usa
// mouse e teclado.
function bloquearZoomMobile() {
  document.addEventListener('touchmove', (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  let ultimoToque = 0;
  document.addEventListener('touchend', (e) => {
    const agora = Date.now();
    if (agora - ultimoToque <= 300) e.preventDefault();
    ultimoToque = agora;
  }, { passive: false });
}

function initPaginaComum(activeKey) {
  aplicarTemaSalvo();
  renderTopbar(activeKey);
  initFirebase();
  montarChatbotWidget();
  bloquearZoomMobile();
  // initPerfilWatch() e initBuscaGlobalWatch() NÃO entram aqui de propósito:
  // elas dependem de TENANT_ID, que só fica pronto depois que o login
  // termina de resolver (dentro de protegerPagina). Chamá-las aqui faria
  // elas rodarem cedo demais, sempre em modo local. Ver protegerPagina.
}

// =====================================================================
// ---------- Motor genérico de cadastros simples ----------
// =====================================================================
// Usado por: Produtos, Vendedores, Funcionários, Pedidos de venda,
// Objetos de postagem, Contratos, Pedido de compras, Notas fiscais de
// entrada, Lançamentos de estoque, Conferência de estoque.

const CADASTROS_REGISTRO = {};
let CADASTROS_DATA = {};
let CADASTRO_MODAL_MODULO = null;
let CADASTRO_MODAL_ID = null;

function registrarModuloCadastro(moduloKey, def) {
  CADASTROS_REGISTRO[moduloKey] = def;
}

function initModuloCadastro(moduloKey) {
  const def = CADASTROS_REGISTRO[moduloKey];
  cloudWatch(def.storageKey, def.seed(), (data) => {
    CADASTROS_DATA[moduloKey] = data;
    renderCadastroTabela(moduloKey);
  });
  const form = document.getElementById(def.formNovoId);
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); handleNovoCadastroSimples(moduloKey); });
}

function renderCadastroTabela(moduloKey) {
  const def = CADASTROS_REGISTRO[moduloKey];
  const tbody = document.getElementById(def.tbodyId);
  if (!tbody) return;
  const dados = CADASTROS_DATA[moduloKey] || [];
  if (!dados.length) {
    tbody.innerHTML = emptyCadastroHtml(`openModal('${def.modalNovoId}')`, def.colunas.length + 1);
    return;
  }
  tbody.innerHTML = dados.map((item) => {
    const cols = def.colunas.map((c) => `<td>${c.render ? c.render(item) : (item[c.key] !== undefined ? escapeHtml(item[c.key]) : '—')}</td>`).join('');
    const editarAttr = def.onEditarCustom ? `${def.onEditarCustom}('${item.id}')` : `abrirCadastroModal('${moduloKey}','${item.id}')`;
    const acoesHtml = def.renderAcoes
      ? def.renderAcoes(item)
      : `<button class="btn btn-small btn-ghost" onclick="${editarAttr}">Editar</button>
         <button class="btn btn-small btn-ghost" style="color:var(--danger);" onclick="excluirCadastroItem('${moduloKey}','${item.id}')">Excluir</button>`;
    return `<tr>${cols}<td style="white-space:nowrap; text-align:right;">${acoesHtml}</td></tr>`;
  }).join('');
}

function handleNovoCadastroSimples(moduloKey) {
  const def = CADASTROS_REGISTRO[moduloKey];
  const form = document.getElementById(def.formNovoId);
  // Usa o 1º valor válido de status/situação DESSE módulo como padrão —
  // cada módulo tem seu próprio vocabulário (ex: contrato usa
  // "vigente"/"encerrado", não "ativo"/"inativo"), então um valor fixo
  // pra todos os módulos mostrava rótulo errado ou "undefined" na tela.
  const campoStatus = def.fields.find((f) => (f.key === 'status' || f.key === 'situacao') && f.options && f.options.length);
  const novo = { id: genId(moduloKey.slice(0, 2)) };
  if (campoStatus) novo[campoStatus.key] = campoStatus.options[0].value;
  def.fields.forEach((f) => {
    const el = form.querySelector(`[data-novo-key="${f.key}"]`);
    if (!el) return;
    novo[f.key] = f.type === 'checkbox' ? el.checked : el.value;
  });
  if (def.camposExtras) Object.assign(novo, def.camposExtras());
  CADASTROS_DATA[moduloKey] = CADASTROS_DATA[moduloKey] || [];
  CADASTROS_DATA[moduloKey].push(novo);
  cloudSet(def.storageKey, CADASTROS_DATA[moduloKey]);
  renderCadastroTabela(moduloKey);
  form.reset();
  closeModal(def.modalNovoId);
}

function renderFichaCampos(fields, item, editavel) {
  let html = '';
  let secaoAtual = null;
  fields.forEach((f) => {
    if (f.secao && f.secao !== secaoAtual) {
      secaoAtual = f.secao;
      html += `<div class="field full" style="margin-top:6px; margin-bottom:-4px;"><div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:var(--blue-text); border-top:1px solid var(--border); padding-top:14px;">${secaoAtual}</div></div>`;
    }
    html += renderCampoHtml(f, item ? item[f.key] : '', editavel);
  });
  return html;
}

function abrirCadastroModal(moduloKey, id) {
  CADASTRO_MODAL_MODULO = moduloKey;
  CADASTRO_MODAL_ID = id;
  const def = CADASTROS_REGISTRO[moduloKey];
  const item = (CADASTROS_DATA[moduloKey] || []).find((i) => i.id === id);
  if (!item) return;
  document.getElementById(def.modalEditTituloId).textContent = 'Editar ' + def.tituloItem;
  document.getElementById(def.modalEditCamposId).innerHTML = renderFichaCampos(def.fields, item, true);
  openModal(def.modalEditId);
}

function salvarCadastroModal() {
  const moduloKey = CADASTRO_MODAL_MODULO;
  const def = CADASTROS_REGISTRO[moduloKey];
  const item = (CADASTROS_DATA[moduloKey] || []).find((i) => i.id === CADASTRO_MODAL_ID);
  if (!item) return;
  Object.assign(item, lerCamposModal('#' + def.modalEditCamposId));
  cloudSet(def.storageKey, CADASTROS_DATA[moduloKey]);
  renderCadastroTabela(moduloKey);
  closeModal(def.modalEditId);
}

function excluirCadastroItem(moduloKey, id) {
  const def = CADASTROS_REGISTRO[moduloKey];
  const item = (CADASTROS_DATA[moduloKey] || []).find((i) => i.id === id);
  if (!item) return;
  const nomeExibicao = item[def.campoNome] || 'este registro';
  if (!window.confirm(`Excluir "${nomeExibicao}"? Essa ação não pode ser desfeita.`)) return;
  CADASTROS_DATA[moduloKey] = CADASTROS_DATA[moduloKey].filter((i) => i.id !== id);
  cloudSet(def.storageKey, CADASTROS_DATA[moduloKey]);
  renderCadastroTabela(moduloKey);
}

// ---------- Definições dos módulos (seeds + campos + colunas) ----------

function produtosSeed() {
  return [];
}
registrarModuloCadastro('produto', {
  storageKey: 'eagles_produtos_v1',
  seed: produtosSeed,
  tituloItem: 'produto',
  campoNome: 'nome',
  href: 'produtos.html',
  tbodyId: 'tabela-produto-body',
  formNovoId: 'form-novo-produto',
  modalNovoId: 'modal-novo-produto',
  modalEditId: 'modal-editar-produto',
  modalEditTituloId: 'produto-editar-titulo',
  modalEditCamposId: 'produto-editar-campos',
  fields: [
    { key: 'nome', label: 'Nome', type: 'text', full: true, secao: 'Identificação' },
    { key: 'sku', label: 'Código (SKU)', type: 'text' },
    { key: 'formato', label: 'Formato', type: 'text', placeholder: 'Ex: Unidade, Kit, Caixa' },
    { key: 'tipo', label: 'Tipo', type: 'text', placeholder: 'Categoria do produto' },
    { key: 'situacao', label: 'Situação', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] },
    { key: 'condicao', label: 'Condição', type: 'select', options: [{ value: 'novo', label: 'Novo' }, { value: 'usado', label: 'Usado' }, { value: 'recondicionado', label: 'Recondicionado' }] },
    { key: 'marca', label: 'Marca', type: 'text' },

    { key: 'precoVenda', label: 'Preço venda (R$)', type: 'number', secao: 'Preço, estoque e fornecedores' },
    { key: 'unidade', label: 'Unidade', type: 'text', placeholder: 'Ex: UN, KG, CX' },
    { key: 'estoque', label: 'Estoque', type: 'number' },
    { key: 'quantidadeMinima', label: 'Quantidade mínima', type: 'number' },
    { key: 'fornecedores', label: 'Fornecedores', type: 'text', full: true, placeholder: 'Nomes separados por vírgula' },
    { key: 'producao', label: 'Produção', type: 'select', options: [{ value: 'nacional', label: 'Nacional' }, { value: 'importado', label: 'Importado' }] },
    { key: 'dataValidade', label: 'Data de validade', type: 'date' },
    { key: 'freteGratis', label: 'Frete', type: 'checkbox', checkboxLabel: 'Frete Grátis' },

    { key: 'caracteristicas', label: 'Características', type: 'textarea', full: true, secao: 'Características' },

    { key: 'pesoLiquido', label: 'Peso Líquido (kg)', type: 'number', secao: 'Dimensões e peso' },
    { key: 'pesoBruto', label: 'Peso Bruto (kg)', type: 'number' },
    { key: 'largura', label: 'Largura (cm)', type: 'number' },
    { key: 'altura', label: 'Altura (cm)', type: 'number' },
    { key: 'profundidade', label: 'Profundidade (cm)', type: 'number' },
    { key: 'unidadeMedida', label: 'Unidade de medida', type: 'text', placeholder: 'Ex: cm/kg' },

    { key: 'volumes', label: 'Volumes', type: 'number', secao: 'Embalagem e códigos fiscais' },
    { key: 'itensPorCaixa', label: 'Itens p/ caixa', type: 'number' },
    { key: 'gtinEan', label: 'GTIN/EAN', type: 'text' },
    { key: 'gtinEanTributario', label: 'GTIN/EAN tributário', type: 'text' },
    { key: 'codigoDun', label: 'Código DUN', type: 'text' },
    { key: 'codigoVolume', label: 'Código (do volume)', type: 'text' },
    { key: 'quantidadeVolume', label: 'Quantidade (no volume)', type: 'number' },
  ],
  colunas: [
    { key: 'nome', label: 'Produto' },
    { key: 'sku', label: 'SKU' },
    { key: 'estoque', label: 'Estoque' },
    { key: 'precoVenda', label: 'Preço de venda', render: (i) => formatMoney(i.precoVenda) },
    { key: 'situacao', label: 'Status', render: (i) => `<span class="badge ${i.situacao === 'ativo' ? 'badge-blue' : 'badge-neutral'}">${i.situacao === 'ativo' ? 'Ativo' : 'Inativo'}</span>` },
  ],
});

function vendedoresSeed() {
  return [];
}
registrarModuloCadastro('vendedor', {
  storageKey: 'eagles_vendedores_v1',
  seed: vendedoresSeed,
  tituloItem: 'vendedor',
  campoNome: 'nome',
  href: 'vendedores.html',
  tbodyId: 'tabela-vendedor-body',
  formNovoId: 'form-novo-vendedor',
  modalNovoId: 'modal-novo-vendedor',
  modalEditId: 'modal-editar-vendedor',
  modalEditTituloId: 'vendedor-editar-titulo',
  modalEditCamposId: 'vendedor-editar-campos',
  fields: [
    { key: 'nome', label: 'Nome completo', type: 'text', full: true, secao: 'Identificação' },
    { key: 'cpf', label: 'CPF', type: 'text' },
    { key: 'dataNascimento', label: 'Data de nascimento', type: 'date' },
    { key: 'telefone', label: 'Telefone', type: 'tel' },
    { key: 'whatsapp', label: 'WhatsApp', type: 'tel' },
    { key: 'email', label: 'E-mail', type: 'email' },

    { key: 'comissao', label: 'Comissão (%)', type: 'text', secao: 'Dados comerciais' },
    { key: 'metaVendasMensal', label: 'Meta de vendas mensal (R$)', type: 'number' },
    { key: 'regiaoAtuacao', label: 'Região de atuação', type: 'text' },
    { key: 'dataAdmissao', label: 'Data de admissão', type: 'date' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] },

    { key: 'banco', label: 'Banco', type: 'text', secao: 'Dados bancários (comissão)' },
    { key: 'agencia', label: 'Agência', type: 'text' },
    { key: 'conta', label: 'Conta', type: 'text' },
    { key: 'tipoConta', label: 'Tipo de conta', type: 'select', options: [{ value: 'corrente', label: 'Corrente' }, { value: 'poupanca', label: 'Poupança' }] },
    { key: 'chavePix', label: 'Chave PIX', type: 'text' },
  ],
  colunas: [
    { key: 'nome', label: 'Vendedor' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'email', label: 'E-mail' },
    { key: 'comissao', label: 'Comissão' },
    { key: 'status', label: 'Status', render: (i) => `<span class="badge ${i.status === 'ativo' ? 'badge-blue' : 'badge-neutral'}">${i.status === 'ativo' ? 'Ativo' : 'Inativo'}</span>` },
  ],
});

function funcionariosSeed() {
  return [];
}
registrarModuloCadastro('funcionario', {
  storageKey: 'eagles_funcionarios_v1',
  seed: funcionariosSeed,
  tituloItem: 'funcionário',
  campoNome: 'nome',
  href: 'funcionarios.html',
  tbodyId: 'tabela-funcionario-body',
  formNovoId: 'form-novo-funcionario',
  modalNovoId: 'modal-novo-funcionario',
  modalEditId: 'modal-editar-funcionario',
  modalEditTituloId: 'funcionario-editar-titulo',
  modalEditCamposId: 'funcionario-editar-campos',
  fields: [
    { key: 'nome', label: 'Nome completo', type: 'text', full: true, secao: 'Identificação' },
    { key: 'cpf', label: 'CPF', type: 'text' },
    { key: 'dataNascimento', label: 'Data de nascimento', type: 'date' },
    { key: 'telefone', label: 'Telefone', type: 'tel' },
    { key: 'email', label: 'E-mail', type: 'email' },
    { key: 'enderecoResidencial', label: 'Endereço residencial', type: 'text', full: true },

    { key: 'cargo', label: 'Cargo', type: 'text', secao: 'Dados profissionais' },
    { key: 'departamento', label: 'Departamento', type: 'text' },
    { key: 'dataAdmissao', label: 'Data de admissão', type: 'date' },
    { key: 'cargaHoraria', label: 'Carga horária', type: 'text', placeholder: 'Ex: 44h semanais' },
    { key: 'salario', label: 'Salário (R$)', type: 'number' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] },

    { key: 'contatoEmergenciaNome', label: 'Contato de emergência — nome', type: 'text', secao: 'Emergência' },
    { key: 'contatoEmergenciaTelefone', label: 'Contato de emergência — telefone', type: 'tel' },
  ],
  colunas: [
    { key: 'nome', label: 'Funcionário' },
    { key: 'cargo', label: 'Cargo' },
    { key: 'telefone', label: 'Telefone' },
    { key: 'status', label: 'Status', render: (i) => `<span class="badge ${i.status === 'ativo' ? 'badge-blue' : 'badge-neutral'}">${i.status === 'ativo' ? 'Ativo' : 'Inativo'}</span>` },
  ],
});

function pedidosVendaSeed() {
  return [];
}
registrarModuloCadastro('pedido-venda', {
  storageKey: 'eagles_pedidos_venda_v1',
  seed: pedidosVendaSeed,
  tituloItem: 'pedido de venda',
  campoNome: 'numero',
  href: 'pedidos-venda.html',
  tbodyId: 'tabela-pedido-venda-body',
  formNovoId: 'form-novo-pedido-venda',
  modalNovoId: 'modal-novo-pedido-venda',
  modalEditId: 'modal-editar-pedido-venda',
  modalEditTituloId: 'pedido-venda-editar-titulo',
  modalEditCamposId: 'pedido-venda-editar-campos',
  onEditarCustom: 'abrirEditarPedidoVenda',
  renderAcoes: (item) => renderMenuAcoesPedido(item),
  fields: [
    { key: 'numero', label: 'Número do pedido', type: 'text' },
    { key: 'cliente', label: 'Cliente', type: 'text', full: true },
    { key: 'vendedor', label: 'Vendedor', type: 'text' },
    { key: 'produto', label: 'Produto', type: 'text' },
    { key: 'estado', label: 'Estado (UF)', type: 'text', placeholder: 'Ex: SP' },
    { key: 'cidade', label: 'Cidade', type: 'text' },
    { key: 'data', label: 'Data', type: 'date' },
    { key: 'valor', label: 'Valor total (R$)', type: 'number' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'aberto', label: 'Aberto' }, { value: 'faturado', label: 'Faturado' }, { value: 'cancelado', label: 'Cancelado' }] },
  ],
  colunas: [
    { key: 'numero', label: 'Nº' },
    { key: 'cliente', label: 'Cliente' },
    { key: 'vendedor', label: 'Vendedor' },
    { key: 'estado', label: 'UF' },
    { key: 'data', label: 'Data', render: (i) => formatDatePt(i.data) },
    { key: 'valor', label: 'Valor', render: (i) => formatMoney(i.valor) },
    { key: 'status', label: 'Status', render: (i) => `<span class="badge badge-blue">${i.status || '—'}</span>` },
  ],
});

function objetosPostagemSeed() { return []; }
registrarModuloCadastro('objeto-postagem', {
  storageKey: 'eagles_objetos_postagem_v1',
  seed: objetosPostagemSeed,
  tituloItem: 'objeto de postagem',
  campoNome: 'codigoRastreio',
  href: 'objetos-postagem.html',
  tbodyId: 'tabela-objeto-postagem-body',
  formNovoId: 'form-novo-objeto-postagem',
  modalNovoId: 'modal-novo-objeto-postagem',
  modalEditId: 'modal-editar-objeto-postagem',
  modalEditTituloId: 'objeto-postagem-editar-titulo',
  modalEditCamposId: 'objeto-postagem-editar-campos',
  fields: [
    { key: 'codigoRastreio', label: 'Código de rastreio', type: 'text', full: true },
    { key: 'pedidoRelacionado', label: 'Pedido relacionado (nº)', type: 'text' },
    { key: 'transportadora', label: 'Transportadora', type: 'text' },
    { key: 'dataEnvio', label: 'Data de envio', type: 'date' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'postado', label: 'Postado' }, { value: 'em_transito', label: 'Em trânsito' }, { value: 'entregue', label: 'Entregue' }] },
  ],
  colunas: [
    { key: 'codigoRastreio', label: 'Rastreio' },
    { key: 'pedidoRelacionado', label: 'Pedido' },
    { key: 'transportadora', label: 'Transportadora' },
    { key: 'dataEnvio', label: 'Envio', render: (i) => formatDatePt(i.dataEnvio) },
    { key: 'status', label: 'Status', render: (i) => `<span class="badge badge-blue">${(i.status || '').replace('_', ' ')}</span>` },
  ],
});

function contratosSeed() { return []; }
registrarModuloCadastro('contrato', {
  storageKey: 'eagles_contratos_v1',
  seed: contratosSeed,
  tituloItem: 'contrato',
  campoNome: 'titulo',
  href: 'contratos.html',
  tbodyId: 'tabela-contrato-body',
  formNovoId: 'form-novo-contrato',
  modalNovoId: 'modal-novo-contrato',
  modalEditId: 'modal-editar-contrato',
  modalEditTituloId: 'contrato-editar-titulo',
  modalEditCamposId: 'contrato-editar-campos',
  fields: [
    { key: 'titulo', label: 'Título do contrato', type: 'text', full: true },
    { key: 'cliente', label: 'Cliente', type: 'text' },
    { key: 'dataInicio', label: 'Início da vigência', type: 'date' },
    { key: 'dataFim', label: 'Fim da vigência', type: 'date' },
    { key: 'valor', label: 'Valor (R$)', type: 'number' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'vigente', label: 'Vigente' }, { value: 'encerrado', label: 'Encerrado' }] },
  ],
  colunas: [
    { key: 'titulo', label: 'Contrato' },
    { key: 'cliente', label: 'Cliente' },
    { key: 'dataFim', label: 'Vigência até', render: (i) => formatDatePt(i.dataFim) },
    { key: 'valor', label: 'Valor', render: (i) => formatMoney(i.valor) },
    { key: 'status', label: 'Status', render: (i) => `<span class="badge ${i.status === 'vigente' ? 'badge-blue' : 'badge-neutral'}">${i.status || '—'}</span>` },
  ],
});

function pedidoComprasSeed() { return []; }
registrarModuloCadastro('pedido-compra', {
  storageKey: 'eagles_pedido_compras_v1',
  seed: pedidoComprasSeed,
  tituloItem: 'pedido de compra',
  campoNome: 'numero',
  href: 'pedido-compras.html',
  tbodyId: 'tabela-pedido-compra-body',
  formNovoId: 'form-novo-pedido-compra',
  modalNovoId: 'modal-novo-pedido-compra',
  modalEditId: 'modal-editar-pedido-compra',
  modalEditTituloId: 'pedido-compra-editar-titulo',
  modalEditCamposId: 'pedido-compra-editar-campos',
  fields: [
    { key: 'numero', label: 'Número do pedido', type: 'text' },
    { key: 'fornecedor', label: 'Fornecedor', type: 'text', full: true },
    { key: 'data', label: 'Data', type: 'date' },
    { key: 'valor', label: 'Valor total (R$)', type: 'number' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'aberto', label: 'Aberto' }, { value: 'recebido', label: 'Recebido' }, { value: 'cancelado', label: 'Cancelado' }] },
  ],
  colunas: [
    { key: 'numero', label: 'Nº' },
    { key: 'fornecedor', label: 'Fornecedor' },
    { key: 'data', label: 'Data', render: (i) => formatDatePt(i.data) },
    { key: 'valor', label: 'Valor', render: (i) => formatMoney(i.valor) },
    { key: 'status', label: 'Status', render: (i) => `<span class="badge badge-blue">${i.status || '—'}</span>` },
  ],
});

function notasFiscaisEntradaSeed() { return []; }
registrarModuloCadastro('nota-fiscal', {
  storageKey: 'eagles_notas_fiscais_entrada_v1',
  seed: notasFiscaisEntradaSeed,
  tituloItem: 'nota fiscal de entrada',
  campoNome: 'numeroNota',
  href: 'notas-fiscais-entrada.html',
  tbodyId: 'tabela-nota-fiscal-body',
  formNovoId: 'form-novo-nota-fiscal',
  modalNovoId: 'modal-novo-nota-fiscal',
  modalEditId: 'modal-editar-nota-fiscal',
  modalEditTituloId: 'nota-fiscal-editar-titulo',
  modalEditCamposId: 'nota-fiscal-editar-campos',
  fields: [
    { key: 'numeroNota', label: 'Número da NF-e', type: 'text' },
    { key: 'fornecedor', label: 'Fornecedor', type: 'text', full: true },
    { key: 'dataEmissao', label: 'Data de emissão', type: 'date' },
    { key: 'valor', label: 'Valor total (R$)', type: 'number' },
    { key: 'status', label: 'Status', type: 'select', options: [{ value: 'lancada', label: 'Lançada' }, { value: 'pendente', label: 'Pendente de lançamento' }] },
  ],
  colunas: [
    { key: 'numeroNota', label: 'NF-e' },
    { key: 'fornecedor', label: 'Fornecedor' },
    { key: 'dataEmissao', label: 'Emissão', render: (i) => formatDatePt(i.dataEmissao) },
    { key: 'valor', label: 'Valor', render: (i) => formatMoney(i.valor) },
    { key: 'status', label: 'Status', render: (i) => `<span class="badge ${i.status === 'lancada' ? 'badge-success' : 'badge-warning'}">${i.status === 'lancada' ? 'Lançada' : 'Pendente'}</span>` },
  ],
});

function lancamentosEstoqueSeed() { return []; }
registrarModuloCadastro('lancamento-estoque', {
  storageKey: 'eagles_lancamentos_estoque_v1',
  seed: lancamentosEstoqueSeed,
  tituloItem: 'lançamento de estoque',
  campoNome: 'produto',
  href: 'lancamentos-estoque.html',
  tbodyId: 'tabela-lancamento-estoque-body',
  formNovoId: 'form-novo-lancamento-estoque',
  modalNovoId: 'modal-novo-lancamento-estoque',
  modalEditId: 'modal-editar-lancamento-estoque',
  modalEditTituloId: 'lancamento-estoque-editar-titulo',
  modalEditCamposId: 'lancamento-estoque-editar-campos',
  fields: [
    { key: 'produto', label: 'Produto', type: 'text', full: true },
    { key: 'tipo', label: 'Tipo', type: 'select', options: [{ value: 'entrada', label: 'Entrada' }, { value: 'saida', label: 'Saída' }] },
    { key: 'quantidade', label: 'Quantidade', type: 'number' },
    { key: 'data', label: 'Data', type: 'date' },
    { key: 'motivo', label: 'Motivo', type: 'text', placeholder: 'Ex: compra, venda, ajuste, perda' },
  ],
  colunas: [
    { key: 'produto', label: 'Produto' },
    { key: 'tipo', label: 'Tipo', render: (i) => `<span class="badge ${i.tipo === 'entrada' ? 'badge-success' : 'badge-danger'}">${i.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span>` },
    { key: 'quantidade', label: 'Qtd.' },
    { key: 'data', label: 'Data', render: (i) => formatDatePt(i.data) },
    { key: 'motivo', label: 'Motivo' },
  ],
});

function conferenciaEstoqueSeed() { return []; }
registrarModuloCadastro('conferencia-estoque', {
  storageKey: 'eagles_conferencia_estoque_v1',
  seed: conferenciaEstoqueSeed,
  tituloItem: 'conferência de estoque',
  campoNome: 'produto',
  href: 'conferencia-estoque.html',
  tbodyId: 'tabela-conferencia-estoque-body',
  formNovoId: 'form-novo-conferencia-estoque',
  modalNovoId: 'modal-novo-conferencia-estoque',
  modalEditId: 'modal-editar-conferencia-estoque',
  modalEditTituloId: 'conferencia-estoque-editar-titulo',
  modalEditCamposId: 'conferencia-estoque-editar-campos',
  fields: [
    { key: 'produto', label: 'Produto', type: 'text', full: true },
    { key: 'data', label: 'Data da contagem', type: 'date' },
    { key: 'estoqueSistema', label: 'Estoque no sistema', type: 'number' },
    { key: 'estoqueContado', label: 'Estoque contado', type: 'number' },
    { key: 'responsavel', label: 'Responsável pela contagem', type: 'text' },
  ],
  colunas: [
    { key: 'produto', label: 'Produto' },
    { key: 'data', label: 'Data', render: (i) => formatDatePt(i.data) },
    { key: 'estoqueSistema', label: 'Sistema' },
    { key: 'estoqueContado', label: 'Contado' },
    { key: 'divergencia', label: 'Divergência', render: (i) => { const d = Number(i.estoqueContado || 0) - Number(i.estoqueSistema || 0); return `<span style="color:${d === 0 ? 'var(--success)' : 'var(--danger)'};">${d > 0 ? '+' : ''}${d}</span>`; } },
  ],
});

// =====================================================================
// ---------- Clientes e Fornecedores (ficha cadastral completa) ----------
// =====================================================================

function clientesFornSeed() {
  return [];
}

let CLIENTE_FORN_DETALHE_ID = null;
let CLIENTE_FORN_MODO_EDICAO = false;

function initClientesFornPage() {
  cloudWatch(CLIENTES_FORN_KEY, clientesFornSeed(), (data) => {
    CLIENTES_FORN_DATA = data;
    renderClientesFornTabela();
    filtrarClientesForn();
  });
  const form = document.getElementById('form-novo-cliente-forn');
  if (form) form.addEventListener('submit', handleNovoClienteForn);

  const params = new URLSearchParams(window.location.search);
  if (params.get('tipo') === 'fornecedor') {
    const filtro = document.getElementById('filtro-tipo-cadastro');
    if (filtro) filtro.value = 'fornecedor';
  }

  ['input-novo-cnpj'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => checarDocumento('input-novo-cnpj', 'hint-novo-cnpj', 'cnpj'));
  });
  const cpfEl = document.getElementById('input-novo-cpf');
  if (cpfEl) cpfEl.addEventListener('input', () => checarDocumento('input-novo-cpf', 'hint-novo-cpf', 'cpf'));
}

function alternarTipoPessoaNovo() {
  const tipo = document.getElementById('input-novo-tipo-pessoa').value;
  document.getElementById('campo-novo-cnpj').style.display = tipo === 'PJ' ? '' : 'none';
  document.getElementById('campo-novo-cpf').style.display = tipo === 'PF' ? '' : 'none';
}

function renderClientesFornTabela() {
  const tbody = document.querySelector('#tabela-clientes-forn tbody');
  if (!tbody) return;
  if (!CLIENTES_FORN_DATA.length) {
    tbody.innerHTML = emptyCadastroHtml(`openModal('modal-novo-cliente-forn')`, 6);
    return;
  }
  tbody.innerHTML = CLIENTES_FORN_DATA.map((c) => {
    const doc = c.tipoPessoa === 'PJ' ? (c.cnpj || '—') : (c.cpf || '—');
    const tipoBadge = c.tipoCadastro === 'fornecedor'
      ? '<span class="badge badge-warning">Fornecedor</span>'
      : c.tipoCadastro === 'ambos'
        ? '<span class="badge badge-blue">Cliente e fornecedor</span>'
        : '<span class="badge badge-blue">Cliente</span>';
    return `<tr class="clickable" data-id="${c.id}" data-tipo="${c.tipoCadastro}">
      <td><div class="person-cell"><div class="avatar">${escapeHtml(initials(c.fantasia || c.nome))}</div><div><div class="person-name">${escapeHtml(c.fantasia || c.nome)}</div><div class="person-sub">${c.nome !== c.fantasia ? escapeHtml(c.nome) : ''}</div></div></div></td>
      <td>${escapeHtml(doc)}</td>
      <td>${escapeHtml(c.cidade || '—')}${c.estado ? '/' + escapeHtml(c.estado) : ''}</td>
      <td>${escapeHtml(c.telefone1 || c.whatsapp || '—')}</td>
      <td>${tipoBadge}</td>
      <td><button class="btn btn-small btn-ghost" onclick="abrirClienteFornDetalhe('${c.id}')">Ver</button></td>
    </tr>`;
  }).join('');
}

function filtrarClientesForn() {
  const termo = (document.getElementById('busca-cliente-forn')?.value || '').toLowerCase().trim();
  const tipo = document.getElementById('filtro-tipo-cadastro')?.value || 'todos';
  let visiveis = 0;
  document.querySelectorAll('#tabela-clientes-forn tbody tr[data-id]').forEach((row) => {
    const nomeEl = row.querySelector('.person-name');
    const nome = nomeEl ? nomeEl.textContent.toLowerCase() : '';
    const bateNome = !termo || nome.includes(termo);
    const bateTipo = tipo === 'todos' || row.dataset.tipo === tipo || row.dataset.tipo === 'ambos';
    const mostra = bateNome && bateTipo;
    row.style.display = mostra ? '' : 'none';
    if (mostra) visiveis++;
  });
  const vazio = document.getElementById('clientes-forn-empty');
  if (vazio) vazio.style.display = visiveis === 0 ? '' : 'none';
}

function limparFiltroClientesForn() {
  const busca = document.getElementById('busca-cliente-forn');
  const tipo = document.getElementById('filtro-tipo-cadastro');
  if (busca) busca.value = '';
  if (tipo) tipo.value = 'todos';
  filtrarClientesForn();
}

function documentoValidoParaSalvar(tipoPessoa, cnpj, cpf) {
  if (tipoPessoa === 'PF') return validarCPF(cpf);
  return validarCNPJ(cnpj);
}

function handleNovoClienteForn(e) {
  e.preventDefault();
  const form = e.target;
  const nome = document.getElementById('input-novo-nome').value;
  if (!nome) return;

  const tipoPessoa = document.getElementById('input-novo-tipo-pessoa').value;
  const cnpj = document.getElementById('input-novo-cnpj').value;
  const cpf = document.getElementById('input-novo-cpf').value;

  if (!documentoValidoParaSalvar(tipoPessoa, cnpj, cpf)) {
    checarDocumento('input-novo-cnpj', 'hint-novo-cnpj', 'cnpj');
    checarDocumento('input-novo-cpf', 'hint-novo-cpf', 'cpf');
    alert('Não é possível salvar: informe um ' + (tipoPessoa === 'PF' ? 'CPF' : 'CNPJ') + ' válido (o dígito verificador não confere).');
    return;
  }

  const novo = {
    id: genId('cf'),
    tipoPessoa,
    nome,
    fantasia: document.getElementById('input-novo-fantasia').value || nome,
    cnpj,
    cpf,
    inscricaoEstadual: document.getElementById('input-novo-ie').value,
    isento: document.getElementById('input-novo-isento').checked,
    tipoCadastro: document.getElementById('input-novo-tipo-cadastro').value,
    email: document.getElementById('input-novo-email').value,
    telefone1: document.getElementById('input-novo-telefone1').value,
    telefone2: document.getElementById('input-novo-telefone2').value,
    whatsapp: document.getElementById('input-novo-whatsapp').value,
    endereco: document.getElementById('input-novo-endereco').value,
    numero: document.getElementById('input-novo-numero').value,
    bairro: document.getElementById('input-novo-bairro').value,
    cidade: document.getElementById('input-novo-cidade').value,
    estado: document.getElementById('input-novo-estado').value,
    cep: document.getElementById('input-novo-cep').value,
    vendedor: document.getElementById('input-novo-vendedor').value,
    situacao: 'ativo',
    observacoes: '',
  };
  CLIENTES_FORN_DATA.push(novo);
  cloudSet(CLIENTES_FORN_KEY, CLIENTES_FORN_DATA);
  renderClientesFornTabela();
  filtrarClientesForn();
  form.reset();
  closeModal('modal-novo-cliente-forn');
}

const CLIENTE_FORN_FIELDS = [
  { key: 'tipoPessoa', label: 'Tipo de pessoa', type: 'select', options: [{ value: 'PJ', label: 'Pessoa Jurídica' }, { value: 'PF', label: 'Pessoa Física' }] },
  { key: 'nome', label: 'Razão social / Nome completo', type: 'text', full: true },
  { key: 'fantasia', label: 'Nome fantasia', type: 'text', full: true },
  { key: 'cnpj', label: 'CNPJ', type: 'text' },
  { key: 'cpf', label: 'CPF', type: 'text' },
  { key: 'inscricaoEstadual', label: 'Inscrição Estadual', type: 'text' },
  { key: 'isento', label: 'Isenção', type: 'checkbox', checkboxLabel: 'Empresa isenta de Inscrição Estadual' },
  { key: 'tipoCadastro', label: 'Tipo de cadastro', type: 'select', options: [{ value: 'cliente', label: 'Cliente' }, { value: 'fornecedor', label: 'Fornecedor' }, { value: 'ambos', label: 'Cliente e fornecedor' }] },
  { key: 'email', label: 'E-mail', type: 'email' },
  { key: 'telefone1', label: 'Telefone 1', type: 'tel' },
  { key: 'telefone2', label: 'Telefone 2', type: 'tel' },
  { key: 'whatsapp', label: 'WhatsApp', type: 'tel' },
  { key: 'endereco', label: 'Endereço', type: 'text', full: true },
  { key: 'numero', label: 'Número', type: 'text' },
  { key: 'bairro', label: 'Bairro', type: 'text' },
  { key: 'cidade', label: 'Cidade', type: 'text' },
  { key: 'estado', label: 'Estado (UF)', type: 'text' },
  { key: 'cep', label: 'CEP', type: 'text' },
  { key: 'vendedor', label: 'Vendedor vinculado', type: 'text' },
  { key: 'situacao', label: 'Situação', type: 'select', options: [{ value: 'ativo', label: 'Ativo' }, { value: 'inativo', label: 'Inativo' }] },
  { key: 'observacoes', label: 'Observações', type: 'textarea', full: true },
];

function abrirClienteFornDetalhe(id) {
  CLIENTE_FORN_DETALHE_ID = id;
  CLIENTE_FORN_MODO_EDICAO = false;
  renderClienteFornDetalheModal();
  openModal('modal-cliente-forn-detalhe');
}

function renderClienteFornDetalheModal() {
  const c = CLIENTES_FORN_DATA.find((x) => x.id === CLIENTE_FORN_DETALHE_ID);
  if (!c) return;
  document.getElementById('cliente-forn-detalhe-titulo').textContent = c.fantasia || c.nome;
  document.getElementById('cliente-forn-detalhe-campos').innerHTML =
    CLIENTE_FORN_FIELDS.map((f) => renderCampoHtml(f, c[f.key], CLIENTE_FORN_MODO_EDICAO)).join('');
  document.getElementById('cliente-forn-detalhe-acoes').innerHTML = CLIENTE_FORN_MODO_EDICAO
    ? `<button type="button" class="btn" onclick="cancelarEdicaoClienteForn()">Cancelar</button><button type="button" class="btn btn-primary" onclick="salvarClienteFornDetalhe()">Salvar</button>`
    : `<button type="button" class="btn" style="margin-right:auto; color:var(--danger); border-color:var(--danger);" onclick="excluirClienteForn('${c.id}')">Excluir</button><button type="button" class="btn" onclick="closeModal('modal-cliente-forn-detalhe')">Fechar</button><button type="button" class="btn btn-primary" onclick="entrarModoEdicaoClienteForn()">Editar</button>`;
}

function entrarModoEdicaoClienteForn() { CLIENTE_FORN_MODO_EDICAO = true; renderClienteFornDetalheModal(); }
function cancelarEdicaoClienteForn() { CLIENTE_FORN_MODO_EDICAO = false; renderClienteFornDetalheModal(); }

function salvarClienteFornDetalhe() {
  const c = CLIENTES_FORN_DATA.find((x) => x.id === CLIENTE_FORN_DETALHE_ID);
  if (!c) return;
  const dados = lerCamposModal('#cliente-forn-detalhe-campos');

  if (!documentoValidoParaSalvar(dados.tipoPessoa, dados.cnpj, dados.cpf)) {
    alert('Não é possível salvar: informe um ' + (dados.tipoPessoa === 'PF' ? 'CPF' : 'CNPJ') + ' válido (o dígito verificador não confere).');
    return;
  }

  Object.assign(c, dados);
  cloudSet(CLIENTES_FORN_KEY, CLIENTES_FORN_DATA);
  CLIENTE_FORN_MODO_EDICAO = false;
  renderClienteFornDetalheModal();
  renderClientesFornTabela();
  filtrarClientesForn();
}

function excluirClienteForn(id) {
  const c = CLIENTES_FORN_DATA.find((x) => x.id === id);
  if (!c) return;
  if (!window.confirm(`Excluir "${c.fantasia || c.nome}"? Essa ação não pode ser desfeita.`)) return;
  CLIENTES_FORN_DATA = CLIENTES_FORN_DATA.filter((x) => x.id !== id);
  cloudSet(CLIENTES_FORN_KEY, CLIENTES_FORN_DATA);
  renderClientesFornTabela();
  filtrarClientesForn();
  closeModal('modal-cliente-forn-detalhe');
}

// =====================================================================
// ---------- FINANÇAS — ciclos mensais independentes ----------
// =====================================================================

const FINANCE_TEMPLATE_KEY = 'eagles_fin_modelo_v1';
const FINANCE_CICLOS_KEY = 'eagles_fin_ciclos_v1';
const FINANCE_HOJE = new Date(2026, 8, 22);

function financeTemplatePadrao() {
  return {
    receitas: [],
    pagamentos: [],
  };
}

function loadFinanceTemplate() { return lsLoad(FINANCE_TEMPLATE_KEY, financeTemplatePadrao()); }
function saveFinanceCiclos(c) { cloudSet(FINANCE_CICLOS_KEY, c); }

function criarCicloDoMes(template) {
  return {
    receitas: template.receitas.map((r) => ({ ...r, status: 'pendente', dataPagamento: null })),
    pagamentos: template.pagamentos.map((p) => ({ ...p, status: 'pendente', dataPagamento: null })),
    adiantamentos: [],
    variaveis: [],
  };
}

let FINANCE_TEMPLATE_CACHE = null;
let FINANCE_CICLOS_CACHE = {};

function getCicloDoMes(mesKey) {
  if (!FINANCE_CICLOS_CACHE[mesKey]) {
    FINANCE_CICLOS_CACHE[mesKey] = criarCicloDoMes(FINANCE_TEMPLATE_CACHE || financeTemplatePadrao());
    saveFinanceCiclos(FINANCE_CICLOS_CACHE);
  }
  return FINANCE_CICLOS_CACHE[mesKey];
}

function salvarCicloDoMes(mesKey, ciclo) {
  FINANCE_CICLOS_CACHE[mesKey] = ciclo;
  saveFinanceCiclos(FINANCE_CICLOS_CACHE);
}

function isoHoje() { return FINANCE_HOJE.toISOString().slice(0, 10); }

function statusExibicaoGenerico(campoDia, item, mesKey) {
  if (item.status === 'pago') return 'pago';
  const [ano, mes] = mesKey.split('-').map(Number);
  const dataVenc = new Date(ano, mes - 1, Number(item[campoDia]));
  if (dataVenc < FINANCE_HOJE) return 'atrasado';
  const diffDias = Math.round((dataVenc - FINANCE_HOJE) / 86400000);
  if (diffDias <= 5) return 'proximo';
  return 'pendente';
}

const STATUS_BADGES = {
  pago: '<span class="badge badge-success">Pago</span>',
  atrasado: '<span class="badge badge-danger">Atrasado</span>',
  proximo: '<span class="badge badge-warning">Vence em breve</span>',
  pendente: '<span class="badge badge-neutral">Pendente</span>',
};

function marcarPago(ciclo, mesKey, lista, id) {
  const item = ciclo[lista].find((i) => i.id === id);
  if (!item) return;
  item.status = 'pago';
  item.dataPagamento = isoHoje();
  salvarCicloDoMes(mesKey, ciclo);
}

function desmarcarPago(ciclo, mesKey, lista, id) {
  const item = ciclo[lista].find((i) => i.id === id);
  if (!item) return;
  item.status = 'pendente';
  item.dataPagamento = null;
  salvarCicloDoMes(mesKey, ciclo);
}

function financeTotals(ciclo) {
  const receita = ciclo.receitas.reduce((acc, r) => acc + Number(r.valor || 0), 0);
  const despPagamentos = ciclo.pagamentos.reduce((acc, p) => acc + Number(p.valor || 0), 0);
  const despAdiantamentos = ciclo.adiantamentos.reduce((acc, a) => acc + Number(a.valor || 0), 0);
  const despVariaveis = ciclo.variaveis.reduce((acc, v) => acc + Number(v.valor || 0), 0);
  const despesaTotal = despPagamentos + despAdiantamentos + despVariaveis;
  return { receita, despPagamentos, despAdiantamentos, despVariaveis, despesaTotal, lucro: receita - despesaTotal };
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

let FINANCE_MES_ATUAL = '2026-09';
let FINANCE_CICLO = null;
let FINANCE_DIA_SELECIONADO = null;
let onCicloCarregado = null;

function carregarCicloAtual(mesInputId) {
  const mesInput = document.getElementById(mesInputId);
  FINANCE_MES_ATUAL = (mesInput && mesInput.value) || '2026-09';
  if (mesInput) mesInput.value = FINANCE_MES_ATUAL;
  cloudWatch(FINANCE_TEMPLATE_KEY, financeTemplatePadrao(), (data) => { FINANCE_TEMPLATE_CACHE = data; });
  cloudWatch(FINANCE_CICLOS_KEY, {}, (data) => {
    FINANCE_CICLOS_CACHE = data;
    FINANCE_CICLO = getCicloDoMes(FINANCE_MES_ATUAL);
    if (typeof onCicloCarregado === 'function') onCicloCarregado();
  });
}

// =====================================================================
// ---------- Painel (somente leitura) ----------
// =====================================================================

function initPainel() {
  onCicloCarregado = renderPainelLeitura;
  carregarCicloAtual('painel-mes');
}

function mudarMesPainel() {
  FINANCE_MES_ATUAL = document.getElementById('painel-mes').value;
  FINANCE_CICLO = getCicloDoMes(FINANCE_MES_ATUAL);
  FINANCE_DIA_SELECIONADO = null;
  renderPainelLeitura();
}

function renderPainelLeitura() {
  const totals = financeTotals(FINANCE_CICLO);
  setText('fin-total-receita', formatMoney(totals.receita));
  setText('fin-total-despesas', formatMoney(totals.despesaTotal));
  setText('fin-desp-pagamentos', formatMoney(totals.despPagamentos));
  setText('fin-desp-adiantamentos', formatMoney(totals.despAdiantamentos));
  setText('fin-desp-variaveis', formatMoney(totals.despVariaveis));
  setText('fin-lucro', formatMoney(totals.lucro));

  const balao = document.getElementById('fin-balao-lucro');
  if (balao) {
    balao.classList.toggle('lucro-negativo', totals.lucro < 0);
    balao.classList.toggle('lucro-positivo', totals.lucro >= 0);
  }

  renderComparativoMensal();
  renderPendentesPainel();
  renderFinanceCalendar();
}

// =====================================================================
// ---------- Financeiro (edição completa + cobranças) ----------
// =====================================================================

function initFinanceiro() {
  onCicloCarregado = () => { renderFinanceiroTudo(); atualizarCobrancasComCiclo(); };
  carregarCicloAtual('financas-mes');
  initMetasWatch();

  document.querySelectorAll('#tabs-cobrancas button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tabs-cobrancas button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderCobrancasLista();
    });
  });

  const params = new URLSearchParams(window.location.search);
  const relatorio = params.get('relatorio');
  if (relatorio) {
    setTimeout(() => gerarRelatorioPeriodo(Number(relatorio)), 300);
  }
}

function mudarMesFinancas() {
  FINANCE_MES_ATUAL = document.getElementById('financas-mes').value;
  FINANCE_CICLO = getCicloDoMes(FINANCE_MES_ATUAL);
  FINANCE_DIA_SELECIONADO = null;
  renderFinanceiroTudo();
  atualizarCobrancasComCiclo();
}

function renderFinanceiroTudo() {
  const totals = financeTotals(FINANCE_CICLO);
  setText('fin-total-receita', formatMoney(totals.receita));
  setText('fin-total-despesas', formatMoney(totals.despesaTotal));
  setText('fin-desp-pagamentos', formatMoney(totals.despPagamentos));
  setText('fin-desp-adiantamentos', formatMoney(totals.despAdiantamentos));
  setText('fin-desp-variaveis', formatMoney(totals.despVariaveis));
  setText('fin-lucro', formatMoney(totals.lucro));

  const balao = document.getElementById('fin-balao-lucro');
  if (balao) {
    balao.classList.toggle('lucro-negativo', totals.lucro < 0);
    balao.classList.toggle('lucro-positivo', totals.lucro >= 0);
  }

  renderReceitasTabela();
  renderPagamentosTabela();
  renderFinanceTabelaSimples('adiantamentos');
  renderFinanceTabelaSimples('variaveis');
  renderFinanceCalendar();
}

function renderReceitasTabela() {
  const tbody = document.getElementById('fin-tbody-receitas');
  if (!tbody) return;
  const itens = FINANCE_CICLO.receitas;
  if (!itens.length) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-soft);">Nenhum lançamento cadastrado.</td></tr>'; return; }
  tbody.innerHTML = itens.map((item) => {
    const status = statusExibicaoGenerico('diaAcerto', item, FINANCE_MES_ATUAL);
    const acaoPago = status === 'pago'
      ? `<button class="btn btn-small btn-ghost" onclick="painelMarcarDesfazerReceita('${item.id}',false)">Marcar pendente</button>`
      : `<button class="btn btn-small btn-ghost" onclick="painelMarcarDesfazerReceita('${item.id}',true)">Marcar pago</button>`;
    return `<tr>
      <td>${escapeHtml(item.cliente)}</td>
      <td>${escapeHtml(item.plano || '—')}</td>
      <td>Dia ${item.diaAcerto}</td>
      <td>${formatMoney(item.valor)}</td>
      <td>${STATUS_BADGES[status]}</td>
      <td style="text-align:right; white-space:nowrap;">
        ${acaoPago}
        <button class="btn btn-small btn-ghost" onclick="abrirFinanceModal('receitas', '${item.id}')">Editar</button>
        <button class="btn btn-small btn-ghost" onclick="excluirFinanceItem('receitas', '${item.id}')">Excluir</button>
      </td>
    </tr>`;
  }).join('');
}

function renderPagamentosTabela() {
  const tbody = document.getElementById('fin-tbody-pagamentos');
  if (!tbody) return;
  const itens = FINANCE_CICLO.pagamentos;
  if (!itens.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-soft);">Nenhum lançamento cadastrado.</td></tr>'; return; }
  tbody.innerHTML = itens.map((item) => {
    const status = statusExibicaoGenerico('diaPagamento', item, FINANCE_MES_ATUAL);
    const acaoPago = status === 'pago'
      ? `<button class="btn btn-small btn-ghost" onclick="painelMarcarDesfazerPagamento('${item.id}',false)">Marcar pendente</button>`
      : `<button class="btn btn-small btn-ghost" onclick="painelMarcarDesfazerPagamento('${item.id}',true)">Marcar pago</button>`;
    return `<tr>
      <td>${escapeHtml(item.cuidador)}</td>
      <td>Dia ${item.diaPagamento}</td>
      <td>${formatMoney(item.valor)}</td>
      <td>${STATUS_BADGES[status]}</td>
      <td style="text-align:right; white-space:nowrap;">
        ${acaoPago}
        <button class="btn btn-small btn-ghost" onclick="abrirFinanceModal('pagamentos', '${item.id}')">Editar</button>
        <button class="btn btn-small btn-ghost" onclick="excluirFinanceItem('pagamentos', '${item.id}')">Excluir</button>
      </td>
    </tr>`;
  }).join('');
}

const FINANCE_TABELA_SIMPLES_CONFIG = {
  adiantamentos: { bodyId: 'fin-tbody-adiantamentos', cols: (i) => [i.cuidador, formatDatePt(i.data), i.obs || '—', formatMoney(i.valor)] },
  variaveis: { bodyId: 'fin-tbody-variaveis', cols: (i) => [i.descricao, formatDatePt(i.data), formatMoney(i.valor)] },
};

function renderFinanceTabelaSimples(tipo) {
  const cfg = FINANCE_TABELA_SIMPLES_CONFIG[tipo];
  const tbody = document.getElementById(cfg.bodyId);
  if (!tbody) return;
  const itens = FINANCE_CICLO[tipo];
  if (!itens.length) { tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-soft);">Nenhum lançamento cadastrado.</td></tr>`; return; }
  tbody.innerHTML = itens.map((item) => {
    const cols = cfg.cols(item).map((c) => `<td>${c}</td>`).join('');
    return `<tr>${cols}
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn btn-small btn-ghost" onclick="abrirFinanceModal('${tipo}', '${item.id}')">Editar</button>
        <button class="btn btn-small btn-ghost" onclick="excluirFinanceItem('${tipo}', '${item.id}')">Excluir</button>
      </td>
    </tr>`;
  }).join('');
}

function painelMarcarDesfazerReceita(id, marcar) { (marcar ? marcarPago : desmarcarPago)(FINANCE_CICLO, FINANCE_MES_ATUAL, 'receitas', id); renderFinanceiroTudo(); atualizarCobrancasComCiclo(); }
function painelMarcarDesfazerPagamento(id, marcar) { (marcar ? marcarPago : desmarcarPago)(FINANCE_CICLO, FINANCE_MES_ATUAL, 'pagamentos', id); renderFinanceiroTudo(); }

const FINANCE_MODAL_FIELDS = {
  receitas: [
    { key: 'cliente', label: 'Cliente', type: 'text', placeholder: 'Nome do cliente' },
    { key: 'produto', label: 'Produto', type: 'text', placeholder: 'Nome do produto vendido' },
    { key: 'plano', label: 'Contrato/Plano', type: 'text', placeholder: 'Ex: Contrato mensal' },
    { key: 'valor', label: 'Valor mensal (R$)', type: 'number', placeholder: 'Ex: 2400' },
    { key: 'diaAcerto', label: 'Dia do acerto mensal', type: 'number', placeholder: 'Ex: 5', min: 1, max: 31 },
  ],
  pagamentos: [
    { key: 'cuidador', label: 'Funcionário/Prestador', type: 'text', placeholder: 'Nome' },
    { key: 'valor', label: 'Valor a pagar (R$)', type: 'number', placeholder: 'Ex: 1200' },
    { key: 'diaPagamento', label: 'Dia do pagamento', type: 'number', placeholder: 'Ex: 30', min: 1, max: 31 },
  ],
  adiantamentos: [
    { key: 'cuidador', label: 'Funcionário/Prestador', type: 'text', placeholder: 'Nome' },
    { key: 'valor', label: 'Valor (R$)', type: 'number', placeholder: 'Ex: 200' },
    { key: 'data', label: 'Data', type: 'date' },
    { key: 'obs', label: 'Observação', type: 'text', placeholder: 'Opcional' },
  ],
  variaveis: [
    { key: 'descricao', label: 'Descrição', type: 'text', placeholder: 'Ex: Material de escritório' },
    { key: 'valor', label: 'Valor (R$)', type: 'number', placeholder: 'Ex: 350' },
    { key: 'data', label: 'Data', type: 'date' },
  ],
};

const FINANCE_TITULOS = {
  receitas: 'receita de cliente',
  pagamentos: 'pagamento',
  adiantamentos: 'adiantamento',
  variaveis: 'saída variável',
};

let FINANCE_MODAL_TIPO = null;
let FINANCE_MODAL_ID = null;

function abrirFinanceModal(tipo, id) {
  FINANCE_MODAL_TIPO = tipo;
  FINANCE_MODAL_ID = id || null;
  const item = id ? FINANCE_CICLO[tipo].find((i) => i.id === id) : null;
  const campos = FINANCE_MODAL_FIELDS[tipo];

  document.getElementById('fin-modal-titulo').textContent = (item ? 'Editar ' : 'Novo(a) ') + FINANCE_TITULOS[tipo] + ' — ' + FINANCE_MES_ATUAL;
  document.getElementById('fin-modal-aviso-mes').textContent = 'Este lançamento vale só para o mês selecionado (' + FINANCE_MES_ATUAL + ').';
  document.getElementById('fin-modal-erro-cadastro').style.display = 'none';

  document.getElementById('fin-modal-campos').innerHTML = campos.map((c) => {
    const listaAttr = (tipo === 'receitas' && c.key === 'cliente') ? ' list="fin-lista-clientes"'
      : (tipo === 'receitas' && c.key === 'produto') ? ' list="fin-lista-produtos"' : '';
    const oninputAttr = (tipo === 'receitas' && c.key === 'produto') ? ' oninput="preencherValorPorProduto(this.value)"' : '';
    return `
    <div class="field full">
      <label>${c.label}</label>
      <input type="${c.type}" data-key="${c.key}" placeholder="${c.placeholder || ''}"${listaAttr}${oninputAttr}
        ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.max !== undefined ? `max="${c.max}"` : ''}
        value="${item ? (item[c.key] !== undefined ? item[c.key] : '') : ''}">
    </div>
  `;
  }).join('');

  if (tipo === 'receitas') {
    const dlCli = document.getElementById('fin-lista-clientes');
    if (dlCli) dlCli.innerHTML = CLIENTES_FORN_DATA.map((c) => `<option value="${c.fantasia || c.nome}">`).join('');
    const dlProd = document.getElementById('fin-lista-produtos');
    if (dlProd) dlProd.innerHTML = (CADASTROS_DATA['produto'] || []).map((p) => `<option value="${escapeHtml(p.nome)}">`).join('');
  }

  openModal('modal-financas-editar');
}

function preencherValorPorProduto(nomeProduto) {
  const produto = (CADASTROS_DATA['produto'] || []).find((p) => p.nome === nomeProduto);
  if (!produto) return;
  const valorInput = document.querySelector('#fin-modal-campos [data-key="valor"]');
  if (valorInput) valorInput.value = produto.precoVenda || 0;
}

function salvarFinanceModal() {
  const tipo = FINANCE_MODAL_TIPO;
  const campos = FINANCE_MODAL_FIELDS[tipo];
  const inputs = document.querySelectorAll('#fin-modal-campos input');
  const novoItem = {};
  inputs.forEach((input) => {
    const key = input.getAttribute('data-key');
    const campo = campos.find((c) => c.key === key);
    novoItem[key] = campo.type === 'number' ? Number(input.value || 0) : input.value;
  });

  if (FINANCE_MODAL_ID) {
    const lista = FINANCE_CICLO[tipo];
    const idx = lista.findIndex((i) => i.id === FINANCE_MODAL_ID);
    if (idx > -1) lista[idx] = { ...lista[idx], ...novoItem };
  } else {
    novoItem.id = genId(tipo[0]);
    if (tipo === 'receitas' || tipo === 'pagamentos') { novoItem.status = 'pendente'; novoItem.dataPagamento = null; }
    FINANCE_CICLO[tipo].push(novoItem);
  }

  salvarCicloDoMes(FINANCE_MES_ATUAL, FINANCE_CICLO);
  renderFinanceiroTudo();
  atualizarCobrancasComCiclo();
  closeModal('modal-financas-editar');
}

function excluirFinanceItem(tipo, id) {
  FINANCE_CICLO[tipo] = FINANCE_CICLO[tipo].filter((i) => i.id !== id);
  salvarCicloDoMes(FINANCE_MES_ATUAL, FINANCE_CICLO);
  renderFinanceiroTudo();
  atualizarCobrancasComCiclo();
}

// ---------- Calendário financeiro ----------

const DIAS_SEMANA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function renderFinanceCalendar() {
  const grid = document.getElementById('fin-calendario-grid');
  if (!grid) return;
  const [ano, mes] = FINANCE_MES_ATUAL.split('-').map(Number);
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay();

  let html = DIAS_SEMANA_CURTO.map((d) => `<div class="fin-cal-weekday">${d}</div>`).join('');
  for (let i = 0; i < primeiroDiaSemana; i++) html += `<div class="fin-cal-day fin-cal-blank"></div>`;

  for (let dia = 1; dia <= diasNoMes; dia++) {
    const receitasDia = FINANCE_CICLO.receitas.filter((r) => Number(r.diaAcerto) === dia);
    const pagamentosDia = FINANCE_CICLO.pagamentos.filter((p) => Number(p.diaPagamento) === dia);
    const temEventos = receitasDia.length || pagamentosDia.length;
    const selecionado = FINANCE_DIA_SELECIONADO === dia;
    html += `
      <button type="button" class="fin-cal-day ${temEventos ? 'has-events' : ''} ${selecionado ? 'selected' : ''}" onclick="selecionarDiaFinanceiro(${dia})">
        <span class="fin-cal-num">${dia}</span>
        <span class="fin-cal-dots">
          ${receitasDia.length ? `<span class="fin-dot fin-dot-receita" title="${receitasDia.length} cliente(s)"></span>` : ''}
          ${pagamentosDia.length ? `<span class="fin-dot fin-dot-pagamento" title="${pagamentosDia.length} pagamento(s)"></span>` : ''}
        </span>
      </button>`;
  }

  grid.innerHTML = html;
  renderFinanceDiaDetalhe();
}

function selecionarDiaFinanceiro(dia) {
  FINANCE_DIA_SELECIONADO = FINANCE_DIA_SELECIONADO === dia ? null : dia;
  renderFinanceCalendar();
}

function renderFinanceDiaDetalhe() {
  const painel = document.getElementById('fin-dia-detalhe');
  if (!painel) return;
  if (!FINANCE_DIA_SELECIONADO) {
    painel.innerHTML = '<p class="empty-state">Clique em um dia do calendário para ver os acertos e pagamentos daquela data.</p>';
    return;
  }
  const dia = FINANCE_DIA_SELECIONADO;
  const receitasDia = FINANCE_CICLO.receitas.filter((r) => Number(r.diaAcerto) === dia);
  const pagamentosDia = FINANCE_CICLO.pagamentos.filter((p) => Number(p.diaPagamento) === dia);

  let html = `<h3 style="margin:0 0 10px; font-size:14px;">Dia ${String(dia).padStart(2, '0')} de ${FINANCE_MES_ATUAL}</h3>`;
  if (!receitasDia.length && !pagamentosDia.length) {
    html += '<p class="empty-state" style="padding:12px 0;">Nenhum acerto ou pagamento cadastrado para este dia.</p>';
  }
  if (receitasDia.length) {
    html += '<div style="margin-bottom:10px;"><strong style="font-size:13px;">Acerto mensal de clientes</strong>';
    receitasDia.forEach((r) => {
      html += `<div class="list-row"><div class="icon-dot">${escapeHtml(initials(r.cliente))}</div><div class="list-row-main"><div class="list-row-title">${escapeHtml(r.cliente)}</div><div class="list-row-sub">${escapeHtml(r.plano || '')}</div></div><div class="list-row-value">${formatMoney(r.valor)}</div></div>`;
    });
    html += '</div>';
  }
  if (pagamentosDia.length) {
    html += '<div><strong style="font-size:13px;">Pagamentos</strong>';
    pagamentosDia.forEach((p) => {
      html += `<div class="list-row"><div class="icon-dot">${escapeHtml(initials(p.cuidador))}</div><div class="list-row-main"><div class="list-row-title">${escapeHtml(p.cuidador)}</div><div class="list-row-sub">Pagamento mensal</div></div><div class="list-row-value">${formatMoney(p.valor)}</div></div>`;
    });
    html += '</div>';
  }
  painel.innerHTML = html;
}

// ---------- Cobranças (dentro do Financeiro) ----------

function atualizarCobrancasComCiclo() {
  if (!document.getElementById('tabela-cobrancas')) return;
  renderCobrancasLista();
}

function renderCobrancasLista() {
  const receitas = FINANCE_CICLO.receitas;
  let recebido = 0, pendente = 0, atrasado = 0, proximos = 0;
  receitas.forEach((r) => {
    const status = statusExibicaoGenerico('diaAcerto', r, FINANCE_MES_ATUAL);
    if (status === 'pago') recebido += Number(r.valor);
    else if (status === 'atrasado') atrasado += Number(r.valor);
    else { pendente += Number(r.valor); if (status === 'proximo') proximos++; }
  });
  setText('cob-recebido', formatMoney(recebido));
  setText('cob-pendente', formatMoney(pendente));
  setText('cob-atrasado', formatMoney(atrasado));
  const avisoEl = document.getElementById('cob-aviso-proximos');
  if (avisoEl) {
    if (proximos > 0) { avisoEl.style.display = ''; avisoEl.textContent = `⚠ ${proximos} cliente(s) com vencimento nos próximos 5 dias.`; }
    else avisoEl.style.display = 'none';
  }

  const filtroAtivo = document.querySelector('#tabs-cobrancas button.active')?.getAttribute('data-filter') || 'todas';
  const tbody = document.querySelector('#tabela-cobrancas tbody');
  const [ano, mes] = FINANCE_MES_ATUAL.split('-').map(Number);

  const linhas = receitas.filter((r) => {
    const status = statusExibicaoGenerico('diaAcerto', r, FINANCE_MES_ATUAL);
    const grupo = (status === 'proximo') ? 'pendente' : status;
    return filtroAtivo === 'todas' || grupo === filtroAtivo;
  });

  if (!linhas.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--text-soft);">Nenhuma cobrança encontrada para esse filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = linhas.map((r) => {
    const status = statusExibicaoGenerico('diaAcerto', r, FINANCE_MES_ATUAL);
    const vencimentoStr = `${String(r.diaAcerto).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
    const badge = STATUS_BADGES[status];
    const linhaEstilo = status === 'proximo' ? 'style="background:var(--warning-tint);"' : '';
    let acao;
    if (status === 'pago') {
      acao = `<span style="color:var(--text-soft); font-size:13px;">${r.dataPagamento ? formatDatePt(r.dataPagamento) : ''}</span>`;
    } else {
      acao = `<button class="btn btn-small" onclick="marcarReceitaPagaCobrancas('${r.id}')">Marcar pago</button>`;
    }
    return `<tr ${linhaEstilo}>
      <td><div class="person-cell"><div class="avatar">${escapeHtml(initials(r.cliente))}</div><div class="person-name">${escapeHtml(r.cliente)}</div></div></td>
      <td>${escapeHtml(r.plano)}</td>
      <td>${vencimentoStr}</td>
      <td>${formatMoney(r.valor)}</td>
      <td>${badge}</td>
      <td>${acao}</td>
    </tr>`;
  }).join('');
}

function marcarReceitaPagaCobrancas(id) {
  marcarPago(FINANCE_CICLO, FINANCE_MES_ATUAL, 'receitas', id);
  renderFinanceiroTudo();
  renderCobrancasLista();
}

function mostrarSecaoFinanceiro(secao, btn) {
  document.getElementById('secao-lancamentos').style.display = secao === 'lancamentos' ? '' : 'none';
  document.getElementById('secao-cobrancas').style.display = secao === 'cobrancas' ? '' : 'none';
  document.querySelectorAll('#tabs-financeiro button').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (secao === 'cobrancas') renderCobrancasLista();
}

// ---------- Duplicar lançamentos para o mês seguinte ----------

function calcularMesSeguinte(mesKey) {
  const [ano, mes] = mesKey.split('-').map(Number);
  const d = new Date(ano, mes, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function cicloTemLancamentos(ciclo) {
  return (ciclo.receitas.length + ciclo.pagamentos.length + ciclo.adiantamentos.length + ciclo.variaveis.length) > 0;
}

function duplicarLancamentosPainel() {
  const mesOrigem = FINANCE_MES_ATUAL;
  const mesDestino = calcularMesSeguinte(mesOrigem);
  const origemLabel = formatMesLabel(mesOrigem);
  const destinoLabel = formatMesLabel(mesDestino);

  if (!cicloTemLancamentos(FINANCE_CICLO)) {
    alert(`Não há lançamentos em ${origemLabel} para duplicar.`);
    return;
  }

  const cicloDestinoExistente = FINANCE_CICLOS_CACHE[mesDestino];
  const destinoTemDados = cicloDestinoExistente && cicloTemLancamentos(cicloDestinoExistente);
  const jaDuplicadoAntes = !!FINANCE_CICLO.duplicadoParaProximoEm;

  let mensagem = `Duplicar todos os lançamentos de ${origemLabel} para ${destinoLabel}?\n\nIsso vai copiar receitas, pagamentos, adiantamentos e saídas variáveis como estão agora, com status "pendente" no mês novo.`;
  if (jaDuplicadoAntes) {
    mensagem = `${origemLabel} já foi duplicado para ${destinoLabel} em ${formatDatePt(FINANCE_CICLO.duplicadoParaProximoEm.slice(0, 10))}.\n\nDuplicar de novo vai SUBSTITUIR todos os lançamentos que já existem em ${destinoLabel}. Deseja continuar mesmo assim?`;
  } else if (destinoTemDados) {
    mensagem = `${destinoLabel} já tem lançamentos cadastrados.\n\nDuplicar agora vai SUBSTITUIR tudo que já existe em ${destinoLabel} pelos lançamentos de ${origemLabel}. Deseja continuar mesmo assim?`;
  }
  if (!window.confirm(mensagem)) return;

  const agora = new Date().toISOString();
  const novoCiclo = {
    receitas: FINANCE_CICLO.receitas.map((r) => ({ ...r, id: genId('r'), status: 'pendente', dataPagamento: null })),
    pagamentos: FINANCE_CICLO.pagamentos.map((p) => ({ ...p, id: genId('p'), status: 'pendente', dataPagamento: null })),
    adiantamentos: FINANCE_CICLO.adiantamentos.map((a) => ({ ...a, id: genId('a') })),
    variaveis: FINANCE_CICLO.variaveis.map((v) => ({ ...v, id: genId('v') })),
  };

  FINANCE_CICLOS_CACHE[mesDestino] = novoCiclo;
  FINANCE_CICLO.duplicadoParaProximoEm = agora;
  FINANCE_CICLOS_CACHE[mesOrigem] = FINANCE_CICLO;
  saveFinanceCiclos(FINANCE_CICLOS_CACHE);

  alert(`Lançamentos de ${origemLabel} duplicados para ${destinoLabel} com sucesso.`);
  renderFinanceiroTudo();
}

// ---------- Comparativo com o mês anterior ----------

function calcularMesAnterior(mesKey) {
  const [ano, mes] = mesKey.split('-').map(Number);
  const d = new Date(ano, mes - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMesLabel(mesKey) {
  const [ano, mes] = mesKey.split('-').map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function variacaoPercentual(atual, anterior) {
  if (!anterior) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function maiorCategoriaDespesa(ciclo) {
  const totals = financeTotals(ciclo);
  const categorias = [
    { nome: 'Pagamentos', valor: totals.despPagamentos },
    { nome: 'Adiantamentos', valor: totals.despAdiantamentos },
    { nome: 'Saídas variáveis', valor: totals.despVariaveis },
  ];
  categorias.sort((a, b) => b.valor - a.valor);
  return categorias[0];
}

function financeComparativoMesAnterior() {
  const mesAnteriorKey = calcularMesAnterior(FINANCE_MES_ATUAL);
  const cicloAnterior = getCicloDoMes(mesAnteriorKey);
  const atual = financeTotals(FINANCE_CICLO);
  const anterior = financeTotals(cicloAnterior);
  return {
    mesAnteriorKey,
    receitaAtual: atual.receita, receitaAnterior: anterior.receita, receitaVariacao: variacaoPercentual(atual.receita, anterior.receita),
    despesaAtual: atual.despesaTotal, despesaAnterior: anterior.despesaTotal, despesaVariacao: variacaoPercentual(atual.despesaTotal, anterior.despesaTotal),
    lucroAtual: atual.lucro, lucroAnterior: anterior.lucro, lucroVariacao: variacaoPercentual(atual.lucro, anterior.lucro),
  };
}

function cartaoComparativoHtml(titulo, atual, anterior, variacaoPct, despesaInvertida) {
  const subiu = variacaoPct >= 0;
  const bom = despesaInvertida ? !subiu : subiu;
  const seta = subiu ? '▲' : '▼';
  const corClasse = bom ? 'up' : 'down';
  const maxValor = Math.max(Math.abs(atual), Math.abs(anterior), 1);
  const largAtual = Math.min(100, (Math.abs(atual) / maxValor) * 100);
  return `
    <div class="fin-comp-card">
      <div class="fin-comp-titulo">${titulo}</div>
      <div class="fin-comp-valor">${formatMoney(atual)}</div>
      <div class="fin-comp-var ${corClasse}">${seta} ${Math.abs(variacaoPct).toFixed(1)}%</div>
      <div class="fin-comp-bar-track"><div class="fin-comp-bar-fill ${corClasse}" style="width:${largAtual}%;"></div></div>
      <div class="fin-comp-bar-legenda">Mês anterior: ${formatMoney(anterior)}</div>
    </div>`;
}

function cartaoMaiorCategoriaHtml(cat, pct) {
  return `
    <div class="fin-comp-card">
      <div class="fin-comp-titulo">Maior gasto do mês</div>
      <div class="fin-comp-valor" style="font-size:16px;">${escapeHtml(cat.nome)}</div>
      <div class="fin-comp-var" style="color:var(--text-soft);">${formatMoney(cat.valor)} · ${pct.toFixed(0)}% das despesas</div>
      <div class="fin-comp-bar-track"><div class="fin-comp-bar-fill" style="width:${pct}%; background:var(--warning);"></div></div>
    </div>`;
}

function renderComparativoMensal() {
  const grid = document.getElementById('fin-comp-grid');
  if (!grid) return;
  const comp = financeComparativoMesAnterior();
  const maiorCategoria = maiorCategoriaDespesa(FINANCE_CICLO);
  const totalsAtual = financeTotals(FINANCE_CICLO);
  const pctCategoria = totalsAtual.despesaTotal > 0 ? (maiorCategoria.valor / totalsAtual.despesaTotal) * 100 : 0;

  grid.innerHTML = [
    cartaoComparativoHtml('Receita', comp.receitaAtual, comp.receitaAnterior, comp.receitaVariacao, false),
    cartaoComparativoHtml('Despesas', comp.despesaAtual, comp.despesaAnterior, comp.despesaVariacao, true),
    cartaoComparativoHtml('Lucro', comp.lucroAtual, comp.lucroAnterior, comp.lucroVariacao, false),
    cartaoMaiorCategoriaHtml(maiorCategoria, pctCategoria),
  ].join('');

  setText('fin-comp-mes-label', 'vs. ' + formatMesLabel(comp.mesAnteriorKey));
}

// ---------- "Pendente" ----------

function renderPendentesPainel() {
  const container = document.getElementById('fin-pendentes-lista');
  if (!container) return;
  const pendentes = FINANCE_CICLO.receitas.filter((r) => statusExibicaoGenerico('diaAcerto', r, FINANCE_MES_ATUAL) !== 'pago');
  const totalPendente = pendentes.reduce((acc, r) => acc + Number(r.valor || 0), 0);
  setText('fin-pendentes-total', pendentes.length ? formatMoney(totalPendente) + ' em aberto' : '');

  if (!pendentes.length) {
    container.innerHTML = '<p class="empty-state">Nenhuma pendência neste mês — tudo pago 🎉</p>';
    return;
  }
  container.innerHTML = pendentes.map((r) => {
    const status = statusExibicaoGenerico('diaAcerto', r, FINANCE_MES_ATUAL);
    return `<div class="list-row">
      <div class="icon-dot">${escapeHtml(initials(r.cliente))}</div>
      <div class="list-row-main"><div class="list-row-title">${escapeHtml(r.cliente)}</div><div class="list-row-sub">${escapeHtml(r.plano || '')} · vencimento dia ${r.diaAcerto}</div></div>
      <div style="text-align:right;"><div class="list-row-value">${formatMoney(r.valor)}</div>${STATUS_BADGES[status]}</div>
    </div>`;
  }).join('');
}

// =====================================================================
// ---------- Relatório por período (dashboard estilo Power BI) ----------
// =====================================================================

const METAS_KEY = 'eagles_fin_metas_v1';
function metasSeed() { return { metaLucroMensal: 0 }; }
let METAS_DATA = metasSeed();

function initMetasWatch() {
  cloudWatch(METAS_KEY, metasSeed(), (data) => { METAS_DATA = data; });
}

function salvarMetaLucro(valor) {
  METAS_DATA.metaLucroMensal = Number(valor) || 0;
  cloudSet(METAS_KEY, METAS_DATA);
}

function formatMesLabelCurto(mesKey) {
  const [ano, mes] = mesKey.split('-').map(Number);
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
}

function gerarListaMeses(mesFinalKey, quantidade) {
  const [ano, mes] = mesFinalKey.split('-').map(Number);
  const lista = [];
  for (let i = quantidade - 1; i >= 0; i--) {
    const d = new Date(ano, mes - 1 - i, 1);
    lista.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return lista;
}

function agregarPeriodo(meses) {
  const porMes = meses.map((mesKey) => {
    const ciclo = getCicloDoMes(mesKey);
    const totals = financeTotals(ciclo);
    return { mesKey, label: formatMesLabelCurto(mesKey), ciclo, ...totals };
  });

  const receitaTotal = porMes.reduce((a, m) => a + m.receita, 0);
  const despesaTotal = porMes.reduce((a, m) => a + m.despesaTotal, 0);
  const lucroTotal = receitaTotal - despesaTotal;
  const margemLucro = receitaTotal > 0 ? (lucroTotal / receitaTotal) * 100 : 0;

  const clientesMap = {};
  porMes.forEach((m) => { m.ciclo.receitas.forEach((r) => { clientesMap[r.cliente] = (clientesMap[r.cliente] || 0) + Number(r.valor || 0); }); });
  const clientesNomes = Object.keys(clientesMap);
  const receitaMediaPorCliente = clientesNomes.length ? receitaTotal / clientesNomes.length : 0;

  const primeiro = porMes[0];
  const ultimo = porMes[porMes.length - 1];
  const crescimentoReceita = variacaoPercentual(ultimo.receita, primeiro.receita);
  const crescimentoLucro = variacaoPercentual(ultimo.lucro, primeiro.lucro);

  const despPagamentosTotal = porMes.reduce((a, m) => a + m.despPagamentos, 0);
  const despAdiantamentosTotal = porMes.reduce((a, m) => a + m.despAdiantamentos, 0);
  const despVariaveisTotal = porMes.reduce((a, m) => a + m.despVariaveis, 0);
  const mesesNegativos = porMes.filter((m) => m.lucro < 0);

  return { porMes, receitaTotal, despesaTotal, lucroTotal, margemLucro, clientesMap, clientesNomes, receitaMediaPorCliente, crescimentoReceita, crescimentoLucro, despPagamentosTotal, despAdiantamentosTotal, despVariaveisTotal, mesesNegativos };
}

let RELATORIO_CHART_LINHA = null;
let RELATORIO_CHART_CATEGORIAS = null;
let RELATORIO_CHART_CLIENTES = null;
let RELATORIO_DADOS_ATUAIS = null;

function gerarRelatorioPeriodo(quantidade, containerId, tituloId) {
  containerId = containerId || 'relatorio-conteudo';
  tituloId = tituloId || 'relatorio-titulo';
  const abrirComoModal = containerId === 'relatorio-conteudo';
  if (abrirComoModal) closeModal('modal-relatorio-periodo');

  const meses = gerarListaMeses(FINANCE_MES_ATUAL, quantidade);
  const dados = agregarPeriodo(meses);
  RELATORIO_DADOS_ATUAIS = { meses, dados, quantidade };

  const tituloPeriodo = quantidade === 1 ? formatMesLabel(meses[0]) : `${formatMesLabel(meses[0])} – ${formatMesLabel(meses[meses.length - 1])}`;
  const tituloEl = document.getElementById(tituloId);
  if (tituloEl) tituloEl.textContent = 'Relatório financeiro · ' + tituloPeriodo;

  renderRelatorioConteudo(dados, quantidade, containerId);
  if (abrirComoModal) openModal('modal-relatorio');
}

function renderRelatorioConteudo(dados, quantidade, containerId) {
  containerId = containerId || 'relatorio-conteudo';
  const metaLucro = METAS_DATA.metaLucroMensal || 0;
  const metaLucroPeriodo = metaLucro * quantidade;
  const bateuMeta = dados.lucroTotal >= metaLucroPeriodo;

  const alertasHtml = [];
  if (dados.mesesNegativos.length) alertasHtml.push(`<div class="alerta-card alerta-danger">⚠ Lucro negativo em: ${dados.mesesNegativos.map((m) => m.label).join(', ')}</div>`);
  if (dados.margemLucro < 15) alertasHtml.push(`<div class="alerta-card alerta-warning">⚠ Margem de lucro baixa (${dados.margemLucro.toFixed(1)}%)</div>`);
  if (!bateuMeta && metaLucro > 0) alertasHtml.push(`<div class="alerta-card alerta-warning">⚠ Meta de lucro não atingida (${formatMoney(dados.lucroTotal)} de ${formatMoney(metaLucroPeriodo)})</div>`);
  if (!alertasHtml.length) alertasHtml.push('<div class="alerta-card alerta-success">✓ Nenhum alerta neste período</div>');

  const topClientes = dados.clientesNomes.map((nome) => ({ nome, valor: dados.clientesMap[nome] })).sort((a, b) => b.valor - a.valor).slice(0, 8);

  document.getElementById(containerId).innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr); margin-bottom:18px;">
      <div class="stat-card"><div class="stat-label">Receita total</div><div class="stat-value" style="font-size:19px;">${formatMoney(dados.receitaTotal)}</div></div>
      <div class="stat-card danger"><div class="stat-label">Despesas totais</div><div class="stat-value" style="font-size:19px;">${formatMoney(dados.despesaTotal)}</div></div>
      <div class="stat-card"><div class="stat-label">Lucro total</div><div class="stat-value" style="font-size:19px;">${formatMoney(dados.lucroTotal)}</div></div>
      <div class="stat-card"><div class="stat-label">Margem de lucro</div><div class="stat-value" style="font-size:19px;">${dados.margemLucro.toFixed(1)}%</div></div>
    </div>
    <div class="fin-comp-grid" style="margin-bottom:18px;">
      <div class="fin-comp-card"><div class="fin-comp-titulo">Crescimento de receita</div><div class="fin-comp-valor">${dados.crescimentoReceita >= 0 ? '+' : ''}${dados.crescimentoReceita.toFixed(1)}%</div><div class="fin-comp-var ${dados.crescimentoReceita >= 0 ? 'up' : 'down'}">${dados.crescimentoReceita >= 0 ? '▲' : '▼'} do início ao fim do período</div></div>
      <div class="fin-comp-card"><div class="fin-comp-titulo">Crescimento de lucro</div><div class="fin-comp-valor">${dados.crescimentoLucro >= 0 ? '+' : ''}${dados.crescimentoLucro.toFixed(1)}%</div><div class="fin-comp-var ${dados.crescimentoLucro >= 0 ? 'up' : 'down'}">${dados.crescimentoLucro >= 0 ? '▲' : '▼'} do início ao fim do período</div></div>
      <div class="fin-comp-card"><div class="fin-comp-titulo">Clientes ativos no período</div><div class="fin-comp-valor">${dados.clientesNomes.length}</div><div class="fin-comp-var" style="color:var(--text-soft);">geraram receita</div></div>
      <div class="fin-comp-card"><div class="fin-comp-titulo">Receita média por cliente</div><div class="fin-comp-valor">${formatMoney(dados.receitaMediaPorCliente)}</div><div class="fin-comp-var" style="color:var(--text-soft);">no período todo</div></div>
    </div>
    <div class="panel" style="margin-bottom:18px;">
      <div class="panel-title"><h2>Meta de lucro mensal</h2><span>${bateuMeta ? '✓ meta batida' : '✗ abaixo da meta'}</span></div>
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
        <label style="font-size:13px; color:var(--text-soft);">Meta por mês (R$)</label>
        <input type="number" id="input-meta-lucro" value="${metaLucro}" style="width:140px;" onchange="salvarMetaLucro(this.value); gerarRelatorioPeriodo(${quantidade});">
        <span style="font-size:13px; color:var(--text-soft);">Meta do período: ${formatMoney(metaLucroPeriodo)} · Realizado: ${formatMoney(dados.lucroTotal)}</span>
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:18px;">${alertasHtml.join('')}</div>
    <div class="panel" style="margin-bottom:18px;">
      <div class="panel-title"><h2>Evolução no período</h2><span>receita, despesas e lucro mês a mês</span></div>
      <canvas id="chart-relatorio-linha" height="90"></canvas>
    </div>
    <div class="grid-2" style="margin-bottom:6px;">
      <div class="panel"><div class="panel-title"><h2>Despesas por categoria</h2><span>somado no período</span></div><canvas id="chart-relatorio-categorias" height="220"></canvas></div>
      <div class="panel"><div class="panel-title"><h2>Receita por cliente</h2><span>top clientes no período</span></div><canvas id="chart-relatorio-clientes" height="220"></canvas></div>
    </div>
  `;

  if (typeof Chart === 'undefined') return;
  if (RELATORIO_CHART_LINHA) RELATORIO_CHART_LINHA.destroy();
  if (RELATORIO_CHART_CATEGORIAS) RELATORIO_CHART_CATEGORIAS.destroy();
  if (RELATORIO_CHART_CLIENTES) RELATORIO_CHART_CLIENTES.destroy();

  RELATORIO_CHART_LINHA = new Chart(document.getElementById('chart-relatorio-linha').getContext('2d'), {
    type: 'line',
    data: { labels: dados.porMes.map((m) => m.label), datasets: [
      { label: 'Receita', data: dados.porMes.map((m) => m.receita), borderColor: '#3f9a5c', backgroundColor: 'rgba(63,154,92,0.12)', fill: true, tension: 0.3 },
      { label: 'Despesas', data: dados.porMes.map((m) => m.despesaTotal), borderColor: '#d0554f', backgroundColor: 'rgba(208,85,79,0.10)', fill: true, tension: 0.3 },
      { label: 'Lucro', data: dados.porMes.map((m) => m.lucro), borderColor: '#3fae12', backgroundColor: 'rgba(63,174,18,0.14)', fill: true, tension: 0.3 },
    ]},
    options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: (v) => formatMoney(v) } } } },
  });

  RELATORIO_CHART_CATEGORIAS = new Chart(document.getElementById('chart-relatorio-categorias').getContext('2d'), {
    type: 'doughnut',
    data: { labels: ['Pagamentos', 'Adiantamentos', 'Saídas variáveis'], datasets: [{ data: [dados.despPagamentosTotal, dados.despAdiantamentosTotal, dados.despVariaveisTotal], backgroundColor: ['#3fae12', '#b8862f', '#d0554f'] }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
  });

  RELATORIO_CHART_CLIENTES = new Chart(document.getElementById('chart-relatorio-clientes').getContext('2d'), {
    type: 'bar',
    data: { labels: topClientes.map((c) => c.nome), datasets: [{ label: 'Receita no período', data: topClientes.map((c) => c.valor), backgroundColor: '#3fae12' }] },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => formatMoney(v) } } } },
  });
}

function imprimirRelatorioPeriodo() {
  if (!RELATORIO_DADOS_ATUAIS) return;
  const { dados, meses, quantidade } = RELATORIO_DADOS_ATUAIS;
  const tituloPeriodo = quantidade === 1 ? formatMesLabel(meses[0]) : `${formatMesLabel(meses[0])} – ${formatMesLabel(meses[meses.length - 1])}`;
  const linhasMeses = dados.porMes.map((m) => `<tr><td>${formatMesLabel(m.mesKey)}</td><td>${formatMoney(m.receita)}</td><td>${formatMoney(m.despesaTotal)}</td><td>${formatMoney(m.lucro)}</td></tr>`).join('');
  const topClientes = dados.clientesNomes.map((nome) => ({ nome, valor: dados.clientesMap[nome] })).sort((a, b) => b.valor - a.valor);
  const linhasClientes = topClientes.map((c) => `<tr><td>${escapeHtml(c.nome)}</td><td>${formatMoney(c.valor)}</td></tr>`).join('') || '<tr><td colspan="2">Nenhum cliente com receita no período.</td></tr>';

  document.getElementById('print-area').innerHTML = `
    <div style="padding:30px; font-family: Inter, sans-serif; color:#111;">
      <h1 style="font-size:20px; margin-bottom:2px;">Eagles Labz</h1>
      <p style="color:#555; margin-top:0;">Relatório financeiro — ${tituloPeriodo}</p>
      <div style="display:flex; gap:14px; margin:20px 0; flex-wrap:wrap;">
        <div style="flex:1; min-width:130px; border:1px solid #ddd; border-radius:8px; padding:12px;"><div style="font-size:11px; color:#777;">Receita total</div><div style="font-size:17px; font-weight:700;">${formatMoney(dados.receitaTotal)}</div></div>
        <div style="flex:1; min-width:130px; border:1px solid #ddd; border-radius:8px; padding:12px;"><div style="font-size:11px; color:#777;">Despesas totais</div><div style="font-size:17px; font-weight:700;">${formatMoney(dados.despesaTotal)}</div></div>
        <div style="flex:1; min-width:130px; border:1px solid #ddd; border-radius:8px; padding:12px;"><div style="font-size:11px; color:#777;">Lucro total</div><div style="font-size:17px; font-weight:700;">${formatMoney(dados.lucroTotal)}</div></div>
        <div style="flex:1; min-width:130px; border:1px solid #ddd; border-radius:8px; padding:12px;"><div style="font-size:11px; color:#777;">Margem de lucro</div><div style="font-size:17px; font-weight:700;">${dados.margemLucro.toFixed(1)}%</div></div>
      </div>
      <p style="font-size:13px;">Crescimento no período: receita ${dados.crescimentoReceita >= 0 ? '+' : ''}${dados.crescimentoReceita.toFixed(1)}%, lucro ${dados.crescimentoLucro >= 0 ? '+' : ''}${dados.crescimentoLucro.toFixed(1)}%.</p>
      <p style="font-size:13px;">Clientes ativos no período: <strong>${dados.clientesNomes.length}</strong> · Receita média por cliente: <strong>${formatMoney(dados.receitaMediaPorCliente)}</strong>.</p>
      <h3 style="font-size:14px; margin-top:22px;">Evolução mês a mês</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:8px; font-size:12px;"><thead><tr><th style="text-align:left; border-bottom:1px solid #ccc; padding:6px 4px;">Mês</th><th style="text-align:left; border-bottom:1px solid #ccc; padding:6px 4px;">Receita</th><th style="text-align:left; border-bottom:1px solid #ccc; padding:6px 4px;">Despesas</th><th style="text-align:left; border-bottom:1px solid #ccc; padding:6px 4px;">Lucro</th></tr></thead><tbody>${linhasMeses}</tbody></table>
      <h3 style="font-size:14px; margin-top:20px;">Receita por cliente no período</h3>
      <table style="width:100%; border-collapse:collapse; margin-top:8px; font-size:12px;"><thead><tr><th style="text-align:left; border-bottom:1px solid #ccc; padding:6px 4px;">Cliente</th><th style="text-align:left; border-bottom:1px solid #ccc; padding:6px 4px;">Receita no período</th></tr></thead><tbody>${linhasClientes}</tbody></table>
    </div>
  `;
  window.print();
}

// =====================================================================
// ---------- Meu Negócio: dashboards de Vendas (mapa + gráficos) ----------
// =====================================================================
//
// O "mapa do Brasil" aqui é um mapa de bolhas: cada estado vira um círculo
// posicionado numa posição aproximada do território (não são fronteiras
// estaduais reais — desenhar isso com precisão cartográfica exigiria uma
// base geográfica que não temos aqui). Passar o mouse mostra o nome do
// estado e o valor vendido; clicar detalha as cidades daquele estado.

//
// O mapa abaixo usa as fronteiras reais dos 27 estados (dados do pacote
// open-source @svg-maps/brazil, baseado em mapa da MapSVG, licença CC BY
// 4.0). Passar o mouse mostra o nome do estado e o valor vendido; clicar
// detalha as vendas por cidade daquele estado.

const BRASIL_MAP_VIEWBOX = '0 0 613 639';
const BRASIL_MAP_ESTADOS = [
  { uf: 'AC', nome: 'Acre', path: 'm 30.732574,238.03114 -2.08,-0.04 0.54,-1.81 -0.21,-0.83 -0.25,-0.49 -1.25,-0.7 -0.14,-0.45 0.27,-1.15 -0.77,-1.95 -1.09,-0.64 -5.6,-1.25 -7.34,-0.19 0.27,-0.56 2.49,-2.26 0.89,-1.23 0.29,-1.2 -0.22,-1.23 -0.68,-0.91 -0.83,-0.44 -1.68,-2.95 -0.77,-0.44 -0.9,-0.19 -1.13,-1.13 -0.92,-2.38 -2,-1.53 -0.98,-3.62 -0.87,-1.64 -1.88,-1.08 -0.08,-1.17 0.81,0.1 0.42,-0.52 0.07,-0.67 -0.2,-0.42 -2.12,-0.93 -0.36,-0.66 -2.16999996,-1.89 0.04,-0.37 0.62,-0.05 0.49999996,-1.32 -0.01,-1.31 3.01,-0.39 0.5,-0.39 -0.22,-1.35 -1.17,-1.57 0,0 17.95,7.48 23.66,5.66 12.14,3.14 26.44,14.17 28.509996,12.13 0,0 2.97,1.26 0,0 -0.3,0.48 -1.57,0.66 -2.09,1.59 -2.86,2.79 -1.65,0.86 -0.66,-0.18 -1.53,0.18 -0.05,0.56 -1.92,1.3 -2.08,0.99 -1.439996,1.83 -0.44,1.18 -0.61,0.28 -1.17,-0.75 -0.76,-0.13 -2.37,0.05 -0.68,0.26 -0.63,0.45 -0.36,0.86 -2.44,3.48 -3.77,1.25 -0.84,0.69 -1.94,0.51 -1.03,0.03 0.08,-2.11 -1.36,0.2 -3.55,-0.77 -5.24,-0.47 -5.09,0.38 -0.66,-0.58 -2.27,-0.17 -3.56,1.83 -2.73,0.62 -1.68,-0.67 -1.4,-1.44 -1.64,1.16 0.04,-17.55 0.05,-1.1 0.47,-0.71 0.07,-2.35 -0.26,-0.88 0.97,-1.18 0.48,-1.14 -1.16,0.2 -2.97,2.59 -1.6,1.01 -2.06,2.38 -1.95,0.67 -0.65,1.08 -1.81,0.99 z' },
  { uf: 'AL', nome: 'Alagoas', path: 'm 562.17257,230.56114 -0.2,-0.73 -1.42,-0.78 -0.45,0.09 -1.02,-0.29 -0.54,-1.4 0,0 1.32,-1.07 0.64,-1.09 2.17,-0.76 2.38,-3.29 0.09,-0.69 0.82,-0.6 1,1.22 1.67,0.3 1.08,-0.12 2.55,2.02 1.9,2.12 1.78,1.05 1.91,0.48 2.5,-0.65 3.14,0.29 1.17,-0.11 1.86,-1.06 1.16,0.05 1.81,-1.11 2.18,-2.29 0.12,-0.45 1.55,-1.24 2,-0.24 2.24,0.85 2.56,-1.29 1.47,-0.19 1.92,0.81 2.9,0.27 0.27,0.21 0,0 -2.78,4.96 -4.55,5.13 -3.58,3.58 -3.04,4.58 -3.33,2.88 -1,2.03 -1.32,1.79 0,0 -0.6,-1.31 -3.59,-2.23 -0.46,-0.03 -1.66,-0.79 -1.76,-1.45 -1.3,-2.45 -5.42,-3.07 -3.68,-0.95 z' },
  { uf: 'AP', nome: 'Amapá', path: 'm 345.24257,99.961144 -0.94,-0.06 -0.77,0.339996 -1.3,0.12 -2.79,-0.679996 -1.45,-1.03 -0.43,-1.5 -1.87,-1.39 -0.11,-1.3 0.21,-0.69 -0.31,-1.58 -0.33,-0.47 -0.95,-0.19 -0.41,-0.94 0.08,-2.43 -2.93,-3.28 -0.78,0.36 -0.82,-0.19 -1.5,-3.48 0.13,-1.58 -0.59,-1.81 -0.62,-0.56 -0.67,-1.51 -0.19,-2.11 0.43,-3.14 -0.17,-0.33 -2.57,-0.73 -2.02,-2.26 -0.76,-2.83 0.19,-0.72 0.68,-0.23 -0.49,-1.18 -0.68,0.03 -2.84,-2.66 -0.94,0.14 -0.38,0.42 -1.33,0.14 -0.84,-0.27 -0.8,-0.98 -1.14,-0.84 -1.19,-0.12 -0.49,-1.28 -0.67,-0.8 -1.93,-1.05 -1.29,-0.49 -3.39,-0.37 -1.08,0.29 -1.17,-0.02 -0.31,-0.54 -0.24,-1.44 0.25,-4.54 0.62,-1.3 -0.37,-2.3 -0.62,-0.57 0,0 0.35,-0.21 0.99,0.3 -0.01,0.81 -0.29,0.18 0.34,0.97 1.47,-0.06 0.82,0.23 0.35,0.9 0.84,0.71 2.25,0.78 3.29,0.75 2.76,-1.78 0.35,-0.76 1.73,-1.17 0.83,-0.29 0.69,0.94 2.71,0.94 1.08,-0.12 1.72,-1.01 0.12,-0.42 0.32,0.03 1.46,1.3 -0.2,0.87 2.37,-0.17 0.51,0.5 0.95,0.17 0.62,-0.01 0.91,-0.48 1.67,-1.5 1.78,-1.1 1.75,-2.3 0.37,-1 -0.2,-0.54 3.13,-6.5 0.11,-1.82 1.11,-1.3 0.73,-0.19 3.6,-5.79 0.23,-1.15 0.84,-1.2 1.79,-1.55 0.63,-1.66 2.11,-1.14 0.47,-0.92 1.04,-0.58 0.56,1.46 0.88,1.36 -1.67,-4.8 -0.07,-1.29 0.18,-0.33 3.37,2.42 1.14,1.21 0.91,1.22 0.52,1.19 0.03,1.58 0.44,0.31 0.32,-0.48 0.38,-0.1 0.21,0.4 0.21,7.89 0.66,3.87 2.71,6.05 2.66,8.94 3.32,5 1.01,0.35 3.27,-0.08 2.78,0.94 1.29,0.85 0.77,2.65 -0.16,3.33 -1.29,0.96 -1.73,0.43 -0.38,0.33 1.79,-0.15 1.04,-0.42 0.28,0.23 0.12,0.59 -0.17,0.73 -5.03,4.06 -1.17,2.1 -2.15,1.41 -1.94,3.72 -2.91,3.5 -0.7,0.46 -0.94,-0.09 -1.45,0.52 -2.08,2.98 0,0 -1.34,0.07 -0.75,0.9 0,0 -1.47,1.68 -0.97,2.22 -1.12,1.87 -0.84,0.65 -3.01,3.45 -0.36,2.4 0.17,1.8 -1.95,1.81 -0.98,0.12 z m 23.36,-46.99 -0.45,-0.33 -1.1,-1.86 0.07,-0.88 0.23,-0.41 1.66,-0.45 0.43,0.39 0.83,2.27 -0.99,1.1 -0.68,0.17 z m 2.49,17.61 -0.4,-0.25 -0.08,-0.71 1.11,-1.1 0.88,-0.15 1.25,0.24 0.46,-0.11 0.44,-0.64 0.05,0.59 -0.97,1.44 -0.99,0.5 -1.75,0.19 z m 3.44,-2.87 -0.78,-0.23 0,-0.56 0.72,-1.04 1.25,-0.1 0.18,0.35 -0.1,0.51 -1.27,1.07 z m -7.19,-18.42 -0.76,-0.5 0.26,-0.83 0.88,-0.17 0.86,0.32 0.01,0.73 -1.25,0.45 z' },
  { uf: 'AM', nome: 'Amazonas', path: 'm 166.08257,47.551144 0.72,0.78 0.75,0.34 0.61,0.01 1.13,-0.42 0.63,0.11 0.06,0.96 1.21,1.17 0.97,0.37 0.88,-0.21 1.36,0.11 1.95,0.95 0.49,0.66 -0.91,3.32 -0.71,1.5 2.73,3.74 1.66,4.76 0.19,2.26 0.87,1.12 0.05,0.45 -1.62,1.46 0.36,1.59 0.66,1.58 -0.77,3.04 -0.57,0.96 0.29,4.98 0.88,2.17 1.22,0.84 0.58,0.9 1.13,4.33 -0.06,0.58 -1.14,1.32 -1.84,-0.33 -0.14,1.14 5.01,4.42 0.52,0.04 1.96,1.31 1.48,1.649996 1.04,2.04 0.53,0.07 1.34,-0.42 2.36,1.04 -0.44,-2.11 0.75,-2.289996 0.25,-1.73 -0.37,-1.8 0.82,-2.97 1.02,-1.26 1.28,-0.69 2.09,-0.71 0.55,-0.89 1.6,-0.06 2.83,0.93 1.87,2.04 0.92,2.51 1.82,0.23 1.25,-0.46 1.41,-1.41 2.03,-0.55 0.42,-0.39 0.02,-0.53 -1.14,-1.41 -0.23,-0.73 0.11,-0.66 1.15,-2.64 0.07,-1.13 1.66,-3.03 2.33,-3.26 -0.03,-0.68 18.49,0.07 0,0 0.4,4.86 -0.43,1.45 0.18,2.27 0.24,0.68 1.7,0.85 0.18,0.41 -0.35,0.69 -0.05,2.11 1.83,1.99 0.36,0.19 0.7,-0.18 1.84,1.23 0.55,1.83 0.04,0.93 0.3,0.45 4.64,3.769996 4.58,2.54 0.63,0.9 1.35,1.09 1.88,0.67 2.37,1.31 2.26,0.65 1.36,0.15 1.32,0.82 0.08,0.61 1.27,1.34 2.7,1.44 1.1,2.17 1.87,0.79 0.85,-0.61 1.38,-0.35 0.19,0.48 -0.13,0.78 1.81,1.67 -29.9,64.24 -0.78,1.31 -1.45,1.13 -0.58,0.97 -0.03,1.13 0.82,2.33 0.38,0.57 1.07,0.58 1.58,1.56 0.64,1.26 0.15,1.96 0.57,0.57 0,0 -1.18,1.2 -0.2,0.61 -0.06,0.76 0.34,0.84 -0.27,1.01 -1.2,1.82 -0.86,0.64 -0.42,0.85 0.1,0.85 0.66,1.37 0.46,1.94 -1.38,4.22 -1.18,5.22 -1.21,0.73 -47.85,0.32 0,0 0.04,-0.7 -0.36,-0.38 -1.39,-0.28 -1.92,1.08 -0.54,1.74 -0.68,0.19 -3.24,-1.48 -0.68,-2.88 -0.62,-0.2 -0.98,0.13 -0.46,-0.21 -1.25,-3.27 -2.54,-0.98 -1.33,-1.27 -0.8,-1.91 -0.45,-0.49 -2.15,-1.13 -10.79,0.06 -1.38,2.56 -1.72,0.5 0.09,1.17 -0.26,0.22 -2.48,0.53 -1.19,1.59 -0.05,0.67 0.9,0.7 0.17,0.45 -0.36,1.02 -0.81,1.15 -2.06,1.21 -0.11,1.81 0.24,1.46 -3.87,-0.46 -2.13,0.38 -1.2,1.07 -1.79,-0.1 -0.84,-0.55 -0.46,-0.02 -1.75,1.26 -0.53,0.84 0.26,1.75 -2.54,3.16 -0.68,0.08 -0.68,-0.53 -0.64,-2.26 -0.38,-0.09 -1.84,1.02 -1.3,1.21 -1.37,0.39 -0.77,-0.13 -1.08,0.5 -0.41,0.53 -0.13,0.72 -1.22,0.79 -0.37,0.02 -2.31,-2.33 -0.72,-0.37 -2.87,0.33 -3.96,-0.26 0.16,1.29 -0.15,0.56 -1.55,1.81 -1.92,0.58 -3.26,2.56 0,0 -28.509996,-12.13 -26.44,-14.17 -12.14,-3.14 -23.66,-5.66 -17.95,-7.48 0,0 -0.07,-0.65 0.7,-2.92 1.22,-1.4 4.92,-3.47 2.26,-0.24 0.47,-0.3 0.98,-1.56 0.08,-1.03 -1.74,-4.49 0.38,-1.19 1.18,-2.19 1.28,-1.32 0.92,-1.25 0.42,-0.98 0.3,-1.74 -0.29,-1.32 0.67,-2.04 0.31,-2.31 0.73,-0.75 3.66,-1.63 2.19,-1.23 1.15,-1.04 0.44,-1.4 0.78,-0.37 1.41,-0.11 1.65,-0.93 3.54,-2.73 2.42,-0.43 1.51,0.29 4.19,-1.22 1.5,-0.77 1.82,-0.36 3.33,0.38 1.3,-1.59 0.63,-1.45 1.09,-0.61 2.14,0.2 0.64,0.54 1.32,-0.24 1.1,-0.74 1.71,0.12 0.31,0.53 -0.02,1.18 1.61,1.29 2.83,0.08 0.58,-0.4 0.46,-0.78 -0.11,-0.39 1.17,-4.92 6.7,-37.17 1.16,-2.92 -0.99,-4.959996 0.12,-0.26 -1.3,-1.05 -1.48,-2.75 -0.04,-0.49 0.65,-1.39 -0.52,-1.78 -0.37,-0.4 -1.7,-0.59 -3.03,-2.35 -1.94,-2.28 0.2,-11.51 3.89,-0.26 1.75,-1.17 3.5,-0.92 2.68,1.76 1.22,0.11 1.27,-0.43 -0.49,-1.69 0.3,-1.72 -1.37,-2.1 -0.57,-0.54 -1.15,-0.6 -1.51,0.53 -2.79,-0.61 -3.57,0.09 -0.06,-9.9 0.96,0.04 1.32,-0.58 2.28,-0.6 2.84,0.87 19.03,0.06 -0.46,-0.66 -0.79,-0.14 -0.38,-1.2 0.95,-1.93 1.43,0.4 0.61,1.52 0.87,1.32 0.66,0.35 0.83,0.01 1.61,-0.61 1.94,-2.09 0.32,-0.84 1.259996,-1.24 2.55,-1.39 1.29,0.46 1.17,2.58 1.62,1.99 0.74,1.3 0.66,1.78 0.23,1.55 -0.49,3.63 0.2,1.76 3.2,-0.75 8.31,7.06 0.79,0.28 2.5,0.21 2.3,-1 1.7,-1.7 2.11,-1.16 2.19,-0.11 0.56,0.29 0.77,1.08 -0.02,0.97 -1.11,1.7 0.37,0.98 0.58,0.27 1.33,-0.72 0.56,-0.91 0.23,-1.29 1,-1.16 0.47,-0.23 1,0.18 0.55,-0.18 0.41,-0.66 0.46,-2.31 0.51,-0.37 1.51,-0.36 2.93,-1.77 0.97,0.55 0.93,-0.29 1.6,-1.04 1.02,-1.61 2.11,-1.21 2.03,0.55 2.36,-1.65 0.55,-0.82 0.44,-2.66 -0.03,-1.29 0.77,-0.92 1.03,-0.42 1.74,-0.02 1.34,-0.39 2.06,-1.6 0.96,-0.37 2.28,-0.3 z' },
  { uf: 'BA', nome: 'Bahia', path: 'm 527.76257,365.59114 -0.36,-0.83 0.68,-1.35 -0.01,-0.53 -0.53,-1.04 -4.13,-3.05 -0.15,-0.51 0.22,-1.51 -0.57,-1.23 -0.65,0.24 -0.2,0.45 -0.34,0.18 -0.22,-0.25 0.53,-4.4 0.82,-3.3 0.82,-0.88 2.47,0.24 1.02,-0.71 0,-0.42 -0.56,-1.02 0.16,-2.65 4.96,-4.22 1.47,-3.08 -0.42,-1.17 -0.78,-1.02 -0.89,-0.06 -0.73,-0.38 -2.83,-2.47 -2.12,0.02 -2.19,-0.6 -2.27,-1.08 -2.73,-0.56 -1.98,-0.14 -1.32,0.99 -1.47,0.5 -2.61,-0.45 -0.57,0.21 -0.44,-3.96 -6.52,-6.2 -0.38,-0.18 -4.39,1.23 -1.53,-1.24 -0.51,0.21 -0.93,-0.22 -2.54,-1.22 -2.17,-1.62 -0.98,0.18 -4.35,-3.63 -1.1,-0.54 -2.73,-0.75 -1.77,0.25 -1.88,0.9 -0.81,1.12 -0.64,0.18 -5.33,-1.47 -0.61,-0.49 -0.26,-1.5 0.14,-0.89 1.29,-2.74 -0.86,-0.46 -2.28,-0.52 -2.18,-0.04 -1.2,-0.5 -1.79,-0.08 -3.83,1.58 -4.26,3.03 -0.64,1.11 -3.37,1.87 -2.02,0.4 -0.95,1.18 -1.81,1.55 -1.43,0.52 -1,-0.15 -1.85,2.58 -1.04,0.77 -2.13,-0.38 -0.72,0.13 -0.69,1 -1.34,0.92 -0.4,-0.24 1.43,-3.43 -0.51,-2.41 0,0 1.48,-1.97 0.25,-0.77 -0.23,-1.27 -0.67,-1.72 0.1,-0.67 0.71,-1.42 -0.05,-0.46 -3.21,-2.62 -1.69,-3.46 -0.62,-3.52 0.05,-1.55 1.2,-3.83 1.59,-1.03 0.23,-0.38 0.06,-0.94 -1.63,-0.84 -0.11,-0.33 0.48,-2.52 1.43,-1.06 -0.02,-0.37 -2.72,-2.46 0,0 -0.04,-0.93 1.36,-2.38 -0.04,-1.07 -0.17,-0.42 -1.46,-0.49 -0.94,-0.65 -0.35,-1.26 0.06,-2.92 0.19,-0.85 1.95,-1.67 1.14,-0.42 0.96,-0.72 -0.29,-0.63 -0.58,-0.52 -0.92,-0.29 -1.03,0.18 -0.35,-0.33 -0.09,-0.5 0.42,-0.96 2.04,-0.82 0.56,-0.45 -0.04,-0.76 -1.88,-0.98 -3.58,-0.67 -1.86,-1.96 -0.23,-0.92 0.5,-1.16 1.01,-0.73 1.52,-3.48 0.9,-0.61 1.01,-0.27 0.35,-0.38 -1.29,-1.8 0.19,-0.37 3.21,-2.62 3.82,-2.02 0.56,-0.47 0.22,-0.98 0.69,-0.65 0,0 2.33,-0.02 1.44,1.34 0.66,1.04 0.53,2.21 1.76,2.49 4.18,1.86 1.8,-0.52 2.11,0.18 0.33,-0.21 0.75,-1.45 1.14,-0.37 0.67,-0.87 1.17,-0.89 2.21,-0.75 1.33,0.17 1.48,0.53 1.35,-0.42 2.97,-2.42 2.95,-5.05 0.72,-0.86 0.24,-0.92 0.3,-2.56 -0.12,-1.16 -2.24,-4.43 0.05,-0.93 3.24,-1.65 1.95,-0.02 1.5,0.46 0.41,0.93 0.32,0.18 2.12,-0.43 1.39,-0.54 1.33,0.38 1.71,0.99 -0.13,0.65 0.19,0.29 0.82,0.28 3,-0.11 1.47,-0.64 1.7,-0.1 0.82,-1.22 1.51,-1.34 2.73,-0.34 0.77,-0.36 0.81,-0.98 2.17,0.01 0.62,0.63 0.31,0.05 1.86,-1.81 -0.1,-2.4 1.99,-0.38 0.79,0.18 1.05,-0.66 1.5,-2.31 0.46,-1.15 0,0 0.89,0.4 1.16,-0.27 2.2,0.29 2.82,1.39 0.44,0.51 -0.06,2.73 0.72,1.94 2.21,0.91 0.27,2 -0.92,1.68 1.83,0.62 0.96,-0.22 0.82,-0.92 2.87,-0.88 0.77,-3.58 0.5,-0.87 0.75,-0.16 0.78,0.53 0.63,0.05 2.39,-1.02 1.1,-1.24 0.17,-0.59 -0.25,-1.36 0.29,-0.25 2.24,-0.45 0.77,-2.05 1.65,-0.44 2.53,-1.46 0.59,-0.1 1.49,0.56 0.83,1.44 1.36,0.81 2.36,0.78 2.99,0.4 1.58,1.15 0.54,1.65 0.39,0.27 0.43,-0.15 0.29,-1.75 0.43,-0.44 1,-0.01 0.45,0.32 0.02,0.63 -0.62,0.88 0.45,0.83 0.5,0.37 2.1,0.86 0.02,0.94 1.22,3.05 0,0 0.54,1.4 1.02,0.29 0.45,-0.09 1.43,0.79 0.2,0.72 0,0 -0.67,1.16 0.21,2.14 1.28,2.5 1.99,1.95 0.75,1.15 -0.08,3.12 -0.66,1.62 -0.09,0.88 0.76,2.75 -0.3,0.58 -0.69,0.55 -2.55,1 -1.13,-0.75 -1.71,-0.01 -0.32,0.3 -0.59,1.58 0.02,0.77 0.95,1.6 1.1,0.66 0.52,1.49 1.43,1.51 0.15,0.39 -0.13,1.42 -0.34,0.39 0.12,0.42 0.59,0.52 1.93,0.92 0.48,0.71 0.54,0.34 1.55,0.64 2.89,-0.88 0,0 0.64,-0.02 0.36,0.41 -4.08,8.83 -3.83,5.19 -1.03,2.33 -5.03,5.74 -2.45,1.26 -0.87,-0.01 0.3,-1.43 0.37,-0.15 0.14,-1.1 -0.45,-1.93 -1.87,-0.25 -0.43,-1.3 -0.68,-0.75 -0.37,0.6 -0.46,2.33 -0.5,0.87 -0.55,0.38 -0.56,-0.29 -0.49,-1.74 0.11,-0.32 0.31,-0.13 -0.03,-0.39 -0.87,1.29 0.93,1.69 0.46,0.23 0.37,-0.15 1.15,0.26 -0.46,1.81 -1.21,1.15 -0.25,1.82 -1.25,0.97 -0.35,0.67 -0.2,0.84 0.18,0.85 -1.35,-0.39 -0.21,0.39 -0.36,2.52 0.36,-0.72 0.75,0.21 0.24,0.54 -0.23,0.41 0.06,0.62 0.3,0.3 0.33,1 -1.04,2.51 0.57,3.44 -0.55,0.49 -0.57,-0.22 -0.14,1.13 0.59,0.46 1.21,-1.72 -0.47,-2.21 0.82,-0.61 0.25,0.54 -0.06,1.76 -0.96,2.61 -0.74,5.43 -0.51,1.81 0.2,2.47 0.78,2.85 0.19,4.54 0.87,6.41 0.99,3.42 -2.21,6.66 -1.35,6.65 -0.47,1.01 -0.16,2.86 -1.06,3.72 -0.09,2.33 0.39,4.42 0.89,1.71 -2.24,2.98 -1.81,0.67 -0.94,0.64 -2.72,3.89 -0.57,2.04 0,0 -8.09,-5.14 -0.31,-0.53 z m 22.28,-78 -0.23,-1.2 0.74,-0.41 1.06,-1.04 0.16,-0.64 -0.37,-0.73 0.76,0.14 0.82,1.05 -0.05,0.53 -2.89,2.3 z m -2.53,6.85 -0.63,-0.03 0.01,-0.67 0.26,-0.36 -0.8,-0.22 -0.42,-0.4 0.13,-1.07 1.87,-0.15 0.16,0.2 0.11,1.13 -0.69,1.57 z' },
  { uf: 'CE', nome: 'Ceará', path: 'm 574.05257,157.11114 -4.89,1.59 -2.61,2.01 -3.3,6.69 -0.84,1.12 -0.87,0.57 -0.65,1.67 0.15,0.74 -1.4,2.44 -1.46,1.51 -0.57,1.1 -1.03,0.26 -0.78,-0.51 -0.51,0.07 -0.84,0.88 -1.41,2.25 -0.34,1.97 0.64,0.17 0.66,-0.38 0,0 -0.08,0.54 -0.84,1.15 -1.03,3 0.52,1.31 -0.66,1.31 -1.09,0.63 -0.17,0.38 -0.12,0.93 0.24,0.41 0.58,0.29 0.35,0.72 -0.02,1.66 1.24,0.89 0.69,0.08 0.34,1.19 -1.61,3.49 -1.19,1.12 0.17,0.25 0,0 -1.59,0.49 -1.07,0.83 -1.54,2.29 -1.65,0.05 -0.63,-1.64 -0.78,-0.57 -1.36,-0.48 -1.01,-1.07 -0.46,-0.99 -1.83,-0.83 -2.85,-1.9 -3.08,-0.42 -1.29,0.1 -2.14,0.8 -1.63,0.19 -0.89,-0.24 -4.93,-0.2 0,0 0.06,-1.32 -0.68,-0.68 -0.08,-0.97 1.14,-3.11 1.5,-2.25 0.01,-0.69 -0.77,-1.16 -2.56,-0.47 -1.31,-0.65 -1.01,-2.67 -1.05,-5.2 -0.76,-2.57 0.24,-0.45 -0.94,-8.16 -0.11,-0.38 -0.92,-0.69 0.8,-0.58 0.59,-1.58 -0.6,-2.99 -1,-2.01 0.48,-1.6 -0.79,-3.87 0.74,-1.36 0.02,-0.76 -1.36,-1.59 -0.44,-1.73 -3.15,-6.42 -1.8,-4.72 -0.29,-1.29 0.18,-1.46 1.58,-1.97 1.09,-1.85 0.11,-0.8 0,0 0.19,-0.14 -0.04,-0.62 -0.4,-0.66 0.65,-0.81 6.74,-0.22 2.89,-0.43 2.07,-0.66 7.4,0.79 2.12,1.12 1.94,1.5 4.12,2.18 1.46,0.52 4.82,3 1.21,0.2 2.22,2.29 2.99,2.11 2.57,0.72 2.44,2.91 1.22,0.61 2.96,3.81 4.16,3.08 1.46,2 1.04,0.99 1.5,0.82 1.15,0.03 2.37,0.92 0.79,0.67 z' },
  { uf: 'DF', nome: 'Distrito Federal', path: 'm 416.97257,334.13114 -14.69,-0.02 -0.52,-3.26 0.92,-1.83 0.38,-3.73 11.95,0.01 1.83,1.98 0.06,2.21 -0.59,1.19 -0.21,2.44 z' },
  { uf: 'ES', nome: 'Espírito Santo', path: 'm 501.89257,411.63114 -0.29,-0.14 0.44,-2.34 0.57,-1.3 -0.59,-3.12 0.16,-0.42 1.72,-2.06 5.15,0.03 0.55,-0.32 0.97,-3.24 1.11,-1.27 0.88,-2.29 0.24,-1.72 0.26,-0.44 1.24,-0.86 1.71,-2.09 0.54,-2.97 -0.29,-2.43 -1.27,-2.81 -1.1,-1.27 -0.52,-0.09 -0.45,0.29 -0.76,-0.28 -0.49,-0.71 0.43,-0.55 1.48,-0.09 0.8,0.35 0.97,0.03 0.95,-0.24 0.32,-0.42 -0.17,-1.72 -1.31,-0.35 -0.21,-0.41 0.3,-1.54 0.03,-1.92 -0.52,-0.66 -1.33,-0.67 -0.3,-0.7 1.17,-1.93 2.17,-1.31 0.31,-0.02 1.05,0.74 1.13,0.11 0.02,-0.81 -1.67,-2.27 1.34,0.13 2.18,-0.29 0.84,-0.61 1.08,-0.32 1.58,-0.08 2.54,0.81 0.91,0.55 0,0 0,0 0,0 0.3,0.53 8.1,5.14 0,0 -0.93,3.35 -0.31,2.86 0.12,3.59 0.72,6.15 -0.31,2.47 -1.49,3.18 -2.75,1.39 -0.55,0.6 -1.67,3.33 -0.98,3.8 -0.77,1.47 -0.83,-0.68 -0.88,-0.13 -0.29,1.28 1.35,0.52 -1.94,4.24 -3.45,3.84 -0.24,-0.27 -1.86,0.66 -0.8,1.23 -0.06,1.39 -0.42,1.25 -1.59,2.02 -0.29,1.13 0,0 -1.62,-1.06 -2.99,0.37 -4.34,-1.01 -2.5,-1.13 -0.67,-4.71 z' },
  { uf: 'GO', nome: 'Goiás', path: 'm 416.97257,334.13114 -0.87,-1.01 0.21,-2.44 0.59,-1.19 -0.06,-2.21 -1.83,-1.98 -11.95,-0.01 -0.38,3.73 -0.92,1.83 0.52,3.26 14.69,0.02 0,0 0,0 0,0 -0.53,1.52 0.31,1.57 -0.68,1.59 -1.04,1.25 -0.41,1.47 0.85,1.21 0.85,0.34 1.42,1.03 1.65,4.56 0,0.6 -2.32,2.71 -3.24,3.01 -0.43,2.14 1.09,1.11 0.9,-0.47 1.58,0.57 0.47,0.61 0.18,1 -0.17,0.71 -0.73,0.9 -0.51,1.89 1.19,3.46 -3.09,2.06 -1.16,0.2 -0.86,0.9 -0.48,1.12 -4.89,2.74 -0.7,-0.77 -4.35,-1.86 -0.55,0.48 -0.58,0.09 -1.75,0.01 -1.48,-0.28 -3.86,0.16 -2.01,-0.89 -4.13,2.64 -2.91,2.92 -0.33,0 -1.31,-1.42 -1.52,-0.3 -3.19,1.64 -3.71,-0.62 -2.48,0.96 -2.23,0.54 -1.41,2.1 -1.21,2.46 0.06,1 -0.84,1.3 -0.82,0.28 -0.84,-0.16 -0.45,0.14 -0.94,0.74 -1.64,2.1 -0.57,1.9 0.56,0.61 -0.01,0.34 -0.36,0.23 -0.86,-0.46 0,0 -0.24,-0.45 -2.66,-2.24 -3.15,-0.61 -1.62,-1.55 -1.9,-0.43 -1.49,-0.04 -3.35,-1.34 -0.68,-0.85 -3.07,-1.56 -0.67,-0.61 -1.44,-0.71 -1.14,-0.17 -2.7,-1.68 -2.78,0.16 -3.8,-0.7 -0.13,-0.33 0.26,-0.84 0.57,-1.17 1.31,-1.76 -0.08,-0.42 -2.25,-0.9 -1.14,0.67 -0.66,-0.19 -0.28,-0.41 -0.23,-1.11 0.26,-2.58 -0.19,-1.77 0,0 -0.95,-2.2 -0.18,-3.43 -1.41,-2.19 -0.16,-0.71 0.4,-3.41 2.55,-3.85 0.38,-2.91 0.7,-0.77 2.02,-0.84 1.92,-1.77 1.25,-2.02 0.33,-1.95 0.5,-1.01 1.28,-1.04 0.82,-1.43 0.08,-1.54 1.75,-0.97 1.4,-2.62 2.65,-0.13 2.72,-0.86 0.32,-0.28 1.98,-4.19 0.71,-0.96 0.64,-4.1 0.38,-0.74 1.92,-1.94 1.65,-1.01 1.07,-0.26 1.23,0.68 1.21,-0.73 1.39,-1.43 0.84,-2.93 1.17,-2.87 -0.01,-0.8 -0.48,-1.14 0.58,-2.74 1.6,-3.09 -0.12,-5.18 1.21,-0.78 1.03,-2.63 2,-3.17 0.39,-1.07 -0.16,-2.72 0.35,-0.9 0.97,-0.86 0.27,-1.13 -0.08,-0.63 0,0 0.34,-0.45 0.2,-1.88 0.66,-1.23 1.81,-2.09 0.56,-0.3 -0.03,1.71 -1.22,1.88 -0.52,2.34 2.4,0.4 2.2,1.03 3.93,0.4 3.09,1.71 4.07,1.43 0.63,-0.23 1.63,-5.94 1.47,-2.39 1.18,-0.97 1.15,1.31 1.04,1.88 1.11,3.71 0.61,3.1 1.14,0.05 0.75,-0.75 0.3,-1 0.56,-0.54 2.76,0.34 4.53,-0.53 0.22,0.74 -0.56,1.56 3.13,1.47 3.35,0.68 0.69,-0.08 0.51,-3.3 0.55,0.03 1.51,2.62 0.46,0.24 1.78,-0.9 2.52,-2.08 4.53,-1 1.55,0 2.56,-1.1 1.74,-1.34 5.36,-1.42 0,0 2.72,2.46 0.02,0.38 -1.43,1.06 -0.48,2.52 0.1,0.33 1.63,0.84 -0.06,0.94 -0.23,0.38 -1.59,1.03 -1.19,3.83 -0.05,1.55 0.62,3.52 1.7,3.46 3.21,2.62 0.05,0.47 -0.72,1.42 -0.1,0.67 0.67,1.72 0.23,1.28 -0.25,0.77 -1.48,1.97 0,0 -1,1.01 -3.23,-0.34 -0.9,-1.76 -2.42,-1.48 -1.17,1.49 0.58,3.77 -0.57,0.54 -0.4,0.13 -2.78,-1.14 -1.17,0.23 -0.37,0.28 -0.72,3.18 0.72,0.1 0.49,1.16 -0.57,0.94 -0.73,0.7 0.04,1.9 0.42,0.61 0.53,0.19 0.69,4.26 -0.53,0.53 -3.36,0.9 -2.29,1.51 z' },
  { uf: 'MA', nome: 'Maranhão', path: 'm 458.83257,129.18114 -0.04,0.33 -2.04,2.15 -0.43,0.17 -0.04,1.44 1.97,-1.7 0.68,-1.21 2.12,-1.58 0.89,-1.14 1.03,-6.33 1.15,-0.7 1.11,-0.12 1.67,-0.92 0.65,-0.13 0.46,0.12 0.08,1.63 -0.2,0.45 -1.42,1.87 -3.21,1.75 -0.03,0.72 0.73,0.12 0.45,-0.81 1.15,-0.31 0.22,0.83 -0.59,0.51 0.25,0.3 4.21,-4.97 0.86,0.33 2.58,-0.93 4.04,0.43 -0.46,-2.41 0.61,-0.23 2.42,0.08 1.78,0.38 2.63,1.05 1.04,0.11 2.15,1.38 1.4,0.03 1.26,1.3 1.89,1.32 2.5,0.58 1.16,-0.19 0.56,0.76 0.34,0.05 1.59,-0.09 2.46,0.66 0.26,-0.9 -0.67,-0.47 1.67,-0.38 0.57,0.11 -0.09,0.42 0,0 -0.46,1.43 0.23,0.72 0.63,0.54 -0.38,1.53 -1.79,2.27 -4.13,3.97 -3.32,0.46 -0.8,-0.16 -2.92,3.4 0.04,1.8 -0.88,1.83 -1.89,1.85 -0.82,1.98 -0.64,0.17 -0.77,1.05 0.36,1.92 1.23,0.83 0.38,1.28 -0.28,1.46 -1.14,2.87 1.58,2.81 0.55,2.98 -0.11,2.43 -0.21,0.55 -4.1,4.42 -0.17,2.48 0.12,2.11 0.51,2.3 1.78,2.04 1.61,0.91 0.17,0.5 0.13,0.84 -0.39,2.2 -0.29,0.44 -0.12,1.21 -0.5,1.46 -1.21,1.31 -2.29,0.29 -0.65,-0.28 -0.83,0.04 -2.43,0.86 -1.52,0.11 -2.5,-1.82 -1.01,-0.21 -1.46,0.19 -1.01,0.6 -1.12,0.26 -0.23,-0.3 -0.84,0.24 -0.5,0.22 -1.9,1.91 0.01,0.46 -0.63,0.87 -2.01,2 -2.34,0.91 -2.87,2.56 -1.33,0.53 -1.05,0.04 -1.7,1.53 -1.08,0.36 -2.61,0.32 -2.72,0.76 -2.13,1.95 -0.98,2.97 -0.39,2.97 -0.63,2.32 -1.45,2.74 -0.3,0.22 -0.34,0.82 -0.13,1.52 -1.2,2.48 -1.7,1.4 -0.73,2 0.71,1.94 0.47,3.18 1.73,3.06 -0.04,0.52 -0.76,1.4 -0.13,6.36 -1.15,2.45 -0.26,1.06 -0.05,1.92 0,0 -1.28,-0.66 -0.61,-0.82 -0.82,-0.45 -0.99,-0.29 -1.78,0.2 -0.71,-0.18 -1.35,-2 -0.99,-2.86 -2.13,-1.62 -0.14,-1.65 1.64,-1.81 -0.08,-0.53 -3.88,-1.95 -0.62,-1.05 -0.06,-1.66 -0.75,-1.59 -0.94,-0.69 -2.08,-0.28 -0.2,-0.42 0.26,-0.71 2.63,-2.54 -0.37,-1.31 0.73,-2.68 0.69,-1.43 0.57,-0.55 1.34,-0.54 3.39,-0.35 -0.39,-1.35 0.64,-3.25 -0.08,-1.76 -1.8,-1.21 -4.27,0.94 -2.15,1.34 -2.27,-3.02 -0.91,-0.85 -3,-4.15 -0.88,0.07 -0.84,-1.44 0.61,-1.19 -0.11,-0.88 -0.25,-0.34 -1.37,-0.24 -0.42,0.27 -1.93,-1.33 0.18,-0.71 1.76,-0.66 1.75,-2.04 0.25,-1.59 -0.28,-1 0.31,-2.36 1.77,-6.16 0.01,-0.43 -0.68,-1.14 -0.23,-1.08 0.21,-3.72 -0.64,-1.5 -0.47,-3.49 -0.84,-1.03 -3.4,-1.44 -1.22,-0.02 -0.28,-0.32 -0.08,-1.03 -0.59,-0.69 -1.74,-0.29 -0.96,0.52 -1.4,-0.09 -2.78,-1.51 -0.86,-0.06 -1.96,0.53 -2.62,1.85 -0.53,0.64 0,0 -0.49,-0.08 14.71,-11.83 2.35,0.23 1.17,-0.92 1.55,-2.17 0.43,-1.15 1.55,-1.17 0.62,-2.88 1.12,-0.46 2.44,-2.32 0.47,-1.21 0.29,-1.9 1.6,-4.69 1.96,-1.54 1.48,-1.76 0.83,-1.45 0.46,-1.28 -0.18,-1.82 0.79,-0.81 -1.04,-1.58 3.68,-3.09 -0.13,-1.64 0.5,-2.38 1.74,-1.57 0.36,-0.71 0.9,-3.02 0.08,-1.61 -0.43,-0.53 -0.99,0.16 -0.27,-0.49 0.05,-0.62 1.14,-0.15 0.57,-0.74 0.71,-4.39 -0.16,-1.38 0.47,-1.03 0.77,-0.45 0,0 0.63,0 0.24,-0.24 -0.06,-0.54 0.34,-0.749996 0.58,-0.53 1.34,0.98 0.45,1.839996 1.19,0.12 0.77,-1.36 0.61,2.93 0.99,0.04 0.29,-0.49 0.07,-0.94 0.85,-0.04 1.69,0.53 0.5,0.69 -1.43,1.7 0.67,0.7 0.02,0.55 1.21,-2.04 0.49,-1.54 0.45,0 0.4,1.02 0,0.58 -0.87,0.92 -0.27,0.99 0.08,2.71 0.26,0.33 0.47,0.12 0.58,-0.14 0.96,-0.93 -0.47,-1 0.14,-0.6 1.32,-1.43 1.05,-0.25 2.13,0.59 1.5,-1.11 0.05,0.92 -0.36,0.21 -1.13,1.53 0.59,0.58 0.1,-0.37 1.25,-0.6 0.58,0.79 -0.14,1.21 1.63,1.75 0.86,-0.44 1.58,0.67 0.77,2.4 -0.11,0.95 -2.19,2.73 -0.38,0.89 0.1,0.66 0.6,-1.03 1.75,-1.68 0.83,-0.03 0.87,0.81 0.52,1.89 -0.27,1.23 -0.97,0.19 -1.03,0.91 -1.16,1.49 0.07,0.77 -1.16,2.35 -0.62,3.52 0.21,0.34 0.87,0.23 z m 0.52,0.45 -0.06,-0.79 0.53,-1.53 -0.41,-1.07 0.13,-0.66 0.91,-1.24 0.55,-0.19 0.05,2.35 -0.22,1.34 -0.8,0.6 -0.68,1.19 z m -6.3,-25.76 -0.44,-0.46 -0.08,-0.6 0.8,-1.12 0.84,-0.03 0.68,0.42 0.1,0.34 -0.19,0.36 -1.71,1.09 z m 3.5,4.18 -0.29,-0.3 0.06,-0.53 1.06,-0.89 0.48,0.07 0.5,0.85 -0.14,0.61 -0.4,-0.17 -1.27,0.36 z m -14.16,-4.81 -0.21,-0.05 0.95,-3.579996 0.3,0.09 0.03,0.23 -0.41,3.059996 -0.66,0.25 z' },
  { uf: 'MT', nome: 'Mato Grosso', path: 'm 207.22257,296.31114 1.47,-1.43 4.11,-2.57 0.52,-2.45 1.43,-3.78 0.93,-1.08 1.64,-0.53 0.43,-0.41 0.58,-0.84 0.52,-2.25 1.66,-2.01 0.56,-2.24 0.07,-1.71 -0.58,-1.49 0.04,-2.05 -1.53,-3.34 -0.9,0.03 -0.58,-0.51 -0.43,-3.25 0.14,-1.32 1.36,-1.08 1.4,-1.75 0.17,-0.75 -1.41,-3.59 -1.07,-0.43 -1.11,-0.11 -3.5,0.09 -1.22,-1.11 0.24,-0.56 -17.16,-0.05 0.9,-9 -1.5,-2.75 -0.27,-1.76 0.03,-0.8 1,-3.52 -0.38,-1.93 0.94,-1.67 -0.83,-2.27 -0.15,-1.39 -0.26,-0.61 -0.78,-0.47 -0.06,-0.35 1.29,-4.99 0.76,-1.42 -0.6,-1.24 -1.4,-0.97 0,0 47.85,-0.32 1.21,-0.73 1.18,-5.22 1.38,-4.22 -0.46,-1.94 -0.66,-1.37 -0.1,-0.85 0.42,-0.85 0.86,-0.64 1.2,-1.82 0.27,-1.01 -0.34,-0.84 0.06,-0.76 0.2,-0.61 1.18,-1.2 0,0 1.17,1.08 2.45,4.06 0.4,1.76 1.37,3.96 1.32,1.93 0.77,1.62 -0.23,2.44 0.48,2.4 0.73,2.2 1.53,1.11 3,2.75 3.38,1.7 0.23,0.94 -0.04,1.1 0.23,0.49 0.95,0.4 0.82,-0.17 1.63,0.45 0.54,0.72 0.2,1.08 0.35,0.32 1.37,-0.45 3.69,1.49 34.04,2.42 62.97,3.48 0,0 -0.65,1.02 -0.56,1.89 -1.1,1.25 -0.44,3.14 -0.43,0.85 -0.37,0.27 -1.94,5.29 -0.54,2.97 -0.04,2.95 -1.88,5.99 0.06,0.86 1.39,1.34 -0.16,0.87 -0.82,0.89 -0.05,0.5 1.1,2.25 -0.47,3.31 0.01,1.57 0.52,0.58 0.44,3.05 -0.74,2.76 0.98,3.34 0.96,0.51 0.8,0.02 0,0 0.08,0.63 -0.27,1.13 -0.97,0.86 -0.35,0.9 0.16,2.72 -0.39,1.07 -2,3.17 -1.03,2.63 -1.21,0.78 0.12,5.18 -1.6,3.09 -0.58,2.74 0.48,1.14 0.01,0.8 -1.17,2.87 -0.84,2.93 -1.39,1.43 -1.21,0.73 -1.23,-0.68 -1.07,0.26 -1.65,1.01 -1.92,1.94 -0.38,0.74 -0.64,4.1 -0.71,0.96 -1.98,4.19 -0.32,0.28 -2.72,0.86 -2.65,0.13 -1.4,2.62 -1.75,0.97 -0.08,1.54 -0.82,1.43 -1.28,1.04 -0.5,1.01 -0.33,1.95 -1.25,2.02 -1.92,1.77 -2.02,0.84 -0.7,0.77 -0.38,2.91 -2.55,3.85 -0.4,3.41 0.16,0.71 1.41,2.19 0.18,3.43 0.95,2.2 0,0 -1.55,0.31 -1.17,-0.57 -0.87,-0.08 -2.66,0.08 -0.57,0.57 -4.62,-0.27 -1.74,-1.27 -1.3,-0.11 -0.15,-0.53 0.19,-0.46 1.66,-2.83 1.8,-0.7 1.23,-6.61 -1.34,0.13 -5.62,6.01 -1.01,-0.06 -2.13,0.88 -0.99,-0.04 -0.24,-0.25 -0.3,-1.37 -1.59,-1.04 -2.44,-0.07 -1.43,0.61 -0.49,0.85 -1.26,0.8 -4.52,0.63 -1.24,-0.57 -1.26,-1.11 -3.03,-1.16 -0.78,-1.02 -0.27,-0.86 -0.65,-0.35 -2.62,-0.47 -2.79,-1.25 -0.76,-1.15 -1.27,-0.2 -2.02,0.49 -1.35,1.25 -1.66,0.51 -0.77,-0.34 -1.56,0.22 -2.59,-0.03 -1.4,1.45 -0.09,1.17 -2.02,2.95 -2.05,2 -5.62,1.97 -2.15,-1.52 -1.02,-1.1 -0.7,-0.2 0,0 -0.66,-0.67 -0.32,-0.8 0.54,-0.71 -2.44,-2.15 -1.28,0.63 -0.52,-0.05 -1.17,-0.68 -0.45,-0.7 -2.02,-1.41 -1.89,-0.76 -0.3,-0.32 -0.3,-1.12 -0.23,-2.93 -0.61,-1.77 -0.19,-3.66 0.88,-1.64 1.14,-1.09 0.34,-1.78 -0.05,-1.89 -0.96,0.06 -0.4,0.6 -0.38,0.16 -26.86,-1.08 -1.05,-12.65 -5.37,-6.13 4.88,-0.06 -0.35,-7.55 -2.64,-5.32 -0.49,-1.97 0.26,-1.06 0.61,-0.55 0.65,-1.28 -1.44,-2.93 -3.11,-1.04 z' },
  { uf: 'MS', nome: 'Mato Grosso do Sul', path: 'm 359.21257,400.07114 -0.4,2.46 -0.28,0.4 -1.5,0.78 -1.32,0.04 -0.47,0.22 -1.22,1.03 -1.99,2.68 -0.73,0.65 -1.01,0.3 -0.62,1.68 -0.16,2.93 -2.59,3.64 -0.96,0.52 -0.23,0.38 0.31,1.93 -0.08,0.95 -1.21,2.34 -2,2.26 0.35,0.85 -0.28,1.21 -1.44,1.03 -0.4,1.21 -1.73,1.69 -1.26,2.44 -1.95,1.87 -7.56,4.53 -1.26,1.14 -0.74,1.54 -0.84,1.08 0,0 -5.41,2.27 -1.11,0.82 -0.93,2.33 0.02,1.15 -1.45,3.56 -0.67,0.68 -1.66,1.01 -1.11,0.32 -0.33,0.35 -1.57,7.92 -0.36,0.82 -2.38,1.56 0,0 -2.55,-2.33 -3.41,-1.89 -3.99,1.97 -0.68,0.75 -1.66,0.49 -2.58,0.43 -2.36,-0.46 -1.01,-0.65 -0.47,-4.27 -0.32,-0.7 -0.9,-0.95 -0.23,-2.47 0.51,-1.34 -0.64,-0.79 -0.09,-0.44 0,-2.87 -0.89,-1.97 -0.6,-2.74 -0.05,-0.72 0.59,-1.36 0.02,-1.61 -1.57,-1.09 -0.38,-0.8 -0.16,-2.16 -1.65,-1.82 -2.17,-0.26 -1.51,0.31 -1.83,-0.29 -2.46,-1.96 -0.56,-1.49 -1.54,0.33 -2.17,2.74 -1,-0.6 -1.72,0.81 -1.08,0.16 -1.74,-0.69 -2.56,-0.49 -3.46,0.23 -3.66,-0.71 -0.48,-0.91 -1.99,-0.13 -0.89,0.52 -2.5,-0.88 0.91,-7.27 -0.43,-2.38 0.6,-1.42 0.98,-1.46 0.6,-6.03 -0.66,-2.33 -0.05,-1.73 -0.76,-0.96 -0.43,-0.09 -0.49,0.65 -0.64,-3.26 -0.79,-1.87 -1.21,-2.02 -0.35,-1.83 4.03,-2.3 0.76,-0.88 -4.2,-3.86 5.38,-11.42 1.12,-0.06 -0.28,-2.13 -0.74,-0.13 3.23,-10.33 0.66,-1.16 -3.09,-5.85 0.03,-1.91 0,0 0.7,0.2 1.02,1.1 2.15,1.52 5.62,-1.97 2.05,-2 2.02,-2.95 0.09,-1.17 1.4,-1.45 2.59,0.03 1.56,-0.22 0.77,0.34 1.66,-0.51 1.35,-1.25 2.02,-0.49 1.27,0.2 0.76,1.15 2.79,1.25 2.62,0.47 0.65,0.35 0.27,0.86 0.78,1.02 3.03,1.16 1.26,1.11 1.24,0.57 4.52,-0.63 1.26,-0.8 0.49,-0.85 1.43,-0.61 2.44,0.07 1.59,1.04 0.3,1.37 0.24,0.25 0.99,0.04 2.13,-0.88 1.01,0.06 5.62,-6.01 1.34,-0.13 -1.23,6.61 -1.8,0.7 -1.66,2.83 -0.19,0.46 0.15,0.53 1.3,0.11 1.74,1.27 4.62,0.27 0.57,-0.57 2.66,-0.08 0.87,0.08 1.17,0.57 1.55,-0.31 0,0 0.19,1.77 -0.26,2.58 0.23,1.11 0.28,0.41 0.66,0.19 1.14,-0.67 2.25,0.9 0.08,0.42 -1.31,1.76 -0.57,1.17 -0.26,0.84 0.13,0.33 3.8,0.7 2.78,-0.16 2.7,1.68 1.14,0.17 1.44,0.71 0.67,0.61 3.07,1.56 0.68,0.85 3.35,1.34 1.49,0.04 1.9,0.43 1.62,1.55 3.15,0.61 2.66,2.24 0.24,0.45 0,0 -0.58,0.25 -0.99,4.18 0.59,3.21 z' },
  { uf: 'MG', nome: 'Minas Gerais', path: 'm 527.76257,365.59114 -0.91,-0.55 -2.54,-0.81 -1.58,0.08 -1.08,0.32 -0.84,0.61 -2.18,0.29 -1.34,-0.13 1.67,2.27 -0.02,0.81 -1.13,-0.11 -1.05,-0.74 -0.31,0.02 -2.17,1.31 -1.17,1.93 0.3,0.7 1.33,0.67 0.52,0.66 -0.03,1.92 -0.3,1.54 0.21,0.41 1.31,0.35 0.17,1.72 -0.32,0.42 -0.95,0.24 -0.97,-0.03 -0.8,-0.35 -1.48,0.09 -0.43,0.55 0.49,0.71 0.76,0.28 0.45,-0.29 0.52,0.09 1.1,1.27 1.27,2.81 0.29,2.43 -0.54,2.97 -1.71,2.09 -1.24,0.86 -0.26,0.44 -0.24,1.72 -0.88,2.29 -1.11,1.27 -0.97,3.24 -0.55,0.32 -5.15,-0.03 -1.72,2.06 -0.16,0.42 0.59,3.12 -0.57,1.3 -0.44,2.34 0.29,0.14 0,0 -2.53,2.35 -1.24,0.27 -0.56,0.5 0.74,0.7 -2.36,6.05 -1.9,3.71 -0.09,0.75 1.44,0.13 0.29,0.61 -0.21,0.52 -2.53,0.98 -9.51,4.53 -1.37,0.2 0.02,-0.46 -0.49,-0.17 -2.53,-0.27 -0.57,0.06 -1.62,0.94 -1.25,0.16 -3.2,0.08 -0.36,-0.32 -0.51,0.08 -4.1,1.78 -1.05,0.77 -1.71,0.77 -0.5,-0.28 -2.59,0.17 -2.91,1.34 -2.42,0.74 -0.68,0.49 0,0 -1.25,0.73 -2.2,0.22 -1.93,1.02 -1.23,1.24 -1.79,0.67 -2.38,0.25 -2.34,-0.08 -0.01,-0.49 0.35,-0.49 -0.09,-0.35 -1.19,0.33 -0.18,2.3 0.24,0.23 -0.05,0.84 -0.75,0.98 -1.3,0.32 -0.57,-0.43 -3.61,1 -0.19,-0.53 -2.01,0.24 -1.12,-0.25 -2.03,-3.31 1.22,-0.71 -0.52,-1.71 -1.8,-0.83 -1.79,-1.23 -0.71,-1.61 0.53,-1.56 0.19,-3.45 -0.26,-2.94 1.86,-2.72 0.7,-2.18 0.05,-1.27 -0.23,-0.37 -3.7,-1.32 -1,0.05 -0.28,0.36 -0.78,0.31 -1.61,0.05 0.03,-0.85 -0.83,-1.99 -1.3,-1.79 -0.37,-2.21 -0.31,-0.62 -0.79,-0.74 0.19,-1.94 1.52,-2.03 0.06,-0.56 -0.4,-1.55 -1.88,-1.21 -0.58,-0.61 0.29,-2.37 0.57,-1.01 -0.2,-1.04 -3.27,-3.35 -1.3,0.29 -0.85,0.64 -1.65,-0.78 -2.38,0.11 -0.31,0.61 0.2,0.46 -0.44,0.99 -2.78,0.68 -1.11,-0.43 -1.51,-1.45 -1.01,1.25 -8.18,0.68 -0.46,0.48 -0.48,1.19 0.27,2.54 -0.41,0.44 -1.19,-0.52 -0.01,-2.78 -0.25,-0.96 -0.36,-0.39 -0.56,-0.05 -0.26,0.19 -0.41,1.13 -0.67,0.94 -0.54,0.32 -0.62,-0.02 -1.21,-2.1 -0.33,-1.42 0.14,-0.91 -1.68,-0.79 -2.18,-1.42 -1.99,0.59 -1.62,-0.22 -1.67,0.35 -4.29,-0.96 -2.55,-0.08 -1.73,-1.55 -0.75,-0.14 -1.5,0.61 -1.43,1.69 -1.92,0.37 -2.15,1.11 -1.22,1.13 0,0 0.31,-2.62 -0.59,-3.21 0.99,-4.18 0.58,-0.25 0,0 0.86,0.46 0.36,-0.23 0.01,-0.34 -0.56,-0.61 0.57,-1.9 1.64,-2.1 0.94,-0.74 0.45,-0.14 0.84,0.16 0.82,-0.28 0.84,-1.3 -0.06,-1 1.21,-2.46 1.41,-2.1 2.23,-0.54 2.48,-0.96 3.71,0.62 3.19,-1.64 1.52,0.3 1.31,1.42 0.33,0 2.91,-2.92 4.13,-2.64 2.01,0.89 3.86,-0.16 1.48,0.28 1.75,-0.01 0.58,-0.09 0.55,-0.48 4.35,1.86 0.7,0.77 4.89,-2.74 0.48,-1.12 0.86,-0.9 1.16,-0.2 3.09,-2.06 -1.19,-3.46 0.51,-1.89 0.73,-0.9 0.17,-0.71 -0.18,-1 -0.47,-0.61 -1.58,-0.57 -0.9,0.47 -1.09,-1.11 0.43,-2.14 3.24,-3.01 2.32,-2.71 0,-0.6 -1.65,-4.56 -1.42,-1.03 -0.85,-0.34 -0.85,-1.21 0.41,-1.47 1.04,-1.25 0.68,-1.59 -0.31,-1.57 0.53,-1.52 1.27,-0.12 2.29,-1.51 3.36,-0.9 0.53,-0.53 -0.69,-4.26 -0.53,-0.19 -0.42,-0.61 -0.04,-1.9 0.73,-0.7 0.57,-0.94 -0.49,-1.16 -0.72,-0.1 0.72,-3.18 0.37,-0.28 1.17,-0.23 2.78,1.14 0.4,-0.13 0.57,-0.54 -0.58,-3.77 1.17,-1.49 2.42,1.48 0.9,1.76 3.23,0.34 1,-1.01 0,0 0.51,2.41 -1.43,3.44 0.4,0.23 1.34,-0.91 0.7,-1 0.72,-0.13 2.13,0.38 1.04,-0.77 1.85,-2.57 0.99,0.15 1.43,-0.53 1.81,-1.55 0.95,-1.17 2.02,-0.41 3.37,-1.86 0.64,-1.11 4.27,-3.03 3.82,-1.58 1.8,0.09 1.2,0.5 2.18,0.03 2.28,0.53 0.85,0.46 -1.29,2.74 -0.15,0.89 0.26,1.49 0.61,0.5 5.33,1.46 0.64,-0.17 0.81,-1.12 1.88,-0.89 1.77,-0.26 2.73,0.75 1.1,0.54 4.35,3.64 0.98,-0.18 2.17,1.62 2.53,1.22 0.93,0.22 0.51,-0.21 1.53,1.24 4.39,-1.23 0.38,0.18 6.52,6.2 0.44,3.96 0.57,-0.21 2.61,0.45 1.47,-0.5 1.32,-0.99 1.99,0.15 2.73,0.56 2.26,1.08 2.19,0.61 2.12,-0.03 2.83,2.47 0.73,0.38 0.89,0.07 0.78,1.02 0.42,1.17 -1.47,3.08 -4.96,4.22 -0.15,2.65 0.56,1.02 0,0.42 -1.02,0.71 -2.48,-0.24 -0.82,0.88 -0.82,3.3 -0.53,4.4 0.22,0.25 0.35,-0.19 0.2,-0.45 0.64,-0.24 0.58,1.23 -0.22,1.51 0.15,0.51 4.14,3.06 0.53,1.04 0.01,0.53 -0.68,1.35 z' },
  { uf: 'PA', nome: 'Pará', path: 'm 371.29257,235.50114 -62.97,-3.48 -34.04,-2.42 -3.69,-1.49 -1.37,0.45 -0.35,-0.31 -0.2,-1.09 -0.55,-0.72 -1.63,-0.45 -0.82,0.17 -0.95,-0.39 -0.23,-0.5 0.04,-1.1 -0.23,-0.94 -3.38,-1.7 -3,-2.76 -1.54,-1.11 -0.72,-2.2 -0.48,-2.39 0.23,-2.44 -0.77,-1.63 -1.33,-1.93 -1.37,-3.95 -0.39,-1.76 -2.45,-4.06 -1.18,-1.08 0,0 -0.57,-0.56 -0.15,-1.96 -0.64,-1.26 -1.59,-1.56 -1.07,-0.58 -0.37,-0.57 -0.83,-2.34 0.03,-1.13 0.58,-0.97 1.45,-1.13 0.78,-1.31 29.9,-64.24 -1.81,-1.67 0.13,-0.78 -0.19,-0.48 -1.39,0.35 -0.85,0.61 -1.87,-0.78 -1.1,-2.17 -2.69,-1.45 -1.27,-1.34 -0.08,-0.6 -1.32,-0.82 -1.37,-0.15 -2.25,-0.65 -2.38,-1.31 -1.88,-0.67 -1.35,-1.09 -0.63,-0.9 -4.58,-2.54 -4.64,-3.769996 -0.3,-0.44 -0.04,-0.93 -0.55,-1.83 -1.84,-1.23 -0.7,0.19 -0.36,-0.2 -1.83,-1.98 0.05,-2.11 0.35,-0.69 -0.18,-0.41 -1.69,-0.85 -0.24,-0.68 -0.18,-2.27 0.43,-1.45 -0.4,-4.86 0,0 -1.59,-16.97 0,0 0.75,0.32 0.43,0.58 -0.02,0.48 0.45,0.4 0.92,0.28 1.37,-0.71 0.47,-0.81 2.71,0.23 0.81,-1.05 -0.54,-1.81 1.79,-0.36 1.41,-1.63 2.64,1.01 1.88,0.03 0.54,-1.52 3.33,-1.62 1.97,0.39 1.16,-0.11 0.49,-0.25 1.2,-1.48 0.4,-1.4 1.46,-1.1 0.86,-0.11 0.65,0.46 2.11,-1.13 0.41,0.11 0.37,0.99 0.73,0.45 2.03,0.48 1.61,0.25 0.56,-0.6 1.67,-0.39 0.78,0.28 0.82,-0.01 0.86,-0.34 2.24,0.3 4.67,1.38 0.96,-0.14 1,-0.87 -0.03,-2.28 -2.07,-2.5 -1.24,-0.63 0.49,-1.68 1.31,-1.45 0.28,-1.11 0.31,-0.17 0.71,0.19 0.83,0.76 2.35,1.11 11.62,-2.33 1.57,1.69 1.02,0.06 0.44,-0.29 0,0 0.62,0.57 0.37,2.3 -0.62,1.3 -0.25,4.54 0.24,1.44 0.31,0.54 1.17,0.02 1.08,-0.29 3.39,0.37 1.29,0.49 1.93,1.05 0.67,0.8 0.49,1.28 1.19,0.12 1.14,0.84 0.8,0.98 0.84,0.27 1.33,-0.14 0.38,-0.42 0.94,-0.14 2.84,2.66 0.68,-0.03 0.49,1.18 -0.68,0.23 -0.19,0.72 0.76,2.83 2.02,2.26 2.57,0.73 0.17,0.33 -0.43,3.14 0.19,2.11 0.67,1.51 0.62,0.56 0.59,1.81 -0.13,1.58 1.5,3.48 0.82,0.19 0.78,-0.36 2.93,3.28 -0.08,2.43 0.41,0.94 0.95,0.19 0.33,0.47 0.31,1.58 -0.21,0.69 0.11,1.3 1.87,1.39 0.43,1.5 1.45,1.03 2.79,0.679996 1.3,-0.12 0.77,-0.339996 0.94,0.06 0,0 -0.53,0.739996 0.29,1.59 -0.17,0.53 -1.29,1.11 -1.39,0.17 -0.5,-0.18 -0.84,-0.79 -0.66,-0.15 -3.38,1.58 -0.37,0.54 -1.6,0.72 -0.63,-0.02 -1.55,0.59 0.04,0.58 6.46,-1.06 0.88,0.66 0.13,0.46 0,0.66 -0.62,0.5 0.3,0.36 0.63,-0.2 0.86,-1 1.02,-0.01 0.53,-0.27 0.6,0.12 1.07,-0.42 1.14,-0.57 3.28,-2.34 1.5,-0.35 1.84,-0.81 3.16,-1.84 0.54,-0.999996 0.67,-0.52 2.09,-1.01 0.66,-0.72 -0.25,-0.67 0.21,-0.41 1.13,-0.28 1.09,0.06 0.41,0.21 0.38,3.799996 -0.52,2.58 0.33,1.62 0.81,1.6 1.31,1.35 0.3,1.64 -0.12,0.47 -1.84,1.84 -0.47,0.13 -0.87,-0.52 -1.82,-0.52 -1.26,-0.31 -0.93,0.14 -2.13,-1.04 -0.26,-1.12 -0.88,-0.53 -2.28,3.82 -0.61,2.37 0.68,2.97 0.48,0.64 0.92,0.62 -1.01,-1.14 -0.43,-2.69 0.12,-0.52 2.57,-4.22 2.31,1.18 0.11,0.45 2.53,2.45 -0.25,2.02 -0.74,0.55 0.4,2.33 0.52,1.13 1.12,0.75 0.74,0.15 0.52,0.49 -0.34,-0.64 -0.77,-0.24 -1.2,-1.04 -0.22,-0.68 0.34,-4.2 0.82,-1.19 1.43,0.73 0.83,1.2 -0.09,0.79 1.2,0.86 0.25,-0.29 -1,-1.26 -0.92,-2.1 0,-0.44 2.26,-2.32 1.62,0.09 1.93,0.64 0.34,0.56 -0.61,0.59 0.32,0.28 0.48,0.03 1.03,-0.17 1.33,-0.9 4.09,-0.96 0.77,0.2 1.74,1.06 3.17,-0.42 1.07,-0.41 1.02,-1.01 0.98,-0.59 1.74,-0.51 0.77,0.07 0.06,0.75 -2.04,4.02 -0.24,1.5 -0.46,1.07 -0.83,1.03 -0.01,0.88 0.58,1.42 -0.32,2.47 0.88,-1.19 0.01,-1.4 1.54,-3 1.13,-3.19 1.12,-1.56 0.27,-0.27 0.76,-0.05 0.58,-0.35 1.82,-0.23 0.88,-1.35 1.51,-1.69 1.36,-2.26 0.52,-0.46 0.79,0.49 0.62,-0.46 1.62,2.34 1.19,0.59 -0.05,-0.74 -0.35,-0.75 0.62,-1.01 3.51,-0.51 -1.03,-0.32 -3.51,0.46 -0.31,-0.21 0.29,-2.43 0.51,-0.29 0.67,0.38 1.02,0.11 1.07,-3.099996 -0.68,-1.39 0.03,-0.68 1.17,-1.81 2.84,-2.48 0.36,-0.08 1.11,1.14 2.93,-2.09 0.46,-0.07 0.4,0.45 0.1,0.57 -0.32,0.67 1.07,-0.16 0.81,-0.58 0.36,-0.78 0.63,-0.19 0.28,0.15 0.74,1.39 1.33,1.2 0.2,-0.56 -0.11,-0.38 -0.96,-0.49 -0.14,-0.29 -0.13,-1.2 0.17,-0.42 0.44,-0.19 2.28,0.26 1.18,0.65 0.62,1.02 1.63,0.71 1.65,-0.78 0.53,2.14 -0.5,0.31 -0.03,0.59 0.92,-0.52 1.16,-2.35 0.38,0.23 -0.23,1.33 0.41,0.44 2.51,-0.26 0.45,0.65 0.46,1.68 -0.6,0.95 0.85,-0.5 0.26,0.37 1.89,0.14 3.53,-1.24 -0.31,1.58 -0.75,1.829996 1.47,-0.489996 0.59,-0.62 0.63,1.619996 0,0 -0.77,0.45 -0.47,1.03 0.16,1.38 -0.71,4.39 -0.57,0.74 -1.14,0.15 -0.05,0.62 0.27,0.49 0.99,-0.16 0.43,0.53 -0.08,1.61 -0.9,3.02 -0.36,0.71 -1.74,1.57 -0.5,2.38 0.13,1.64 -3.68,3.09 1.04,1.58 -0.79,0.81 0.18,1.82 -0.46,1.28 -0.83,1.45 -1.48,1.76 -1.96,1.54 -1.6,4.69 -0.29,1.9 -0.47,1.21 -2.44,2.32 -1.12,0.46 -0.62,2.88 -1.55,1.17 -0.43,1.15 -1.55,2.17 -1.17,0.92 -2.35,-0.23 -14.71,11.83 0.49,0.08 0,0 2.29,0.81 1.87,-0.24 1.29,0.12 1.02,1.66 0.39,0.31 0.87,0.14 1.26,1.17 -0.04,0.63 -0.37,0.67 -0.72,0.37 -0.97,0.07 -0.29,0.28 0.09,1.41 1.01,1.34 -0.92,2.75 -0.64,0.48 -1.46,0.46 -0.25,0.46 0.29,1.2 -0.19,1.34 -1.3,0.15 -1.51,1.34 -0.85,1.27 0.15,1.51 -0.24,0.5 -2.5,1.2 -3.41,1.14 -2.47,1.78 -0.19,0.35 0.43,2.19 0.06,2.67 -1.28,2.1 -1.41,1.68 -0.15,0.57 0.17,0.88 0.59,0.96 1.67,1.74 0.75,0.32 0.15,0.3 -0.66,4.04 -1.76,5.15 -1.08,0.81 -1.7,3.24 -0.18,0.99 -0.94,1.54 -0.74,0.85 -1.05,0.16 -1.37,0.92 -1.03,1.92 -1.21,1.68 -1.18,1.09 -1.15,1.58 -1.13,4.46 -1.6,3.66 z m 21.16,-130.31 -4.52,1.96 -3.39,0.52 -2.02,-0.31 -0.65,1.13 -1.84,1.19 -0.72,-0.61 -0.61,-1.53 -0.23,0.28 0.42,1.23 -0.34,0.81 -0.71,0.41 -3.77,-1.64 -0.8,0.72 -4.19,1.26 -3.2,-0.57 -0.81,-0.61 -0.24,-1.85 -0.23,-0.41 -1.11,-1.02 -1.06,-1.6 -0.21,-1.78 0.52,-2.75 0.62,-0.379996 1.76,0.359996 0.93,-0.749996 0.08,-0.56 -1.3,0.43 -1.22,-0.13 -0.94,-0.71 -0.18,-1.05 0.34,-5.08 0.73,-0.76 0.35,0.75 1.76,0.6 0.55,-0.06 -0.46,-0.42 -1.27,-0.22 -0.9,-2.16 0.36,-1.68 0.89,-1.97 1.33,-1.33 0.96,-0.57 1.34,-0.49 1.32,-0.13 3.46,0.52 7.21,1.77 3.7,-0.46 0.11,-0.3 1.14,-0.62 2.16,-0.37 2.89,0.29 2.8,0.82 6.48,0.85 0.63,0.47 -0.05,1.23 -0.7,0.74 -0.68,1.5 -0.36,2.65 -0.86,3.3 -1.29,0.68 -0.35,0.69 0.23,1.19 -1.98,2.579996 -1.39,3.5 -0.49,0.45 z m -47.21,-0.17 -0.75,-0.51 1.1,-2.25 -0.09,-1.79 0.25,-0.21 2.33,-0.479996 0.9,-0.86 0.15,-0.5 -0.2,-2.34 0.86,-2.58 1.26,-1.49 2.29,-1.47 2.87,-0.2 0.72,2.36 -1.1,2.19 -0.85,3.04 -1.1,0.67 -1.34,2.029996 -0.78,0.72 -4.94,3.31 -1.58,0.36 z m 28.48,-22.899996 -1.03,-0.25 -2.45,0.08 -0.79,-0.16 -0.29,-0.26 -0.38,-1.09 0.01,-1.24 1.51,-0.42 1.89,0.04 2.19,-1.29 4.81,-0.6 0.77,0.26 0.68,0.68 -0.18,1.02 -2.56,1.39 -1.78,2.48 -1.1,0.5 -1.3,-1.14 z m 4.79,0 1.86,-1.2 1.98,0.03 1.65,0.62 0.53,0.99 0.05,0.62 -0.88,0.77 -2.85,0.28 -1.17,0.32 -2.26,-0.89 -0.2,-0.53 1.29,-1.01 z m -16.98,4.39 -0.5,-0.26 -0.61,0.04 -1.54,-0.69 0.21,-1.16 0.64,-0.92 1.92,-0.4 2.36,-0.9 1.32,0.08 0.8,0.68 0.09,0.13 -1.93,1.61 -1.07,0.34 -1.69,1.45 z m 9.42,-9.69 -0.82,-0.3 -0.17,-1.66 0.15,-0.6 1.17,-1.31 2.45,-0.92 0.25,0.12 0.53,0.68 0.04,0.89 -1.95,1.99 -1.65,1.11 z m -13.83,20.22 -0.14,-0.41 0.19,-0.93 1.04,-2.81 2.59,-1.69 0.72,-0.28 0.69,0.14 -0.16,1.79 -1.56,0.44 -1.62,2.19 -1.75,1.56 z m 10.91,-17.57 -1.19,-0.31 -0.3,-0.48 0.88,-0.96 0.71,-3.95 0.89,-1.23 0.29,0.13 0.07,0.32 -0.02,2.48 0.6,1.87 -0.32,0.88 -1.03,0.4 -0.58,0.85 z m -14.81,10.19 -0.27,-0.19 0.12,-0.61 0.55,-0.36 1.19,-1.71 0.76,-1.54 0.73,-0.66 1.45,-0.54 -0.2,1.49 -0.4,1 -1.72,1.66 -2.21,1.46 z m 13.87,-7.03 -0.6,-0.15 -0.84,-0.71 -0.96,-1.64 -0.05,-0.38 0.23,-0.29 0.81,-0.58 1.85,0.84 0.29,0.43 0.24,2.09 -0.97,0.39 z m -5.38,30.559996 -0.65,-0.11 -0.88,-0.52 -0.69,0.46 -0.75,-0.28 -1.68,-1.74 0,-0.61 1.28,-0.01 3.06,1.32 0.31,1.49 z m -21.15,-5.54 0.04,-1.03 -0.2,-0.3 0.6,-0.99 2.36,-0.88 0.78,0.38 0.87,0.86 -0.29,0.35 -1.03,0.47 -2.54,0.41 -0.59,0.73 z m 12.7,-6.69 -0.18,-0.03 0.01,-0.35 0.54,-0.939996 1.79,-1.62 0.42,-1.24 0.05,-1.3 0.24,-0.3 0.32,0.44 0,1.51 -0.89,2.73 -0.62,0.649996 -1.68,0.45 z m 6.3,-9.899996 1.65,-2.96 0.88,-0.21 0.71,0.19 0.27,0.87 -0.58,0.71 -2.93,1.4 z m 31.42,18.969996 -0.84,-0.35 -0.34,-1.06 1.04,-1.72 1.07,-0.33 0.19,0.1 -0.02,0.74 -0.74,2.24 -0.36,0.38 z m -33.48,-19.469996 -0.54,-0.2 0.32,-2.04 1.33,-1.81 0.23,0.04 1.29,0.88 -0.01,0.25 -1.55,0.64 -1.07,2.24 z m 2.23,5.03 0.72,0.03 -0.4,0.45 -0.94,0.31 -0.11,1.12 -0.79,0.71 -1.69,0.84 -0.16,-0.18 0.27,-0.83 0.47,-0.63 1.73,-1.67 0.9,-0.15 z m -22.56,10.209996 -0.55,-0.19 -0.07,-0.35 0.43,-0.4 3.56,-1.6 0.54,0.7 -0.01,0.2 -1.4,0.73 -2.5,0.91 z m 63.53,-4.78 -1.03,-0.19 -0.82,-0.79 0.87,-1.249996 1.34,-0.01 0.19,1.19 -0.1,0.589996 -0.45,0.46 z m -37.25,-18.899996 -2.36,0.7 -0.59,0.01 -0.18,-0.21 1.03,-1.04 1.04,-0.51 1.04,0.17 0.44,0.34 0.15,0.23 -0.15,0.21 -0.42,0.1 z m -5.27,8.59 -0.08,-0.76 0.25,-0.5 2.48,-1.46 -0.9,2 -0.81,0.63 -0.94,0.09 z m 2.14,4.53 -0.45,-0.12 -0.07,-0.23 0.78,-1.5 1.19,0.02 -0.12,1.35 -1.33,0.48 z m 28.04,15.829996 -0.28,-0.23 0.9,-1.6 0.68,-0.4 0.23,0.75 0.51,0.37 -0.26,0.52 -0.43,0.34 -0.63,-0.18 -0.72,0.43 z m -26.66,-23.319996 -0.89,-0.07 0.02,-0.19 2.36,-1.84 0.04,0.96 -0.23,0.63 -0.25,0.34 -1.05,0.17 z m 67.46,10.22 -0.38,-0.53 0.19,-0.76 1.02,-0.91 0.25,0.15 0.23,1.75 -1.31,0.3 z' },
  { uf: 'PB', nome: 'Paraíba', path: 'm 610.69257,199.41114 -2.5,-2.06 -0.82,-0.26 -2.65,-0.21 -2.31,1.07 -1.48,1.28 -0.45,1.8 -1.9,1.03 -2.01,0.45 -1.14,-0.02 0,0.6 -0.8,0.53 -2.18,0.29 -3.88,-0.26 -1.61,0.88 -0.55,0.64 -1.82,0.1 -0.89,0.69 -0.54,0.76 0.39,0.73 0.01,0.54 -0.4,0.48 -1.78,1.53 -1.34,0.16 -1.65,0.84 -1.6,-0.79 -0.95,-0.94 -0.35,-2.24 0.24,-0.49 -0.18,-0.3 -1.14,-0.32 -0.44,0.29 -1.51,0.25 0.04,-0.45 2.53,-2.64 0.17,-0.43 -0.72,-1.87 -0.04,-0.47 0.37,-0.78 3,-1.07 0.11,-0.3 -0.5,-1.39 -3.5,-1.92 -1.48,0.41 -2.22,1.26 -0.93,1.51 -1.48,0.87 -1.05,0.31 -2.7,1.88 -1.52,1.64 -1.63,0.23 -2.63,0.97 -0.77,-0.33 0.05,-0.68 -0.63,-1.24 -0.38,-0.08 -0.93,0.73 -1.51,0.32 -0.99,-0.33 -1.4,-1.91 -0.4,-0.09 0,0 -0.17,-0.25 1.19,-1.12 1.61,-3.49 -0.34,-1.19 -0.69,-0.08 -1.24,-0.89 0.02,-1.66 -0.35,-0.72 -0.58,-0.29 -0.24,-0.41 0.12,-0.93 0.17,-0.38 1.09,-0.63 0.66,-1.31 -0.52,-1.31 1.03,-3 0.84,-1.15 0.08,-0.54 0,0 0.57,-0.46 1.93,1.64 0.9,0.42 2.88,0.61 1.16,-1.13 3.23,-1.66 0.82,-0.71 0.1,-1.04 0.41,-0.95 3.18,-1.21 1.43,-0.12 3.26,-1.04 0.64,0.08 0.53,0.44 0.01,1.19 -2.99,3.21 -0.44,0.96 -0.38,1.74 -0.41,0.38 -0.85,0.25 -0.21,0.31 -0.08,1.72 3.53,0.52 0.32,0.23 0.31,1.38 0.29,0.23 3.15,-1.26 1.77,-0.08 1.95,0.3 0.89,1.17 -0.52,1.54 0.83,0.74 2.35,-0.93 0.5,-0.74 0.55,-1.21 -0.47,-0.94 -0.16,-1.42 0.48,-0.59 1.01,0.32 -0.53,-1.53 -0.72,-0.78 0.31,-1.48 1.82,-1.35 1.38,-0.05 0.42,0.39 -0.1,1 0.62,0.49 3.42,0.4 0.53,0.35 5.83,-0.39 2.17,0.3 2.46,1.1 1.04,-0.4 3.5,0.21 0.93,-0.24 0,0 0.09,2.4 1.45,4.39 0.06,0.64 -0.18,0.94 -0.37,0.45 -0.03,0.88 0.58,-0.74 0.51,-1.5 0.01,1.98 0.59,1.01 -0.27,5.18 -0.36,0.6 z' },
  { uf: 'PR', nome: 'Paraná', path: 'm 397.01257,499.66114 -5.24,-0.03 -0.33,0.44 -1.74,0.24 -0.76,-0.07 -0.11,-0.39 -1.57,0.57 -1.35,1.43 -3.35,2.13 -1.44,-0.16 -1.23,-0.62 -3.13,-2.6 -1.03,-0.39 -0.76,-0.01 -2.84,0.73 -2.33,0.17 -0.81,-0.03 -1.42,-0.76 -1.11,0.14 -1.53,0.65 -0.59,1.47 -0.73,0.87 -1.87,0.98 -3.57,-0.41 -2,1.15 -0.72,0.77 -0.69,1.59 0.85,2.99 -0.87,0.86 -0.92,0.02 -0.75,0.38 -0.17,0.49 -1.33,-1.89 -4.25,0.13 -3.76,-0.43 -1.58,-1.18 -0.16,-0.41 -1.03,-0.63 -4.26,-0.36 -5.29,-1.68 -2.34,0.57 -2.69,-0.03 -2.02,-1.41 -0.32,-0.51 -1.06,-0.24 -0.53,-0.01 -0.71,0.37 -3.63,-0.02 0,0 -0.22,-1.21 -2.53,-4.18 0.02,-2.59 -0.99,-2.88 -3.42,-2.37 -1.09,1.13 -2.12,-0.11 -1.1,0.43 -1.07,0.9 -1.46,-1.08 -0.82,0.06 -0.28,-2.2 0.66,-1.57 1.07,-1.27 1.22,-2.18 0.06,-0.34 -0.49,-0.75 0.02,-1.24 0.9,-3.64 1.26,-3.02 -0.25,-2.3 1.28,-2.38 -0.21,-1.02 -0.84,-0.88 -0.31,-1.6 0.66,-1.06 0.79,-0.54 0,0 2.38,-1.56 0.36,-0.82 1.57,-7.92 0.33,-0.35 1.11,-0.32 1.66,-1.01 0.67,-0.68 1.45,-3.56 -0.02,-1.15 0.93,-2.33 1.11,-0.82 5.41,-2.27 0,0 3.26,-2.29 3.83,0.65 4.01,-0.11 3.27,0.29 1.21,-0.62 0.35,-0.6 0.73,-0.37 1.17,0.29 1.48,0.78 2.52,0.46 2.64,1.09 1.31,0.13 1.07,-0.54 2.58,-0.01 0.78,1 1.75,0.84 3.51,0.8 0.63,0.51 0.71,1.32 1.73,0.07 0.42,-0.34 1.65,0.15 0.66,0.54 5.31,0.13 2.97,-0.85 1.13,1.55 3.59,2.83 0.89,1.76 0.01,2.74 -0.39,0.58 -0.16,0.81 0.38,1.84 1.3,1.51 -0.08,1.76 -0.36,0.56 1.49,3 1.21,1.15 0.67,0.28 0.5,0.68 -0.05,0.89 0.92,1.97 0.6,0.29 0.25,0.44 -0.25,1.05 -1.27,2.13 0.32,2.04 0.6,0.38 1.01,0.21 2.38,-0.12 3.42,-0.53 0.5,0.39 1.58,-0.19 1.59,0.13 1.61,1.26 -0.14,0.41 -0.89,0.65 -0.69,3.3 0.35,0.78 1.07,0.53 0.65,-0.85 1.1,-2.76 0.76,-0.17 2.14,0.58 -0.4,1.95 0.73,3.3 1.42,0.58 0.16,1.32 0,0 -1.35,1.02 -0.61,1.48 -0.55,-0.12 0.27,-1.94 1.44,-0.95 -1.41,0.28 -0.89,0.49 -0.87,-0.02 -0.34,-0.39 -0.57,-0.17 -0.54,0.37 -0.28,0.93 0.52,0.8 -0.73,0.96 -0.3,0.1 -2.48,-0.53 -0.79,-0.54 -0.45,0.12 -0.18,0.9 0.34,0.37 1.61,0.56 1.4,-0.25 2.13,0.6 0.27,0.48 -0.97,0.68 -1.54,2.78 -1.24,0.77 -2.42,0.57 -0.2,0.45 2.95,-0.2 0.15,1.19 z' },
  { uf: 'PE', nome: 'Pernambuco', path: 'm 558.54257,227.45114 -1.22,-3.04 -0.01,-0.94 -2.11,-0.86 -0.5,-0.37 -0.45,-0.83 0.61,-0.89 -0.02,-0.62 -0.45,-0.32 -1,0.01 -0.43,0.44 -0.29,1.74 -0.43,0.15 -0.39,-0.26 -0.54,-1.65 -1.58,-1.15 -2.99,-0.4 -2.36,-0.77 -1.35,-0.81 -0.83,-1.44 -1.49,-0.56 -0.59,0.11 -2.53,1.46 -1.65,0.44 -0.77,2.05 -2.23,0.45 -0.29,0.25 0.25,1.36 -0.17,0.59 -1.1,1.24 -2.39,1.03 -0.64,-0.06 -0.77,-0.53 -0.76,0.17 -0.5,0.87 -0.77,3.57 -2.87,0.88 -0.82,0.92 -0.96,0.23 -1.84,-0.62 0.92,-1.68 -0.26,-2 -2.21,-0.91 -0.72,-1.94 0.06,-2.73 -0.44,-0.51 -2.81,-1.38 -2.2,-0.29 -1.16,0.26 -0.9,-0.4 0,0 2.62,-1.27 1.97,-1.71 0.54,-0.87 2.29,-1.33 0.97,-0.28 3.89,-3.87 0.74,-1.76 0.06,-2.27 -0.29,-0.54 -1.62,-1.58 0.07,-2.19 -0.6,-1.13 -0.06,-0.95 0.11,-0.45 0.52,-0.33 1.79,-0.16 0,0 4.93,0.2 0.89,0.24 1.63,-0.19 2.14,-0.8 1.29,-0.1 3.08,0.42 2.85,1.9 1.83,0.83 0.46,0.99 1.01,1.07 1.36,0.48 0.78,0.57 0.63,1.64 1.65,-0.05 1.54,-2.29 1.07,-0.83 1.59,-0.49 0,0 0.4,0.09 1.4,1.91 0.99,0.33 1.51,-0.32 0.93,-0.73 0.38,0.08 0.63,1.24 -0.05,0.68 0.77,0.33 2.63,-0.97 1.63,-0.23 1.52,-1.64 2.7,-1.88 1.05,-0.31 1.48,-0.87 0.93,-1.51 2.22,-1.26 1.48,-0.41 3.5,1.92 0.5,1.39 -0.11,0.3 -3,1.07 -0.37,0.78 0.04,0.47 0.72,1.87 -0.17,0.43 -2.53,2.64 -0.04,0.45 1.51,-0.25 0.44,-0.29 1.14,0.32 0.18,0.3 -0.24,0.49 0.35,2.24 0.95,0.94 1.6,0.79 1.65,-0.84 1.34,-0.16 1.78,-1.53 0.4,-0.48 -0.01,-0.54 -0.39,-0.73 0.54,-0.76 0.89,-0.69 1.82,-0.1 0.55,-0.64 1.61,-0.88 3.88,0.26 2.18,-0.29 0.8,-0.53 0,-0.6 1.14,0.02 2.01,-0.45 1.9,-1.03 0.45,-1.8 1.48,-1.28 2.31,-1.07 2.65,0.21 0.82,0.26 2.5,2.06 0,0 0.88,0.23 0.55,1.22 -1.27,1.72 -0.11,0.55 0.01,0.48 0.7,0.37 0.27,0.5 0.19,1.06 -1.96,6.38 -3.25,8.95 0,0 -0.27,-0.21 -2.9,-0.27 -1.92,-0.81 -1.47,0.19 -2.56,1.29 -2.24,-0.85 -2,0.24 -1.55,1.24 -0.12,0.45 -2.18,2.29 -1.81,1.11 -1.16,-0.05 -1.86,1.06 -1.17,0.11 -3.14,-0.29 -2.5,0.65 -1.91,-0.48 -1.78,-1.05 -1.9,-2.12 -2.55,-2.02 -1.08,0.12 -1.67,-0.3 -1,-1.22 -0.82,0.6 -0.09,0.69 -2.38,3.29 -2.17,0.76 -0.64,1.09 z' },
  { uf: 'PI', nome: 'Piauí', path: 'm 505.96257,127.17114 1.31,0.12 0.69,-0.23 2.24,0.51 0.99,0.85 0.32,0.6 0,0 -0.11,0.8 -1.09,1.85 -1.58,1.97 -0.18,1.46 0.29,1.29 1.8,4.72 3.15,6.42 0.44,1.73 1.36,1.59 -0.02,0.76 -0.74,1.36 0.79,3.87 -0.48,1.6 1,2.01 0.6,2.99 -0.59,1.58 -0.8,0.58 0.92,0.69 0.11,0.38 0.94,8.16 -0.24,0.45 0.76,2.57 1.05,5.2 1.01,2.67 1.31,0.65 2.56,0.47 0.77,1.16 -0.01,0.69 -1.5,2.25 -1.14,3.11 0.08,0.97 0.68,0.68 -0.06,1.32 0,0 -1.79,0.16 -0.52,0.33 -0.11,0.45 0.06,0.95 0.6,1.13 -0.07,2.19 1.62,1.58 0.29,0.54 -0.06,2.27 -0.74,1.76 -3.89,3.87 -0.97,0.28 -2.29,1.33 -0.54,0.87 -1.97,1.71 -2.62,1.27 0,0 -0.45,1.16 -1.5,2.3 -1.05,0.67 -0.79,-0.18 -2,0.38 0.11,2.4 -1.86,1.8 -0.32,-0.05 -0.62,-0.62 -2.16,-0.01 -0.82,0.98 -0.77,0.36 -2.73,0.34 -1.51,1.34 -0.82,1.22 -1.7,0.1 -1.48,0.64 -3,0.11 -0.82,-0.28 -0.19,-0.28 0.13,-0.66 -1.71,-0.98 -1.33,-0.39 -1.39,0.55 -2.13,0.43 -0.32,-0.18 -0.41,-0.93 -1.5,-0.46 -1.95,0.02 -3.24,1.65 -0.06,0.93 2.24,4.44 0.12,1.15 -0.29,2.57 -0.25,0.91 -0.72,0.86 -2.95,5.05 -2.97,2.42 -1.35,0.42 -1.48,-0.53 -1.34,-0.17 -2.2,0.75 -1.17,0.89 -0.67,0.87 -1.14,0.38 -0.75,1.45 -0.33,0.21 -2.11,-0.18 -1.8,0.52 -4.18,-1.85 -1.77,-2.49 -0.53,-2.21 -0.66,-1.04 -1.44,-1.34 -2.33,0.02 0,0 -2.94,-0.21 0,0 0.05,-1.92 0.26,-1.06 1.15,-2.45 0.13,-6.36 0.76,-1.4 0.03,-0.51 -1.73,-3.06 -0.47,-3.19 -0.7,-1.94 0.73,-2 1.7,-1.4 1.2,-2.48 0.13,-1.51 0.34,-0.83 0.3,-0.21 1.44,-2.74 0.63,-2.32 0.39,-2.97 0.98,-2.98 2.13,-1.95 2.72,-0.76 2.61,-0.31 1.07,-0.37 1.7,-1.53 1.05,-0.04 1.34,-0.52 2.86,-2.57 2.34,-0.91 2.01,-2 0.63,-0.87 0,-0.46 1.9,-1.92 0.5,-0.22 0.84,-0.24 0.23,0.3 1.12,-0.26 1,-0.6 1.46,-0.19 1.01,0.21 2.51,1.82 1.51,-0.1 2.44,-0.86 0.83,-0.04 0.65,0.28 2.28,-0.29 1.21,-1.31 0.5,-1.46 0.12,-1.21 0.29,-0.44 0.39,-2.2 -0.13,-0.85 -0.17,-0.5 -1.61,-0.91 -1.78,-2.03 -0.51,-2.3 -0.11,-2.11 0.17,-2.48 4.1,-4.43 0.21,-0.55 0.1,-2.43 -0.55,-2.98 -1.58,-2.8 1.14,-2.87 0.28,-1.47 -0.38,-1.27 -1.23,-0.84 -0.35,-1.92 0.77,-1.05 0.64,-0.17 0.82,-1.98 1.89,-1.85 0.88,-1.83 -0.04,-1.79 2.92,-3.41 0.81,0.16 3.31,-0.46 4.13,-3.97 1.79,-2.27 0.39,-1.53 -0.64,-0.53 -0.22,-0.72 0.46,-1.44 0,0 0.73,0.12 1.47,0.87 0.51,0.51 -0.13,0.31 z' },
  { uf: 'RJ', nome: 'Rio de Janeiro', path: 'm 468.61257,450.54114 -0.07,-0.78 0.38,-0.27 3.19,0.22 2.59,-0.59 -2.53,-1.55 -1.4,-0.5 -2.81,0.68 -1.36,1.6 -1.03,0.32 -0.7,-0.05 -1.35,-2.15 -0.48,0 -0.9,0.42 -0.96,1.06 -3.15,0.8 -0.34,0.91 -0.19,1.9 2.19,0.13 1.07,1.01 -1.15,1.08 -0.94,-0.17 -1.42,0.17 0,0 -0.48,-0.26 -1.63,-1.73 -0.05,-0.41 1.09,-3.5 1.09,-1.15 2.35,-1.01 0.5,0.15 2.77,-0.36 1.5,-0.71 1.65,-2.15 -0.75,-1.64 -1.7,-0.01 -3.15,0.53 -1.77,-0.39 -1.23,-1.59 -0.56,-1.17 -1.27,-0.54 0,0 0.68,-0.49 2.42,-0.74 2.91,-1.34 2.58,-0.17 0.5,0.27 1.72,-0.77 1.05,-0.77 4.09,-1.79 0.52,-0.07 0.36,0.31 3.2,-0.07 1.25,-0.17 1.63,-0.94 0.57,-0.06 2.53,0.27 0.49,0.17 -0.02,0.47 1.38,-0.2 9.51,-4.53 2.53,-0.99 0.21,-0.52 -0.28,-0.61 -1.44,-0.13 0.09,-0.75 1.89,-3.71 2.36,-6.04 -0.73,-0.71 0.56,-0.49 1.24,-0.27 2.53,-2.36 0,0 1.93,0.76 0.67,4.71 2.5,1.13 4.33,1.01 2.99,-0.37 1.62,1.06 0,0 -0.08,1.27 -0.94,1.61 -0.22,2.13 1.14,6.78 -0.5,0.68 -3.08,1.75 -5.97,1.94 -2.83,1.72 -3.5,3.69 -0.11,1.66 0.31,1.19 -0.19,1.62 -0.73,1.48 -1.82,0.51 -6.55,-0.17 -5.79,0.7 -2.39,-0.46 -0.49,-0.38 -0.06,-0.68 1.03,-1.48 0.67,-1.45 -0.09,-0.62 -0.78,-0.18 -2.79,1.15 -0.26,0.69 0.31,0.79 1.38,1.17 0.25,0.97 -0.59,0.52 -1.63,0.51 -1.57,-0.03 -8.04,1.07 -1.46,0.45 z m -5.11,1.99 -0.67,-0.97 2.11,-1.55 1.86,0.94 0.43,0.7 -2.46,0.5 -0.41,-0.35 -0.47,0 -0.39,0.73 z' },
  { uf: 'RN', nome: 'Rio Grande do Norte', path: 'm 609.55257,183.17114 -0.93,0.24 -3.5,-0.21 -1.04,0.4 -2.46,-1.1 -2.17,-0.3 -5.83,0.39 -0.53,-0.35 -3.42,-0.4 -0.62,-0.49 0.1,-1 -0.42,-0.39 -1.38,0.05 -1.82,1.35 -0.31,1.48 0.72,0.78 0.53,1.53 -1.01,-0.32 -0.48,0.59 0.16,1.42 0.47,0.94 -0.55,1.21 -0.5,0.74 -2.35,0.93 -0.83,-0.74 0.52,-1.54 -0.89,-1.17 -1.95,-0.3 -1.77,0.08 -3.15,1.26 -0.29,-0.23 -0.31,-1.38 -0.32,-0.23 -3.53,-0.52 0.08,-1.72 0.21,-0.31 0.85,-0.25 0.41,-0.38 0.38,-1.74 0.44,-0.96 2.99,-3.21 -0.01,-1.19 -0.53,-0.44 -0.64,-0.08 -3.26,1.04 -1.43,0.12 -3.18,1.21 -0.41,0.95 -0.1,1.04 -0.82,0.71 -3.23,1.66 -1.16,1.13 -2.88,-0.61 -0.9,-0.42 -1.93,-1.64 -0.57,0.46 0,0 -0.66,0.38 -0.64,-0.17 0.34,-1.97 1.41,-2.25 0.84,-0.88 0.51,-0.07 0.78,0.51 1.03,-0.26 0.57,-1.1 1.46,-1.51 1.4,-2.44 -0.15,-0.74 0.65,-1.67 0.87,-0.57 0.84,-1.12 3.3,-6.69 2.61,-2.01 4.89,-1.59 0,0 0.47,0.76 0.86,0.75 3.13,-0.01 1.22,0.41 1.69,1.75 1.32,0.5 3.33,-0.32 2.88,0.52 2.54,-0.24 2.33,-0.73 4.5,0.92 1.27,0.04 1.95,0.86 1.02,0.82 0.64,0.94 2.31,4.74 0.5,1.79 -0.04,0.75 1.48,5.38 0.21,1.68 0.72,0.54 0.96,2.69 z' },
  { uf: 'RS', nome: 'Rio Grande do Sul', path: 'm 322.25257,638.78114 -0.36,0.01 -1.94,-1.11 -0.2,-0.46 0.52,-4.27 -0.46,-4.25 0.15,-1.07 0.63,-1.24 2.84,-2.38 0.83,-1.56 2.3,-2.56 -1.46,-1.65 -1.07,-0.62 -2.25,-0.6 -2.32,-2.25 -1.21,-1.62 -0.1,-1.59 -0.43,-1.18 -1.23,-2.03 -2.06,-2.24 -0.67,-0.59 -2.39,-1.21 -1.45,0.21 -1.9,-1.51 -1.52,-1.63 -1.25,-0.78 -0.14,-1.7 -1.9,-2.16 -3.32,-0.46 -0.92,-0.47 -1.73,-1.66 -1.76,0.13 -2.17,-1.38 -1.91,-3.71 -1.11,-1.49 -2.53,-2.12 -0.7,0.08 -0.67,1.79 -2.59,2.24 -2.67,0.12 0.1,-2.86 0.4,-1.28 -0.39,-1 -3.65,-4.29 -2.37,-1.77 -2.18,-2.06 -1.75,-2.11 -2.69,-2.21 -1.9,-0.14 -2.15,0.21 -1.14,1.36 -0.06,0.96 -1.03,0.97 -1.11,0.02 -0.58,-0.48 -3.16,0.14 -0.65,-0.48 -0.16,-0.91 -0.49,-0.22 0.85,-0.22 1.04,-0.72 2.52,-2.77 0.11,-1.84 0.6,-1.25 0.82,-0.45 1.29,-0.07 0.64,-0.26 0.92,-1 5.45,-6.48 0.63,-1.42 0.17,-1.11 0.82,-1.07 1.2,-0.85 1.37,-0.41 1.96,-4.22 0.1,-0.61 0.31,-0.37 1.64,-0.86 1.63,-1.8 0.85,-1.15 0.51,-1.29 1.34,-2.1 0.93,-0.29 1.57,0.18 0.55,0.79 0.47,-1.28 -0.21,-0.58 -1.35,-0.82 -0.05,-0.36 0.35,-0.33 1.08,-0.38 0.82,-0.96 2.79,-0.95 1.05,-1.07 0.1,-0.92 0.82,-0.91 2.21,-1.15 2.47,-0.4 1.77,-1.81 0.15,-1.06 1.32,-2.36 0.33,-0.04 0.05,0.36 0.29,0.2 1.33,-0.17 2.44,-1.13 2.68,-0.59 1.21,-0.57 2.1,-2.35 0.5,0.01 0.67,-0.39 1.01,-1.35 2.31,-0.73 0.3,0.38 0,0 3.52,0.39 3.26,-1.15 0.56,-0.81 1.35,0.58 -0.15,0.92 3.08,-0.03 1.63,0.99 2.56,-0.37 1.92,1.15 2.58,-0.41 1.54,0.18 2.8,-0.16 2.26,0.92 2.48,1.4 1,2.44 1.59,0.19 0.09,-0.48 1.81,-0.35 5.56,3.54 1.37,1.55 0.71,-0.03 1.56,0.98 3.03,3.49 1.64,2.21 0.48,1.48 2.17,2.66 1.17,0.55 6.69,1.06 2.11,-0.4 3.35,0.34 0.88,2.34 -2.08,1.58 -1.27,0.41 -0.73,1.86 0.22,2.19 -0.38,1.56 -0.52,1.3 -1.18,0.2 -1.29,1.69 -0.03,1.41 1.8,1.17 0.27,-0.2 -0.28,-0.97 0.01,-0.96 1.49,-0.82 1.58,0.64 0.73,0.91 1.17,0.85 0.45,-0.03 0,0 -1.4,1.73 -3.9,7.04 -4.21,11.6 -6.3,10.48 -5.44,6.66 -6.51,5.96 -6.09,3.68 -3.1,4.31 -0.18,-0.43 0.65,-1.58 0.34,-2.18 -1.18,-1.71 0.1,-0.42 0.93,-0.17 1.01,0.4 0.56,0.58 1.02,0.04 2.58,-1.41 0.82,-0.68 2.85,-3.71 0.75,-0.69 0.45,0.19 1.02,-0.19 1.05,-0.84 0.93,-1.27 0.37,-1.48 0.18,-0.93 -0.23,-2.1 0.2,-1.37 1.57,-0.07 0.74,0.3 0.27,0.83 0.35,-0.26 -0.29,-1.4 0.51,-2.07 0.48,-0.57 2.74,-1.59 0.73,-1.08 0.47,-2.75 -0.21,-2.28 0.56,-0.68 0.5,0.8 0.37,0.03 0.43,-0.42 0.47,-3.08 -0.1,-0.44 -0.95,-1.22 -0.67,-0.03 -0.26,0.69 0.17,0.39 -0.14,0.57 -0.35,0.2 -1.51,-0.02 -2.01,0.4 -0.34,1.61 -0.53,0.05 -0.81,-0.44 0.1,-1.71 -0.82,-0.89 -1.04,0.33 -0.6,-0.48 -0.73,-1.26 -0.4,-1.45 0.12,-0.57 -0.64,-0.69 -0.61,2.71 0.44,2.25 1.25,2.11 -0.57,0.81 -0.74,2.54 0.38,3.03 -0.18,0.77 -0.48,-0.37 0.26,-0.24 -0.03,-0.71 -0.47,-1.28 -0.45,-0.39 -0.53,0.66 -0.03,1.37 -1.41,3.27 -0.05,1.89 0.22,0.52 -0.72,0.7 -1.61,0.64 -0.61,1.58 -4.09,1.57 -0.72,0.53 -0.53,1.59 -0.1,2.27 -0.97,2.27 -2.36,1.3 -0.11,1.76 0.48,0.83 0.25,1.02 -0.95,0.56 -0.25,1.51 0.43,0.6 0.68,-0.14 1.3,0.63 0.15,0.91 -2.13,1.65 -2.32,4.52 -1.93,6.88 -2.01,4.49 -1.68,2.52 -7.79,7.53 z' },
  { uf: 'RO', nome: 'Rondônia', path: 'm 187.58257,291.21114 -1.29,-1.45 -0.44,-1.88 -1.56,-0.52 -0.86,0.32 -1.81,0.08 -4.07,-1.81 -0.01,-0.4 -0.66,-0.61 -1.27,0.59 -1.98,-1.68 -1.52,-0.97 -0.86,-1.46 -0.28,-1.39 -1.04,-0.39 -1.77,1.12 -1.22,-0.03 -1.41,-0.8 -0.87,-1.33 -3.13,-1.58 -1.96,-0.17 -1.14,0.54 -0.9,0.85 -1.43,-0.17 -0.31,-0.3 -2.14,-0.51 -3.06,-0.28 -0.76,-0.43 -1.18,-1.19 -0.3,-1.97 -1.58,-0.49 -1.89,-0.97 -0.82,-1.72 -0.29,-0.2 -2.72,-0.28 -0.38,-0.35 -0.84,-3.71 -0.88,-0.89 -0.48,1.16 -0.66,-0.32 -0.27,-0.64 0.62,-1.53 -0.84,-1.52 -1.36,-0.39 -1.26,-3.47 -0.17,-1.66 1.55,-2.91 -0.21,-1.66 -1.16,-1.97 -0.75,-2.16 -0.06,-2.29 0.62,-0.5 0.38,-1.37 1.04,-1.05 0.36,-1.47 -0.24,-1.49 -0.42,-0.89 -0.09,-1.53 0.54,-1.65 -1.17,-2.18 -1.02,-0.38 -1.09,0.98 -0.06,0.51 -0.84,0.96 -0.57,0 -2.18,-1.02 -5.18,0.08 -5.61,1.78 -1.69,-0.01 -1.48,0.48 0,0 -2.97,-1.26 0,0 3.26,-2.56 1.92,-0.58 1.55,-1.81 0.15,-0.56 -0.16,-1.29 3.96,0.26 2.87,-0.33 0.72,0.37 2.31,2.33 0.37,-0.02 1.22,-0.79 0.13,-0.72 0.41,-0.53 1.08,-0.5 0.77,0.13 1.37,-0.39 1.3,-1.21 1.84,-1.02 0.38,0.09 0.64,2.26 0.68,0.53 0.68,-0.08 2.54,-3.16 -0.26,-1.75 0.53,-0.84 1.75,-1.26 0.46,0.02 0.84,0.55 1.79,0.1 1.2,-1.07 2.13,-0.38 3.87,0.46 -0.24,-1.46 0.11,-1.81 2.06,-1.21 0.81,-1.15 0.36,-1.02 -0.17,-0.45 -0.9,-0.7 0.05,-0.67 1.19,-1.59 2.48,-0.53 0.26,-0.22 -0.09,-1.17 1.72,-0.5 1.38,-2.56 10.79,-0.06 2.15,1.13 0.45,0.49 0.8,1.91 1.33,1.27 2.54,0.98 1.25,3.27 0.46,0.21 0.98,-0.13 0.62,0.2 0.68,2.88 3.24,1.48 0.68,-0.19 0.54,-1.74 1.92,-1.08 1.39,0.28 0.36,0.38 -0.04,0.7 0,0 1.4,0.97 0.6,1.24 -0.76,1.42 -1.29,4.99 0.06,0.35 0.78,0.47 0.26,0.61 0.15,1.39 0.83,2.27 -0.94,1.67 0.38,1.93 -1,3.52 -0.03,0.8 0.27,1.76 1.5,2.75 -0.9,9 17.16,0.05 -0.24,0.56 1.22,1.11 3.5,-0.09 1.11,0.11 1.07,0.43 1.41,3.59 -0.17,0.75 -1.4,1.75 -1.36,1.08 -0.14,1.32 0.43,3.25 0.58,0.51 0.9,-0.03 1.53,3.34 -0.04,2.05 0.58,1.49 -0.07,1.71 -0.56,2.24 -1.66,2.01 -0.52,2.25 -0.58,0.84 -0.43,0.41 -1.64,0.53 -0.93,1.08 -1.43,3.78 -0.52,2.45 -4.11,2.57 -1.47,1.43 0,0 -0.74,-0.04 -2.59,-1.55 -1.27,-1.43 -7.08,0.96 -1.32,-0.43 -0.25,-0.3 -3.38,0.66 -0.48,-0.16 -0.52,-1.35 z' },
  { uf: 'RR', nome: 'Roraima', path: 'm 234.87257,61.661144 1.6,16.97 0,0 -18.49,-0.07 0.03,0.68 -2.33,3.26 -1.66,3.03 -0.07,1.13 -1.15,2.64 -0.11,0.66 0.23,0.73 1.14,1.41 -0.02,0.53 -0.42,0.39 -2.03,0.55 -1.41,1.41 -1.25,0.46 -1.82,-0.23 -0.92,-2.51 -1.87,-2.04 -2.83,-0.93 -1.6,0.06 -0.55,0.89 -2.09,0.71 -1.28,0.69 -1.02,1.26 -0.82,2.97 0.37,1.8 -0.25,1.73 -0.75,2.289996 0.44,2.11 -2.36,-1.04 -1.34,0.42 -0.53,-0.07 -1.04,-2.04 -1.48,-1.649996 -1.96,-1.31 -0.52,-0.04 -5.01,-4.42 0.14,-1.14 1.84,0.33 1.14,-1.32 0.06,-0.58 -1.13,-4.33 -0.58,-0.9 -1.22,-0.84 -0.88,-2.17 -0.29,-4.98 0.57,-0.96 0.77,-3.04 -0.66,-1.58 -0.36,-1.59 1.62,-1.46 -0.05,-0.45 -0.87,-1.12 -0.19,-2.26 -1.66,-4.76 -2.73,-3.74 0.71,-1.5 0.91,-3.32 -0.49,-0.66 -1.95,-0.95 -1.36,-0.11 -0.88,0.21 -0.97,-0.37 -1.21,-1.17 -0.06,-0.96 -0.63,-0.11 -1.13,0.42 -0.61,-0.01 -0.75,-0.34 -0.72,-0.78 0,0 0.3,-0.46 0.23,-2.28 -0.3,-0.22 -3.37,-0.23 -3.75,0.14 -3.31,-0.7 -0.2,-0.6 0.8,-1.76 0.12,-1.48 -0.73,-1.77 -1.94,-3.54 -0.73,-2.06 -0.47,-3.72 0.79,-1.48 -0.08,-0.96 -1.84,-2 -2.16,-1.06 -2.81,-2.78 -1.06,-1.81 -0.29,-0.96 -1.14,-0.65 -0.25,-0.39 0.03,-0.84 0.29,-0.33 0.9,0.07 1.12,0.66 0.94,1.73 0.61,0.09 3.39,-0.5 1.35,0.1 1.91,0.59 0.61,1.2 0.55,1.93 0.54,0.35 0.96,-0.08 0.74,-0.65 0.95,-0.4 3.18,0.16 0.47,0.05 1.31,1.21 0.6,0.15 0.52,-0.14 0.61,-1.56 1.31,0.14 1.45,0.93 3.93,4.57 1.05,0.57 0.71,0.11 1.51,-0.68 0.74,-1.13 0.1,-0.84 -0.83,-2.76 0.36,-1.74 0.46,-0.28 1.93,-0.05 1.01,-1.1 1.55,-1.09 0.75,0.05 3.9,1.34 0.59,-0.17 0.8,-0.72 1.03,-0.3 1.13,0.35 1.03,-0.21 1.34,-1.28 1,-0.25 1.15,0.23 1.11,-0.07 0.68,-0.85 0.05,-1.35 3.03,-1.81 2.33,0.19 2.76,-0.39 0.89,-1.13 0.09,-0.71 0.59,-1.1199998 0.75,-0.13 1.85,-0.9 1.1,-1.04 1.11,-1.71 -1.2,-3.56 -1.17,-0.36 0.64,-0.18 1.43,0.07 0.8,0.32 3.57,-0.1 1.06,-0.95 0.74,-0.22 1.37,0.42 0.53,1.31 1.04,0.8 0.48,1.37 -0.67,4.9 -0.72,1.3799998 -1.25,0.7 0.06,0.83 1.61,0.41 1.62,-0.22 2.35,0.81 1.82,1.1 -0.88,1.43 -0.01,1.15 2.34,3.42 0.2,1.55 -1.51,2.92 -1.88,1.41 -0.72,1.5 0.27,0.39 0.06,2.17 -1.47,2.41 -0.9,2.77 -0.31,2.57 -0.09,2.67 0.98,1.87 0.51,1.76 -0.01,1.4 1.57,1.03 0.9,0.2 0.13,0.68 -0.46,5.15 0.12,0.74 1.81,0.29 -0.66,1.17 0.46,0.5 2.15,0.74 1.46,1.92 2.66,2.74 z' },
  { uf: 'SC', nome: 'Santa Catarina', path: 'm 379.56257,558.27114 -0.45,0.03 -1.17,-0.85 -0.73,-0.92 -1.59,-0.63 -1.48,0.82 -0.01,0.96 0.28,0.97 -0.27,0.2 -1.8,-1.17 0.04,-1.41 1.28,-1.69 1.18,-0.2 0.53,-1.31 0.37,-1.55 -0.22,-2.19 0.73,-1.86 1.27,-0.42 2.08,-1.58 -0.88,-2.34 -3.35,-0.34 -2.11,0.4 -6.69,-1.06 -1.16,-0.54 -2.17,-2.66 -0.49,-1.48 -1.63,-2.21 -3.03,-3.49 -1.57,-0.99 -0.71,0.03 -1.37,-1.55 -5.56,-3.54 -1.81,0.34 -0.09,0.48 -1.6,-0.19 -1,-2.44 -2.47,-1.39 -2.27,-0.93 -2.79,0.16 -1.54,-0.18 -2.59,0.41 -1.91,-1.15 -2.57,0.36 -1.63,-0.98 -3.08,0.03 0.15,-0.93 -1.35,-0.58 -0.56,0.81 -3.26,1.16 -3.52,-0.39 0,0 1.45,-2.93 0.73,-2.09 -0.58,-3.25 0.41,-3.21 -0.04,-2.55 0.96,-1.75 0,0 3.63,0.02 0.71,-0.38 0.53,0.01 1.06,0.24 0.31,0.51 2.03,1.41 2.68,0.03 2.34,-0.58 5.29,1.68 4.26,0.36 1.02,0.63 0.17,0.41 1.57,1.18 3.77,0.42 4.25,-0.13 1.33,1.9 0.18,-0.5 0.74,-0.38 0.92,-0.02 0.87,-0.86 -0.85,-2.99 0.69,-1.58 0.72,-0.78 2,-1.14 3.57,0.4 1.87,-0.97 0.73,-0.87 0.59,-1.48 1.53,-0.65 1.11,-0.14 1.42,0.76 0.81,0.03 2.33,-0.17 2.84,-0.73 0.75,0.01 1.04,0.4 3.12,2.6 1.23,0.62 1.44,0.16 3.35,-2.13 1.35,-1.43 1.56,-0.57 0.12,0.39 0.76,0.07 1.74,-0.23 0.33,-0.44 5.24,0.03 0,0 -0.39,1.32 0.51,1.65 -0.07,0.39 -1.5,1.14 -0.98,-0.48 -0.82,-2.53 -0.02,1.12 0.59,2.72 1.71,1.66 0.56,0.95 -1.01,2.29 -0.16,2.32 0.1,0.43 0.76,0.73 0.26,5.86 0.31,0.55 0.43,0.2 0.77,-0.51 0.35,0.72 0.1,0.87 -0.47,0.06 -0.43,-0.28 -1.19,0.63 -0.34,3.84 0.57,2.59 -0.57,0.75 0.31,1.93 0.91,1.88 -0.86,2.34 -0.52,4.01 -1.71,4.68 -0.34,-0.1 -0.36,-0.76 0.21,-0.97 -0.92,-1.18 -0.26,0.33 0.18,2.43 1.16,0.83 -0.92,1.66 -1.64,0.65 -4.13,3.04 -2.8,2.56 -3.75,4.44 -1.04,1.88 z m 17.88,-26.55 -0.15,-0.47 0.25,-1.75 0.76,-2.4 -0.4,-1.18 0.16,-1.02 1.4,-0.76 0.22,0.06 0.66,0.94 -0.54,2.56 -0.82,0.86 -0.59,1.22 0.2,1.17 -1.15,0.77 z m -0.45,-24.37 -1.87,-2.02 2.55,-2.44 0.25,0.04 0.65,1.05 -0.86,1.32 -0.72,2.05 z' },
  { uf: 'SP', nome: 'São Paulo', path: 'm 404.84257,488.18114 -0.16,-1.33 -1.42,-0.57 -0.73,-3.3 0.4,-1.95 -2.14,-0.58 -0.76,0.17 -1.1,2.77 -0.66,0.85 -1.06,-0.53 -0.35,-0.78 0.69,-3.3 0.89,-0.66 0.14,-0.4 -1.61,-1.27 -1.59,-0.13 -1.58,0.19 -0.5,-0.38 -3.41,0.53 -2.38,0.12 -1.01,-0.21 -0.6,-0.39 -0.33,-2.04 1.28,-2.12 0.25,-1.05 -0.25,-0.44 -0.6,-0.3 -0.92,-1.97 0.06,-0.89 -0.5,-0.68 -0.67,-0.29 -1.21,-1.14 -1.49,-3.01 0.36,-0.55 0.08,-1.76 -1.3,-1.52 -0.38,-1.84 0.17,-0.81 0.39,-0.58 -0.02,-2.74 -0.89,-1.76 -3.59,-2.83 -1.13,-1.55 -2.97,0.86 -5.31,-0.13 -0.66,-0.54 -1.65,-0.14 -0.42,0.34 -1.72,-0.07 -0.72,-1.32 -0.63,-0.51 -3.51,-0.8 -1.75,-0.84 -0.78,-1 -2.58,0.01 -1.07,0.54 -1.32,-0.13 -2.64,-1.09 -2.53,-0.46 -1.48,-0.79 -1.17,-0.29 -0.73,0.37 -0.34,0.6 -1.21,0.62 -3.28,-0.29 -4.01,0.11 -3.83,-0.65 -3.25,2.29 0,0 0.84,-1.08 0.73,-1.54 1.26,-1.14 7.56,-4.54 1.95,-1.87 1.26,-2.43 1.73,-1.69 0.4,-1.21 1.44,-1.03 0.28,-1.22 -0.35,-0.84 2,-2.26 1.21,-2.34 0.07,-0.94 -0.31,-1.93 0.23,-0.39 0.96,-0.52 2.6,-3.64 0.16,-2.93 0.62,-1.68 1.01,-0.3 0.73,-0.64 1.99,-2.68 1.22,-1.02 0.47,-0.23 1.31,-0.04 1.5,-0.78 0.28,-0.4 0.4,-2.46 0,0 1.22,-1.13 2.15,-1.11 1.92,-0.37 1.43,-1.69 1.5,-0.61 0.75,0.14 1.73,1.55 2.55,0.08 4.29,0.96 1.67,-0.36 1.62,0.22 2,-0.59 2.18,1.42 1.67,0.79 -0.13,0.92 0.33,1.42 1.21,2.09 0.63,0.03 0.54,-0.32 0.67,-0.94 0.41,-1.13 0.26,-0.19 0.55,0.05 0.36,0.39 0.25,0.96 0.01,2.78 1.2,0.53 0.41,-0.45 -0.27,-2.54 0.49,-1.19 0.45,-0.48 8.18,-0.67 1.01,-1.25 1.5,1.46 1.12,0.43 2.78,-0.69 0.44,-0.99 -0.2,-0.46 0.31,-0.61 2.38,-0.11 1.66,0.78 0.85,-0.64 1.31,-0.29 3.26,3.35 0.2,1.04 -0.57,1.01 -0.29,2.37 0.58,0.61 1.89,1.21 0.4,1.55 -0.06,0.56 -1.52,2.03 -0.18,1.94 0.79,0.74 0.31,0.61 0.37,2.21 1.3,1.8 0.83,1.99 -0.03,0.85 1.61,-0.05 0.78,-0.31 0.28,-0.36 1,-0.05 3.7,1.32 0.23,0.37 -0.05,1.27 -0.7,2.18 -1.86,2.72 0.26,2.94 -0.19,3.45 -0.53,1.56 0.72,1.6 1.78,1.24 1.81,0.83 0.51,1.72 -1.21,0.7 2.02,3.31 1.13,0.25 2.01,-0.24 0.18,0.53 3.62,-1 0.56,0.42 1.31,-0.32 0.75,-0.98 0.05,-0.84 -0.24,-0.24 0.17,-2.3 1.19,-0.33 0.09,0.35 -0.35,0.49 0.01,0.48 2.34,0.08 2.39,-0.25 1.79,-0.67 1.23,-1.24 1.93,-1.02 2.21,-0.22 1.24,-0.73 0,0 1.27,0.54 0.56,1.17 1.23,1.59 1.77,0.39 3.15,-0.53 1.7,0.01 0.75,1.64 -1.65,2.15 -1.5,0.71 -2.77,0.36 -0.5,-0.15 -2.35,1.01 -1.09,1.15 -1.09,3.5 0.05,0.41 1.63,1.73 0.48,0.26 0,0 -0.06,0.2 -1.69,0.42 -1.06,-0.82 -1.48,1.11 -0.43,0.65 0.27,0.22 -0.76,0.64 -3.22,1.55 -2.25,0.7 -0.28,0.44 0.04,0.96 0.5,1.55 -0.32,0.42 -1.4,0.26 -0.7,-0.64 -1.34,-0.29 -3.12,-0.5 -0.86,0.15 -1.32,0.34 -1.73,0.82 -0.5,0.51 -1.21,2.15 -1.31,0.57 -0.5,-0.12 0.58,-0.47 -0.48,-1.22 -1.17,-0.85 -0.83,1.23 0.26,0.75 -0.3,0.61 -7.62,4.24 -0.95,0.82 -0.31,1.16 -3.27,3 -3.25,1.95 -1.92,0.53 -4.5,3.21 -2.33,1.96 -0.67,0.08 -0.44,0.62 0.9,0.43 0.66,0.06 0.93,-0.36 0,0.76 -0.62,1.31 -1.32,0.85 -1.06,1.48 z m 44.31,-23.01 -1.54,-0.65 -1.16,0.18 -0.49,-0.38 0.1,-0.78 0.95,-0.65 1.09,-1.85 0.72,0.25 0.66,0.65 0.13,2.91 -0.46,0.32 z' },
  { uf: 'SE', nome: 'Sergipe', path: 'm 570.20257,261.95114 -2.9,0.89 -1.55,-0.64 -0.54,-0.34 -0.48,-0.72 -1.92,-0.92 -0.6,-0.52 -0.12,-0.41 0.34,-0.39 0.13,-1.42 -0.15,-0.39 -1.43,-1.51 -0.52,-1.49 -1.09,-0.67 -0.96,-1.6 -0.02,-0.77 0.59,-1.58 0.32,-0.3 1.7,0.01 1.13,0.75 2.55,-0.99 0.69,-0.55 0.3,-0.58 -0.76,-2.75 0.08,-0.88 0.66,-1.62 0.08,-3.11 -0.75,-1.15 -1.99,-1.95 -1.27,-2.5 -0.22,-2.14 0.67,-1.15 0,0 6.46,2.98 3.68,0.95 5.42,3.07 1.3,2.45 1.76,1.45 1.66,0.79 0.46,0.03 3.59,2.23 0.6,1.31 0,0 -2.38,0.76 -4.57,2.94 -0.97,0.89 -1.55,2.21 -0.32,-0.02 0.11,-1.1 -1.05,-1.82 -0.99,0.16 0.34,1.16 1.24,0 0.23,0.24 -0.52,1.97 -1.27,2.09 -0.53,-0.35 -0.37,-0.67 -0.99,-0.16 0.2,0.68 1.13,0.62 -0.26,1.77 -0.86,1.15 -0.93,2.03 -0.78,0.15 -0.3,-0.46 0.48,-1.4 0.41,-0.13 0.31,-0.43 0.37,-1.04 -0.81,-0.37 0.1,0.68 -0.45,1.13 -0.48,0.5 -0.26,1.09 0.28,0.72 -0.26,0.52 z' },
  { uf: 'TO', nome: 'Tocantins', path: 'm 433.61257,282.08114 -5.36,1.42 -1.74,1.34 -2.56,1.1 -1.55,0 -4.53,1 -2.52,2.08 -1.78,0.9 -0.46,-0.24 -1.51,-2.62 -0.55,-0.03 -0.51,3.3 -0.69,0.08 -3.35,-0.68 -3.13,-1.47 0.56,-1.56 -0.22,-0.74 -4.53,0.53 -2.76,-0.34 -0.56,0.54 -0.3,1 -0.75,0.75 -1.14,-0.05 -0.61,-3.1 -1.11,-3.71 -1.04,-1.88 -1.15,-1.31 -1.18,0.97 -1.47,2.39 -1.63,5.94 -0.63,0.23 -4.07,-1.43 -3.09,-1.71 -3.93,-0.4 -2.2,-1.03 -2.4,-0.4 0.52,-2.34 1.22,-1.88 0.03,-1.71 -0.56,0.3 -1.81,2.09 -0.66,1.23 -0.2,1.88 -0.34,0.45 0,0 -0.8,-0.02 -0.96,-0.51 -0.98,-3.34 0.74,-2.76 -0.44,-3.05 -0.52,-0.58 -0.01,-1.57 0.47,-3.31 -1.1,-2.25 0.05,-0.5 0.82,-0.89 0.16,-0.87 -1.39,-1.34 -0.06,-0.86 1.88,-5.99 0.04,-2.95 0.54,-2.97 1.94,-5.29 0.37,-0.27 0.43,-0.85 0.44,-3.14 1.1,-1.25 0.56,-1.89 0.65,-1.02 0,0 1.62,-3.69 1.13,-4.45 1.15,-1.58 1.19,-1.1 1.21,-1.68 1.03,-1.92 1.37,-0.92 1.05,-0.16 0.73,-0.85 0.94,-1.54 0.18,-0.99 1.7,-3.24 1.09,-0.8 1.76,-5.15 0.66,-4.04 -0.15,-0.3 -0.74,-0.32 -1.67,-1.74 -0.6,-0.95 -0.16,-0.88 0.14,-0.57 1.41,-1.69 1.29,-2.1 -0.06,-2.67 -0.43,-2.18 0.19,-0.35 2.47,-1.78 3.41,-1.14 2.5,-1.21 0.24,-0.5 -0.15,-1.51 0.86,-1.27 1.51,-1.34 1.29,-0.15 0.19,-1.34 -0.29,-1.2 0.25,-0.46 1.46,-0.46 0.64,-0.48 0.93,-2.75 -1.02,-1.34 -0.09,-1.4 0.29,-0.28 0.97,-0.08 0.72,-0.37 0.37,-0.66 0.03,-0.64 -1.26,-1.17 -0.87,-0.14 -0.39,-0.31 -1.02,-1.66 -1.29,-0.12 -1.87,0.25 -2.29,-0.81 0,0 0.53,-0.64 2.62,-1.85 1.96,-0.53 0.87,0.05 2.78,1.52 1.4,0.08 0.95,-0.52 1.74,0.29 0.59,0.69 0.08,1.03 0.28,0.32 1.22,0.03 3.4,1.43 0.84,1.03 0.47,3.5 0.64,1.5 -0.21,3.72 0.23,1.08 0.67,1.13 -0.01,0.44 -1.77,6.15 -0.31,2.37 0.28,1 -0.25,1.59 -1.75,2.04 -1.76,0.67 -0.18,0.71 1.94,1.32 0.42,-0.27 1.37,0.24 0.25,0.35 0.11,0.88 -0.62,1.19 0.85,1.44 0.88,-0.07 3,4.16 0.91,0.85 2.28,3.02 2.14,-1.34 4.27,-0.94 1.8,1.22 0.08,1.75 -0.64,3.25 0.39,1.35 -3.39,0.35 -1.34,0.54 -0.57,0.55 -0.68,1.43 -0.73,2.68 0.37,1.3 -2.63,2.55 -0.26,0.7 0.2,0.42 2.08,0.29 0.94,0.69 0.74,1.59 0.06,1.66 0.62,1.04 3.88,1.95 0.09,0.53 -1.64,1.81 0.13,1.65 2.14,1.62 0.99,2.87 1.34,2 0.71,0.18 1.78,-0.21 1,0.3 0.82,0.44 0.61,0.82 1.28,0.66 0,0 2.94,0.21 0,0 -0.69,0.65 -0.22,0.98 -0.56,0.47 -3.82,2.02 -3.21,2.62 -0.19,0.37 1.29,1.8 -0.36,0.39 -1.01,0.27 -0.9,0.61 -1.52,3.49 -1.01,0.72 -0.5,1.16 0.23,0.92 1.86,1.95 3.59,0.67 1.87,0.99 0.05,0.76 -0.56,0.45 -2.04,0.81 -0.43,0.96 0.09,0.5 0.35,0.33 1.03,-0.18 0.92,0.29 0.58,0.51 0.29,0.64 -0.96,0.71 -1.15,0.42 -1.95,1.67 -0.19,0.85 -0.05,2.92 0.35,1.25 0.94,0.66 1.05,0.24 0.41,0.25 0.17,0.42 0.05,1.06 -1.36,2.38 z' },
];

function getPedidosVenda() { return CADASTROS_DATA['pedido-venda'] || []; }

function agregarProdutosDosItens(pedidos) {
  const mapa = {};
  pedidos.forEach((p) => {
    if (p.itens && p.itens.length) {
      p.itens.forEach((item) => {
        const nome = item.descricao || '—';
        const precoUn = calcularPrecoUnitario(item);
        const total = precoUn * Number(item.quantidade || 0);
        mapa[nome] = (mapa[nome] || 0) + total;
      });
    } else if (p.produto) {
      mapa[p.produto] = (mapa[p.produto] || 0) + Number(p.valor || 0);
    }
  });
  return mapa;
}

function agregarPorChave(pedidos, chave) {
  const mapa = {};
  pedidos.forEach((p) => {
    const k = p[chave] || '—';
    mapa[k] = (mapa[k] || 0) + Number(p.valor || 0);
  });
  return mapa;
}

let MN_ESTADO_SELECIONADO = null;
let MN_CHART_STATUS = null, MN_CHART_ESTADO = null, MN_CHART_PRODUTO = null;
let MN_CHART_VENDEDOR = null, MN_CHART_PRODUTO2 = null, MN_CHART_EVOLUCAO = null;

function renderMapaBrasil() {
  const svgEl = document.getElementById('mn-mapa-svg');
  if (!svgEl) return;
  const pedidos = getPedidosVenda();
  const porEstado = agregarPorChave(pedidos, 'estado');
  const maxValor = Math.max(...Object.values(porEstado), 1);

  svgEl.innerHTML = BRASIL_MAP_ESTADOS.map((e) => {
    const valor = porEstado[e.uf] || 0;
    const temVenda = valor > 0;
    const intensidade = temVenda ? (0.3 + (valor / maxValor) * 0.7).toFixed(2) : 0;
    const selecionado = MN_ESTADO_SELECIONADO === e.uf;
    return `<path d="${e.path}" class="mn-mapa-estado ${temVenda ? 'tem-venda' : ''} ${selecionado ? 'selecionado' : ''}"
      style="${temVenda ? `fill-opacity:${intensidade}` : ''}"
      data-uf="${e.uf}"
      onmousemove="mnHoverEstado('${e.uf}', event)"
      onmouseleave="mnHoverSai()"
      onclick="mnClicarEstado('${e.uf}')"><title>${e.nome}</title></path>`;
  }).join('');

  const btnVoltar = document.getElementById('mn-mapa-voltar');
  if (MN_ESTADO_SELECIONADO) {
    if (btnVoltar) btnVoltar.style.display = '';
    // getBBox só funciona com o <path> já no DOM, por isso espera o próximo frame
    requestAnimationFrame(() => aplicarZoomEstado(MN_ESTADO_SELECIONADO));
  } else {
    if (btnVoltar) btnVoltar.style.display = 'none';
    svgEl.setAttribute('viewBox', BRASIL_MAP_VIEWBOX);
  }

  renderMnDetalheEstado();
}

function aplicarZoomEstado(uf) {
  const svgEl = document.getElementById('mn-mapa-svg');
  const pathEl = svgEl && svgEl.querySelector(`path[data-uf="${uf}"]`);
  if (!svgEl || !pathEl || typeof pathEl.getBBox !== 'function') return;

  const bbox = pathEl.getBBox();
  const padX = bbox.width * 0.22;
  const padY = bbox.height * 0.22;
  svgEl.setAttribute('viewBox', `${bbox.x - padX} ${bbox.y - padY} ${bbox.width + padX * 2} ${bbox.height + padY * 2}`);

  renderMarcadoresCidades(uf, bbox);
}

// As cidades não têm coordenadas reais aqui — a posição de cada uma dentro
// do estado é calculada (de forma sempre igual para a mesma cidade, não
// aleatória a cada clique) só para espalhar os marcadores visualmente.
// Quem mostra o valor exato por cidade, de verdade, é a lista ao lado.
function posicaoDentroDoEstado(nomeCidade, bbox) {
  let hash = 0;
  for (let i = 0; i < nomeCidade.length; i++) hash = (hash * 31 + nomeCidade.charCodeAt(i)) >>> 0;
  const fracX = 0.22 + ((hash % 1000) / 1000) * 0.56;
  const fracY = 0.22 + (((Math.floor(hash / 1000)) % 1000) / 1000) * 0.56;
  return { x: bbox.x + bbox.width * fracX, y: bbox.y + bbox.height * fracY };
}

function renderMarcadoresCidades(uf, bbox) {
  const svgEl = document.getElementById('mn-mapa-svg');
  if (!svgEl) return;
  svgEl.querySelectorAll('.mn-cidade-marcador-grupo').forEach((el) => el.remove());

  const pedidos = getPedidosVenda().filter((p) => p.estado === uf);
  const porCidade = agregarPorChave(pedidos, 'cidade');
  const cidades = Object.keys(porCidade);
  if (!cidades.length) return;

  const maxValor = Math.max(...Object.values(porCidade), 1);
  const fontSize = Math.max(bbox.width, bbox.height) / 26;
  const NS = 'http://www.w3.org/2000/svg';

  cidades.forEach((cidade) => {
    const valor = porCidade[cidade];
    const pos = posicaoDentroDoEstado(cidade, bbox);
    const raio = fontSize * (0.55 + (valor / maxValor) * 0.75);

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'mn-cidade-marcador-grupo');
    g.setAttribute('onmousemove', `mnHoverCidade('${cidade.replace(/'/g, "\\'")}', ${valor}, event)`);
    g.setAttribute('onmouseleave', 'mnHoverSai()');

    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('cx', pos.x);
    circle.setAttribute('cy', pos.y);
    circle.setAttribute('r', raio);
    circle.setAttribute('class', 'mn-cidade-marcador');

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', pos.x);
    label.setAttribute('y', pos.y - raio - fontSize * 0.5);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', fontSize);
    label.setAttribute('class', 'mn-cidade-marcador-label');
    label.textContent = cidade;

    g.appendChild(circle);
    g.appendChild(label);
    svgEl.appendChild(g);
  });
}

function mnHoverEstado(uf, evt) {
  const estado = BRASIL_MAP_ESTADOS.find((e) => e.uf === uf);
  const nome = estado ? estado.nome : uf;
  const pedidos = getPedidosVenda().filter((p) => p.estado === uf);
  const total = pedidos.reduce((a, p) => a + Number(p.valor || 0), 0);
  const tooltip = document.getElementById('mn-mapa-tooltip');
  const wrap = document.getElementById('mn-mapa-wrap');
  if (!tooltip || !wrap) return;
  const rect = wrap.getBoundingClientRect();
  tooltip.style.display = 'block';
  tooltip.style.left = (evt.clientX - rect.left) + 'px';
  tooltip.style.top = (evt.clientY - rect.top) + 'px';
  tooltip.innerHTML = `<strong>${nome}</strong><br>${formatMoney(total)} · ${pedidos.length} pedido(s)`;
}

function mnHoverCidade(cidade, valor, evt) {
  const tooltip = document.getElementById('mn-mapa-tooltip');
  const wrap = document.getElementById('mn-mapa-wrap');
  if (!tooltip || !wrap) return;
  const rect = wrap.getBoundingClientRect();
  tooltip.style.display = 'block';
  tooltip.style.left = (evt.clientX - rect.left) + 'px';
  tooltip.style.top = (evt.clientY - rect.top) + 'px';
  tooltip.innerHTML = `<strong>${cidade}</strong><br>${formatMoney(valor)}`;
}

function mnHoverSai() {
  const tooltip = document.getElementById('mn-mapa-tooltip');
  if (tooltip) tooltip.style.display = 'none';
}

function mnClicarEstado(uf) {
  MN_ESTADO_SELECIONADO = MN_ESTADO_SELECIONADO === uf ? null : uf;
  mnHoverSai();
  renderMapaBrasil();
}

function voltarMapaBrasil() {
  MN_ESTADO_SELECIONADO = null;
  mnHoverSai();
  renderMapaBrasil();
}

function renderMnDetalheEstado() {
  const painel = document.getElementById('mn-mapa-detalhe');
  if (!painel) return;
  if (!MN_ESTADO_SELECIONADO) {
    painel.innerHTML = '<p class="empty-state">Passe o mouse sobre um estado para ver o total vendido, ou clique para dar zoom e ver as cidades.</p>';
    return;
  }
  const uf = MN_ESTADO_SELECIONADO;
  const estado = BRASIL_MAP_ESTADOS.find((e) => e.uf === uf);
  const nome = estado ? estado.nome : uf;
  const pedidos = getPedidosVenda().filter((p) => p.estado === uf);
  const porCidade = agregarPorChave(pedidos, 'cidade');
  const cidades = Object.keys(porCidade).sort((a, b) => porCidade[b] - porCidade[a]);

  let html = `<h3 style="margin:0 0 10px; font-size:14px;">${nome} (${uf})</h3>`;
  if (!cidades.length) {
    html += '<p class="empty-state" style="padding:10px 0;">Nenhuma venda registrada neste estado ainda.</p>';
  } else {
    cidades.forEach((cidade) => {
      html += `<div class="list-row"><div class="icon-dot">${initials(cidade)}</div><div class="list-row-main"><div class="list-row-title">${cidade}</div></div><div class="list-row-value">${formatMoney(porCidade[cidade])}</div></div>`;
    });
  }
  painel.innerHTML = html;
}


// ---------- Boxes do dashboard "Vendas" ----------

function renderDashboardVendas() {
  if (typeof Chart === 'undefined') return;
  const pedidos = getPedidosVenda();

  renderMapaBrasil();

  // 2) Situação da venda
  const porStatus = agregarPorChave(pedidos, 'status');
  if (MN_CHART_STATUS) MN_CHART_STATUS.destroy();
  const ctxStatus = document.getElementById('mn-chart-status');
  if (ctxStatus) {
    MN_CHART_STATUS = new Chart(ctxStatus.getContext('2d'), {
      type: 'doughnut',
      data: { labels: Object.keys(porStatus), datasets: [{ data: Object.values(porStatus), backgroundColor: ['#3fae12', '#b8862f', '#d0554f', '#4fa8d8'] }] },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
    });
  }

  // 3) Vendas por estado
  const porEstado = agregarPorChave(pedidos, 'estado');
  const estadosOrdenados = Object.keys(porEstado).sort((a, b) => porEstado[b] - porEstado[a]);
  if (MN_CHART_ESTADO) MN_CHART_ESTADO.destroy();
  const ctxEstado = document.getElementById('mn-chart-estado');
  if (ctxEstado) {
    MN_CHART_ESTADO = new Chart(ctxEstado.getContext('2d'), {
      type: 'bar',
      data: { labels: estadosOrdenados, datasets: [{ label: 'Vendas', data: estadosOrdenados.map((e) => porEstado[e]), backgroundColor: '#3fae12' }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => formatMoney(v) } } } },
    });
  }

  // 4) Vendas por produto
  const porProduto = agregarProdutosDosItens(pedidos);
  const produtosOrdenados = Object.keys(porProduto).sort((a, b) => porProduto[b] - porProduto[a]);
  if (MN_CHART_PRODUTO) MN_CHART_PRODUTO.destroy();
  const ctxProduto = document.getElementById('mn-chart-produto');
  if (ctxProduto) {
    MN_CHART_PRODUTO = new Chart(ctxProduto.getContext('2d'), {
      type: 'bar',
      data: { labels: produtosOrdenados, datasets: [{ label: 'Vendas', data: produtosOrdenados.map((p) => porProduto[p]), backgroundColor: '#4fa8d8' }] },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => formatMoney(v) } } } },
    });
  }
}

// ---------- Boxes do dashboard "Venda por vendedor" ----------

function renderDashboardVendedor() {
  if (typeof Chart === 'undefined') return;
  const pedidos = getPedidosVenda();

  // 1) Vendas por vendedor
  const porVendedor = agregarPorChave(pedidos, 'vendedor');
  const vendedoresOrdenados = Object.keys(porVendedor).sort((a, b) => porVendedor[b] - porVendedor[a]);
  if (MN_CHART_VENDEDOR) MN_CHART_VENDEDOR.destroy();
  const ctxVendedor = document.getElementById('mn-chart-vendedor');
  if (ctxVendedor) {
    MN_CHART_VENDEDOR = new Chart(ctxVendedor.getContext('2d'), {
      type: 'bar',
      data: { labels: vendedoresOrdenados, datasets: [{ label: 'Vendas', data: vendedoresOrdenados.map((v) => porVendedor[v]), backgroundColor: '#3fae12' }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => formatMoney(v) } } } },
    });
  }

  // 2) Vendas por produto (reaproveita a mesma agregação)
  const porProduto = agregarProdutosDosItens(pedidos);
  const produtosOrdenados = Object.keys(porProduto).sort((a, b) => porProduto[b] - porProduto[a]);
  if (MN_CHART_PRODUTO2) MN_CHART_PRODUTO2.destroy();
  const ctxProduto2 = document.getElementById('mn-chart-produto-2');
  if (ctxProduto2) {
    MN_CHART_PRODUTO2 = new Chart(ctxProduto2.getContext('2d'), {
      type: 'bar',
      data: { labels: produtosOrdenados, datasets: [{ label: 'Vendas', data: produtosOrdenados.map((p) => porProduto[p]), backgroundColor: '#4fa8d8' }] },
      options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { callback: (v) => formatMoney(v) } } } },
    });
  }

  // 3) Evolução (mês a mês, valor total vendido)
  const porMes = {};
  pedidos.forEach((p) => {
    if (!p.data) return;
    const mesKey = p.data.slice(0, 7);
    porMes[mesKey] = (porMes[mesKey] || 0) + Number(p.valor || 0);
  });
  const mesesOrdenados = Object.keys(porMes).sort();
  if (MN_CHART_EVOLUCAO) MN_CHART_EVOLUCAO.destroy();
  const ctxEvolucao = document.getElementById('mn-chart-evolucao');
  if (ctxEvolucao) {
    MN_CHART_EVOLUCAO = new Chart(ctxEvolucao.getContext('2d'), {
      type: 'line',
      data: { labels: mesesOrdenados.map((m) => formatMesLabelCurto(m)), datasets: [{ label: 'Vendas', data: mesesOrdenados.map((m) => porMes[m]), borderColor: '#3fae12', backgroundColor: 'rgba(63,174,18,0.14)', fill: true, tension: 0.3 }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => formatMoney(v) } } } },
    });
  }
}

// ---------- Página "Meu Negócio": navegação interna ----------

function initMeuNegocio() {
  cloudWatch('eagles_pedidos_venda_v1', pedidosVendaSeed(), (data) => {
    CADASTROS_DATA['pedido-venda'] = data;
    const secaoAtiva = document.querySelector('.mn-secao:not([style*="display: none"])');
    if (secaoAtiva && secaoAtiva.id === 'mn-secao-vendas') renderDashboardVendas();
    if (secaoAtiva && secaoAtiva.id === 'mn-secao-vendedor') renderDashboardVendedor();
  });
  const mesInput = document.getElementById('mn-dashboard-mes');
  if (mesInput) mesInput.value = '2026-09';
  FINANCE_MES_ATUAL = '2026-09';
  cloudWatch(FINANCE_TEMPLATE_KEY, financeTemplatePadrao(), (data) => { FINANCE_TEMPLATE_CACHE = data; });
  cloudWatch(FINANCE_CICLOS_KEY, {}, (data) => {
    FINANCE_CICLOS_CACHE = data;
    FINANCE_CICLO = getCicloDoMes(FINANCE_MES_ATUAL);
    gerarRelatorioPeriodo(1, 'mn-dashboard-conteudo', 'mn-dashboard-titulo');
  });
}

function mostrarSecaoNegocio(secao, btn) {
  document.querySelectorAll('.mn-secao').forEach((el) => { el.style.display = 'none'; });
  const alvo = document.getElementById('mn-secao-' + secao);
  if (alvo) alvo.style.display = '';
  document.querySelectorAll('.mn-nav-item').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (secao === 'vendas') renderDashboardVendas();
  if (secao === 'vendedor') renderDashboardVendedor();
}

function toggleMnSubmenu(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'flex' : 'none';
}
// =====================================================================
// ---------- Pedido de venda — formulário completo (estilo ERP) ----------
// =====================================================================

let PEDIDO_FORM_ITENS = [];
let PEDIDO_FORM_PARCELAS = [];
let PEDIDO_FORM_EDITANDO_ID = null;

let FINANCE_SYNC_PRONTO_PV = false;

function initPedidosVendaExtra() {
  cloudWatch(CLIENTES_FORN_KEY, clientesFornSeed(), (data) => {
    CLIENTES_FORN_DATA = data;
    const dl = document.getElementById('pv-lista-clientes');
    if (dl) dl.innerHTML = CLIENTES_FORN_DATA.map((c) => `<option value="${c.fantasia || c.nome}">`).join('');
  });
  cloudWatch('eagles_vendedores_v1', vendedoresSeed(), (data) => {
    CADASTROS_DATA['vendedor'] = data;
    const dl = document.getElementById('pv-lista-vendedores');
    if (dl) dl.innerHTML = data.map((v) => `<option value="${escapeHtml(v.nome)}">`).join('');
  });
  cloudWatch('eagles_produtos_v1', produtosSeed(), (data) => {
    CADASTROS_DATA['produto'] = data;
    const dl = document.getElementById('pv-lista-produtos');
    if (dl) dl.innerHTML = data.map((p) => `<option value="${escapeHtml(p.nome)}">`).join('');
  });
  // precisamos do ciclo financeiro carregado ANTES de permitir "Lançar",
  // senão salvar um mês novo poderia sobrescrever a nuvem com dados vazios.
  cloudWatch(FINANCE_TEMPLATE_KEY, financeTemplatePadrao(), (data) => { FINANCE_TEMPLATE_CACHE = data; });
  cloudWatch(FINANCE_CICLOS_KEY, {}, (data) => { FINANCE_CICLOS_CACHE = data; FINANCE_SYNC_PRONTO_PV = true; });
}

function criarLinhaItemVazia() {
  return { descricao: '', codigo: '', unidade: 'UN', quantidade: 1, precoLista: 0, descontoPct: 0 };
}

function calcularProximoNumeroPedido() {
  const dados = CADASTROS_DATA['pedido-venda'] || [];
  const nums = dados.map((p) => parseInt(p.numero, 10)).filter((n) => !isNaN(n));
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

function mostrarFormPedidoVenda() {
  document.getElementById('pv-lista-view').style.display = 'none';
  document.getElementById('pv-form-view').style.display = '';
}

function fecharFormPedidoVenda() {
  document.getElementById('pv-form-view').style.display = 'none';
  document.getElementById('pv-lista-view').style.display = '';
}

function limparCamposPedidoForm() {
  PEDIDO_FORM_PARCELAS = [];
  ['pv-cliente', 'pv-vendedor', 'pv-numero-pedido', 'pv-data-venda', 'pv-data-saida', 'pv-data-prevista',
   'pv-pedido-compra', 'pv-condicao-pagamento', 'pv-transportador-nome', 'pv-peso-bruto', 'pv-frete',
   'pv-observacoes', 'pv-transporte-qtd', 'pv-prazo-entrega'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('pv-desconto-venda').value = 0;
  document.getElementById('pv-outras-despesas').value = 0;
  document.getElementById('pv-frete-conta').value = '0';
  document.getElementById('pv-loja').selectedIndex = 0;
  document.getElementById('pv-unidade-negocio').selectedIndex = 0;
  document.getElementById('pv-lista-preco').selectedIndex = 0;
  document.getElementById('pv-categoria').selectedIndex = 0;
  document.getElementById('pv-endereco-diferente').checked = false;
  document.getElementById('pv-parcelas-resultado').innerHTML = '';
  const btnEditarParc = document.getElementById('btn-editar-parcelas');
  if (btnEditarParc) btnEditarParc.style.display = 'none';
  document.getElementById('pv-cliente-erro').style.display = 'none';
  mostrarAbaPedido('itens', document.querySelector('#pv-tabs button'));
}

function abrirNovoPedidoVenda() {
  PEDIDO_FORM_EDITANDO_ID = null;
  PEDIDO_FORM_ITENS = [criarLinhaItemVazia()];
  limparCamposPedidoForm();
  const numero = calcularProximoNumeroPedido();
  document.getElementById('pv-form-titulo').textContent = 'Pedido de venda - ' + numero;
  document.getElementById('pv-numero-pedido').value = numero;
  document.getElementById('pv-data-venda').value = isoHoje();
  document.getElementById('pv-data-saida').value = isoHoje();
  renderItensPedidoForm();
  recalcularTotaisPedido();
  mostrarFormPedidoVenda();
}

function abrirEditarPedidoVenda(id) {
  const lista = CADASTROS_DATA['pedido-venda'] || [];
  const registro = lista.find((p) => p.id === id);
  if (!registro) return;
  PEDIDO_FORM_EDITANDO_ID = id;
  PEDIDO_FORM_ITENS = (registro.itens && registro.itens.length) ? registro.itens.map((i) => ({ ...i })) : [criarLinhaItemVazia()];

  document.getElementById('pv-form-titulo').textContent = 'Pedido de venda - ' + (registro.numero || '');
  document.getElementById('pv-cliente').value = registro.cliente || '';
  document.getElementById('pv-vendedor').value = registro.vendedor || '';
  document.getElementById('pv-numero-pedido').value = registro.numero || '';
  document.getElementById('pv-data-venda').value = registro.data || '';
  document.getElementById('pv-data-saida').value = registro.dataSaida || '';
  document.getElementById('pv-data-prevista').value = registro.dataPrevista || '';
  document.getElementById('pv-pedido-compra').value = registro.pedidoCompra || '';
  document.getElementById('pv-condicao-pagamento').value = registro.condicaoPagamento || '';
  document.getElementById('pv-categoria').value = registro.categoria || 'Sem categoria';
  document.getElementById('pv-transportador-nome').value = registro.transportadorNome || '';
  document.getElementById('pv-frete-conta').value = registro.fretePorConta || '0';
  document.getElementById('pv-peso-bruto').value = registro.pesoBruto || 0;
  document.getElementById('pv-frete').value = registro.frete || 0;
  document.getElementById('pv-desconto-venda').value = registro.descontoGeral || 0;
  document.getElementById('pv-outras-despesas').value = registro.outrasDespesas || 0;
  document.getElementById('pv-observacoes').value = registro.observacoes || '';
  PEDIDO_FORM_PARCELAS = (registro.parcelasPersonalizadas || []).map((p) => ({ ...p }));
  renderResumoParcelas();
  document.getElementById('pv-cliente-erro').style.display = 'none';
  mostrarAbaPedido('itens', document.querySelector('#pv-tabs button'));

  renderItensPedidoForm();
  recalcularTotaisPedido();
  mostrarFormPedidoVenda();
}

function calcularPrecoUnitario(item) {
  const lista = Number(item.precoLista || 0);
  const desc = Number(item.descontoPct || 0);
  return lista * (1 - desc / 100);
}

function renderItensPedidoForm() {
  const tbody = document.getElementById('pv-itens-tbody');
  if (!tbody) return;
  tbody.innerHTML = PEDIDO_FORM_ITENS.map((item, idx) => {
    const precoUn = calcularPrecoUnitario(item);
    const precoTotal = precoUn * Number(item.quantidade || 0);
    return `<tr>
      <td style="color:var(--text-soft); font-size:12px;">${idx + 1}</td>
      <td><input type="text" value="${escapeHtml(item.descricao)}" list="pv-lista-produtos" oninput="atualizarItemPedido(${idx},'descricao',this.value)" placeholder="Pesquise por código, descrição ou GTIN"></td>
      <td style="width:90px;"><input type="text" value="${item.codigo}" oninput="atualizarItemPedido(${idx},'codigo',this.value)"></td>
      <td style="width:60px;"><input type="text" value="${item.unidade}" oninput="atualizarItemPedido(${idx},'unidade',this.value)"></td>
      <td style="width:80px;"><input type="number" value="${item.quantidade}" min="0" oninput="atualizarItemPedido(${idx},'quantidade',this.value)"></td>
      <td style="width:100px;"><input type="number" value="${item.precoLista}" min="0" step="0.01" oninput="atualizarItemPedido(${idx},'precoLista',this.value)"></td>
      <td style="width:80px;"><input type="number" value="${item.descontoPct}" min="0" max="100" step="0.1" oninput="atualizarItemPedido(${idx},'descontoPct',this.value)"></td>
      <td class="pv-item-preco-un" style="text-align:right; padding-right:10px; font-size:13px; white-space:nowrap;">${formatMoney(precoUn)}</td>
      <td class="pv-item-preco-total" style="text-align:right; padding-right:10px; font-size:13px; font-weight:600; white-space:nowrap;">${formatMoney(precoTotal)}</td>
      <td><button type="button" class="btn btn-small btn-ghost" style="color:var(--danger);" onclick="removerItemPedido(${idx})" title="Remover item"><svg style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td>
    </tr>`;
  }).join('');
}

function atualizarItemPedido(idx, campo, valor) {
  const numericos = ['quantidade', 'precoLista', 'descontoPct'];
  PEDIDO_FORM_ITENS[idx][campo] = numericos.includes(campo) ? Number(valor) : valor;

  if (campo === 'descricao') {
    const produto = (CADASTROS_DATA['produto'] || []).find((p) => p.nome === valor);
    if (produto) {
      PEDIDO_FORM_ITENS[idx].precoLista = Number(produto.precoVenda || 0);
      PEDIDO_FORM_ITENS[idx].codigo = produto.sku || '';
      PEDIDO_FORM_ITENS[idx].unidade = produto.unidade || 'UN';
      renderItensPedidoForm();
      recalcularTotaisPedido();
      return;
    }
  }

  const item = PEDIDO_FORM_ITENS[idx];
  const precoUn = calcularPrecoUnitario(item);
  const precoTotal = precoUn * Number(item.quantidade || 0);
  const linhas = document.querySelectorAll('#pv-itens-tbody tr');
  const row = linhas[idx];
  if (row) {
    row.querySelector('.pv-item-preco-un').textContent = formatMoney(precoUn);
    row.querySelector('.pv-item-preco-total').textContent = formatMoney(precoTotal);
  }
  recalcularTotaisPedido();
}

function adicionarItemPedido() {
  PEDIDO_FORM_ITENS.push(criarLinhaItemVazia());
  renderItensPedidoForm();
  recalcularTotaisPedido();
}

function removerItemPedido(idx) {
  if (PEDIDO_FORM_ITENS.length <= 1) { alert('O pedido precisa ter ao menos um item.'); return; }
  PEDIDO_FORM_ITENS.splice(idx, 1);
  renderItensPedidoForm();
  recalcularTotaisPedido();
}

function recalcularTotaisPedido() {
  const nItens = PEDIDO_FORM_ITENS.length;
  const somaQuantidades = PEDIDO_FORM_ITENS.reduce((a, i) => a + Number(i.quantidade || 0), 0);
  const totalItens = PEDIDO_FORM_ITENS.reduce((a, i) => a + calcularPrecoUnitario(i) * Number(i.quantidade || 0), 0);
  const descontoTotalItens = PEDIDO_FORM_ITENS.reduce((a, i) => {
    const lista = Number(i.precoLista || 0) * Number(i.quantidade || 0);
    const un = calcularPrecoUnitario(i) * Number(i.quantidade || 0);
    return a + (lista - un);
  }, 0);

  const descontoGeralEl = document.getElementById('pv-desconto-venda');
  const outrasDespesasEl = document.getElementById('pv-outras-despesas');
  const descontoGeral = Number((descontoGeralEl && descontoGeralEl.value) || 0);
  const outrasDespesas = Number((outrasDespesasEl && outrasDespesasEl.value) || 0);

  const vendedorNome = (document.getElementById('pv-vendedor') || {}).value || '';
  const vendedorInfo = (CADASTROS_DATA['vendedor'] || []).find((v) => v.nome === vendedorNome);
  const comissaoPct = vendedorInfo ? (parseFloat(String(vendedorInfo.comissao || '0').replace('%', '').replace(',', '.')) || 0) : 0;
  const totalComissoes = totalItens * (comissaoPct / 100);

  const totalVenda = totalItens - descontoGeral + outrasDespesas;

  document.getElementById('pv-total-n-itens').value = nItens;
  document.getElementById('pv-total-soma-qtd').value = somaQuantidades;
  document.getElementById('pv-total-desconto-venda').value = formatMoney(descontoGeral);
  document.getElementById('pv-total-comissoes').value = formatMoney(totalComissoes);
  document.getElementById('pv-total-desconto-itens').value = formatMoney(descontoTotalItens);
  document.getElementById('pv-total-itens').value = formatMoney(totalItens);
  document.getElementById('pv-total-venda').value = formatMoney(totalVenda);

  setText('pv-comissao-vendedor', vendedorNome || '—');
  setText('pv-comissao-pct', comissaoPct.toFixed(1) + '%');
  setText('pv-comissao-valor', formatMoney(totalComissoes));
}

function mostrarAbaPedido(aba, btn) {
  document.getElementById('pv-aba-itens').style.display = aba === 'itens' ? '' : 'none';
  document.getElementById('pv-aba-comissoes').style.display = aba === 'comissoes' ? '' : 'none';
  document.querySelectorAll('#pv-tabs button').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// Uma função só de verdade pro cálculo de parcelas — usada tanto na
// prévia (botão "Gerar parcelas") quanto no lançamento real no
// Financeiro, pra garantir que os dois SEMPRE batem certinho.
function calcularParcelas(condicao, dataBase, total) {
  condicao = (condicao || '').trim();
  dataBase = dataBase || isoHoje();
  total = Number(total || 0);

  // formato "30/60/90", "30/60", "30/45"... — dias corridos a partir da venda
  const diasMatch = condicao.match(/^\d+(\s*\/\s*\d+)+$/);
  if (diasMatch) {
    const diasArr = condicao.split('/').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    const valorParcela = total / diasArr.length;
    return diasArr.map((dias) => ({ data: adicionarDias(dataBase, dias), valor: valorParcela }));
  }

  // formato "5x", "3x"... — parcelas mensais iguais
  const xMatch = condicao.match(/(\d+)\s*x/i);
  if (xMatch) {
    const n = Math.max(1, parseInt(xMatch[1], 10));
    const valorParcela = total / n;
    const parcelas = [];
    for (let i = 0; i < n; i++) parcelas.push({ data: adicionarMeses(dataBase, i), valor: valorParcela });
    return parcelas;
  }

  // sem padrão reconhecido = à vista, uma parcela só
  return [{ data: dataBase, valor: total }];
}

function gerarParcelasPedido() {
  const condicao = (document.getElementById('pv-condicao-pagamento').value || '').trim();
  const dataVenda = document.getElementById('pv-data-venda').value || isoHoje();
  const totalVenda = PEDIDO_FORM_ITENS.reduce((a, i) => a + calcularPrecoUnitario(i) * Number(i.quantidade || 0), 0)
    - Number(document.getElementById('pv-desconto-venda').value || 0) + Number(document.getElementById('pv-outras-despesas').value || 0);

  PEDIDO_FORM_PARCELAS = calcularParcelas(condicao, dataVenda, totalVenda);
  renderResumoParcelas();
}

function renderResumoParcelas() {
  const resultadoEl = document.getElementById('pv-parcelas-resultado');
  const btnEditar = document.getElementById('btn-editar-parcelas');
  if (!PEDIDO_FORM_PARCELAS.length) {
    resultadoEl.innerHTML = '';
    if (btnEditar) btnEditar.style.display = 'none';
    return;
  }
  const partes = PEDIDO_FORM_PARCELAS.map((p, idx) => `${idx + 1}ª: ${formatDatePt(p.data)} — ${formatMoney(p.valor)}`);
  resultadoEl.innerHTML = `<strong>${PEDIDO_FORM_PARCELAS.length}x</strong> — ${partes.join(' · ')}`;
  if (btnEditar) btnEditar.style.display = '';
}

// ---------- Editar parcelas (ajustar data/valor de cada uma antes de lançar) ----------

function abrirEditorParcelas() {
  if (!PEDIDO_FORM_PARCELAS.length) return;
  const tbody = document.getElementById('pv-parcelas-editor-tbody');
  tbody.innerHTML = PEDIDO_FORM_PARCELAS.map((p, idx) => `
    <tr>
      <td>${idx + 1}ª</td>
      <td><input type="date" value="${p.data}" onchange="PEDIDO_FORM_PARCELAS[${idx}].data = this.value"></td>
      <td><input type="number" step="0.01" value="${Number(p.valor).toFixed(2)}" onchange="PEDIDO_FORM_PARCELAS[${idx}].valor = Number(this.value)"></td>
    </tr>`).join('');
  openModal('modal-editar-parcelas');
}

function salvarEdicaoParcelas() {
  renderResumoParcelas();
  closeModal('modal-editar-parcelas');
}

function verificarClientePedido() {
  const nome = document.getElementById('pv-cliente').value.trim();
  const erroEl = document.getElementById('pv-cliente-erro');
  if (!nome) { erroEl.style.display = 'none'; return true; }
  const existe = CLIENTES_FORN_DATA.some((c) => (c.fantasia || c.nome) === nome || c.nome === nome);
  if (!existe) {
    erroEl.innerHTML = `⚠ O cliente "${nome}" não está cadastrado.
      <div style="margin-top:8px;"><button type="button" class="btn btn-small btn-primary" onclick="window.open('clientes-fornecedores.html','_blank')">Cadastrar agora</button></div>`;
    erroEl.style.display = '';
    return false;
  }
  erroEl.style.display = 'none';
  return true;
}

function salvarPedidoVenda() {
  const cliente = document.getElementById('pv-cliente').value.trim();
  if (!cliente) { alert('Informe o cliente.'); return; }
  if (!verificarClientePedido()) { return; }
  if (!PEDIDO_FORM_ITENS.some((i) => i.descricao.trim())) { alert('Adicione ao menos um item com descrição.'); return; }

  const vendedor = document.getElementById('pv-vendedor').value.trim();
  const numero = document.getElementById('pv-numero-pedido').value.trim() || calcularProximoNumeroPedido();
  const dataVenda = document.getElementById('pv-data-venda').value;
  const descontoGeral = Number(document.getElementById('pv-desconto-venda').value || 0);
  const outrasDespesas = Number(document.getElementById('pv-outras-despesas').value || 0);
  const totalItens = PEDIDO_FORM_ITENS.reduce((a, i) => a + calcularPrecoUnitario(i) * Number(i.quantidade || 0), 0);
  const totalVenda = totalItens - descontoGeral + outrasDespesas;

  const clienteInfo = CLIENTES_FORN_DATA.find((c) => (c.fantasia || c.nome) === cliente || c.nome === cliente);
  const estado = clienteInfo ? clienteInfo.estado : '';
  const cidade = clienteInfo ? clienteInfo.cidade : '';
  const produtoResumo = PEDIDO_FORM_ITENS.map((i) => i.descricao).filter(Boolean).join(', ') || '—';

  const lista = CADASTROS_DATA['pedido-venda'] || [];
  const registroAnterior = PEDIDO_FORM_EDITANDO_ID ? lista.find((p) => p.id === PEDIDO_FORM_EDITANDO_ID) : null;

  const registro = {
    id: PEDIDO_FORM_EDITANDO_ID || genId('pv'),
    numero, cliente, vendedor,
    produto: produtoResumo, estado, cidade,
    data: dataVenda, valor: totalVenda,
    status: (registroAnterior && registroAnterior.status) || 'aberto',
    itens: PEDIDO_FORM_ITENS.slice(),
    loja: document.getElementById('pv-loja').value,
    unidadeNegocio: document.getElementById('pv-unidade-negocio').value,
    listaPreco: document.getElementById('pv-lista-preco').value,
    dataSaida: document.getElementById('pv-data-saida').value,
    dataPrevista: document.getElementById('pv-data-prevista').value,
    pedidoCompra: document.getElementById('pv-pedido-compra').value,
    condicaoPagamento: document.getElementById('pv-condicao-pagamento').value,
    categoria: document.getElementById('pv-categoria').value,
    transportadorNome: document.getElementById('pv-transportador-nome').value,
    fretePorConta: document.getElementById('pv-frete-conta').value,
    pesoBruto: Number(document.getElementById('pv-peso-bruto').value || 0),
    frete: Number(document.getElementById('pv-frete').value || 0),
    descontoGeral, outrasDespesas, totalItens,
    parcelasPersonalizadas: PEDIDO_FORM_PARCELAS.length ? PEDIDO_FORM_PARCELAS.map((p) => ({ ...p })) : null,
    enderecoDiferente: document.getElementById('pv-endereco-diferente').checked,
    observacoes: document.getElementById('pv-observacoes').value,
  };

  if (PEDIDO_FORM_EDITANDO_ID) {
    const idx = lista.findIndex((p) => p.id === PEDIDO_FORM_EDITANDO_ID);
    if (idx > -1) lista[idx] = registro; else lista.push(registro);
  } else {
    lista.push(registro);
  }
  CADASTROS_DATA['pedido-venda'] = lista;
  cloudSet('eagles_pedidos_venda_v1', lista);
  renderCadastroTabela('pedido-venda');
  fecharFormPedidoVenda();
}
// =====================================================================
// ---------- Pedido de venda — menu de ações (⋮) ----------
// =====================================================================

function buscarPedidoPorId(id) {
  return (CADASTROS_DATA['pedido-venda'] || []).find((p) => p.id === id);
}

// O menu (⋮) é renderizado como um painel único, fixo na tela e anexado
// fora da tabela — se ficasse dentro da tabela (que tem overflow para
// rolagem horizontal), o menu ficava cortado/escondido.

function montarMenuAcoesGlobal() {
  if (document.getElementById('acoes-menu-global')) return;
  const div = document.createElement('div');
  div.innerHTML = '<div class="mega-menu" id="acoes-menu-global" style="position:fixed; display:none; max-height:80vh; overflow-y:auto; z-index:500;"></div>';
  document.body.appendChild(div);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#acoes-menu-global') && !e.target.closest('.row-menu-btn')) {
      fecharMenuAcoesGlobal();
    }
  });
  // Fecha só ao clicar de novo no botão (⋮) ou clicar fora da caixinha —
  // rolar a página ou rolar dentro do próprio menu NÃO fecha mais.
  window.addEventListener('resize', fecharMenuAcoesGlobal);
}

function fecharMenuAcoesGlobal() {
  const menu = document.getElementById('acoes-menu-global');
  if (menu) menu.style.display = 'none';
}

function conteudoMenuAcoesPedido(item) {
  const lancadoLabel = item.lancadoFinanceiro ? 'Lançar novamente' : 'Lançar';
  return `
    <button type="button" class="mega-link" onclick="lancarPedidoNoFinanceiro('${item.id}')">${lancadoLabel}${item.lancadoFinanceiro ? ' ✓' : ''}</button>
    <button type="button" class="mega-link" onclick="imprimirDocumentoPedido('${item.id}','completo')">Exportar em PDF</button>
    <button type="button" class="mega-link" onclick="gerarNotaServicoPedido('${item.id}')">Gerar nota serviço</button>
    <button type="button" class="mega-link" onclick="gerarOrdemServicoPedido('${item.id}')">Gerar ordem serviço</button>
    <button type="button" class="mega-link" onclick="clonarPedidoVenda('${item.id}')">Clonar venda</button>
    <button type="button" class="mega-link" onclick="imprimirDocumentoPedido('${item.id}','simples')">Imprimir</button>
    <button type="button" class="mega-link" onclick="imprimirDocumentoPedido('${item.id}','comprovante')">Imprimir comprovante</button>
    <button type="button" class="mega-link" onclick="imprimirDocumentoPedido('${item.id}','detalhado')">Imprimir c/ detalhes</button>
    <button type="button" class="mega-link" onclick="imprimirDocumentoPedido('${item.id}','etiqueta')">Imprimir etiqueta de envio</button>
    <button type="button" class="mega-link" onclick="imprimirDocumentoPedido('${item.id}','carne')">Imprimir carnê</button>
    <button type="button" class="mega-link" onclick="imprimirDocumentoPedido('${item.id}','producao')">Relatório de produção</button>
    <button type="button" class="mega-link" onclick="enviarPedidoEmail('${item.id}')">Enviar por e-mail</button>
    <button type="button" class="mega-link" onclick="enviarPedidoWhatsApp('${item.id}')">Enviar por WhatsApp</button>
    <button type="button" class="mega-link" onclick="emitirBoletosPedido('${item.id}')">Emitir boletos</button>
    <div style="border-top:1px solid var(--border); margin-top:4px; padding-top:4px;">
      <button type="button" class="mega-link row-menu-danger" onclick="fecharMenuAcoesGlobal(); excluirCadastroItem('pedido-venda','${item.id}')">Excluir</button>
    </div>`;
}

function abrirMenuAcoesPedido(id, btnEl) {
  montarMenuAcoesGlobal();
  const item = buscarPedidoPorId(id);
  if (!item) return;
  const menu = document.getElementById('acoes-menu-global');
  const jaAberto = menu.style.display === 'block' && menu.dataset.pedidoId === id;
  if (jaAberto) { fecharMenuAcoesGlobal(); return; }

  menu.innerHTML = conteudoMenuAcoesPedido(item);
  menu.dataset.pedidoId = id;
  menu.style.display = 'block';

  const rect = btnEl.getBoundingClientRect();
  const menuWidth = 230;
  let left = rect.right - menuWidth;
  if (left < 8) left = 8;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;

  // Sempre abre para baixo do botão. Se não houver espaço suficiente até o
  // fim da tela, o menu fica mais baixo (nunca "para cima") e ganha
  // rolagem própria dentro dele — nunca corta as opções de fora da tela.
  const top = rect.bottom + 6;
  const espacoAbaixo = window.innerHeight - top - 10;
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.maxHeight = Math.max(140, espacoAbaixo) + 'px';
  menu.style.overflowY = 'auto';
}

function renderMenuAcoesPedido(item) {
  return `<button type="button" class="row-menu-btn" onclick="abrirMenuAcoesPedido('${item.id}', this)">⋮</button>`;
}

// ---------- Lançar no Financeiro (respeita parcelamento) ----------

function adicionarDias(dataIso, dias) {
  const d = new Date(dataIso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function adicionarMeses(dataIso, meses) {
  const d = new Date(dataIso + 'T00:00:00');
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}

function calcularParcelasPedidoParaLancamento(pedido) {
  // Se as parcelas já foram geradas/ajustadas no formulário, usa EXATAMENTE
  // elas — assim o que aparece no Financeiro bate certinho com o que a
  // pessoa viu e editou na hora de montar o pedido.
  if (pedido.parcelasPersonalizadas && pedido.parcelasPersonalizadas.length) {
    return pedido.parcelasPersonalizadas.map((p) => ({ data: p.data, valor: Number(p.valor) }));
  }
  return calcularParcelas(pedido.condicaoPagamento, pedido.data, pedido.valor);
}

function lancarPedidoNoFinanceiro(id) {
  fecharTodosDropdowns();
  if (!FINANCE_SYNC_PRONTO_PV) { alert('Ainda sincronizando os dados financeiros — aguarde um instante e tente de novo.'); return; }

  const lista = CADASTROS_DATA['pedido-venda'] || [];
  const pedido = lista.find((p) => p.id === id);
  if (!pedido) return;

  if (pedido.lancadoFinanceiro) {
    if (!window.confirm('Este pedido já foi lançado no Financeiro antes. Lançar de novo cria lançamentos duplicados. Continuar?')) return;
  }

  const parcelas = calcularParcelasPedidoParaLancamento(pedido);
  const mesesAfetados = [];

  parcelas.forEach((parcela) => {
    const mesKey = parcela.data.slice(0, 7);
    const dia = Number(parcela.data.slice(8, 10)) || 1;
    const ciclo = getCicloDoMes(mesKey);
    ciclo.receitas.push({
      id: genId('r'),
      cliente: pedido.cliente,
      plano: 'Pedido de venda nº ' + pedido.numero + (parcelas.length > 1 ? ` (parcela ${mesesAfetados.length + 1}/${parcelas.length})` : ''),
      valor: parcela.valor,
      diaAcerto: dia,
      status: 'pendente',
      dataPagamento: null,
      origemPedidoId: pedido.id,
    });
    salvarCicloDoMes(mesKey, ciclo);
    if (!mesesAfetados.includes(mesKey)) mesesAfetados.push(mesKey);
  });

  pedido.lancadoFinanceiro = true;
  pedido.status = 'faturado';
  CADASTROS_DATA['pedido-venda'] = lista;
  cloudSet('eagles_pedidos_venda_v1', lista);
  renderCadastroTabela('pedido-venda');

  const mesesTexto = mesesAfetados.map((m) => formatMesLabel(m)).join(', ');
  alert(`Lançamento a receber criado no Financeiro!\n${parcelas.length} parcela(s) distribuída(s) em: ${mesesTexto}.`);
}

// ---------- Clonar venda ----------

function clonarPedidoVenda(id) {
  fecharTodosDropdowns();
  const pedido = buscarPedidoPorId(id);
  if (!pedido) return;
  if (!window.confirm(`Clonar o pedido nº ${pedido.numero}? Isso cria um novo pedido com os mesmos itens e dados, pronto para editar.`)) return;
  const lista = CADASTROS_DATA['pedido-venda'] || [];
  const novoNumero = calcularProximoNumeroPedido();
  const clone = {
    ...pedido,
    id: genId('pv'),
    numero: novoNumero,
    status: 'aberto',
    lancadoFinanceiro: false,
    data: isoHoje(),
    itens: (pedido.itens || []).map((i) => ({ ...i })),
  };
  lista.push(clone);
  CADASTROS_DATA['pedido-venda'] = lista;
  cloudSet('eagles_pedidos_venda_v1', lista);
  renderCadastroTabela('pedido-venda');
  alert(`Pedido clonado como nº ${novoNumero}.`);
}

// ---------- Documentos para impressão ----------

function montarLinhasItensPedido(pedido) {
  const itens = pedido.itens || [];
  if (!itens.length) return '<tr><td colspan="5">Nenhum item.</td></tr>';
  return itens.map((i) => {
    const precoUn = calcularPrecoUnitario(i);
    const total = precoUn * Number(i.quantidade || 0);
    return `<tr><td style="padding:6px;">${escapeHtml(i.descricao)}</td><td style="padding:6px;">${escapeHtml(i.codigo || '—')}</td><td style="padding:6px;">${i.quantidade}</td><td style="padding:6px;">${formatMoney(precoUn)}</td><td style="padding:6px;">${formatMoney(total)}</td></tr>`;
  }).join('');
}

function montarLinhasItensPedidoCompleto(pedido) {
  const itens = pedido.itens || [];
  if (!itens.length) return '<tr><td colspan="8" style="padding:6px;">Nenhum item.</td></tr>';
  return itens.map((i) => {
    const precoUn = calcularPrecoUnitario(i);
    const total = precoUn * Number(i.quantidade || 0);
    return `<tr>
      <td style="padding:6px; border-bottom:1px solid #eee;">${escapeHtml(i.descricao)}</td>
      <td style="padding:6px; border-bottom:1px solid #eee;">${escapeHtml(i.codigo || '—')}</td>
      <td style="padding:6px; border-bottom:1px solid #eee;">${escapeHtml(i.unidade || 'UN')}</td>
      <td style="padding:6px; border-bottom:1px solid #eee;">${i.quantidade}</td>
      <td style="padding:6px; border-bottom:1px solid #eee;">${formatMoney(i.precoLista)}</td>
      <td style="padding:6px; border-bottom:1px solid #eee;">${Number(i.descontoPct || 0)}%</td>
      <td style="padding:6px; border-bottom:1px solid #eee;">${formatMoney(precoUn)}</td>
      <td style="padding:6px; border-bottom:1px solid #eee; font-weight:600;">${formatMoney(total)}</td>
    </tr>`;
  }).join('');
}

const FRETE_POR_CONTA_LABELS = {
  '0': '0 - Contratação do Frete por conta do Remetente (CIF)',
  '1': '1 - Contratação do Frete por conta do Destinatário (FOB)',
  '2': '2 - Sem transporte',
};

// Documento completo pra exportar em PDF — reproduz TODAS as seções do
// formulário do pedido, preenchidas, como uma tabela/ficha só (usa
// window.print(), então a pessoa escolhe "Salvar como PDF" no navegador).
function montarDocumentoCompletoPedido(pedido, empresa) {
  const nItens = (pedido.itens || []).length;
  const somaQuantidades = (pedido.itens || []).reduce((a, i) => a + Number(i.quantidade || 0), 0);
  const totalItens = Number(pedido.totalItens || 0);
  const descontoTotalItens = (pedido.itens || []).reduce((a, i) => {
    const lista = Number(i.precoLista || 0) * Number(i.quantidade || 0);
    const un = calcularPrecoUnitario(i) * Number(i.quantidade || 0);
    return a + (lista - un);
  }, 0);

  const linha = (label, valor) => `<div><div style="font-size:10.5px; color:#888; text-transform:uppercase; letter-spacing:0.3px;">${escapeHtml(label)}</div><div style="font-size:13px; margin-top:2px;">${valor}</div></div>`;
  const secao = (titulo, conteudoHtml) => `
    <div style="margin-top:22px;">
      <div style="font-size:11.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; color:#333; border-bottom:1.5px solid #333; padding-bottom:6px; margin-bottom:12px;">${escapeHtml(titulo)}</div>
      ${conteudoHtml}
    </div>`;

  return `
    <div style="padding:30px; font-family: Inter, sans-serif; color:#111; max-width:800px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h1 style="font-size:21px; margin:0 0 2px;">${escapeHtml(empresa)}</h1>
          <p style="color:#555; margin:0; font-size:13px;">Pedido de venda nº ${escapeHtml(pedido.numero)} — documento completo</p>
        </div>
        <div style="text-align:right; font-size:12px; color:#555;">Emitido em ${formatDatePt(isoHoje())}</div>
      </div>

      ${secao('Dados gerais', `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px 24px;">
          ${linha('Cliente', escapeHtml(pedido.cliente || '—'))}
          ${linha('Vendedor', escapeHtml(pedido.vendedor || '—'))}
          ${linha('Loja', escapeHtml(pedido.loja || '—'))}
          ${linha('Unidade de negócio', escapeHtml(pedido.unidadeNegocio || '—'))}
          ${linha('Lista de preço', escapeHtml(pedido.listaPreco || '—'))}
        </div>`)}

      ${secao('Itens do pedido', `
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead><tr>
            <th style="text-align:left; padding:6px; border-bottom:2px solid #333;">Descrição</th>
            <th style="text-align:left; padding:6px; border-bottom:2px solid #333;">Código</th>
            <th style="text-align:left; padding:6px; border-bottom:2px solid #333;">Un</th>
            <th style="text-align:left; padding:6px; border-bottom:2px solid #333;">Qtd.</th>
            <th style="text-align:left; padding:6px; border-bottom:2px solid #333;">Preço lista</th>
            <th style="text-align:left; padding:6px; border-bottom:2px solid #333;">Desc.</th>
            <th style="text-align:left; padding:6px; border-bottom:2px solid #333;">Preço un.</th>
            <th style="text-align:left; padding:6px; border-bottom:2px solid #333;">Preço total</th>
          </tr></thead>
          <tbody>${montarLinhasItensPedidoCompleto(pedido)}</tbody>
        </table>`)}

      ${secao('Totais', `
        <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:14px 20px;">
          ${linha('Nº de itens', nItens)}
          ${linha('Soma das quantidades', somaQuantidades)}
          ${linha('Desconto', formatMoney(pedido.descontoGeral))}
          ${linha('Outras despesas', formatMoney(pedido.outrasDespesas))}
          ${linha('Desconto total dos itens', formatMoney(descontoTotalItens))}
          ${linha('Total dos itens', formatMoney(totalItens))}
          ${linha('Total da venda', `<strong>${formatMoney(pedido.valor)}</strong>`)}
        </div>`)}

      ${secao('Detalhes da venda', `
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px 20px;">
          ${linha('Número do pedido', escapeHtml(pedido.numero || '—'))}
          ${linha('Data da venda', formatDatePt(pedido.data))}
          ${linha('Data saída', pedido.dataSaida ? formatDatePt(pedido.dataSaida) : '—')}
          ${linha('Data prevista', pedido.dataPrevista ? formatDatePt(pedido.dataPrevista) : '—')}
          ${linha('Pedido de compra', escapeHtml(pedido.pedidoCompra || '—'))}
          ${linha('Status', escapeHtml(pedido.status || '—'))}
        </div>`)}

      ${secao('Pagamento', `
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px 20px;">
          ${linha('Condição de pagamento', escapeHtml(pedido.condicaoPagamento || 'À vista'))}
          ${linha('Categoria', escapeHtml(pedido.categoria || '—'))}
        </div>`)}

      ${secao('Transportador', `
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px 20px;">
          ${linha('Nome', escapeHtml(pedido.transportadorNome || '—'))}
          ${linha('Frete por conta', escapeHtml(FRETE_POR_CONTA_LABELS[pedido.fretePorConta] || '—'))}
          ${linha('Peso bruto', pedido.pesoBruto ? pedido.pesoBruto + ' kg' : '—')}
          ${linha('Frete', formatMoney(pedido.frete))}
        </div>`)}

      ${secao('Logística', `
        <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:12px 20px;">
          ${linha('Endereço de entrega diferente da cobrança', pedido.enderecoDiferente ? 'Sim' : 'Não')}
        </div>`)}

      ${secao('Observações', `<p style="font-size:13px; margin:0; white-space:pre-wrap;">${escapeHtml(pedido.observacoes || '—')}</p>`)}
    </div>`;
}

function imprimirDocumentoPedido(id, tipo) {
  fecharTodosDropdowns();
  const pedido = buscarPedidoPorId(id);
  if (!pedido) return;

  const empresa = (PERFIL_DATA && (PERFIL_DATA.nomeFantasia || PERFIL_DATA.nomeEmpresa)) || 'Eagles Labz';
  const linhasItens = montarLinhasItensPedido(pedido);

  if (tipo === 'etiqueta') {
    document.getElementById('print-area').innerHTML = `
      <div style="padding:20px; font-family:Inter,sans-serif; width:320px; border:1px dashed #999;">
        <div style="font-size:11px; color:#777;">Remetente: ${empresa}</div>
        <h2 style="margin:12px 0 4px; font-size:16px;">${escapeHtml(pedido.cliente)}</h2>
        <p style="margin:0; font-size:13px;">${escapeHtml(pedido.cidade || '')}${pedido.cidade && pedido.estado ? ' - ' : ''}${escapeHtml(pedido.estado || '')}</p>
        <p style="margin:12px 0 0; font-size:12px; color:#777;">Pedido nº ${escapeHtml(pedido.numero)}</p>
      </div>`;
    window.print();
    return;
  }

  if (tipo === 'completo') {
    document.getElementById('print-area').innerHTML = montarDocumentoCompletoPedido(pedido, empresa);
    window.print();
    return;
  }

  let titulo = 'Pedido de venda';
  let corpoExtra = '';
  let mostraTabelaItens = true;

  if (tipo === 'comprovante') {
    titulo = 'Comprovante de venda';
    corpoExtra = `<p style="font-size:13px;">Comprovante referente ao pedido nº ${escapeHtml(pedido.numero)}, cliente ${escapeHtml(pedido.cliente)}, no valor total de <strong>${formatMoney(pedido.valor)}</strong>.</p>`;
    mostraTabelaItens = false;
  } else if (tipo === 'detalhado') {
    titulo = 'Pedido de venda — detalhado';
  } else if (tipo === 'carne') {
    titulo = 'Carnê de pagamento';
    mostraTabelaItens = false;
    const parcelas = calcularParcelasPedidoParaLancamento(pedido);
    corpoExtra = `<table style="width:100%; border-collapse:collapse; margin-top:14px; font-size:12px;">
      <thead><tr><th style="text-align:left; border-bottom:1px solid #ccc; padding:6px;">Parcela</th><th style="text-align:left; border-bottom:1px solid #ccc; padding:6px;">Vencimento</th><th style="text-align:left; border-bottom:1px solid #ccc; padding:6px;">Valor</th></tr></thead>
      <tbody>${parcelas.map((p, idx) => `<tr><td style="padding:6px;">${idx + 1}/${parcelas.length}</td><td style="padding:6px;">${formatDatePt(p.data)}</td><td style="padding:6px;">${formatMoney(p.valor)}</td></tr>`).join('')}</tbody>
    </table>`;
  } else if (tipo === 'producao') {
    titulo = 'Relatório de produção';
    corpoExtra = `<p style="font-size:13px;">Itens a produzir/separar para o pedido nº ${escapeHtml(pedido.numero)}:</p>`;
  } else if (tipo === 'nota-servico') {
    titulo = 'Nota de serviço';
  } else if (tipo === 'ordem-servico') {
    titulo = 'Ordem de serviço';
  }

  document.getElementById('print-area').innerHTML = `
    <div style="padding:30px; font-family: Inter, sans-serif; color:#111;">
      <h1 style="font-size:20px; margin-bottom:2px;">${empresa}</h1>
      <p style="color:#555; margin-top:0;">${titulo} — Pedido nº ${escapeHtml(pedido.numero)}</p>
      <p style="font-size:13px;">Cliente: <strong>${escapeHtml(pedido.cliente)}</strong>${pedido.vendedor ? ' · Vendedor: ' + escapeHtml(pedido.vendedor) : ''}</p>
      <p style="font-size:13px;">Data da venda: ${formatDatePt(pedido.data)} · Total: <strong>${formatMoney(pedido.valor)}</strong></p>
      ${corpoExtra}
      ${mostraTabelaItens ? `
      <table style="width:100%; border-collapse:collapse; margin-top:16px; font-size:12px;">
        <thead><tr>
          <th style="text-align:left; border-bottom:1px solid #ccc; padding:6px;">Descrição</th>
          <th style="text-align:left; border-bottom:1px solid #ccc; padding:6px;">Código</th>
          <th style="text-align:left; border-bottom:1px solid #ccc; padding:6px;">Qtd.</th>
          <th style="text-align:left; border-bottom:1px solid #ccc; padding:6px;">Preço un.</th>
          <th style="text-align:left; border-bottom:1px solid #ccc; padding:6px;">Total</th>
        </tr></thead>
        <tbody>${linhasItens}</tbody>
      </table>` : ''}
      ${tipo === 'detalhado' ? `
      <p style="font-size:12px; color:#555; margin-top:14px;">Observações: ${escapeHtml(pedido.observacoes || '—')}</p>
      <p style="font-size:12px; color:#555;">Condição de pagamento: ${escapeHtml(pedido.condicaoPagamento || '—')} · Transportador: ${escapeHtml(pedido.transportadorNome || '—')}</p>` : ''}
    </div>`;
  window.print();
}

function gerarNotaServicoPedido(id) { imprimirDocumentoPedido(id, 'nota-servico'); }
function gerarOrdemServicoPedido(id) { imprimirDocumentoPedido(id, 'ordem-servico'); }

// ---------- Enviar por e-mail / WhatsApp ----------

function enviarPedidoEmail(id) {
  fecharTodosDropdowns();
  const pedido = buscarPedidoPorId(id);
  if (!pedido) return;
  const clienteInfo = CLIENTES_FORN_DATA.find((c) => (c.fantasia || c.nome) === pedido.cliente || c.nome === pedido.cliente);
  const destinatario = clienteInfo ? (clienteInfo.email || '') : '';
  const assunto = encodeURIComponent(`Pedido de venda nº ${pedido.numero}`);
  const itensTexto = (pedido.itens || []).map((i) => `- ${i.descricao} (${i.quantidade}x)`).join('\n');
  const corpo = encodeURIComponent(`Olá,\n\nSegue o resumo do pedido nº ${pedido.numero}:\n\nCliente: ${pedido.cliente}\nData: ${formatDatePt(pedido.data)}\nTotal: ${formatMoney(pedido.valor)}\n\nItens:\n${itensTexto}\n\nAtenciosamente.`);
  window.location.href = `mailto:${destinatario}?subject=${assunto}&body=${corpo}`;
}

function enviarPedidoWhatsApp(id) {
  fecharTodosDropdowns();
  const pedido = buscarPedidoPorId(id);
  if (!pedido) return;
  const clienteInfo = CLIENTES_FORN_DATA.find((c) => (c.fantasia || c.nome) === pedido.cliente || c.nome === pedido.cliente);
  const numero = clienteInfo ? limparNumeros(clienteInfo.whatsapp || clienteInfo.telefone1 || '') : '';
  const texto = encodeURIComponent(`Olá! Segue o resumo do seu pedido nº ${pedido.numero}, no valor de ${formatMoney(pedido.valor)}.`);
  const url = numero ? `https://wa.me/55${numero}?text=${texto}` : `https://wa.me/?text=${texto}`;
  window.open(url, '_blank');
}

function emitirBoletosPedido(id) {
  fecharTodosDropdowns();
  alert('Emitir boletos de verdade (com código de barras válido) exige conectar uma integração bancária ou gateway de pagamento, que este sistema ainda não tem. Por enquanto, use "Lançar" + "Gerar parcelas" e acompanhe o recebimento pela aba Financeiro.');
}
// =====================================================================
// ---------- Gestão de usuários (TenantAdmin) ----------
// =====================================================================
//
// Criar um novo login sem derrubar a sessão de quem está criando exige um
// truque: abrir uma SEGUNDA instância do Firebase só pra esse cadastro,
// já que criar um usuário loga automaticamente com ele na instância que
// fez a chamada. A sessão "principal" (o admin que está usando o app)
// nunca é tocada.

const LIMITE_USUARIOS_POR_EMPRESA = 5;
let USUARIOS_TENANT_DATA = [];

function initUsuariosPage() {
  if (!(USUARIO_ROLE === 'TenantAdmin' || USUARIO_ROLE === 'SuperAdmin')) {
    document.getElementById('usuarios-sem-permissao').style.display = '';
    document.getElementById('usuarios-conteudo').style.display = 'none';
    return;
  }
  escutarUsuariosTenant();
}

function escutarUsuariosTenant() {
  if (!FIREBASE_PRONTO || !TENANT_ID) return;
  firestoreDb.collection('usuarios').where('tenantId', '==', TENANT_ID).onSnapshot((snap) => {
    USUARIOS_TENANT_DATA = [];
    snap.forEach((doc) => USUARIOS_TENANT_DATA.push({ uid: doc.id, ...doc.data() }));
    renderUsuariosTenant();
  }, (err) => {
    console.error('Erro ao listar usuários da empresa:', err);
  });
}

function renderUsuariosTenant() {
  const tbody = document.getElementById('tabela-usuarios-body');
  const contadorEl = document.getElementById('usuarios-contador');
  if (contadorEl) contadorEl.textContent = `${USUARIOS_TENANT_DATA.length} de ${LIMITE_USUARIOS_POR_EMPRESA} usuários`;
  const btnNovo = document.getElementById('btn-novo-usuario');
  if (btnNovo) btnNovo.disabled = USUARIOS_TENANT_DATA.length >= LIMITE_USUARIOS_POR_EMPRESA;

  if (!tbody) return;
  if (!USUARIOS_TENANT_DATA.length) {
    tbody.innerHTML = emptyCadastroHtml("openModal('modal-novo-usuario')", 4);
    return;
  }
  tbody.innerHTML = USUARIOS_TENANT_DATA.map((u) => `
    <tr>
      <td><div class="person-cell"><div class="avatar">${escapeHtml(initials(u.nome || u.email))}</div><div class="person-name">${escapeHtml(u.nome || '—')}</div></div></td>
      <td>${escapeHtml(u.email || '—')}</td>
      <td><span class="badge badge-blue">${escapeHtml(traduzirRole(u.role))}</span></td>
      <td style="text-align:right;">
        ${u.uid === USUARIO_UID ? '<span style="font-size:12px; color:var(--text-soft);">você</span>' : `<button class="btn btn-small btn-ghost" style="color:var(--danger);" onclick="removerAcessoUsuario('${u.uid}')">Remover acesso</button>`}
      </td>
    </tr>`).join('');
}

async function criarNovoUsuarioTenant(e) {
  e.preventDefault();
  if (USUARIOS_TENANT_DATA.length >= LIMITE_USUARIOS_POR_EMPRESA) {
    alert(`Limite de ${LIMITE_USUARIOS_POR_EMPRESA} usuários atingido para esta empresa.`);
    return;
  }
  const nome = document.getElementById('novo-usuario-nome').value.trim();
  const email = document.getElementById('novo-usuario-email').value.trim();
  const senha = document.getElementById('novo-usuario-senha').value;
  const role = document.getElementById('novo-usuario-role').value;
  if (!nome || !email || senha.length < 6) {
    alert('Preencha nome, e-mail e uma senha com pelo menos 6 caracteres.');
    return;
  }

  const btn = document.getElementById('btn-salvar-novo-usuario');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  const nomeAppSecundario = 'secundario-' + Date.now();
  let appSecundario;
  try {
    appSecundario = firebase.initializeApp(FIREBASE_CONFIG, nomeAppSecundario);
    const cred = await appSecundario.auth().createUserWithEmailAndPassword(email, senha);
    const novoUid = cred.user.uid;

    try {
      await firestoreDb.collection('usuarios').doc(novoUid).set({
        tenantId: TENANT_ID,
        role: role || 'TenantUser',
        nome,
        email,
        criadoEm: new Date().toISOString(),
        criadoPor: USUARIO_UID,
      });
    } catch (errVinculo) {
      await cred.user.delete().catch(() => {});
      throw errVinculo;
    }

    await appSecundario.auth().signOut();
    await appSecundario.delete();

    document.getElementById('form-novo-usuario').reset();
    closeModal('modal-novo-usuario');
    alert(`Usuário "${nome}" criado! Ele já pode entrar com o e-mail e senha cadastrados.`);
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    alert('Não foi possível criar o usuário: ' + mensagemErroCriacaoConta(err.code));
    if (appSecundario) { try { await appSecundario.delete(); } catch (e2) {} }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar usuário';
  }
}

async function removerAcessoUsuario(uid) {
  if (!window.confirm('Remover o acesso deste usuário? Ele não vai conseguir mais entrar no sistema (a conta de login em si só é apagada de vez pelo Super Admin, mas o acesso a essa empresa é cortado imediatamente).')) return;
  try {
    await firestoreDb.collection('usuarios').doc(uid).delete();
  } catch (err) {
    console.error('Erro ao remover acesso:', err);
    alert('Não foi possível remover o acesso agora. Tente de novo.');
  }
}

// =====================================================================
// ---------- Empresas / Tenants (Super Admin) ----------
// =====================================================================

let TENANTS_DATA = [];

function initEmpresasPage() {
  if (USUARIO_ROLE !== 'SuperAdmin') {
    document.getElementById('empresas-sem-permissao').style.display = '';
    document.getElementById('empresas-conteudo').style.display = 'none';
    return;
  }
  renderMinhaEmpresaStatus();
  escutarTenants();
}

// ---------- Minha própria empresa (Super Admin usando o sistema pro proprio negocio) ----------

function renderMinhaEmpresaStatus() {
  const el = document.getElementById('minha-empresa-conteudo');
  if (!el) return;
  if (TENANT_ID) {
    const empresa = TENANTS_DATA.find((t) => t.id === TENANT_ID);
    const nome = empresa ? (empresa.nomeEmpresa || empresa.id) : TENANT_ID;
    el.innerHTML = `
      <p style="font-size:13px;">Sua conta está vinculada a: <strong>${escapeHtml(nome)}</strong> — o que você lançar no Painel, Financeiro, Produtos etc. com este login fica salvo aqui, sincronizado na nuvem.</p>
      <button type="button" class="btn btn-small btn-ghost" style="color:var(--danger);" onclick="desvincularMinhaEmpresa()">Desvincular minha conta</button>`;
  } else {
    el.innerHTML = `
      <p style="font-size:13px; color:var(--text-soft);">Sua conta de Super Admin ainda não está vinculada a nenhuma empresa — por isso o que você lança no Painel/Financeiro/Produtos fica só "modo local" (só nesse aparelho, sem sincronizar entre celular e computador). Crie uma empresa pra você mesmo pra passar a usar o sistema de verdade.</p>
      <button type="button" class="btn btn-primary" onclick="openModal('modal-minha-empresa')">Criar minha empresa</button>`;
  }
}

async function criarMinhaEmpresa(e) {
  e.preventDefault();
  const nomeEmpresa = document.getElementById('minha-empresa-nome').value.trim();
  if (!nomeEmpresa) { alert('Digite o nome da sua empresa.'); return; }

  const btn = document.getElementById('btn-salvar-minha-empresa');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  try {
    const novoTenantId = genId('tenant');
    await firestoreDb.collection('tenants').doc(novoTenantId).set({
      nomeEmpresa,
      ativo: true,
      criadoEm: new Date().toISOString(),
      criadoPor: USUARIO_UID,
    });
    await firestoreDb.collection('usuarios').doc(USUARIO_UID).set({ tenantId: novoTenantId }, { merge: true });

    closeModal('modal-minha-empresa');
    alert(`Empresa "${nomeEmpresa}" criada e vinculada à sua conta! A página vai recarregar pra sincronizar tudo direitinho.`);
    window.location.reload();
  } catch (err) {
    console.error('Erro ao criar minha empresa:', err);
    alert('Não foi possível criar agora: ' + mensagemErroCriacaoConta(err.code));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar empresa';
  }
}

async function desvincularMinhaEmpresa() {
  if (!window.confirm('Desvincular sua conta dessa empresa? Você volta a ficar só como Super Admin da plataforma. Os dados da empresa continuam guardados, só o vínculo com o seu login é removido.')) return;
  try {
    await firestoreDb.collection('usuarios').doc(USUARIO_UID).set({ tenantId: null }, { merge: true });
    alert('Desvinculado! A página vai recarregar.');
    window.location.reload();
  } catch (err) {
    console.error('Erro ao desvincular:', err);
    alert('Não foi possível desvincular agora. Tente de novo.');
  }
}

function escutarTenants() {
  if (!FIREBASE_PRONTO) return;
  firestoreDb.collection('tenants').onSnapshot((snap) => {
    TENANTS_DATA = [];
    snap.forEach((doc) => TENANTS_DATA.push({ id: doc.id, ...doc.data() }));
    renderTenantsLista();
  }, (err) => console.error('Erro ao listar empresas:', err));
}

function renderTenantsLista() {
  const tbody = document.getElementById('tabela-empresas-body');
  if (!tbody) return;
  if (!TENANTS_DATA.length) {
    tbody.innerHTML = emptyCadastroHtml("openModal('modal-nova-empresa')", 5);
    renderMinhaEmpresaStatus();
    return;
  }
  tbody.innerHTML = TENANTS_DATA.map((t) => {
    const ativo = t.ativo !== false; // sem o campo = tratado como ativo (empresas criadas antes desse recurso)
    return `
    <tr>
      <td>${escapeHtml(t.nomeEmpresa || t.id)}</td>
      <td style="font-size:12px; color:var(--text-soft);">${escapeHtml(t.id)}</td>
      <td>${t.criadoEm ? formatDatePt(t.criadoEm.slice(0, 10)) : '—'}</td>
      <td>${ativo ? '<span class="badge badge-success">Ativa</span>' : '<span class="badge badge-danger">Suspensa</span>'}</td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn btn-small btn-ghost" style="color:var(--blue-text);" onclick="abrirModalNovoAcessoEmpresa('${t.id}','${escapeParaOnclick(t.nomeEmpresa || '')}')">+ Criar acesso</button>
        ${ativo
          ? `<button class="btn btn-small btn-ghost" style="color:var(--warning);" onclick="suspenderEmpresa('${t.id}','${escapeParaOnclick(t.nomeEmpresa || '')}')">Suspender</button>`
          : `<button class="btn btn-small btn-ghost" style="color:var(--success);" onclick="reativarEmpresa('${t.id}','${escapeParaOnclick(t.nomeEmpresa || '')}')">Reativar</button>`}
        <button class="btn btn-small btn-ghost" style="color:var(--danger);" onclick="excluirEmpresaCompleta('${t.id}','${escapeParaOnclick(t.nomeEmpresa || '')}')">Excluir</button>
      </td>
    </tr>`;
  }).join('');
  renderMinhaEmpresaStatus();
}

// ---------- Suspender / reativar (por falta de pagamento, por exemplo) ----------
// Não apaga nada — só impede login de todo mundo daquela empresa até você
// reativar. Os dados continuam guardados no Firestore normalmente.

async function suspenderEmpresa(tenantId, nomeEmpresa) {
  if (!window.confirm(`Suspender o acesso de "${nomeEmpresa}"? Ninguém dessa empresa vai conseguir entrar até você reativar. Os dados NÃO são apagados.`)) return;
  try {
    await firestoreDb.collection('tenants').doc(tenantId).set({ ativo: false }, { merge: true });
  } catch (err) {
    console.error('Erro ao suspender empresa:', err);
    alert('Não foi possível suspender agora. Tente de novo.');
  }
}

async function reativarEmpresa(tenantId, nomeEmpresa) {
  try {
    await firestoreDb.collection('tenants').doc(tenantId).set({ ativo: true }, { merge: true });
    alert(`Acesso de "${nomeEmpresa}" reativado.`);
  } catch (err) {
    console.error('Erro ao reativar empresa:', err);
    alert('Não foi possível reativar agora. Tente de novo.');
  }
}

// ---------- Excluir empresa de vez (apaga os dados e corta todos os acessos) ----------

async function excluirEmpresaCompleta(tenantId, nomeEmpresa) {
  const confirmacao = window.prompt(`Isso apaga PERMANENTEMENTE todos os dados e acessos de "${nomeEmpresa}". Essa ação não pode ser desfeita.\n\nPara confirmar, digite o nome da empresa exatamente como está: ${nomeEmpresa}`);
  if (confirmacao !== nomeEmpresa) {
    if (confirmacao !== null) alert('O nome digitado não bateu. Nada foi excluído.');
    return;
  }

  try {
    const usuariosSnap = await firestoreDb.collection('usuarios').where('tenantId', '==', tenantId).get();
    const lote1 = firestoreDb.batch();
    usuariosSnap.forEach((doc) => lote1.delete(doc.ref));
    await lote1.commit();

    const dadosSnap = await firestoreDb.collection('tenants').doc(tenantId).collection('dados').get();
    const lote2 = firestoreDb.batch();
    dadosSnap.forEach((doc) => lote2.delete(doc.ref));
    await lote2.commit();

    await firestoreDb.collection('tenants').doc(tenantId).delete();

    alert(`Empresa "${nomeEmpresa}" e todos os seus dados foram excluídos.`);
  } catch (err) {
    console.error('Erro ao excluir empresa:', err);
    alert('Não foi possível concluir a exclusão. Alguma parte pode ter sido apagada — confira a lista.');
  }
}

// ---------- Criar acesso (admin) para uma empresa que já existe ----------
// Serve tanto pra empresas criadas sem admin (por causa de algum erro no
// meio do caminho) quanto pra adicionar um segundo administrador depois.

function abrirModalNovoAcessoEmpresa(tenantId, nomeEmpresa) {
  document.getElementById('novo-acesso-tenant-id').value = tenantId;
  document.getElementById('novo-acesso-empresa-titulo').textContent = `Criar acesso — ${nomeEmpresa}`;
  document.getElementById('form-novo-acesso-empresa').reset();
  document.getElementById('novo-acesso-tenant-id').value = tenantId; // reset() acima limpa hidden tb, redefine de novo
  openModal('modal-novo-acesso-empresa');
}

async function criarAcessoParaEmpresaExistente(e) {
  e.preventDefault();
  const tenantId = document.getElementById('novo-acesso-tenant-id').value;
  const nome = document.getElementById('novo-acesso-nome').value.trim();
  const email = document.getElementById('novo-acesso-email').value.trim();
  const senha = document.getElementById('novo-acesso-senha').value;
  const role = document.getElementById('novo-acesso-role').value;
  if (!tenantId || !nome || !email || senha.length < 6) {
    alert('Preencha nome, e-mail e uma senha com pelo menos 6 caracteres.');
    return;
  }

  const btn = document.getElementById('btn-salvar-novo-acesso-empresa');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  const nomeAppSecundario = 'secundario-' + Date.now();
  let appSecundario;
  try {
    appSecundario = firebase.initializeApp(FIREBASE_CONFIG, nomeAppSecundario);
    const cred = await appSecundario.auth().createUserWithEmailAndPassword(email, senha);
    const novoUid = cred.user.uid;

    try {
      await firestoreDb.collection('usuarios').doc(novoUid).set({
        tenantId,
        role: role || 'TenantAdmin',
        nome,
        email,
        criadoEm: new Date().toISOString(),
        criadoPor: USUARIO_UID,
      });
    } catch (errVinculo) {
      await cred.user.delete().catch(() => {});
      throw errVinculo;
    }

    await appSecundario.auth().signOut();
    await appSecundario.delete();

    closeModal('modal-novo-acesso-empresa');
    alert(`Acesso criado! ${nome} já pode entrar com o e-mail e senha cadastrados.`);
  } catch (err) {
    console.error('Erro ao criar acesso:', err);
    alert('Não foi possível criar o acesso: ' + mensagemErroCriacaoConta(err.code));
    if (appSecundario) { try { await appSecundario.delete(); } catch (e2) {} }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar acesso';
  }
}

async function criarNovaEmpresa(e) {
  e.preventDefault();
  const nomeEmpresa = document.getElementById('nova-empresa-nome').value.trim();
  const adminNome = document.getElementById('nova-empresa-admin-nome').value.trim();
  const adminEmail = document.getElementById('nova-empresa-admin-email').value.trim();
  const adminSenha = document.getElementById('nova-empresa-admin-senha').value;
  if (!nomeEmpresa || !adminNome || !adminEmail || adminSenha.length < 6) {
    alert('Preencha o nome da empresa e os dados do administrador (senha com pelo menos 6 caracteres).');
    return;
  }

  const btn = document.getElementById('btn-salvar-nova-empresa');
  btn.disabled = true;
  btn.textContent = 'Criando...';

  const novoTenantId = genId('tenant');
  const nomeAppSecundario = 'secundario-' + Date.now();
  let appSecundario;
  try {
    await firestoreDb.collection('tenants').doc(novoTenantId).set({
      nomeEmpresa,
      ativo: true,
      criadoEm: new Date().toISOString(),
      criadoPor: USUARIO_UID,
    });

    appSecundario = firebase.initializeApp(FIREBASE_CONFIG, nomeAppSecundario);
    const cred = await appSecundario.auth().createUserWithEmailAndPassword(adminEmail, adminSenha);
    const novoUid = cred.user.uid;

    try {
      await firestoreDb.collection('usuarios').doc(novoUid).set({
        tenantId: novoTenantId,
        role: 'TenantAdmin',
        nome: adminNome,
        email: adminEmail,
        criadoEm: new Date().toISOString(),
        criadoPor: USUARIO_UID,
      });
    } catch (errVinculo) {
      // Se não conseguir vincular o login à empresa, desfaz o login criado
      // agora mesmo — assim o e-mail fica livre pra tentar de novo, em vez
      // de sobrar uma conta "fantasma" (existe, mas sem empresa nenhuma).
      await cred.user.delete().catch(() => {});
      throw errVinculo;
    }

    await appSecundario.auth().signOut();
    await appSecundario.delete();

    document.getElementById('form-nova-empresa').reset();
    closeModal('modal-nova-empresa');
    alert(`Empresa "${nomeEmpresa}" criada! O administrador ${adminNome} já pode entrar com o e-mail e senha cadastrados.`);
  } catch (err) {
    console.error('Erro ao criar empresa:', err);
    alert('Não foi possível criar a empresa: ' + mensagemErroCriacaoConta(err.code));
    if (appSecundario) { try { await appSecundario.delete(); } catch (e2) {} }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar empresa';
  }
}

// =====================================================================
// ---------- Migrar dados antigos (modo local/global) para o tenant ----------
// =====================================================================
//
// Antes desta versão, os dados ficavam numa coleção única (não isolada
// por empresa). Esta função copia, uma vez, o que estava lá para dentro
// do tenant atual — útil só durante a transição.

async function migrarDadosAntigosParaTenant() {
  if (!TENANT_ID) { alert('Entre no sistema antes de migrar os dados.'); return; }
  if (!window.confirm('Isso copia os dados antigos (de antes das empresas separadas) para a empresa atual. Se já existirem dados aqui, eles serão SUBSTITUÍDOS. Continuar?')) return;

  const chaves = [
    'eagles_clientes_fornecedores_v1', 'eagles_produtos_v1', 'eagles_vendedores_v1', 'eagles_funcionarios_v1',
    'eagles_pedidos_venda_v1', 'eagles_objetos_postagem_v1', 'eagles_contratos_v1',
    'eagles_pedido_compras_v1', 'eagles_notas_fiscais_entrada_v1', 'eagles_lancamentos_estoque_v1', 'eagles_conferencia_estoque_v1',
    'eagles_fin_modelo_v1', 'eagles_fin_ciclos_v1', 'eagles_fin_metas_v1', 'eagles_perfil_empresa_v1',
  ];

  let copiados = 0;
  for (const chave of chaves) {
    try {
      const snapAntigo = await firestoreDb.collection('eagles').doc(chave).get();
      if (snapAntigo.exists) {
        await caminhoTenantDoc(chave).set({ valor: snapAntigo.data().valor });
        copiados++;
      }
    } catch (err) {
      console.error('Erro ao migrar', chave, err);
    }
  }
  alert(`Migração concluída: ${copiados} conjunto(s) de dados copiados para esta empresa. Recarregue a página para ver tudo atualizado.`);
}
