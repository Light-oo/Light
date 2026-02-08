export const PENDING_AUTH_ACTION_KEY = 'pendingAuthAction';
export const AUTH_RETRY_ACTION_KEY = 'authRetryAction';

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
};

export const savePendingAuthAction = ({ actionType, payload, returnUrl }) => {
  if (!actionType || !payload) return;
  const action = {
    actionType,
    payload,
    returnUrl: returnUrl || '/app/search.html'
  };
  sessionStorage.setItem(PENDING_AUTH_ACTION_KEY, JSON.stringify(action));
};

export const consumeAuthRetryAction = (expectedActionType) => {
  const action = parseJson(sessionStorage.getItem(AUTH_RETRY_ACTION_KEY));
  if (!action || action.actionType !== expectedActionType) return null;
  sessionStorage.removeItem(AUTH_RETRY_ACTION_KEY);
  return action;
};

export const consumePendingAuthAction = () => {
  const action = parseJson(sessionStorage.getItem(PENDING_AUTH_ACTION_KEY));
  if (!action) return null;
  sessionStorage.removeItem(PENDING_AUTH_ACTION_KEY);
  return action;
};

export const completeAuthSuccess = (fallbackReturnUrl = '/app/search.html') => {
  const pending = consumePendingAuthAction();
  if (!pending) return fallbackReturnUrl;
  sessionStorage.setItem(AUTH_RETRY_ACTION_KEY, JSON.stringify(pending));
  return pending.returnUrl || fallbackReturnUrl;
};
