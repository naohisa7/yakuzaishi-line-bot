(function () {
  const loginSection = document.getElementById('login-section');
  const guideContent = document.getElementById('guide-content');
  const loginError = document.getElementById('login-error');

  function showSection(section) {
    [loginSection, guideContent].forEach((s) => (s.style.display = 'none'));
    section.style.display = 'block';
  }

  async function init() {
    const res = await fetch('/api/admin/session-status');
    const data = await res.json();
    showSection(data.authenticated ? guideContent : loginSection);
  }

  document.getElementById('login-button').addEventListener('click', async () => {
    const password = document.getElementById('password-input').value.trim();
    loginError.style.display = 'none';

    if (!password) {
      loginError.textContent = 'パスワードを入力してください。';
      loginError.style.display = 'block';
      return;
    }

    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pharmacistId: window.getSelectedPharmacistId ? window.getSelectedPharmacistId() : '', password }),
    });
    const data = await res.json();

    if (!data.ok) {
      loginError.textContent = data.message || 'ログインできませんでした。';
      loginError.style.display = 'block';
      return;
    }

    showSection(guideContent);
  });

  init();
})();
