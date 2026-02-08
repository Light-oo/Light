export const SearchStates = {
  LOADING: 'loading',
  RESULTS: 'results',
  EMPTY: 'empty',
  ERROR: 'error'
};

export function createSearchStateEngine({
  requestListings,
  onRenderResults,
  onRenderEmpty,
  onRenderError,
  onRenderLoading
}) {
  let state = SearchStates.LOADING;
  let latestRequestId = 0;
  let debounceTimer;
  let lastSuccessfulParams = null;
  let lastAttempted = null;

  const toParams = (params) => (params instanceof URLSearchParams ? new URLSearchParams(params) : new URLSearchParams(params || {}));

  const transition = (nextState) => {
    state = nextState;
  };

  const execute = async ({ params, cursor = null, append = false } = {}) => {
    const finalParams = toParams(params);
    lastAttempted = { params: new URLSearchParams(finalParams), cursor, append };

    if (!append) {
      transition(SearchStates.LOADING);
      onRenderLoading();
    }

    const requestId = ++latestRequestId;

    try {
      const { items, nextCursor } = await requestListings(finalParams, cursor);

      if (requestId !== latestRequestId) return;

      lastSuccessfulParams = new URLSearchParams(finalParams);
      if (items.length > 0 || append) {
        transition(SearchStates.RESULTS);
        onRenderResults(items, nextCursor);
      } else {
        transition(SearchStates.EMPTY);
        onRenderEmpty(finalParams);
      }
    } catch (error) {
      if (requestId !== latestRequestId) return;
      transition(SearchStates.ERROR);
      onRenderError(error, retryLastAttempt);
    }
  };

  const run = (payload) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      execute(payload);
    }, 120);
  };

  const retryLastAttempt = () => {
    if (!lastAttempted) return;
    run(lastAttempted);
  };

  return {
    run,
    retryLastAttempt,
    getState: () => state,
    getLastSuccessfulParams: () => (lastSuccessfulParams ? new URLSearchParams(lastSuccessfulParams) : null),
    getLastAttempted: () =>
      lastAttempted
        ? {
            ...lastAttempted,
            params: new URLSearchParams(lastAttempted.params)
          }
        : null
  };
}
