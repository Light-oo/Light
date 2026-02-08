import { savePendingAuthAction, consumeAuthRetryAction } from '/app/auth-flow.js';

const toastEl = document.getElementById('toast');
const formSection = document.getElementById('demandForm');
const confirmationSection = document.getElementById('confirmation');
const confirmationMessage = document.getElementById('confirmationMessage');
const backToSearch = document.getElementById('backToSearch');
const confirmSearch = document.getElementById('confirmSearch');

const LOCAL_FALLBACK_KEY = 'pilotDemands';
const RETRY_QUEUE_KEY = 'pendingDemandRetry';

let prefilledSide = '';
let prefilledPosition = '';

const showToast = (message) => {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2400);
};

const getField = (id) => document.getElementById(id).value.trim();

const setField = (id, value) => {
  if (value) document.getElementById(id).value = value;
};

const getSilentLocation = () => {
  try {
    const location = JSON.parse(localStorage.getItem('pilotDefaultLocation') || localStorage.getItem('pilotLocation') || 'null');
    if (!location) return null;
    if (!location.department && !location.municipality) return null;
    return location;
  } catch (_error) {
    return null;
  }
};

const buildNotes = () => {
  const notesParts = [];
  const part = getField('part');
  const details = getField('details');

  if (part) notesParts.push(`Pieza: ${part}`);
  if (details) notesParts.push(details);

  return notesParts.join('\n').trim() || null;
};

const buildDemandPayload = () => {
  const year = getField('year');
  const itemTypeId = getField('itemType');
  const location = getSilentLocation();

  const payload = {
    brand: getField('brand') || null,
    model: getField('model') || null,
    year: year ? Number(year) : null,
    itemTypeId: itemTypeId || null,
    side: prefilledSide || null,
    position: prefilledPosition || null,
    notes: buildNotes()
  };

  if (location) {
    payload.location = location;
  }

  return payload;
};

const isValidDemand = (payload) => {
  if (!payload.brand || !payload.model || !payload.itemTypeId) {
    return false;
  }
  return Boolean(payload.year);
};

const queueLocalFallback = (payload) => {
  const existing = JSON.parse(localStorage.getItem(LOCAL_FALLBACK_KEY) || '[]');
  existing.push(payload);
  localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(existing));
  localStorage.setItem(RETRY_QUEUE_KEY, JSON.stringify(payload));
};

const clearLocalQueueOnSuccess = () => {
  localStorage.removeItem(RETRY_QUEUE_KEY);
};

const showConfirmation = () => {
  confirmationMessage.textContent = 'Solicitud lista. Ya está en el mercado.';
  formSection.hidden = true;
  confirmationSection.hidden = false;
};

const submitToBackend = async (payload) => {
  const response = await fetch('/api/demands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    savePendingAuthAction({
      actionType: 'demand',
      payload: { demandPayload: payload },
      returnUrl: window.location.href
    });
    window.location.href = '/auth';
    return { handledByRedirect: true };
  }

  if (response.status === 400) {
    showToast('Revisa los datos e intenta de nuevo.');
    return { handled: true };
  }

  if (response.ok) {
    clearLocalQueueOnSuccess();
    showConfirmation();
    return { handled: true };
  }

  throw new Error(`backend_failed_${response.status}`);
};

const submitDemand = async (payloadOverride = null) => {
  const payload = payloadOverride || buildDemandPayload();

  if (!isValidDemand(payload)) {
    showToast('Completa marca, modelo, año y pieza.');
    return;
  }

  try {
    const result = await submitToBackend(payload);
    if (result?.handled) return;
    if (result?.handledByRedirect) return;
  } catch (_error) {
    queueLocalFallback(payload);
    showToast('Guardado temporalmente en este dispositivo.');
    showConfirmation();
  }
};

const tryRetryQueuedDemand = async () => {
  const raw = localStorage.getItem(RETRY_QUEUE_KEY);
  if (!raw) return;

  try {
    const payload = JSON.parse(raw);
    await submitToBackend(payload);
  } catch (_error) {
    // keep queued for later opportunity
  }
};

const resetForm = () => {
  formSection.querySelectorAll('input, textarea').forEach((input) => {
    input.value = '';
  });
  confirmationSection.hidden = true;
  formSection.hidden = false;
};

const hydrateFromSearch = () => {
  const params = new URLSearchParams(window.location.search);
  setField('brand', params.get('brand'));
  setField('model', params.get('model'));
  setField('year', params.get('year'));
  setField('itemType', params.get('itemTypeId'));

  prefilledSide = params.get('side') || '';
  prefilledPosition = params.get('position') || '';

  const detailHints = [prefilledSide && `Lado: ${prefilledSide}`, prefilledPosition && `Posición: ${prefilledPosition}`].filter(Boolean);
  if (detailHints.length) {
    setField('details', detailHints.join(', '));
  }

  const searchParams = params.toString();
  if (searchParams) {
    backToSearch.href = `/app/search.html?${searchParams}`;
    confirmSearch.href = `/app/search.html?${searchParams}`;
  }
};

document.getElementById('submitDemand').addEventListener('click', () => submitDemand());
document.getElementById('newDemand').addEventListener('click', resetForm);

window.addEventListener('DOMContentLoaded', async () => {
  formSection.hidden = false;
  confirmationSection.hidden = true;
  hydrateFromSearch();
  await tryRetryQueuedDemand();
  const pending = consumeAuthRetryAction('demand');
  if (pending?.payload?.demandPayload) {
    await submitDemand(pending.payload.demandPayload);
  }
});
