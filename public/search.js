import { createSearchStateEngine } from '/app/search/stateEngine.js';
import { savePendingAuthAction, consumeAuthRetryAction } from '/app/auth-flow.js';

const stateRootEl = document.getElementById('searchStateRoot');
const refineOverlay = document.getElementById('refineOverlay');
const toastEl = document.getElementById('toast');
const querySummaryEl = document.getElementById('querySummary');
const refineTitleEl = document.getElementById('refineTitle');
const modeToggleBtn = document.getElementById('modeToggle');
const openRefineBtn = document.getElementById('openRefine');
const sellPublishBtn = document.getElementById('sellPublish');
const sellSearchBtn = document.getElementById('sellSearch');

const refineFields = ['itemTypeId', 'brand', 'model', 'year', 'side', 'position', 'itemDetail', 'priceInput', 'extraDetails'];

let nextCursor = null;
let renderedResults = [];
let listedById = new Map();
let lastAutoCreated = false;
let sellHasSearched = false;

const DEFAULT_LOCATION_KEY = 'pilotDefaultLocation';
const LAST_SEARCH_LOCATION_KEY = 'pilotLastSearchLocation';
const REVEALED_CONTACTS_KEY = 'pilotRevealedContacts';
const MODE_KEY = 'pilotMode';
const MODE_BUY = 'BUY';
const MODE_SELL = 'SELL';
const WHATSAPP_KEY = 'pilotWhatsapp';

const optionLabels = {
  itemTypes: new Map(),
  brands: new Map(),
  models: new Map(),
  sides: new Map(),
  positions: new Map(),
  years: new Map()
};

const fetchCatalog = async (path) => {
  const response = await fetch(`/catalog/${path}`);
  if (!response.ok) {
    throw new Error(`catalog_failed_${response.status}`);
  }
  const payload = await response.json();
  const data = payload?.data ?? payload;
  return Array.isArray(data) ? data : [];
};

const fetchCatalogSafe = async (path) => {
  try {
    return await fetchCatalog(path);
  } catch (_error) {
    return [];
  }
};

const applyOptions = (selectEl, options, labelMap) => {
  const emptyOption = selectEl.querySelector('option[value=""]');
  selectEl.replaceChildren();
  if (emptyOption) {
    selectEl.appendChild(emptyOption);
  } else {
    const fallback = document.createElement('option');
    fallback.value = '';
    fallback.textContent = 'Todos';
    selectEl.appendChild(fallback);
  }
  labelMap.clear();
  options.forEach((option) => {
    if (!option?.id) return;
    const label = option.label_es || option.label || option.id;
    labelMap.set(option.id, label);
    const opt = document.createElement('option');
    opt.value = option.id;
    opt.textContent = label;
    selectEl.appendChild(opt);
  });
};

const readStoredLocation = (key) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (!value || (!value.department && !value.municipality)) return null;
    return value;
  } catch (_error) {
    return null;
  }
};

const readRevealedContacts = () => {
  try {
    const value = JSON.parse(localStorage.getItem(REVEALED_CONTACTS_KEY) || '{}');
    if (!value || typeof value !== 'object') return {};
    return value;
  } catch (_error) {
    return {};
  }
};

const readLocalWhatsapp = () => localStorage.getItem(WHATSAPP_KEY) || '';

const getStoredContact = (listingId) => {
  const contacts = readRevealedContacts();
  return contacts[listingId] || null;
};

const storeContact = (listingId, contact) => {
  const contacts = readRevealedContacts();
  contacts[listingId] = contact;
  localStorage.setItem(REVEALED_CONTACTS_KEY, JSON.stringify(contacts));
};

const withPreferredLocation = (params) => {
  const next = new URLSearchParams(params);
  const accountDefault = readStoredLocation(DEFAULT_LOCATION_KEY);
  const lastSearch = readStoredLocation(LAST_SEARCH_LOCATION_KEY);
  const preferred = accountDefault || lastSearch;

  if (preferred?.department) next.set('department', preferred.department);
  if (preferred?.municipality) next.set('municipality', preferred.municipality);

  return next;
};

