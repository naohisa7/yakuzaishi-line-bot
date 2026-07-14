(async function () {
  const container = document.getElementById('medication-list');

  const statusRes = await fetch('/api/session-status');
  const status = await statusRes.json();

  if (!status.authenticated || !status.consented) {
    container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card';
    const p = document.createElement('p');
    p.textContent = 'お薬手帳を見るには、患者様専用ページからログインしてください。';
    const link = document.createElement('a');
    link.className = 'btn';
    link.href = '/patient';
    link.textContent = '患者様専用ページへ';
    card.appendChild(p);
    card.appendChild(link);
    container.appendChild(card);
    return;
  }

  const pharmacistBanner = document.getElementById('pharmacist-name-banner');

  // ────────────────────────────────
  // お薬の登録（検索 → 選択 → まとめて登録）
  // ────────────────────────────────
  const MIN_QUERY_LENGTH = 3;
  const SEARCH_DEBOUNCE_MS = 250;

  const registerSection = document.getElementById('register-section');
  const searchInput = document.getElementById('drug-search-input');
  const searchStatus = document.getElementById('drug-search-status');
  const searchResults = document.getElementById('drug-search-results');
  const pendingBox = document.getElementById('drug-pending');
  const pendingList = document.getElementById('drug-pending-list');
  const pendingCount = document.getElementById('drug-pending-count');
  const registerButton = document.getElementById('drug-register-button');

  registerSection.style.display = 'block';

  // 登録ボタンを押すまでの「登録予定リスト」。ここに積んでからまとめて登録する
  let pending = [];
  let searchTimer = null;
  let latestQuery = '';

  function clearResults() {
    searchResults.innerHTML = '';
    searchResults.hidden = true;
  }

  function renderPending() {
    pendingCount.textContent = pending.length;
    pendingBox.hidden = pending.length === 0;

    pendingList.innerHTML = '';
    pending.forEach((name) => {
      const item = document.createElement('li');

      const label = document.createElement('span');
      label.textContent = name;
      item.appendChild(label);

      // 登録前なら1件ずつ取り消せる
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'drug-pending-remove';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', `${name} を取り消す`);
      removeBtn.addEventListener('click', () => {
        pending = pending.filter((n) => n !== name);
        renderPending();
      });
      item.appendChild(removeBtn);

      pendingList.appendChild(item);
    });
  }

  function addToPending(name) {
    if (!pending.includes(name)) {
      pending.push(name);
      renderPending();
    }
    // 次のお薬をすぐ検索できるよう、選んだら検索欄を空にして候補を閉じる
    searchInput.value = '';
    latestQuery = '';
    clearResults();
    searchStatus.textContent = `「${name}」を追加しました。続けて検索できます。`;
    searchInput.focus();
  }

  function renderResults(drugs) {
    clearResults();
    if (drugs.length === 0) {
      searchStatus.textContent = '該当するお薬が見つかりませんでした。';
      return;
    }

    searchStatus.textContent = '';
    drugs.forEach((drug) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'drug-result-item';

      const name = document.createElement('span');
      name.className = 'drug-result-name';
      name.textContent = drug.name;
      button.appendChild(name);

      if (drug.unit) {
        const unit = document.createElement('span');
        unit.className = 'drug-result-unit';
        unit.textContent = drug.unit;
        button.appendChild(unit);
      }

      button.addEventListener('click', () => addToPending(drug.name));
      item.appendChild(button);
      searchResults.appendChild(item);
    });
    searchResults.hidden = false;
  }

  async function runSearch(query) {
    try {
      const res = await fetch(`/api/drugs/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      // 入力が進んでいたら古い検索結果は捨てる
      if (query !== latestQuery) return;
      renderResults(data.drugs || []);
    } catch (err) {
      if (query !== latestQuery) return;
      clearResults();
      searchStatus.textContent = '検索できませんでした。通信環境をご確認ください。';
    }
  }

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    latestQuery = query;
    clearTimeout(searchTimer);

    if (query.length < MIN_QUERY_LENGTH) {
      clearResults();
      searchStatus.textContent = query.length === 0 ? '' : `あと${MIN_QUERY_LENGTH - query.length}文字入力してください。`;
      return;
    }

    searchStatus.textContent = '検索中...';
    searchTimer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
  });

  // 候補が出ている状態でのEnterによる意図しない送信を防ぐ
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  registerButton.addEventListener('click', async () => {
    if (pending.length === 0) return;

    registerButton.disabled = true;
    registerButton.textContent = '登録しています...';

    try {
      const res = await fetch('/api/medications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: pending }),
      });
      if (!res.ok) throw new Error('登録に失敗しました');

      pending = [];
      renderPending();
      searchStatus.textContent = 'お薬手帳に登録しました。';
      await loadMedications();
    } catch (err) {
      searchStatus.textContent = '登録できませんでした。時間をおいて再度お試しください。';
    } finally {
      registerButton.disabled = false;
      registerButton.textContent = 'この内容で登録する';
    }
  });

  renderPending();

  // ────────────────────────────────
  // 登録済みのお薬一覧
  // ────────────────────────────────
  const SOURCE_LABELS = {
    manual: { text: '✍️ ご自身で登録', className: 'med-badge-manual' },
    photo: { text: '📷 写真で確認済み', className: 'med-badge-photo' },
    legacy: { text: '⚠️ 要確認', className: 'med-badge-legacy' },
  };

  async function loadMedications() {
    const res = await fetch('/api/medications');
    const data = await res.json();
    if (data.pharmacistName) {
      pharmacistBanner.textContent = `👤 担当かかりつけ薬剤師：${data.pharmacistName}`;
      pharmacistBanner.style.display = 'block';
    }
    render(data.medications || []);
  }

  function render(medications) {
    if (medications.length === 0) {
      container.innerHTML =
        '<div class="card">まだお薬手帳に登録がありません。上の「お薬を登録する」から、お飲みになっているお薬を検索して登録してください。お薬やお薬手帳の写真をチャットで送っていただいた場合も、確認できたものは自動的に記録されます。</div>';
      return;
    }

    container.innerHTML = '';
    const colors = ['c-teal', 'c-amber', 'c-purple', 'c-rose', 'c-sky'];

    medications.forEach((med, i) => {
      const date = new Date(med.recordedAt).toLocaleDateString('ja-JP');
      const direction = i % 2 === 0 ? 'reveal-left' : 'reveal-right';
      const card = document.createElement('div');
      card.className = `card medication-card tilt-card reveal-on-scroll ${direction}`;

      const main = document.createElement('div');
      main.className = 'medication-card-main';

      const icon = document.createElement('div');
      icon.className = 'card-icon-circle sm ' + colors[i % colors.length];
      icon.textContent = '💊';
      main.appendChild(icon);

      const info = document.createElement('div');
      info.className = 'med-info';

      const title = document.createElement('h3');
      title.textContent = med.name;
      info.appendChild(title);

      // sourceを持たない古いレコードは legacy 扱いにする（サーバー側でも同様に補完しているが、
      // バッジと注意書きの判定がずれないよう、ここで一度だけ確定させる）
      const sourceKey = SOURCE_LABELS[med.source] ? med.source : 'legacy';
      const source = SOURCE_LABELS[sourceKey];

      const badge = document.createElement('span');
      badge.className = `med-badge ${source.className}`;
      badge.textContent = source.text;
      info.appendChild(badge);

      const dateEl = document.createElement('p');
      dateEl.className = 'article-date';
      dateEl.textContent = date + '登録';
      info.appendChild(dateEl);

      // 旧仕様でチャットのテキストから自動記録されたもの。規格が不明で信頼できない
      if (sourceKey === 'legacy') {
        const note = document.createElement('p');
        note.className = 'med-legacy-note';
        note.textContent = '規格（mg等）が不明な古い記録です。お手数ですが、上の検索から登録し直してください。';
        info.appendChild(note);
      }

      main.appendChild(info);
      card.appendChild(main);

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'resolution-btn resolution-no med-delete';
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', async () => {
        deleteBtn.disabled = true;
        await fetch('/api/medications/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: med.name }),
        });
        await loadMedications();
      });
      card.appendChild(deleteBtn);

      container.appendChild(card);

      if (window.SiteAnim) {
        window.SiteAnim.observeReveal(card);
        window.SiteAnim.attachTilt(card);
      }
    });
  }

  await loadMedications();
})();
