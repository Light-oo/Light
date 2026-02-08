import { completeAuthSuccess } from '/app/auth-flow.js';

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const continueBtn = document.getElementById('continue');
const createAccountBtn = document.getElementById('createAccount');
const errorEl = document.getElementById('authError');

const setSubmitting = (isSubmitting) => {
  continueBtn.disabled = isSubmitting;
  createAccountBtn.disabled = isSubmitting;
  continueBtn.textContent = isSubmitting ? 'Continuando...' : 'Continuar';
};

const readCredentials = () => ({
  email: emailInput.value.trim(),
  password: passwordInput.value
});

const isValidCredentials = ({ email, password }) => Boolean(email) && Boolean(password);

const submitAuth = async (mode) => {
  const credentials = readCredentials();
  if (!isValidCredentials(credentials)) {
    errorEl.hidden = false;
    return;
  }

  errorEl.hidden = true;
  setSubmitting(true);

  try {
    const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(credentials)
    });

    if (!response.ok) {
      errorEl.hidden = false;
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const explicitReturn = params.get('returnTo') || '/app/search.html';
    const destination = completeAuthSuccess(explicitReturn);
    window.location.href = destination;
  } catch (_error) {
    errorEl.hidden = false;
  } finally {
    setSubmitting(false);
  }
};

continueBtn.addEventListener('click', () => submitAuth('signin'));
createAccountBtn.addEventListener('click', () => submitAuth('signup'));