const persistLastSearchLocation = (params) => {
  const department = params.get('department')?.trim();
  const municipality = params.get('municipality')?.trim();

  if (!department && !municipality) return;

  localStorage.setItem(
    LAST_SEARCH_LOCATION_KEY,
    JSON.stringify({
      department: department || '',
      municipality: municipality || ''
    })
  );
};

const showToast = (message) => {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2600);
};

const clearStateRoot = () => {
  stateRootEl.replaceChildren();
};

const formatPrice = (listing) => {
  if (listing?.price == null) return 'Precio: —';
  const suffix = listing.price_type === 'negotiable' ? ' (Negociable)' : '';
  return `Precio: ${listing.price}${suffix}`;
};

const formatWhat = (listing) => {
  const what = listing?.what || {};
  const parts = [what.brand, what.model, what.year, what.partText]
    .filter(Boolean)
    .map((value) => value.toString().trim())
    .filter(Boolean);
  const itemLabel = what.itemType || 'Pieza';
  return [itemLabel, ...parts].join(' · ');
};

const formatWhere = (location) => {
  const parts = [location?.department, location?.municipality].filter(Boolean);
  if (!parts.length) return '';
  return parts.join(', ');
};

const formatTime = (createdAt) => {
  if (!createdAt) return '';
  const published = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - published.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (Number.isNaN(days) || days < 0) return '';
  if (days === 0) return 'Publicado hoy';
  if (days === 1) return 'Publicado hace 1 día';
  return `Publicado hace ${days} días`;
};

const buildMessage = (listing, contactName) => {
  const item = formatWhat(listing);
  const location = formatWhere(listing.location);
  return `Hola ${contactName || ''}, vi tu publicación de ${item}. ¿Me puedes compartir fotos y confirmar disponibilidad? ${location ? `Estoy en ${location}.` : ''}`.trim();
};

const openWhatsApp = (listing, contact) => {
  const message = buildMessage(listing, contact?.contact_name);
  const link = `https://wa.me/${contact?.whatsapp_e164}?text=${encodeURIComponent(message)}`;
  const opened = window.open(link, '_blank');
  if (!opened) {
    window.location.href = link;
  }
};

const setContactButtonState = (button, revealed) => {
  if (!button) return;
  if (revealed) {
    button.textContent = 'Abrir WhatsApp';
    button.dataset.revealed = 'true';
  } else {
    button.textContent = 'Contactar';
    delete button.dataset.revealed;
  }
};

