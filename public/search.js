import { requestListings } from '/app/search/api.js';
import { createSearchStateEngine } from '/app/search/stateEngine.js';
import { savePendingAuthAction, consumeAuthRetryAction } from '/app/auth-flow.js';

const stateRootEl = document.getElementById('searchStateRoot');
const refineOverlay = document.getElementById('refineOverlay');
const toastEl = document.getElementById('toast');
const marketLabel = document.getElementById('marketLabel');
const querySummaryEl = document.getElementById('querySummary');

const refineFields = [
  'marketId',
  'itemTypeId',
  'brand',
  'model',
  'year',
  'side',
  'position'
];

let nextCursor = null;
let renderedResults = [];
let listedById = new Map();


const DEFAULT_LOCATION_KEY = 'pilotDefaultLocation';
const LAST_SEARCH_LOCATION_KEY = 'pilotLastSearchLocation';
const REVEALED_CONTACTS_KEY = 'pilotRevealedContacts';

const optionLabels = {
  markets: new Map(),
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
  setTimeout(() => toastEl.classList.remove('show'), 2400);
};

const clearStateRoot = () => {
  stateRootEl.replaceChildren();
};

const formatPrice = (_howMuch) => 'Precio: ?';

const formatYear = (what) => {
  if (!what?.year_from) return '';
  if (!what.year_to || what.year_from === what.year_to) return `${what.year_from}`;
  return `${what.year_from}–${what.year_to}`;
};

const formatWhat = (itemType, what) => {
  const parts = [what?.brand, what?.model, formatYear(what), what?.side, what?.position]
    .filter(Boolean)
    .map((value) => value.toString().trim())
    .filter(Boolean);
  const itemLabel = itemType?.label_es || itemType?.key || 'Pieza';
  return [itemLabel, ...parts].join(' · ');
};

const formatWhere = (location) => {
  const parts = [location?.department, location?.municipality].filter(Boolean);
  if (!parts.length) return '';
  return parts.join(', ');
};

const formatTime = (publishedAt) => {
  if (!publishedAt) return '';
  const published = new Date(publishedAt);
  const now = new Date();
  const diffMs = now.getTime() - published.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (Number.isNaN(days) || days < 0) return '';
  if (days === 0) return 'Publicado hoy';
  if (days === 1) return 'Publicado hace 1 día';
  return `Publicado hace ${days} días`;
};

const qualityLabel = (score) => {
  if (score == null) return 'Sin señal';
  if (score >= 70) return 'Confiable';
  if (score >= 40) return 'Revisar';
  return 'Nuevo';
};

