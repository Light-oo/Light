export async function requestListings(params, cursor) {
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

  return {
    items: data.results,
    nextCursor: data.nextCursor || null
  };
}