const revealContact = async (listing, button) => {
  if (!listing?.listingId) return;
  const storedContact = getStoredContact(listing.listingId);
  if (storedContact?.whatsapp_e164) {
    setContactButtonState(button, true);
    openWhatsApp(listing, storedContact);
    return;
  }
  if (button.disabled) return;
  button.disabled = true;
  button.textContent = 'Conectando...';

  try {
    const response = await fetch(`/listings/${listing.listingId}/reveal-contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tokenCost: 1 })
    });

    if (response.status === 401) {
      savePendingAuthAction({
        actionType: 'reveal',
        payload: { listingId: listing.listingId },
        returnUrl: window.location.href
      });
      window.location.href = '/auth';
      return;
    }

    if (response.status === 403) {
      showToast('Acceso bloqueado. Contacta soporte.');
      return;
    }

    if (response.status === 429) {
      showToast('Límite alcanzado. Intenta más tarde.');
      return;
    }

    if (!response.ok) {
      showToast('No pudimos revelar el contacto.');
      return;
    }

    const payload = await response.json();
    const whatsapp = payload?.data?.whatsapp_e164;
    if (!whatsapp) {
      showToast('Contacto no disponible.');
      return;
    }

    const contact = {
      whatsapp_e164: whatsapp,
      contact_name: payload?.data?.contact_name || ''
    };
    storeContact(listing.listingId, contact);
    setContactButtonState(button, true);
    openWhatsApp(listing, contact);
  } catch (_error) {
    showToast('No pudimos completar la acción. Intenta de nuevo.');
  } finally {
    button.disabled = false;
    if (!button.dataset.revealed) {
      button.textContent = 'Contactar';
    }
  }
};

const buildCard = (listing) => {
  const card = document.createElement('article');
  card.className = 'card';

  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = formatWhat(listing);

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = listing.cardType === 'buy' ? 'Solicitud' : 'Oferta';

  const meta = document.createElement('div');
  meta.className = 'meta';

  const price = document.createElement('div');
  price.className = 'price';
  price.textContent = formatPrice(listing);

  const whereText = formatWhere(listing.location);
  const where = document.createElement('div');
  where.textContent = whereText;

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = formatTime(listing.audit?.created_at);

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (listing.cardType !== 'buy' && listing.listingId) {
    const contactBtn = document.createElement('button');
    contactBtn.className = 'btn btn-success btn-block';
    const storedContact = getStoredContact(listing.listingId);
    setContactButtonState(contactBtn, Boolean(storedContact?.whatsapp_e164));
    contactBtn.dataset.listingId = listing.listingId;
    contactBtn.addEventListener('click', () => revealContact(listing, contactBtn));
    actions.appendChild(contactBtn);
  }

  header.appendChild(title);
  header.appendChild(badge);
  meta.appendChild(price);
  if (whereText) meta.appendChild(where);
  if (time.textContent) meta.appendChild(time);
  card.appendChild(header);
  card.appendChild(meta);
  if (actions.children.length > 0) {
    card.appendChild(actions);
  }

  return card;
};

const getMode = () => {
  const stored = localStorage.getItem(MODE_KEY);
  if (stored === MODE_SELL) return MODE_SELL;
  return MODE_BUY;
};

const setMode = (mode) => {
  const normalized = mode === MODE_SELL ? MODE_SELL : MODE_BUY;
  localStorage.setItem(MODE_KEY, normalized);
  if (modeToggleBtn) modeToggleBtn.textContent = normalized;

  if (normalized === MODE_SELL) {
    openRefineBtn.classList.add('hidden');
    sellPublishBtn.classList.remove('hidden');
    sellSearchBtn.classList.remove('hidden');
    if (refineTitleEl) refineTitleEl.textContent = 'Publicar oferta';
  } else {
    openRefineBtn.classList.remove('hidden');
    sellPublishBtn.classList.add('hidden');
    sellSearchBtn.classList.add('hidden');
    if (refineTitleEl) refineTitleEl.textContent = 'Buscar';
  }

  const applyBtn = document.getElementById('applyRefine');
  if (applyBtn) applyBtn.textContent = normalized === MODE_SELL ? 'Publicar' : 'Buscar';

  const priceLabel = document.getElementById('priceLabel');
  if (priceLabel) priceLabel.textContent = 'Precio';

  document.body.dataset.mode = normalized;
  updateRequiredValidity();
};

const getAccountName = async () => {
  try {
    const response = await fetch('/api/me', { credentials: 'include' });
    if (!response.ok) return null;
    const payload = await response.json();
    const email = payload?.user?.email;
    if (email && typeof email === 'string') {
      return email.split('@')[0] || null;
    }
  } catch (_error) {
    return null;
  }
  return null;
};

const publishListing = async () => {
  const priceInput = document.getElementById('priceInput');
  const detailInput = document.getElementById('itemDetail');
  const priceValue = Number(priceInput?.value);
  if (!Number.isFinite(priceValue) || priceValue < 10 || priceValue > 1000) {
    showToast('Ingresa un precio entre 10 y 1000.');
    return;
  }
  if (!detailInput?.value?.trim()) {
    showToast('Ingresa la pieza.');
    return;
  }

  const whatsapp = readLocalWhatsapp();
  if (!whatsapp) {
    showToast('Configura tu WhatsApp primero.');
    window.location.href = '/app/account.html';
    return;
  }

  const location = readStoredLocation(DEFAULT_LOCATION_KEY) || readStoredLocation(LAST_SEARCH_LOCATION_KEY);
  if (!location) {
    showToast('Configura tu ubicación por defecto.');
    window.location.href = '/app/account.html';
    return;
  }

  const contactName = (await getAccountName()) || whatsapp;

  const marketId = null;
  const brandId = sanitizeValue(document.getElementById('brand').value);
  const modelId = sanitizeValue(document.getElementById('model').value);
  const yearId = sanitizeValue(document.getElementById('year').value);
  const itemTypeId = sanitizeValue(document.getElementById('itemTypeId').value);
  const sideId = sanitizeValue(document.getElementById('side').value);
  const positionId = sanitizeValue(document.getElementById('position').value);

  const brand = brandId ? optionLabels.brands.get(brandId) || brandId : null;
  const model = modelId ? optionLabels.models.get(modelId) || modelId : null;
  const yearLabel = yearId ? optionLabels.years.get(yearId) || yearId : null;
  const yearValue = yearLabel ? Number(yearLabel) : null;
  const side = sideId ? optionLabels.sides.get(sideId) || sideId : null;
  const position = positionId ? optionLabels.positions.get(positionId) || positionId : null;
  const itemDetail = detailInput?.value?.trim() || null;
  if (!brandId || !modelId || !yearId || !itemTypeId || !itemDetail) {
    showToast('Completa los campos requeridos.');
    return;
  }

  try {
    const draftResponse = await fetch('/listings/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId, source: 'pilot' })
    });

    if (draftResponse.status === 401) {
      window.location.href = '/auth';
      return;
    }

    if (!draftResponse.ok) {
      showToast('No pudimos iniciar la publicación.');
      return;
    }

    const draftPayload = await draftResponse.json();
    const listingId = draftPayload?.data?.id || draftPayload?.id;
    if (!listingId) {
      showToast('No pudimos crear el borrador.');
      return;
    }

    const updateResponse = await fetch(`/listings/${listingId}/draft`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        what: {
          itemTypeId: itemTypeId || null,
          brand,
          model,
          yearFrom: Number.isFinite(yearValue) ? yearValue : null,
          yearTo: Number.isFinite(yearValue) ? yearValue : null,
          side,
          position,
          detail: itemDetail
        },
        howMuch: {
          priceType: 'fixed',
          priceAmount: priceValue,
          currency: 'USD'
        },
        location: {
          department: location.department || '',
          municipality: location.municipality || ''
        },
        contact: {
          sellerType: 'seller',
          contactName,
          whatsapp
        }
      })
    });

    if (!updateResponse.ok) {
      showToast('No pudimos completar los datos.');
      return;
    }

    const publishResponse = await fetch(`/listings/${listingId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!publishResponse.ok) {
      showToast('No pudimos publicar el repuesto.');
      return;
    }

    showToast('Publicado.');
    closeOverlay(refineOverlay);
  } catch (_error) {
    showToast('Error al publicar.');
  }
};

const updateQuerySummary = (params) => {
  const tokens = [];
  const brandId = params.get('brand');
  const modelId = params.get('model');
  const yearId = params.get('year');
  const itemTypeId = params.get('itemTypeId');
  const sideId = params.get('side');
  const positionId = params.get('position');
  if (brandId) tokens.push(optionLabels.brands.get(brandId) || brandId);
  if (modelId) tokens.push(optionLabels.models.get(modelId) || modelId);
  if (yearId) tokens.push(optionLabels.years.get(yearId) || yearId);
  if (itemTypeId) tokens.push(optionLabels.itemTypes.get(itemTypeId) || itemTypeId);
  if (sideId) tokens.push(optionLabels.sides.get(sideId) || sideId);
  if (positionId) tokens.push(optionLabels.positions.get(positionId) || positionId);
  querySummaryEl.textContent = tokens.join(' · ');
};

const loadMore = async (button) => {
  if (!nextCursor) return;
  button.disabled = true;
  button.textContent = 'Cargando...';

  const params = currentParams();
  try {
    const { items, nextCursor: upcoming } = await requestListings(params, nextCursor);
    renderedResults = [...renderedResults, ...items];
    nextCursor = upcoming;
    onRenderResults(renderedResults, nextCursor);
  } catch (_error) {
    showToast('No pudimos cargar más resultados.');
  }
};

const onRenderLoading = () => {
  nextCursor = null;
  renderedResults = [];
  clearStateRoot();

  const list = document.createElement('section');
  list.className = 'list';

  for (let i = 0; i < 4; i += 1) {
    const skeleton = document.createElement('div');
    skeleton.className = 'card skeleton-card skeleton';
    list.appendChild(skeleton);
  }

  stateRootEl.appendChild(list);
};

const onRenderResults = (items, upcomingCursor) => {
  nextCursor = upcomingCursor;
  renderedResults = items;
  listedById = new Map(items.filter((item) => item.listingId).map((item) => [item.listingId, item]));
  clearStateRoot();

  const wrapper = document.createElement('div');
  wrapper.className = 'list';

  const list = document.createElement('section');
  list.className = 'list';
  list.setAttribute('aria-live', 'polite');
  items.forEach((listing) => list.appendChild(buildCard(listing)));
  wrapper.appendChild(list);

  if (nextCursor) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className = 'btn btn-block';
    loadMoreBtn.textContent = 'Cargar más';
    loadMoreBtn.addEventListener('click', () => loadMore(loadMoreBtn));
    wrapper.appendChild(loadMoreBtn);
  }

  stateRootEl.appendChild(wrapper);

  const pending = consumeAuthRetryAction('reveal');
  if (pending?.payload?.listingId && listedById.has(pending.payload.listingId)) {
    const listing = listedById.get(pending.payload.listingId);
    const button = stateRootEl.querySelector(`[data-listing-id="${pending.payload.listingId}"]`);
    const storedContact = getStoredContact(pending.payload.listingId);
    if (storedContact?.whatsapp_e164) {
      setContactButtonState(button, true);
      openWhatsApp(listing, storedContact);
    } else if (button) {
      revealContact(listing, button);
    }
  }
};

