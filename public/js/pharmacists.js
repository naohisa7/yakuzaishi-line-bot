(function () {
  const loginSection = document.getElementById('login-section');
  const deniedSection = document.getElementById('denied-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const loginError = document.getElementById('login-error');
  const addError = document.getElementById('add-error');
  const listEl = document.getElementById('pharmacist-list');

  function showSection(section) {
    [loginSection, deniedSection, dashboardSection].forEach((s) => (s.style.display = 'none'));
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

  // 名簿を読み込む。管理者でなければ403が返るので、その場合は「管理者専用」を表示する。
  async function enterDashboard() {
    const res = await fetch('/api/admin/pharmacists');
    if (res.status === 403) {
      showSection(deniedSection);
      return;
    }
    showSection(dashboardSection);
    await loadList();
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
    await enterDashboard();
  });

  document.getElementById('add-button').addEventListener('click', async () => {
    const input = document.getElementById('new-name-input');
    const name = input.value.trim();
    addError.style.display = 'none';
    if (!name) {
      addError.textContent = 'お名前を入力してください。';
      addError.style.display = 'block';
      return;
    }
    const res = await fetch('/api/admin/pharmacists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!data.ok) {
      addError.textContent = data.message || '追加できませんでした。';
      addError.style.display = 'block';
      return;
    }
    input.value = '';
    await loadList();
  });

  async function loadList() {
    listEl.textContent = '読み込み中...';
    const res = await fetch('/api/admin/pharmacists');
    const data = await res.json();
    const list = (data && data.pharmacists) || [];
    listEl.innerHTML = '';
    if (list.length === 0) {
      listEl.textContent = 'まだ薬剤師が登録されていません。';
      return;
    }
    for (const p of list) {
      listEl.appendChild(renderCard(p));
    }
  }

  function statusBadge(label, on) {
    const span = document.createElement('span');
    span.className = 'pill ' + (on ? 'pill-on' : 'pill-off');
    span.textContent = (on ? '✓ ' : '– ') + label;
    return span;
  }

  function field(labelText, input) {
    const wrap = document.createElement('div');
    wrap.className = 'pharma-field';
    const label = document.createElement('label');
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(input);
    return wrap;
  }

  // 未連携の薬剤師向け：本人がタップ/読み取るだけで連携できるリンク＋QR
  function buildLinkingBox(p) {
    const box = document.createElement('div');
    box.className = 'linking-box';

    const title = document.createElement('p');
    title.className = 'linking-title';
    title.textContent = '📲 通知を受け取るためのLINE連携（未完了）';
    box.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'この薬剤師さんご本人のスマホで下のリンクを開く（またはQRコードを読み取る）と、公式LINEが連携メッセージ入力済みの状態で開きます。そのまま送信すれば連携完了です。';
    box.appendChild(hint);

    if (p.lineLinkUrl) {
      const actions = document.createElement('div');
      actions.className = 'linking-actions';

      const open = document.createElement('a');
      open.className = 'btn btn-secondary';
      open.href = p.lineLinkUrl;
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = '📱 連携用リンクを開く';
      actions.appendChild(open);

      const copy = document.createElement('button');
      copy.className = 'btn btn-secondary';
      copy.textContent = 'リンクをコピー';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(p.lineLinkUrl);
          copy.textContent = 'コピーしました';
          setTimeout(() => (copy.textContent = 'リンクをコピー'), 1500);
        } catch {
          copy.textContent = 'コピーできませんでした';
        }
      });
      actions.appendChild(copy);
      box.appendChild(actions);

      if (p.lineLinkQr) {
        const qr = document.createElement('div');
        qr.className = 'linking-qr';
        qr.innerHTML = p.lineLinkQr; // サーバー生成のSVG（信頼できる）
        box.appendChild(qr);
      }
    } else {
      // フォールバック：手入力の案内
      const manual = document.createElement('p');
      manual.className = 'hint';
      manual.textContent = 'ご本人のLINEから「薬剤師LINE連携:' + p.id + '」と送ってもらってください。';
      box.appendChild(manual);
    }

    return box;
  }

  // 名刺のモーダル：レイアウトを切り替えると画面のプレビューも切り替わる。
  // スマホで印刷できない場合は、この画面をスクリーンショットして配れる。
  function openCardModal(cardData) {
    const old = document.getElementById('card-modal');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'card-modal';
    overlay.className = 'card-modal';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    const inner = document.createElement('div');
    inner.className = 'card-modal-inner';

    const title = document.createElement('h3');
    title.className = 'card-modal-title';
    title.textContent = '患者さんに渡す名刺';
    inner.appendChild(title);

    // レイアウト切替（プレビューも切り替わる）
    const seg = document.createElement('div');
    seg.className = 'card-seg';

    const preview = document.createElement('div');
    preview.className = 'card-modal-preview';

    const buildSheet = () => {
      const s = document.createElement('div');
      s.className = 'namecard-sheet';
      for (let i = 0; i < 10; i++) s.appendChild(window.buildNameCard(cardData));
      return s;
    };
    const layouts = [
      { key: 'card', label: '名刺サイズ', width: 340, build: () => window.buildNameCard(cardData), print: () => window.printNameCard(cardData, 1) },
      { key: 'sheet', label: 'A4に10枚', width: 686, build: buildSheet, print: () => window.printNameCard(cardData, 10) },
      { key: 'flyer', label: 'A4チラシ', width: 718, build: () => window.buildNameFlyer(cardData), print: () => window.printNameFlyer(cardData) },
    ];
    let current = layouts[0];

    function showLayout(l) {
      current = l;
      Array.from(seg.children).forEach((b, i) => b.classList.toggle('active', layouts[i].key === l.key));
      preview.innerHTML = '';
      const node = l.build();
      preview.appendChild(node);
      // プレビュー幅に合わせて全体を縮小表示（スマホでも全体が見える）
      const avail = preview.clientWidth || 300;
      node.style.zoom = Math.min(1, avail / l.width);
    }

    layouts.forEach((l) => {
      const b = document.createElement('button');
      b.className = 'card-seg-btn';
      b.textContent = l.label;
      b.addEventListener('click', () => showLayout(l));
      seg.appendChild(b);
    });
    inner.appendChild(seg);
    inner.appendChild(preview);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'スマホで印刷できないときは、この画面をスクリーンショットして、写真アプリやコンビニ印刷でお使いいただけます。';
    inner.appendChild(hint);

    const btns = document.createElement('div');
    btns.className = 'card-modal-buttons';
    const printBtn = document.createElement('button');
    printBtn.className = 'btn';
    printBtn.textContent = '🖨 このレイアウトを印刷';
    printBtn.addEventListener('click', () => current.print());
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-secondary';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', () => overlay.remove());
    btns.appendChild(printBtn);
    btns.appendChild(closeBtn);
    inner.appendChild(btns);

    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    showLayout(layouts[0]);
  }

  function renderCard(p) {
    const card = document.createElement('div');
    card.className = 'card pharma-card';

    // 見出し（名前＋管理者バッジ）
    const head = document.createElement('h3');
    head.textContent = '👤 ' + p.name;
    if (p.owner) {
      const owner = document.createElement('span');
      owner.className = 'pill pill-owner';
      owner.textContent = '管理者';
      head.appendChild(document.createTextNode(' '));
      head.appendChild(owner);
    }
    card.appendChild(head);

    // 状態バッジ
    const badges = document.createElement('div');
    badges.className = 'pharma-badges';
    badges.appendChild(statusBadge('認証コード', !!p.patientAuthCode));
    badges.appendChild(statusBadge('パスワード', p.hasPassword));
    badges.appendChild(statusBadge('LINE連携', p.lineLinked));
    card.appendChild(badges);

    // ID（LINE連携で使う）
    const idLine = document.createElement('p');
    idLine.className = 'hint pharma-id';
    idLine.textContent = 'ID：' + p.id;
    card.appendChild(idLine);
    if (!p.lineLinked) {
      card.appendChild(buildLinkingBox(p));
    }

    const err = document.createElement('div');
    err.className = 'error';
    err.style.display = 'none';
    card.appendChild(err);

    // 名前
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = p.name;
    card.appendChild(field('お名前', nameInput));

    // 認証コード（患者さん用）
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.value = p.patientAuthCode || '';
    codeInput.placeholder = '患者さんにお伝えするコード';
    card.appendChild(field('認証コード（患者さん用）', codeInput));

    // ログインパスワード
    const passInput = document.createElement('input');
    passInput.type = 'text';
    passInput.value = '';
    passInput.placeholder = p.hasPassword ? '変更する場合のみ入力' : '新しいパスワード';
    card.appendChild(field('ログインパスワード', passInput));

    // 電話番号（エスカレーション時に患者さんへ表示する連絡先）
    const phoneInput = document.createElement('input');
    phoneInput.type = 'tel';
    phoneInput.value = p.phone || '';
    phoneInput.placeholder = '例：090-1234-5678';
    card.appendChild(field('電話番号（患者さんへの連絡先）', phoneInput));

    // ボタン
    const actions = document.createElement('div');
    actions.className = 'pharma-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = '保存する';
    saveBtn.addEventListener('click', async () => {
      err.style.display = 'none';
      const body = {};
      if (nameInput.value.trim() && nameInput.value.trim() !== p.name) body.name = nameInput.value.trim();
      if (codeInput.value.trim() !== (p.patientAuthCode || '')) body.authCode = codeInput.value.trim();
      if (passInput.value.trim()) body.password = passInput.value.trim();
      if (phoneInput.value.trim() !== (p.phone || '')) body.phone = phoneInput.value.trim();
      if (Object.keys(body).length === 0) {
        err.textContent = '変更点がありません。';
        err.style.display = 'block';
        return;
      }
      saveBtn.disabled = true;
      const res = await fetch('/api/admin/pharmacists/' + encodeURIComponent(p.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      saveBtn.disabled = false;
      if (!data.ok) {
        err.textContent = data.message || data.error || '保存できませんでした。';
        err.style.display = 'block';
        return;
      }
      await loadList();
    });
    actions.appendChild(saveBtn);

    // 名刺（認証コードが設定済みのときのみ）。押すと画面に名刺を表示してから印刷できる
    if (p.card && p.card.patientAuthCode) {
      const cardBtn = document.createElement('button');
      cardBtn.className = 'btn btn-secondary';
      cardBtn.textContent = '🪪 名刺を見る・印刷';
      cardBtn.addEventListener('click', () => openCardModal(p.card));
      actions.appendChild(cardBtn);
    }

    // 削除（管理者は不可）
    if (!p.owner) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-secondary';
      delBtn.textContent = '削除';
      delBtn.addEventListener('click', async () => {
        if (!confirm(p.name + 'さんを名簿から削除します。よろしいですか？')) return;
        err.style.display = 'none';
        delBtn.disabled = true;
        const res = await fetch('/api/admin/pharmacists/' + encodeURIComponent(p.id), { method: 'DELETE' });
        const data = await res.json();
        delBtn.disabled = false;
        if (!data.ok) {
          err.textContent = data.message || data.error || '削除できませんでした。';
          err.style.display = 'block';
          return;
        }
        await loadList();
      });
      actions.appendChild(delBtn);
    }

    card.appendChild(actions);
    return card;
  }

  init();
})();
