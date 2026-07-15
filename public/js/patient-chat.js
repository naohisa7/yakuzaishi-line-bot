(function () {
  const loginSection = document.getElementById('login-section');
  const consentSection = document.getElementById('consent-section');
  const chatSection = document.getElementById('chat-section');
  const loginError = document.getElementById('login-error');
  const policyText = document.getElementById('policy-text');
  const chatLog = document.getElementById('chat-log');

  let sessionId = null;
  let pendingResolutionTimer = null;
  let isSending = false;
  const RESOLUTION_PROMPT_DELAY_MS = 8000;

  function showSection(section) {
    [loginSection, consentSection, chatSection].forEach((s) => (s.style.display = 'none'));
    section.style.display = 'block';
  }

  let currentUtteranceButton = null;
  let speechGeneration = 0;
  const PARAGRAPH_PAUSE_MS = 450;

  // ブラウザ内蔵の機械的な声ではなく、できるだけ自然な日本語音声を選んで使う
  let cachedVoices = [];
  function refreshVoiceCache() {
    cachedVoices = window.speechSynthesis.getVoices();
  }
  if ('speechSynthesis' in window) {
    refreshVoiceCache();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoiceCache);
  }

  function getBestJapaneseVoice() {
    const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
    const jaVoices = voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('ja'));
    if (jaVoices.length === 0) return null;

    const preferredKeywords = ['google', 'siri', 'enhanced', 'premium', 'neural', 'natural', 'wavenet'];
    const scored = jaVoices.map((voice) => {
      const name = voice.name.toLowerCase();
      let score = 0;
      if (preferredKeywords.some((k) => name.includes(k))) score += 2;
      if (name.includes('compact')) score -= 2; // 機械的になりがちな簡易音声は後回し
      if (!voice.localService) score += 1; // ネットワーク経由の音声は高品質なことが多い
      return { voice, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].voice;
  }

  // 絵文字や強調記号（**太字**、箇条書きの記号など）をそのまま読み上げると
  // 「にっこり笑う顔」「アスタリスク」のように読まれて不自然なため、読み上げ用の
  // テキストからだけ取り除く（画面上の表示はそのまま記号ありで残す）
  function cleanTextForSpeech(text) {
    return text
      .replace(/\p{Extended_Pictographic}(‍\p{Extended_Pictographic})*/gu, '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
      .replace(/️/g, '')
      // 見出し記号（# ## など）
      .replace(/^#{1,6}\s*/gm, '')
      // 太字・斜体・打ち消し線（中身のテキストは残す）
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])/gu, '$1')
      // コードの引用記号
      .replace(/`+/g, '')
      // 罫線・区切り線（同じ記号の連続）
      .replace(/^[━─―=~*_-]{3,}$/gm, '')
      // 箇条書きの先頭記号
      .replace(/^[ \t]*[-・*●○▪◆]\s*/gm, '')
      // 上記で対にならず残ってしまった記号を最後に一掃する
      .replace(/[*#`~]/g, '')
      .replace(/[ \t]{2,}/g, ' ');
  }

  // 空行（段落の区切り）で分けて、間に少し間を置きながら読み上げる
  function buildSpeechSegments(text) {
    return text
      .split(/\n\s*\n/)
      .map((part) => cleanTextForSpeech(part).replace(/\s*\n\s*/g, ' ').trim())
      .filter((part) => part.length > 0);
  }

  function speak(text, button) {
    if (!('speechSynthesis' in window)) return;

    const resetButton = (btn) => {
      if (btn) btn.textContent = '🔊';
    };

    const wasActive = currentUtteranceButton !== null;
    const sameButton = currentUtteranceButton === button;
    if (wasActive) {
      speechGeneration++; // 進行中のキューを打ち切る
      window.speechSynthesis.cancel();
      resetButton(currentUtteranceButton);
      currentUtteranceButton = null;
      if (sameButton) return; // 同じボタンをもう一度押した場合は停止のみ
    }

    const segments = buildSpeechSegments(text);
    if (segments.length === 0) return;

    const myGeneration = ++speechGeneration;
    currentUtteranceButton = button;
    if (button) button.textContent = '⏸';

    const speakSegment = (index) => {
      if (myGeneration !== speechGeneration) return; // 別の読み上げに切り替わった

      if (index >= segments.length) {
        resetButton(button);
        if (currentUtteranceButton === button) currentUtteranceButton = null;
        return;
      }

      const utterance = new SpeechSynthesisUtterance(segments[index]);
      utterance.lang = 'ja-JP';
      const bestVoice = getBestJapaneseVoice();
      if (bestVoice) {
        try {
          utterance.voice = bestVoice;
        } catch (_) {
          // 音声の指定に失敗しても、ブラウザの既定音声で読み上げを続ける
        }
      }
      utterance.onend = () => {
        if (myGeneration !== speechGeneration) return;
        if (index < segments.length - 1) {
          setTimeout(() => speakSegment(index + 1), PARAGRAPH_PAUSE_MS);
        } else {
          speakSegment(index + 1);
        }
      };
      utterance.onerror = () => {
        if (myGeneration !== speechGeneration) return;
        resetButton(button);
        if (currentUtteranceButton === button) currentUtteranceButton = null;
      };

      window.speechSynthesis.speak(utterance);
    };

    speakSegment(0);
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

  // 返信を待っている間、お薬のキャラクターがこちらへ向かって走るアニメーションを見せる
  // （画像の解析などで待ち時間が長くなることがあるため、待たされている感を和らげる）
  //
  // カプセル本体はCSSの3D変換（perspective + preserve-3d）で立体的に見せている。
  // 正面向きなので、脚はrotateXで前後に振り、手前に出た脚が大きく見えるようにしている。
  const PILL_RUNNER_HTML = `
    <svg class="pill-runner" viewBox="0 0 60 54" aria-hidden="true">
      <defs>
        <clipPath id="pillClip">
          <rect x="18" y="4" width="24" height="38" rx="12" />
        </clipPath>
        <!-- 左右を暗く、中央を明るくして円柱の丸みを出す -->
        <linearGradient id="pillCapGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#A82F2E" />
          <stop offset="0.22" stop-color="#DC4B49" />
          <stop offset="0.46" stop-color="#FF8F8A" />
          <stop offset="0.62" stop-color="#EC5250" />
          <stop offset="1" stop-color="#A82F2E" />
        </linearGradient>
        <linearGradient id="pillBodyGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#BEC3C9" />
          <stop offset="0.22" stop-color="#E8EBEE" />
          <stop offset="0.46" stop-color="#FFFFFF" />
          <stop offset="0.62" stop-color="#EDF0F2" />
          <stop offset="1" stop-color="#BEC3C9" />
        </linearGradient>
        <linearGradient id="pillLimbGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#1B6259" />
          <stop offset="0.5" stop-color="#35B0A0" />
          <stop offset="1" stop-color="#1B6259" />
        </linearGradient>
      </defs>

      <ellipse class="pill-shadow" cx="30" cy="50" rx="12" ry="2.6" />

      <g class="pill-runner-body">
        <!-- 奥に振れた脚・腕（小さく暗く見せることで奥行きを出す） -->
        <rect class="pill-limb pill-leg pill-leg-back" x="23" y="40" width="6" height="12" rx="3" />
        <rect class="pill-limb pill-arm pill-arm-back" x="13" y="20" width="5" height="12" rx="2.5" />

        <g class="pill-capsule">
          <g clip-path="url(#pillClip)">
            <rect x="18" y="4" width="24" height="19" fill="url(#pillCapGrad)" />
            <rect x="18" y="23" width="24" height="19" fill="url(#pillBodyGrad)" />
            <rect x="18" y="22" width="24" height="1.6" fill="rgba(0,0,0,0.22)" />
            <rect class="pill-gloss" x="22" y="8" width="3.2" height="11" rx="1.6" />
          </g>
          <g class="pill-face">
            <circle cx="26" cy="14" r="1.9" />
            <circle cx="34" cy="14" r="1.9" />
            <path d="M26.5 18.6q3.5 3 7 0" />
          </g>
        </g>

        <!-- 手前に振れた脚・腕 -->
        <rect class="pill-limb pill-arm pill-arm-front" x="42" y="20" width="5" height="12" rx="2.5" />
        <rect class="pill-limb pill-leg pill-leg-front" x="31" y="40" width="6" height="12" rx="3" />
      </g>
    </svg>`;

  function addTypingBubble() {
    const div = document.createElement('div');
    div.className = 'bubble assistant typing-bubble';
    div.innerHTML = `${PILL_RUNNER_HTML}<span class="typing-label">お調べしています…</span>`;
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

  // 名刺のQRコードから来た場合、URLの ?code= を認証コード欄に入れておく（入力の手間を省く）
  (function prefillCode() {
    try {
      const code = new URLSearchParams(location.search).get('code');
      if (code) {
        const el = document.getElementById('passcode-input');
        if (el) el.value = code;
      }
    } catch (_) {}
  })();

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

  // 写真を選んでも添付できたか分からない、という声があったため、
  // 入力欄のすぐ上にサムネイル付きで大きく表示し、取り消しもできるようにする
  const attachPreview = document.getElementById('attach-preview');
  const attachThumb = document.getElementById('attach-thumb');
  const attachName = document.getElementById('attach-name');
  const attachRemove = document.getElementById('attach-remove');
  const fileBtn = document.getElementById('file-btn');
  const imageInput = document.getElementById('image-input');

  let attachedThumbUrl = null;

  function clearAttachment() {
    imageInput.value = '';
    attachPreview.hidden = true;
    fileBtn.classList.remove('has-file');
    if (attachedThumbUrl) {
      URL.revokeObjectURL(attachedThumbUrl); // 画像の一時URLを解放する
      attachedThumbUrl = null;
    }
    attachThumb.removeAttribute('src');
  }

  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (!file) {
      clearAttachment();
      return;
    }

    if (attachedThumbUrl) URL.revokeObjectURL(attachedThumbUrl);
    attachedThumbUrl = URL.createObjectURL(file);

    attachThumb.src = attachedThumbUrl;
    attachName.textContent = file.name;
    attachPreview.hidden = false;
    fileBtn.classList.add('has-file');
  });

  attachRemove.addEventListener('click', clearAttachment);

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

  // Android(Chrome)は実際に音声認識して自動でテキストを入力できるが、
  // iPhoneはブラウザの種類を問わずWebKit制約でこれが使えないため、
  // 代わりにキーボード標準のマイク機能を使ってもらう案内を表示する
  const micButton = document.getElementById('mic-button');
  const voiceHint = document.getElementById('voice-hint');
  const isAndroid = /Android/i.test(navigator.userAgent);
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (isAndroid && SpeechRecognitionCtor && micButton) {
    micButton.style.display = '';
    let recognition = null;
    let isListening = false;

    micButton.addEventListener('click', () => {
      if (isListening) {
        recognition.stop();
        return;
      }

      recognition = new SpeechRecognitionCtor();
      recognition.lang = 'ja-JP';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        isListening = true;
        micButton.classList.add('recording');
      };
      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const input = document.getElementById('message-input');
        input.value = input.value ? input.value + transcript : transcript;
        input.focus();
      };
      recognition.onerror = () => {
        // 認識に失敗しても手入力に切り替えられるよう、特にエラー表示はしない
      };
      recognition.onend = () => {
        isListening = false;
        micButton.classList.remove('recording');
      };

      recognition.start();
    });
  } else if (voiceHint) {
    voiceHint.style.display = 'block';
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
    clearAttachment();

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
