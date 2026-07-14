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
  const registerSection = document.getElementById('register-section');
  registerSection.style.display = 'block';

  // 検索〜まとめて登録の操作は薬剤師コンソールと共通のウィジェットを使う
  DrugPicker.create({
    input: document.getElementById('drug-search-input'),
    status: document.getElementById('drug-search-status'),
    results: document.getElementById('drug-search-results'),
    pendingBox: document.getElementById('drug-pending'),
    pendingList: document.getElementById('drug-pending-list'),
    pendingCount: document.getElementById('drug-pending-count'),
    registerButton: document.getElementById('drug-register-button'),
    searchUrl: '/api/drugs/search',
    onRegister: async (names) => {
      const res = await fetch('/api/medications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) throw new Error('登録に失敗しました');
      await loadMedications();
    },
  });

  // ────────────────────────────────
  // 登録済みのお薬（薬剤師の手帳／ご自身の手帳に分けて表示）
  // ────────────────────────────────
  const SOURCE_LABELS = {
    manual: { text: '✍️ ご自身で登録', className: 'med-badge-manual' },
    photo: { text: '📷 写真で確認済み', className: 'med-badge-photo' },
    legacy: { text: '⚠️ 要確認', className: 'med-badge-legacy' },
  };

  // ────────────────────────────────
  // LINEとの連携（お薬手帳を1冊にまとめる）
  // ────────────────────────────────
  const linkForm = document.getElementById('line-link-form');
  const linkDone = document.getElementById('line-link-done');
  const linkCode = document.getElementById('line-link-code');
  const linkButton = document.getElementById('line-link-button');
  const linkStatus = document.getElementById('line-link-status');

  function renderLinkState(linked) {
    linkDone.hidden = !linked;
    linkForm.hidden = linked;
  }

  linkButton.addEventListener('click', async () => {
    const code = linkCode.value.trim();
    if (!/^\d{6}$/.test(code)) {
      linkStatus.textContent = '6桁のコードを入力してください。';
      return;
    }

    linkButton.disabled = true;
    linkStatus.textContent = '連携しています...';

    try {
      const res = await fetch('/api/medications/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();

      if (!res.ok) {
        linkStatus.textContent = data.error || '連携できませんでした。';
        return;
      }

      linkCode.value = '';
      linkStatus.textContent = '';
      await loadMedications(); // 統合後のお薬手帳を読み直す
    } catch (err) {
      linkStatus.textContent = '連携できませんでした。通信環境をご確認ください。';
    } finally {
      linkButton.disabled = false;
    }
  });

  async function loadMedications() {
    const res = await fetch('/api/medications');
    const data = await res.json();
    if (data.pharmacistName) {
      pharmacistBanner.textContent = `👤 担当かかりつけ薬剤師：${data.pharmacistName}`;
      pharmacistBanner.style.display = 'block';
    }
    renderLinkState(!!data.linkedWithLine);
    render(data.medications || []);
  }

  function buildCard(med, index, { deletable }) {
    const colors = ['c-teal', 'c-amber', 'c-purple', 'c-rose', 'c-sky'];
    const date = new Date(med.recordedAt).toLocaleDateString('ja-JP');
    const direction = index % 2 === 0 ? 'reveal-left' : 'reveal-right';

    const card = document.createElement('div');
    card.className = `card medication-card tilt-card reveal-on-scroll ${direction}`;

    const main = document.createElement('div');
    main.className = 'medication-card-main';

    const icon = document.createElement('div');
    icon.className = 'card-icon-circle sm ' + colors[index % colors.length];
    icon.textContent = '💊';
    main.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'med-info';

    const title = document.createElement('h3');
    title.textContent = med.name;
    info.appendChild(title);

    // 患者さんの手帳のみ、登録の出所（自分で登録／写真／古い記録）をバッジで示す
    if (!deletable) {
      // 薬剤師の手帳はバッジ不要（見出しで既に分かる）
    } else {
      const sourceKey = SOURCE_LABELS[med.source] ? med.source : 'legacy';
      const source = SOURCE_LABELS[sourceKey];

      const badge = document.createElement('span');
      badge.className = `med-badge ${source.className}`;
      badge.textContent = source.text;
      info.appendChild(badge);
    }

    const dateEl = document.createElement('p');
    dateEl.className = 'article-date';
    dateEl.textContent = date + '登録';
    info.appendChild(dateEl);

    // 旧仕様でチャットのテキストから自動記録されたもの。規格が不明で信頼できない
    if (deletable && !SOURCE_LABELS[med.source]) {
      const note = document.createElement('p');
      note.className = 'med-legacy-note';
      note.textContent = '規格（mg等）が不明な古い記録です。お手数ですが、上の検索から登録し直してください。';
      info.appendChild(note);
    }

    main.appendChild(info);
    card.appendChild(main);

    if (deletable) {
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
    }

    if (window.SiteAnim) {
      window.SiteAnim.observeReveal(card);
      window.SiteAnim.attachTilt(card);
    }
    return card;
  }

  function buildBook({ title, note, medications, deletable, emptyText }) {
    const section = document.createElement('section');
    section.className = 'med-book';

    const heading = document.createElement('h2');
    heading.className = 'med-book-title';
    heading.textContent = title;
    section.appendChild(heading);

    if (note) {
      const noteEl = document.createElement('p');
      noteEl.className = 'med-book-note';
      noteEl.textContent = note;
      section.appendChild(noteEl);
    }

    if (medications.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.textContent = emptyText;
      section.appendChild(empty);
    } else {
      medications.forEach((med, i) => section.appendChild(buildCard(med, i, { deletable })));
    }

    return section;
  }

  function render(medications) {
    const byPharmacist = medications.filter((m) => m.source === 'pharmacist');
    const byPatient = medications.filter((m) => m.source !== 'pharmacist');

    container.innerHTML = '';

    container.appendChild(
      buildBook({
        title: '💊 担当薬剤師が登録したお薬',
        note: 'かかりつけ薬剤師が確認して登録したお薬です。こちらは患者様ご自身では削除できません。',
        medications: byPharmacist,
        deletable: false,
        emptyText: 'まだ担当薬剤師が登録したお薬はありません。',
      })
    );

    container.appendChild(
      buildBook({
        title: '✍️ ご自身で登録したお薬',
        note: null,
        medications: byPatient,
        deletable: true,
        emptyText:
          'まだご自身で登録したお薬はありません。上の「お薬を登録する」から、お飲みになっているお薬を検索して登録してください。',
      })
    );
  }

  await loadMedications();
})();
