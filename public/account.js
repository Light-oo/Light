const accountNameEl = document.getElementById('accountName');
const accountEmailEl = document.getElementById('accountEmail');
const logoutBtn = document.getElementById('logoutBtn');
const toastEl = document.getElementById('toast');

const whatsappValueEl = document.getElementById('accountWhatsappValue');
const toggleWhatsappEditBtn = document.getElementById('toggleWhatsappEdit');
const whatsappEditor = document.getElementById('whatsappEditor');
const whatsappInput = document.getElementById('whatsappInput');
const saveWhatsappBtn = document.getElementById('saveWhatsappBtn');
const cancelWhatsappBtn = document.getElementById('cancelWhatsappBtn');

const departmentInput = document.getElementById('defaultDepartment');
const municipalityInput = document.getElementById('defaultMunicipality');
const saveLocationBtn = document.getElementById('saveLocationBtn');

const WHATSAPP_KEY = 'pilotWhatsapp';
const LOCATION_KEY = 'pilotDefaultLocation';
const LEGACY_LOCATION_KEY = 'pilotLocation';
const LAST_SEARCH_LOCATION_KEY = 'pilotLastSearchLocation';

const showToast = (message) => {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2200);
};

const readLocalWhatsapp = () => localStorage.getItem(WHATSAPP_KEY) || '';

const setWhatsappView = (value) => {
  const hasValue = Boolean(value);
  whatsappValueEl.textContent = hasValue ? value : 'No configurado';
  toggleWhatsappEditBtn.textContent = hasValue ? 'Editar' : 'Configurar';
};

const readLocation = () => {
  try {
    const location = JSON.parse(localStorage.getItem(LOCATION_KEY) || localStorage.getItem(LEGACY_LOCATION_KEY) || 'null');
    if (!location || (!location.department && !location.municipality)) {
      return { department: '', municipality: '' };
    }
    return {
      department: location.department || '',
      municipality: location.municipality || ''
    };
  } catch (_error) {
    return { department: '', municipality: '' };
  }
};

const clearClientAuthState = () => {
  sessionStorage.removeItem('pendingAuthAction');
  sessionStorage.removeItem('authRetryAction');
  localStorage.removeItem(WHATSAPP_KEY);
  localStorage.removeItem(LOCATION_KEY);
  localStorage.removeItem(LEGACY_LOCATION_KEY);
  localStorage.removeItem(LAST_SEARCH_LOCATION_KEY);
};

const normalizeWhatsapp = (value) => {
  const raw = value.trim();
  if (!raw) {
    return { ok: false, error: 'Ingresa un número de WhatsApp.' };
  }

  if (/^\+503\d{8}$/.test(raw)) {
    return { ok: true, value: raw };
  }

  const digits = raw.replace(/\D/g, '');
  if (/^\d{8}$/.test(digits)) {
    return { ok: true, value: `+503${digits}` };
  }

  return { ok: false, error: 'Número inválido. Usa formato +503XXXXXXXX.' };
};

const setWhatsappEditMode = (isEditing) => {
  whatsappEditor.hidden = !isEditing;
  if (isEditing) {
    whatsappInput.value = readLocalWhatsapp();
    whatsappInput.focus();
  }
};

const saveWhatsapp = async () => {
  const normalized = normalizeWhatsapp(whatsappInput.value);
  if (!normalized.ok) {
    showToast(normalized.error);
    return;
  }

  saveWhatsappBtn.disabled = true;

  // Local fallback (required) even if backend endpoint is unavailable.
  let persistedRemotely = false;
  try {
    const response = await fetch('/api/me', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ whatsapp: normalized.value })
    });
    persistedRemotely = response.ok;
  } catch (_error) {
    persistedRemotely = false;
  }

  localStorage.setItem(WHATSAPP_KEY, normalized.value);
  setWhatsappView(normalized.value);
  setWhatsappEditMode(false);
  saveWhatsappBtn.disabled = false;
  showToast(persistedRemotely ? 'WhatsApp actualizado.' : 'WhatsApp guardado localmente.');
};

const saveDefaultLocation = () => {
  const department = departmentInput.value.trim();
  const municipality = municipalityInput.value.trim();

  if (!department && !municipality) {
    showToast('Ingresa departamento o municipio.');
    return;
  }

  const payload = { department, municipality };
  localStorage.setItem(LOCATION_KEY, JSON.stringify(payload));
  localStorage.setItem(LEGACY_LOCATION_KEY, JSON.stringify(payload));
  showToast('Ubicación por defecto guardada.');
};

const loadIdentity = async () => {
  try {
    const response = await fetch('/api/me', { credentials: 'include' });
    if (!response.ok) {
      accountEmailEl.textContent = '—';
      accountNameEl.textContent = '—';
    } else {
      const payload = await response.json();
      const email = payload?.user?.email || '—';
      accountEmailEl.textContent = email;
      accountNameEl.textContent = email !== '—' ? email.split('@')[0] : '—';
    }
  } catch (_error) {
    accountEmailEl.textContent = '—';
    accountNameEl.textContent = '—';
  }

  setWhatsappView(readLocalWhatsapp());
  const location = readLocation();
  departmentInput.value = location.department;
  municipalityInput.value = location.municipality;
};

const logout = async () => {
  logoutBtn.disabled = true;
  logoutBtn.textContent = 'Cerrando...';

  try {
    await fetch('/api/auth/signout', {
      method: 'POST',
      credentials: 'include'
    });
  } catch (_error) {
    showToast('No se pudo cerrar sesión en servidor.');
  } finally {
    clearClientAuthState();
    window.location.href = '/app/search.html';
  }
};

toggleWhatsappEditBtn.addEventListener('click', () => setWhatsappEditMode(true));
cancelWhatsappBtn.addEventListener('click', () => setWhatsappEditMode(false));
saveWhatsappBtn.addEventListener('click', saveWhatsapp);
saveLocationBtn.addEventListener('click', saveDefaultLocation);
logoutBtn.addEventListener('click', logout);
window.addEventListener('DOMContentLoaded', loadIdentity);
