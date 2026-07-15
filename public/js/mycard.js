(function () {
  const loginSection = document.getElementById('login-section');
  const unavailableSection = document.getElementById('unavailable-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const loginError = document.getElementById('login-error');
  const codeError = document.getElementById('code-error');
  const codeStatus = document.getElementById('code-status');
  const greeting = document.getElementById('greeting');
  const codeInput = document.getElementById('code-input');
  const codeSaveButton = document.getElementById('code-save-button');
  const cardPreview = document.getElementById('card-preview');
  const phoneInput = document.getElementById('phone-input');
  const phoneSaveButton = document.getElementById('phone-save-button');
  const phoneStatus = document.getElementById('phone-status');
  const openCardModalButton = document.getElementById('open-card-modal-button');

  let currentCard = null;

  function showSection(section) {
    [loginSection, unavailableSection, dashboardSection].forEach((s) => (s.style.display = 'none'));
    section.style.display = 'block';
  }

  async function init() {
    const res = await fetch('/api/admin/session-status');
    const data = await res.json();
    if (data.authenticated) {
      await enterDashboard();
    } else {
      showSection(loginSection);
    }
  }

  async function enterDashboard() {
    const res = await fetch('/api/pharmacist/me');
    const data = await res.json();
    if (!data.available) {
      showSection(unavailableSection);
      return;
    }
    currentCard = data.card;
    showSection(dashboardSection);
    phoneInput.value = data.phone || '';
    render();
  }

  function render() {
    greeting.textContent = currentCard.name + ' さんの認証コード・名刺';
    codeInput.value = currentCard.patientAuthCode || '';
    cardPreview.innerHTML = '';
    cardPreview.appendChild(window.buildNameCard(currentCard));
  }

  phoneSaveButton.addEventListener('click', async () => {
    phoneStatus.textContent = '';
    phoneSaveButton.disabled = true;
    try {
      const res = await fetch('/api/pharmacist/me/phone', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneInput.value.trim() }),
      });
      const data = await res.json();
      phoneStatus.textContent = data.ok
        ? '電話番号を保存しました。'
        : data.message || data.error || '保存できませんでした。';
    } finally {
      phoneSaveButton.disabled = false;
    }
  });

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
    await enterDashboard();
  });

  codeSaveButton.addEventListener('click', async () => {
    codeError.style.display = 'none';
    codeStatus.textContent = '';
    const authCode = codeInput.value.trim();
    if (!authCode) {
      codeError.textContent = '認証コードを入力してください。';
      codeError.style.display = 'block';
      return;
    }
    codeSaveButton.disabled = true;
    try {
      const res = await fetch('/api/pharmacist/me/authcode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authCode }),
      });
      const data = await res.json();
      if (!data.ok) {
        codeError.textContent = data.message || data.error || '変更できませんでした。';
        codeError.style.display = 'block';
        return;
      }
      currentCard = data.card;
      render();
      codeStatus.textContent = '認証コードを更新しました。名刺も更新されています。';
    } finally {
      codeSaveButton.disabled = false;
    }
  });

  function ensureCodeThen(fn) {
    if (!currentCard) return;
    if (!currentCard.patientAuthCode) {
      codeError.textContent = '先に認証コードを設定してください。';
      codeError.style.display = 'block';
      return;
    }
    fn();
  }

  openCardModalButton.addEventListener('click', () => ensureCodeThen(() => window.openCardModal(currentCard)));

  init();
})();
