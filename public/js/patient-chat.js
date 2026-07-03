(function () {
  const loginSection = document.getElementById('login-section');
  const consentSection = document.getElementById('consent-section');
  const chatSection = document.getElementById('chat-section');
  const loginError = document.getElementById('login-error');
  const policyText = document.getElementById('policy-text');
  const chatLog = document.getElementById('chat-log');
  const imageFilename = document.getElementById('image-filename');

  let sessionId = null;
  let pendingResolutionTimer = null;
  let isSending = false;
  const RESOLUTION_PROMPT_DELAY_MS = 8000;

  function showSection(section) {
    [loginSection, consentSection, chatSection].forEach((s) => (s.style.display = 'none'));
    section.style.display = 'block';
  }

  let currentUtteranceButton = null;

  function speak(text, button) {
    if (!('speechSynthesis' in window)) return;

    const resetButton = (btn) => {
      if (btn) btn.textContent = '🔊';
    };

    const wasSpeaking = window.speechSynthesis.speaking;
    const sameButton = currentUtteranceButton === button;
    if (wasSpeaking) {
      window.speechSynthesis.cancel();
      resetButton(currentUtteranceButton);
      currentUtteranceButton = null;
      if (sameButton) return; // 同じボタンをもう一度押した場合は停止のみ
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.onend = () => {
      resetButton(button);
      if (currentUtteranceButton === button) currentUtteranceButton = null;
    };
    utterance.onerror = () => {
      resetButton(button);
      if (currentUtteranceButton === button) currentUtteranceButton = null;
    };

    window.speechSynthesis.speak(utterance);
    if (button) button.textContent = '⏸';
    currentUtteranceButton = button;
  }

  function addBubble(role, text) {
    const div = document.createElement('div');
    div.className = 'bubble ' + role;

    const textEl = document.createElement('div');
    textEl.className = 'bubble-text';
    textEl.textContent = text;
    div.appendChild(textEl);

    if ((role === 'assistant' || role === 'pharmacist') && 'speechSynthesis' in window) {
      const ttsButton = document.createElement('button');
      ttsButton.type = 'button';
      ttsButton.className = 'tts-button';
      ttsButton.setAttribute('aria-label', '読み上げ');
      ttsButton.textContent = '🔊';
      ttsButton.addEventListener('click', () => speak(text, ttsButton));
      div.appendChild(ttsButton);
    }

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addTypingBubble() {
    const div = document.createElement('div');
    div.className = 'bubble assistant typing-bubble';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'typing-dot';
      div.appendChild(dot);
    }
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
    return div;
  }

  function addCallBubble(phone, videoLink) {
    const div = document.createElement('div');
    div.className = 'bubble assistant call-bubble';

    const p = document.createElement('p');
    p.textContent = 'お急ぎの場合は、担当薬剤師に直接お電話・ビデオ通話でご相談いただくこともできます。';
    div.appendChild(p);

    const link = document.createElement('a');
    link.className = 'call-link';
    link.href = 'tel:' + phone.replace(/[^0-9+]/g, '');
    link.textContent = '📞 ' + phone + ' に電話する';
    div.appendChild(link);

    if (videoLink) {
      const videoBtn = document.createElement('a');
      videoBtn.className = 'call-link video-call-link';
      videoBtn.href = videoLink;
      videoBtn.target = '_blank';
      videoBtn.rel = 'noopener noreferrer';
      videoBtn.textContent = '📹 ビデオ通話で相談する';
      div.appendChild(videoBtn);
    }

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addVideoCallBubble(videoLink) {
    const div = document.createElement('div');
    div.className = 'bubble assistant call-bubble';

    const p = document.createElement('p');
    p.textContent = '担当薬剤師にビデオ通話をご案内しました。下記のリンクから参加してお待ちください。';
    div.appendChild(p);

    const videoBtn = document.createElement('a');
    videoBtn.className = 'call-link video-call-link';
    videoBtn.href = videoLink;
    videoBtn.target = '_blank';
    videoBtn.rel = 'noopener noreferrer';
    videoBtn.textContent = '📹 ビデオ通話に参加する';
    div.appendChild(videoBtn);

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addResolutionPrompt() {
    const div = document.createElement('div');
    div.className = 'bubble assistant resolution-bubble';

    const p = document.createElement('p');
    p.textContent = 'この回答で解決しましたか？';
    div.appendChild(p);

    const row = document.createElement('div');
    row.className = 'resolution-buttons';

    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.className = 'resolution-btn resolution-yes';
    yesBtn.textContent = '✅ 解決した';

    const noBtn = document.createElement('button');
    noBtn.type = 'button';
    noBtn.className = 'resolution-btn resolution-no';
    noBtn.textContent = '❌ 解決しなかった';

    row.appendChild(yesBtn);
    row.appendChild(noBtn);
    div.appendChild(row);

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;

    yesBtn.addEventListener('click', async () => {
      div.innerHTML = '';
      const doneP = document.createElement('p');
      doneP.textContent = 'よかったです！またいつでもご相談ください。';
      div.appendChild(doneP);
      chatLog.scrollTop = chatLog.scrollHeight;

      await fetch('/api/chat/resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: true }),
      });
    });

    noBtn.addEventListener('click', () => {
      showFeedbackForm(div);
    });
  }

  function showFeedbackForm(container) {
    container.innerHTML = '';

    const p = document.createElement('p');
    p.textContent =
      '申し訳ありません。今後の改善のため、どのような点が分かりにくかった・不十分だったか教えていただけますか？（未入力のまま送信いただいても構いません）';
    container.appendChild(p);

    const row = document.createElement('div');
    row.className = 'feedback-form-row';

    const feedbackInput = document.createElement('input');
    feedbackInput.type = 'text';
    feedbackInput.placeholder = '例：もっと具体的な薬の名前が知りたかった';

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'call-link';
    sendBtn.textContent = '送信';

    row.appendChild(feedbackInput);
    row.appendChild(sendBtn);
    container.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;

    let submitting = false;
    const submit = async () => {
      if (submitting) return;
      submitting = true;

      const feedback = feedbackInput.value.trim();
      container.innerHTML = '';
      const doneP = document.createElement('p');
      doneP.textContent = '貴重なご意見をありがとうございました。今後の改善に活かします🙏';
      container.appendChild(doneP);
      chatLog.scrollTop = chatLog.scrollHeight;

      await fetch('/api/chat/resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: false, feedback }),
      });
    };

    sendBtn.addEventListener('click', submit);
    feedbackInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    });
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

  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  function connectWebSocket() {
    clearTimeout(reconnectTimer);

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(protocol + '//' + location.host + '/ws?session=' + sessionId);

    ws.onopen = () => {
      reconnectAttempts = 0;
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      addBubble('pharmacist', data.text);
    };

    // スマホの電波切れや画面ロックなどで接続が切れても、薬剤師からの
    // 返信を受け取れなくならないよう、間隔を広げながら自動で再接続する
    ws.onclose = () => {
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    const delay = Math.min(30000, 1000 * 2 ** reconnectAttempts);
    reconnectAttempts++;
    reconnectTimer = setTimeout(connectWebSocket, delay);
  }

  // アプリをバックグラウンドから復帰した際にも、接続が切れていれば
  // すぐに再接続を試みる
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ws && ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }
  });

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

  const videoCallButton = document.getElementById('video-call-button');
  if (videoCallButton) {
    videoCallButton.addEventListener('click', async () => {
      videoCallButton.disabled = true;
      try {
        const res = await fetch('/api/video-call', { method: 'POST' });
        const data = await res.json();
        if (data.videoLink) {
          addVideoCallBubble(data.videoLink);
        } else {
          addBubble('assistant', data.error || 'ビデオ通話を開始できませんでした。しばらくしてから再度お試しください。');
        }
      } catch (err) {
        addBubble('assistant', '通信エラーが発生しました。しばらくしてから再度お試しください。');
      } finally {
        videoCallButton.disabled = false;
      }
    });
  }

  const sendButton = document.getElementById('send-button');
  sendButton.addEventListener('click', sendMessage);

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
    if (isSending) return;

    const input = document.getElementById('message-input');
    const imageInput = document.getElementById('image-input');
    const text = input.value.trim();
    const file = imageInput.files[0];
    if (!text && !file) return;

    isSending = true;
    sendButton.disabled = true;

    // まだ会話が続いている途中で「解決したか」を聞かないよう、
    // 新しいメッセージを送ったら前回分の保留中の確認は取り消す
    clearTimeout(pendingResolutionTimer);

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

    // 写真の解析など、返信に時間がかかる場合でも待っていることが分かるように表示
    const typingBubble = addTypingBubble();

    try {
      const res = await fetch('/api/chat', { method: 'POST', body: formData });
      const data = await res.json();
      typingBubble.remove();

      if (!res.ok || data.error) {
        addBubble('assistant', data.error || '現在システムの調子が良くありません。しばらくしてから再度お試しください。');
        return;
      }

      if (data.reply) {
        addBubble('assistant', data.reply);
      }
      if (data.needsEscalation && data.phone) {
        addCallBubble(data.phone, data.videoLink);
      } else if (data.reply) {
        // すぐには聞かず、一定時間これ以上メッセージが来なければ
        // 会話が一段落したとみなして「解決したか」を確認する
        pendingResolutionTimer = setTimeout(() => {
          addResolutionPrompt();
        }, RESOLUTION_PROMPT_DELAY_MS);
      }
    } catch (err) {
      typingBubble.remove();
      addBubble('assistant', '通信エラーが発生しました。しばらくしてから再度お試しください。');
    } finally {
      isSending = false;
      sendButton.disabled = false;
    }
  }

  init();
})();