const onRenderEmpty = () => {
  nextCursor = null;
  renderedResults = [];
  clearStateRoot();

  if (getMode() === MODE_BUY && lastAutoCreated) {
    showToast('Solicitud creada. Te avisaremos cuando aparezcan ofertas.');
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.textContent = 'Solicitud creada. Te avisaremos cuando aparezcan ofertas.';
    stateRootEl.appendChild(notice);
    return;
  }

  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = 'No hay resultados aún.';
  stateRootEl.appendChild(empty);
};

const onRenderError = (_error, onRetry) => {
  nextCursor = null;
  clearStateRoot();

  const error = document.createElement('div');
  error.className = 'empty';

  const title = document.createElement('div');
  title.textContent = 'No pudimos cargar resultados.';

  const helper = document.createElement('div');
  helper.className = 'helper';
  helper.textContent = 'Revisa tu conexión e intenta de nuevo.';

  const retryBtn = document.createElement('button');
  retryBtn.className = 'btn btn-primary btn-block';
  retryBtn.textContent = 'Reintentar';
  retryBtn.addEventListener('click', onRetry);

  error.appendChild(title);
  error.appendChild(helper);
  error.appendChild(retryBtn);
  stateRootEl.appendChild(error);
};

const requestListings = async (params, cursor) => {
  const query = new URLSearchParams();
  const source = params instanceof URLSearchParams ? params : new URLSearchParams(params || {});

  source.forEach((value, key) => {
    if (value !== '' && value != null) {
      query.set(key, value);
    }
  });

  if (cursor) {
    query.set('cursor', cursor);
  }

  if (!query.get('pageSize')) query.set('pageSize', '10');
  if (!query.get('sort')) query.set('sort', 'newest');

  const response = await fetch(`/search/listings?${query.toString()}`);
  if (!response.ok) {
    throw new Error(`search_failed_${response.status}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    throw new Error('search_invalid_json');
  }

  const data = payload?.ok === true && payload?.data ? payload.data : payload;
  if (!data || !Array.isArray(data.results)) {
    throw new Error('search_invalid_payload');
  }

  lastAutoCreated = Boolean(data.autoCreated);

  return {
    items: data.results,
    nextCursor: data.nextCursor || null
  };
};

const engine = createSearchStateEngine({
  requestListings,
  onRenderLoading,
  onRenderResults,
  onRenderEmpty,
  onRenderError
});

const openOverlay = (overlay) => {
  overlay.classList.add('active');
  overlay.setAttribute('aria-hidden', 'false');
  const firstInput = overlay.querySelector('input, select, textarea');
  if (firstInput) {
    requestAnimationFrame(() => firstInput.focus());
  }
};

const closeOverlay = (overlay) => {
  overlay.classList.remove('active');
  overlay.setAttribute('aria-hidden', 'true');
};

const currentParams = () => new URLSearchParams(window.location.search);

const sanitizeValue = (value) => value.trim();

const enforceBrandModelDependency = () => {
  const brandInput = document.getElementById('brand');
  const modelInput = document.getElementById('model');
  const hasBrand = Boolean(sanitizeValue(brandInput.value));
  modelInput.disabled = !hasBrand;
  if (!hasBrand) {
    modelInput.value = '';
  }
};

const loadItemTypes = async (marketId) => {
  const itemTypeSelect = document.getElementById('itemTypeId');
  try {
    const query = marketId ? `item-types?marketId=${encodeURIComponent(marketId)}&active=true` : 'item-types?active=true';
    const items = await fetchCatalog(query);
    applyOptions(itemTypeSelect, items, optionLabels.itemTypes);
  } catch (_error) {
    applyOptions(itemTypeSelect, [], optionLabels.itemTypes);
  }
};

const loadModels = async (brandId) => {
  const modelSelect = document.getElementById('model');
  try {
    if (!brandId) {
      applyOptions(modelSelect, [], optionLabels.models);
      modelSelect.disabled = true;
      return;
    }
    const items = await fetchCatalog(`models?brandId=${encodeURIComponent(brandId)}&active=true`);
    applyOptions(modelSelect, items, optionLabels.models);
    modelSelect.disabled = false;
  } catch (_error) {
    applyOptions(modelSelect, [], optionLabels.models);
    modelSelect.disabled = Boolean(brandId);
  }
};

const getFormState = () => {
  const priceValue = Number(document.getElementById('priceInput')?.value);
  const values = {
    brand: sanitizeValue(document.getElementById('brand').value),
    model: sanitizeValue(document.getElementById('model').value),
    year: sanitizeValue(document.getElementById('year').value),
    itemTypeId: sanitizeValue(document.getElementById('itemTypeId').value),
    side: sanitizeValue(document.getElementById('side').value),
    position: sanitizeValue(document.getElementById('position').value),
    detail: sanitizeValue(document.getElementById('itemDetail').value),
    extraDetails: sanitizeValue(document.getElementById('extraDetails')?.value || ''),
    expectedPrice: priceValue
  };
  const requiredIds = ['brand', 'model', 'year', 'itemTypeId', 'detail'];
  const allFilled = requiredIds.every((key) => values[key]?.length > 0);
  if (getMode() === MODE_SELL) {
    const priceValid = Number.isFinite(priceValue) && priceValue >= 10 && priceValue <= 1000;
    return {
      values,
      isValid: allFilled && priceValid
    };
  }
  return {
    values,
    isValid: allFilled
  };
};

const updateRequiredValidity = () => {
  const { isValid } = getFormState();
  const applyBtn = document.getElementById('applyRefine');
  if (applyBtn) applyBtn.disabled = !isValid;
  if (sellSearchBtn) sellSearchBtn.disabled = getMode() === MODE_SELL ? !isValid : true;
};

const loadStaticOptions = async () => {
  const brandSelect = document.getElementById('brand');
  const sideSelect = document.getElementById('side');
  const positionSelect = document.getElementById('position');
  const yearSelect = document.getElementById('year');

  const [brands, sides, positions, years] = await Promise.all([
    fetchCatalogSafe('brands?active=true'),
    fetchCatalogSafe('sides?active=true'),
    fetchCatalogSafe('positions?active=true'),
    fetchCatalogSafe('year-options?active=true')
  ]);

  applyOptions(brandSelect, brands, optionLabels.brands);
  applyOptions(sideSelect, sides, optionLabels.sides);
  applyOptions(positionSelect, positions, optionLabels.positions);
  applyOptions(yearSelect, years, optionLabels.years);
};

const buildSearchParamsFromForm = (mode) => {
  const { values } = getFormState();
  const params = new URLSearchParams();
  params.set('mode', mode);
  if (mode === MODE_SELL) {
    params.set('expectedPrice', `${values.expectedPrice}`);
  }
  if (values.brand) params.set('brand', values.brand);
  if (values.model) params.set('model', values.model);
  if (values.year) params.set('year', values.year);
  if (values.itemTypeId) params.set('itemTypeId', values.itemTypeId);
  if (mode === MODE_SELL) {
    if (values.side) params.set('side', values.side);
    if (values.position) params.set('position', values.position);
  }
  if (values.detail || values.extraDetails) {
    const combined = [values.detail, values.extraDetails].filter(Boolean).join(' ');
    params.set('q', combined.trim());
  }
  return params;
};

const runSearch = (mode) => {
  const { isValid } = getFormState();
  if (!isValid) {
    showToast('Completa los campos requeridos.');
    openOverlay(refineOverlay);
    return;
  }
  const params = buildSearchParamsFromForm(mode);
  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  closeOverlay(refineOverlay);
  updateQuerySummary(params);
  const paramsWithLocation = withPreferredLocation(params);
  persistLastSearchLocation(paramsWithLocation);
  lastAutoCreated = false;
  engine.run({ params: paramsWithLocation, cursor: null });
};

const applyRefine = () => {
  const mode = getMode();
  if (mode === MODE_SELL) {
    publishListing();
    return;
  }
  runSearch(MODE_BUY);
};

const resetRefine = async () => {
  refineFields.forEach((field) => {
    const el = document.getElementById(field);
    if (el) el.value = '';
  });
  window.history.replaceState({}, '', window.location.pathname);
  closeOverlay(refineOverlay);
  const params = new URLSearchParams();
  updateQuerySummary(params);
  await loadItemTypes(null);
  await loadModels(null);
};

const hydrateRefineForm = async () => {
  const params = currentParams();
  const brandId = params.get('brand') || '';
  const modelId = params.get('model') || '';
  const itemTypeId = params.get('itemTypeId') || '';

  document.getElementById('brand').value = brandId;
  document.getElementById('year').value = params.get('year') || '';
  document.getElementById('side').value = params.get('side') || '';
  document.getElementById('position').value = params.get('position') || '';
  document.getElementById('itemDetail').value = params.get('q') || '';
  document.getElementById('priceInput').value = params.get('expectedPrice') || '';
  const extraDetails = document.getElementById('extraDetails');
  if (extraDetails) extraDetails.value = '';

  await loadItemTypes(null);
  document.getElementById('itemTypeId').value = itemTypeId;

  await loadModels(brandId || null);
  document.getElementById('model').value = modelId;
};

openRefineBtn.addEventListener('click', () => {
  hydrateRefineForm();
  openOverlay(refineOverlay);
});

sellPublishBtn.addEventListener('click', () => {
  hydrateRefineForm();
  openOverlay(refineOverlay);
});

sellSearchBtn.addEventListener('click', () => {
  sellHasSearched = true;
  runSearch(MODE_SELL);
});

document.getElementById('closeRefine').addEventListener('click', () => closeOverlay(refineOverlay));
document.getElementById('applyRefine').addEventListener('click', applyRefine);
document.getElementById('resetRefine').addEventListener('click', resetRefine);
modeToggleBtn.addEventListener('click', () => {
  const next = getMode() === MODE_BUY ? MODE_SELL : MODE_BUY;
  setMode(next);
  clearStateRoot();
});
document.getElementById('brand').addEventListener('change', async (event) => {
  const brandId = event.target.value || '';
  await loadModels(brandId || null);
  document.getElementById('model').value = '';
  enforceBrandModelDependency();
});
['brand', 'model', 'year', 'itemTypeId', 'itemDetail', 'priceInput', 'extraDetails'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('input', updateRequiredValidity);
    el.addEventListener('change', updateRequiredValidity);
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  setMode(getMode());
  try {
    await loadStaticOptions();
  } catch (_error) {
    // keep defaults if catalog fetch fails
  }
  await hydrateRefineForm();
  updateQuerySummary(currentParams());

  const mode = getMode();
  const params = currentParams();
  if (mode === MODE_BUY && params.get('expectedPrice')) {
    const paramsWithLocation = withPreferredLocation(params);
    persistLastSearchLocation(paramsWithLocation);
    engine.run({ params: paramsWithLocation, cursor: null });
  }
});
