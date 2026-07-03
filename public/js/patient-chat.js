(function () {
  const loginSection = document.getElementById('login-section');
  const consentSection = document.getElementById('consent-section');
  const chatSection = document.getElementById('chat-section');
  const loginError = document.getElementById('login-error');
  const policyText = document.getElementById('policy-text');
  const chatLog = document.getElementById('chat-log');
  const imageFilename = document.getElementById('image-filename');

  let sessionId = null;

  function showSection(section) {
    [loginSection, consentSection, chatSection].forEach((s) => (s.style.display = 'none'));
    section.style.display = 'block';
  }

  function addBubble(role, text) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role;
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addCallBubble(phone) {
    const div = document.createElement('div');
    div.className = 'bubble assistant call-bubble';

    const p = document.createElement('p');
    p.textContent = 'お急ぎの場合は、担当薬剤師に直接お電話いただくこともできます。';
    div.appendChild(p);

    const link = document.createElement('a');
    link.className = 'call-link';
    link.href = 'tel:' + phone.replace(/[^0-9+]/g, '');
    link.textContent = '📞 ' + phone + ' に電話する';
    div.appendChild(link);

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  async function init() {
    const res = await fetch('/api/session-status');
    const data = await res.json();

    if (!data.authenticated) {
      showSection(loginSection);
      return;
    }

    sessionId = data.sessionId;

    if (!data.consented) {
      policyText.textContent = data.privacyPolicy;
      showSection(consentSection);
      return;
    }

    await enterChat();
  }

  async function enterChat() {
    showSection(chatSection);

    const historyRes = await fetch('/api/chat/history');
    const historyData = await historyRes.json();
    historyData.messages.forEach((m) => addBubble(m.role, m.text));

    connectWebSocket();
  }

  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(protocol + '//' + location.host + '/ws?session=' + sessionId);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      addBubble('pharmacist', data.text);
    };
  }

  document.getElementById('verify-button').addEventListener('click', async () => {
    const name = document.getElementById('name-input').value.trim();
    const passcode = document.getElementById('passcode-input').value.trim();
    loginError.style.display = 'none';

    if (!name || !passcode) {
      loginError.textContent = 'お名前と認証コードを入力してください。';
      loginError.style.display = 'block';
      return;
    }

    const res = await fetch('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, passcode }),
    });
    const data = await res.json();

    if (!data.ok) {
      loginError.textContent = data.message || '認証コードが正しくありません。';
      loginError.style.display = 'block';
      return;
    }

    sessionId = data.sessionId;
    policyText.textContent = data.privacyPolicy;
    showSection(consentSection);
  });

  document.getElementById('agree-button').addEventListener('click', async () => {
    await fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agree: true }),
    });
    await enterChat();
  });

  document.getElementById('disagree-button').addEventListener('click', () => {
    document.getElementById('app-container').innerHTML =
      '<div class="card">同意いただけない場合、本サービスはご利用いただけません。</div>';
  });

  document.getElementById('image-input').addEventListener('change', () => {
    const file = document.getElementById('image-input').files[0];
    imageFilename.textContent = file ? '添付：' + file.name : '';
  });

  document.getElementById('send-button').addEventListener('click', sendMessage);

  let isComposing = false;
  const messageInput = document.getElementById('message-input');
  messageInput.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  messageInput.addEventListener('compositionend', () => {
    isComposing = false;
  });
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isComposing && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });

  async function sendMessage() {
    const input = document.getElementById('message-input');
    const imageInput = document.getElementById('image-input');
    const text = input.value.trim();
    const file = imageInput.files[0];
    if (!text && !file) return;

    addBubble('user', text || '（写真を送信しました）');
    input.value = '';
    // 一部のIME環境では確定直後に元の文字列がinputへ書き戻されることがあるため、
    // 次のティックで再度クリアして確実に空にする
    setTimeout(() => {
      input.value = '';
    }, 0);

    const formData = new FormData();
    if (text) formData.append('message', text);
    if (file) formData.append('image', file);
    imageInput.value = '';
    imageFilename.textContent = '';

    const res = await fetch('/api/chat', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.reply) {
      addBubble('assistant', data.reply);
    }
    if (data.needsEscalation && data.phone) {
      addCallBubble(data.phone);
    }
  }

  init();
})();
