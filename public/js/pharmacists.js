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
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = '通知を受け取るには、この薬剤師さんご本人のLINEから「薬剤師LINE連携:' + p.id + '」と送ってもらってください。';
      card.appendChild(hint);
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
