(function () {
  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const loginError = document.getElementById('login-error');
  const patientListEl = document.getElementById('patient-list');
  const consoleEmpty = document.getElementById('console-empty');
  const consoleChatPanel = document.getElementById('console-chat-panel');
  const consolePatientName = document.getElementById('console-patient-name');
  const consoleLog = document.getElementById('console-log');
  const consoleInput = document.getElementById('console-input');
  const consoleSendButton = document.getElementById('console-send-button');
  const consoleRevokeButton = document.getElementById('console-revoke-button');
  const broadcastTemplatesEl = document.getElementById('broadcast-templates');
  const broadcastInput = document.getElementById('broadcast-input');
  const broadcastSendButton = document.getElementById('broadcast-send-button');

  const POLL_INTERVAL_MS = 4000;

  let selectedId = null;
  let selectedName = null;
  let pollTimer = null;

  function showSection(section) {
    [loginSection, dashboardSection].forEach((s) => (s.style.display = 'none'));
    section.style.display = 'block';
  }

  async function init() {
    const res = await fetch('/api/admin/session-status');
    const data = await res.json();

    if (data.authenticated) {
      showSection(dashboardSection);
      await loadPatients();
      await loadBroadcastTemplates();
    } else {
      showSection(loginSection);
    }
  }

  async function loadBroadcastTemplates() {
    const res = await fetch('/api/admin/broadcast-templates');
    const data = await res.json();
    broadcastTemplatesEl.innerHTML = '';
    (data.templates || []).forEach((tpl) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'resolution-btn resolution-yes';
      btn.textContent = tpl.label;
      btn.addEventListener('click', () => {
        broadcastInput.value = tpl.text;
      });
      broadcastTemplatesEl.appendChild(btn);
    });
  }

  broadcastSendButton.addEventListener('click', async () => {
    const text = broadcastInput.value.trim();
    if (!text) return;

    const confirmed = window.confirm('全ての患者さんに、下記の内容を一斉送信します。よろしいですか？\n\n' + text);
    if (!confirmed) return;

    broadcastSendButton.disabled = true;
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.ok) {
        window.alert(`送信しました（LINE: ${data.lineSent}名 / ホームページ: ${data.webSent}名）`);
        broadcastInput.value = '';
      } else {
        window.alert(data.error || '送信できませんでした。');
      }
    } catch (err) {
      window.alert('通信エラーが発生しました。');
    } finally {
      broadcastSendButton.disabled = false;
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
      body: JSON.stringify({ password }),
    });
    const data = await res.json();

    if (!data.ok) {
      loginError.textContent = data.message || 'ログインできませんでした。';
      loginError.style.display = 'block';
      return;
    }

    showSection(dashboardSection);
    await loadPatients();
    await loadBroadcastTemplates();
  });

  async function loadPatients() {
    const res = await fetch('/api/admin/patients');
    const data = await res.json();
    renderPatientList(data.patients || []);
  }

  function renderPatientList(patients) {
    if (patients.length === 0) {
      patientListEl.innerHTML = '<div class="card">まだ患者さんがいません。</div>';
      return;
    }

    patientListEl.innerHTML = '';
    patients.forEach((patient) => {
      const item = document.createElement('div');
      item.className = 'patient-list-item';
      if (patient.id === selectedId) item.classList.add('active');

      const badge = document.createElement('span');
      badge.className = 'channel-badge ' + patient.type;
      badge.textContent = patient.type === 'line' ? 'LINE' : 'Web';

      const name = document.createElement('span');
      name.textContent = patient.name;

      item.appendChild(badge);
      item.appendChild(name);
      item.addEventListener('click', () => selectPatient(patient.id, patient.name));

      patientListEl.appendChild(item);
    });
  }

  function renderThread(messages) {
    consoleLog.innerHTML = '';
    messages.forEach((m) => {
      const div = document.createElement('div');
      // 薬剤師側の画面なので、患者さんのメッセージを相手側（左）、
      // 自分（AI/薬剤師）からの返信を自分側（右）に表示する
      div.className = 'bubble ' + (m.role === 'user' ? 'pharmacist' : 'user');
      const textEl = document.createElement('div');
      textEl.className = 'bubble-text';
      textEl.textContent = m.text;
      div.appendChild(textEl);
      consoleLog.appendChild(div);
    });
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }

  async function selectPatient(id, name) {
    selectedId = id;
    selectedName = name;
    consolePatientName.textContent = name;
    consoleEmpty.style.display = 'none';
    consoleChatPanel.style.display = 'block';

    Array.from(patientListEl.children).forEach((item) => item.classList.remove('active'));
    const patients = await (await fetch('/api/admin/patients')).json();
    renderPatientList(patients.patients || []);

    await refreshThread();
    startPolling();
  }

  async function refreshThread() {
    if (!selectedId) return;
    const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/messages');
    const data = await res.json();
    renderThread(data.messages || []);
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshThread();
    }, POLL_INTERVAL_MS);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && selectedId) refreshThread();
  });

  async function sendMessage() {
    const text = consoleInput.value.trim();
    if (!text || !selectedId) return;

    consoleSendButton.disabled = true;
    try {
      const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.ok) {
        consoleInput.value = '';
        await refreshThread();
      } else {
        window.alert(data.error || '送信できませんでした。');
      }
    } catch (err) {
      window.alert('通信エラーが発生しました。');
    } finally {
      consoleSendButton.disabled = false;
    }
  }

  consoleSendButton.addEventListener('click', sendMessage);
  consoleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  consoleRevokeButton.addEventListener('click', async () => {
    if (!selectedId) return;

    // 解除する相手を必ず名前で確認してもらい、患者さんを取り違えて解除しないようにする
    const confirmed = window.confirm(
      `「${selectedName}」さんの認証を解除します。\n次回の相談時は、認証コードの入力からやり直しになります。\n本当によろしいですか？`
    );
    if (!confirmed) return;

    consoleRevokeButton.disabled = true;
    try {
      const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId), { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        clearInterval(pollTimer);
        selectedId = null;
        selectedName = null;
        consoleChatPanel.style.display = 'none';
        consoleEmpty.style.display = 'block';
        await loadPatients();
      } else {
        window.alert(data.error || '認証解除できませんでした。');
      }
    } catch (err) {
      window.alert('通信エラーが発生しました。');
    } finally {
      consoleRevokeButton.disabled = false;
    }
  });

  init();
})();