const buildMessage = (listing, contactName) => {
  const item = formatWhat(listing.itemType, listing.what);
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
  title.textContent = formatWhat(listing.itemType, listing.what);

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = qualityLabel(listing.quality_score);

  const meta = document.createElement('div');
  meta.className = 'meta';

  const price = document.createElement('div');
  price.className = 'price';
  price.textContent = formatPrice(listing.how_much);

  const whereText = formatWhere(listing.location);
  const where = document.createElement('div');
  where.textContent = whereText;

  const time = document.createElement('div');
  time.className = 'time';
  time.textContent = formatTime(listing.audit?.published_at);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const cardType = listing.cardType || 'listing';
  if (cardType === 'actionable') {
    const actionBtn = document.createElement('a');
    actionBtn.className = 'btn btn-primary btn-block';
    actionBtn.textContent = 'Crear solicitud';
    actionBtn.href = `/app/demand.html?${demandPrefillParamsFromSearch(currentParams()).toString()}`;
    actions.appendChild(actionBtn);
  } else {
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
  card.appendChild(actions);

  return card;
};

const updateMarketLabel = (params) => {
  const marketId = params.get('marketId');
  const label = marketId ? optionLabels.markets.get(marketId) : null;
  marketLabel.textContent = `Mercado: ${label || 'Todos'}`;
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

const demandPrefillParamsFromSearch = (params) => {
  const allowed = ['brand', 'model', 'year', 'itemTypeId', 'side', 'position'];
  const query = new URLSearchParams();
  allowed.forEach((key) => {
    const value = params.get(key);
    if (value) {
      query.set(key, value);
    }
  });
  return query;
};

const hashString = (value) => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
};

const buildActionableCardFromParams = (params) => {
  const parts = [];
  ['marketId', 'itemTypeId', 'brand', 'model', 'year', 'side', 'position', 'department', 'municipality', 'q'].forEach((key) => {
    const value = params.get(key);
    if (value) parts.push(`${key}=${encodeURIComponent(value)}`);
  });
  const signature = parts.join('|');
  const brandId = params.get('brand');
  const modelId = params.get('model');
  const yearId = params.get('year');
  const itemTypeId = params.get('itemTypeId');
  const sideId = params.get('side');
  const positionId = params.get('position');

  return {
    listingId: `actionable:${hashString(signature)}`,
    cardType: 'actionable',
    marketId: params.get('marketId') || null,
    itemType: itemTypeId
      ? {
          id: itemTypeId,
          label_es: optionLabels.itemTypes.get(itemTypeId) || itemTypeId
        }
      : null,
    what: {
      brand: brandId ? optionLabels.brands.get(brandId) || brandId : null,
      model: modelId ? optionLabels.models.get(modelId) || modelId : null,
      year_from: yearId ? Number(yearId) : null,
      year_to: yearId ? Number(yearId) : null,
      side: sideId ? optionLabels.sides.get(sideId) || sideId : null,
      position: positionId ? optionLabels.positions.get(positionId) || positionId : null
    },
    how_much: null,
    location: null,
    audit: { published_at: new Date().toISOString() },
    quality_score: 0
  };
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
  listedById = new Map(items.filter((item) => item.cardType !== 'actionable').map((item) => [item.listingId, item]));
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

  const params = currentParams();
  const actionable = buildActionableCardFromParams(params);
  const list = document.createElement('section');
  list.className = 'list';
  list.appendChild(buildCard(actionable));
  stateRootEl.appendChild(list);
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

const enforceItemTypeDependency = () => {
  const sideInput = document.getElementById('side');
  const positionInput = document.getElementById('position');
  sideInput.disabled = false;
  positionInput.disabled = false;
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

const loadStaticOptions = async () => {
  const marketSelect = document.getElementById('marketId');
  const brandSelect = document.getElementById('brand');
  const sideSelect = document.getElementById('side');
  const positionSelect = document.getElementById('position');
  const yearSelect = document.getElementById('year');

  const [markets, brands, sides, positions, years] = await Promise.all([
    fetchCatalogSafe('markets?active=true'),
    fetchCatalogSafe('brands?active=true'),
    fetchCatalogSafe('sides?active=true'),
    fetchCatalogSafe('positions?active=true'),
    fetchCatalogSafe('year-options?active=true')
  ]);

  applyOptions(marketSelect, markets, optionLabels.markets);
  applyOptions(brandSelect, brands, optionLabels.brands);
  applyOptions(sideSelect, sides, optionLabels.sides);
  applyOptions(positionSelect, positions, optionLabels.positions);
  applyOptions(yearSelect, years, optionLabels.years);
};

const applyRefine = () => {
  const params = new URLSearchParams();
  const marketId = sanitizeValue(document.getElementById('marketId').value);
  const brand = sanitizeValue(document.getElementById('brand').value);
  const model = sanitizeValue(document.getElementById('model').value);
  const year = sanitizeValue(document.getElementById('year').value);
  const itemTypeId = sanitizeValue(document.getElementById('itemTypeId').value);
  const side = sanitizeValue(document.getElementById('side').value);
  const position = sanitizeValue(document.getElementById('position').value);

  if (marketId) params.set('marketId', marketId);
  if (brand) params.set('brand', brand);
  if (brand && model) params.set('model', model);
  if (year) params.set('year', year);
  if (itemTypeId) params.set('itemTypeId', itemTypeId);
  if (side) params.set('side', side);
  if (position) params.set('position', position);

  window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  closeOverlay(refineOverlay);
  updateMarketLabel(params);
  updateQuerySummary(params);
  const paramsWithLocation = withPreferredLocation(params);
  persistLastSearchLocation(paramsWithLocation);
  engine.run({ params: paramsWithLocation, cursor: null });
};

const resetRefine = async () => {
  refineFields.forEach((field) => {
    document.getElementById(field).value = '';
  });
  window.history.replaceState({}, '', window.location.pathname);
  closeOverlay(refineOverlay);
  const params = new URLSearchParams();
  updateMarketLabel(params);
  updateQuerySummary(params);
  await loadItemTypes(null);
  await loadModels(null);
  const paramsWithLocation = withPreferredLocation(params);
  persistLastSearchLocation(paramsWithLocation);
  engine.run({ params: paramsWithLocation, cursor: null });
};

const hydrateRefineForm = async () => {
  const params = currentParams();
  const marketId = params.get('marketId') || '';
  const brandId = params.get('brand') || '';
  const modelId = params.get('model') || '';
  const itemTypeId = params.get('itemTypeId') || '';

  document.getElementById('marketId').value = marketId;
  document.getElementById('brand').value = brandId;
  document.getElementById('year').value = params.get('year') || '';
  document.getElementById('side').value = params.get('side') || '';
  document.getElementById('position').value = params.get('position') || '';

  await loadItemTypes(marketId || null);
  document.getElementById('itemTypeId').value = itemTypeId;

  await loadModels(brandId || null);
  document.getElementById('model').value = modelId;
};

document.getElementById('openRefine').addEventListener('click', () => {
  hydrateRefineForm();
  openOverlay(refineOverlay);
});

document.getElementById('closeRefine').addEventListener('click', () => closeOverlay(refineOverlay));
document.getElementById('applyRefine').addEventListener('click', applyRefine);
document.getElementById('resetRefine').addEventListener('click', resetRefine);
document.getElementById('brand').addEventListener('change', async (event) => {
  const brandId = event.target.value || '';
  await loadModels(brandId || null);
  document.getElementById('model').value = '';
  enforceBrandModelDependency();
});
document.getElementById('marketId').addEventListener('change', async (event) => {
  const marketId = event.target.value || '';
  await loadItemTypes(marketId || null);
  document.getElementById('itemTypeId').value = '';
});

window.addEventListener('DOMContentLoaded', async () => {
  const params = currentParams();
  try {
    await loadStaticOptions();
  } catch (_error) {
    // keep defaults if catalog fetch fails
  }
  await hydrateRefineForm();
  updateMarketLabel(params);
  updateQuerySummary(params);
  const paramsWithLocation = withPreferredLocation(params);
  persistLastSearchLocation(paramsWithLocation);
  engine.run({ params: paramsWithLocation, cursor: null });
});
