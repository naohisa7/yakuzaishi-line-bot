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
  const interventionType = document.getElementById('intervention-type');
  const interventionNote = document.getElementById('intervention-note');
  const interventionAddButton = document.getElementById('intervention-add-button');
  const interventionCancelButton = document.getElementById('intervention-cancel-button');
  const interventionList = document.getElementById('intervention-list');
  const exportMonth = document.getElementById('export-month');
  const exportDownloadButton = document.getElementById('export-download-button');
  const reminderTime = document.getElementById('reminder-time');
  const reminderMessage = document.getElementById('reminder-message');
  const reminderAddButton = document.getElementById('reminder-add-button');
  const reminderList = document.getElementById('reminder-list');
  const medPharmacistList = document.getElementById('console-med-pharmacist-list');
  const medPatientList = document.getElementById('console-med-patient-list');

  const INTERVENTION_LABELS = {
    follow_up: '📞 フォローアップ（電話等）',
    remaining_med: '💊 残薬調整',
    adverse_event: '⚠️ 有害事象防止（処方変更）',
    visit: '🏠 訪問',
    other: '📝 その他',
  };

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
      exportMonth.value = new Date().toISOString().slice(0, 7);
    } else {
      showSection(loginSection);
    }
  }

  exportDownloadButton.addEventListener('click', () => {
    if (!exportMonth.value) return;
    window.location.href = '/api/admin/interventions/export?month=' + encodeURIComponent(exportMonth.value);
  });

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
      body: JSON.stringify({ pharmacistId: window.getSelectedPharmacistId ? window.getSelectedPharmacistId() : '', password }),
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
    exportMonth.value = new Date().toISOString().slice(0, 7);
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

      if (patient.followUpDue) {
        const followUpBadge = document.createElement('span');
        followUpBadge.className = 'reminder-badge reminder-follow-up';
        followUpBadge.textContent = '🔔フォロー';
        item.appendChild(followUpBadge);
      }
      if (patient.visitDue) {
        const visitBadge = document.createElement('span');
        visitBadge.className = 'reminder-badge reminder-visit';
        visitBadge.textContent = '🏠訪問検討';
        item.appendChild(visitBadge);
      }

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

    resetInterventionForm();
    drugPicker.reset(); // 前の患者さん向けに選びかけていたお薬を持ち越さない
    setScanStatus('');
    await refreshThread();
    await refreshInterventions();
    await refreshReminder();
    await refreshMedicationLink();
    await refreshMedications();
    startPolling();
  }

  function renderReminderList(reminders) {
    reminderList.innerHTML = '';
    if (reminders.length === 0) {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--muted); font-size:13px; margin:0;';
      p.textContent = '未設定です。';
      reminderList.appendChild(p);
    } else {
      reminders.forEach((r) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:6px 0; border-bottom:1px solid #EEE; font-size:14px;';

        const label = document.createElement('span');
        label.style.flex = '1';
        label.textContent = `毎日 ${r.time}${r.message ? ' ・ ' + r.message : ''}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'resolution-btn resolution-no';
        removeBtn.textContent = '削除';
        removeBtn.addEventListener('click', async () => {
          removeBtn.disabled = true;
          try {
            const res = await fetch(
              '/api/admin/patients/' + encodeURIComponent(selectedId) + '/reminder/' + encodeURIComponent(r.id),
              { method: 'DELETE' }
            );
            const data = await res.json();
            if (data.ok) {
              await refreshReminder();
            } else {
              window.alert(data.error || '削除できませんでした。');
            }
          } catch (err) {
            window.alert('通信エラーが発生しました。');
          } finally {
            removeBtn.disabled = false;
          }
        });

        row.appendChild(label);
        row.appendChild(removeBtn);
        reminderList.appendChild(row);
      });
    }
  }

  async function refreshReminder() {
    if (!selectedId) return;
    const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/reminder');
    const data = await res.json();
    renderReminderList(data.reminders || []);
  }

  // ────────────────────────────────
  // お薬手帳（薬剤師の手帳／患者さんの手帳を分けて表示）
  // ────────────────────────────────
  const MED_SOURCE_LABELS = {
    manual: '✍️ ご自身で登録',
    photo: '📷 写真で確認済み',
    legacy: '⚠️ 要確認（規格不明）',
  };

  const drugPicker = DrugPicker.create({
    input: document.getElementById('console-drug-search'),
    status: document.getElementById('console-drug-status'),
    results: document.getElementById('console-drug-results'),
    pendingBox: document.getElementById('console-drug-pending'),
    pendingList: document.getElementById('console-drug-pending-list'),
    pendingCount: document.getElementById('console-drug-pending-count'),
    registerButton: document.getElementById('console-drug-register'),
    searchUrl: '/api/admin/drugs/search',
    onRegister: async (names) => {
      if (!selectedId) throw new Error('患者さんが選択されていません');
      const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/medications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) throw new Error('登録に失敗しました');
      await refreshMedications();
    },
  });

  // ────────────────────────────────
  // お薬手帳の連携（LINEの患者さんとホームページの患者さんを同一人物として紐づける）
  // ────────────────────────────────
  const linkBox = document.getElementById('med-link-box');
  const linkLinked = document.getElementById('med-link-linked');
  const linkUnlinked = document.getElementById('med-link-unlinked');
  const linkName = document.getElementById('med-link-name');
  const linkSelect = document.getElementById('med-link-select');
  const linkButton = document.getElementById('med-link-button');
  const linkUnlinkButton = document.getElementById('med-link-unlink');
  const linkStatus = document.getElementById('med-link-status');
  const linkLineNote = document.getElementById('med-link-line-note');

  // 連携欄の読み込みに失敗しても、チャット・対応記録・お薬手帳の表示までは巻き添えで
  // 止めない（連携はあくまで付加機能なので、ここで例外を投げて全体を壊さないこと）
  async function refreshMedicationLink() {
    if (!selectedId) return;

    linkStatus.textContent = '';

    try {
      const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/medication-link');
      if (!res.ok) throw new Error('連携状況を取得できませんでした');
      const data = await res.json();

      // LINEの患者さんを開いているときは、紐づけ操作はホームページ側から行う（案内のみ出す）
      if (data.type === 'line') {
        linkBox.hidden = true;
        linkLineNote.hidden = !data.linked;
        if (data.linked) {
          linkLineNote.textContent = `🔗 ${data.linkedName}（ホームページ）と同期中です。お薬手帳は1冊にまとまっています。`;
        }
        return;
      }

      linkLineNote.hidden = true;
      linkBox.hidden = false;
      linkLinked.hidden = !data.linked;
      linkUnlinked.hidden = data.linked;

      if (data.linked) {
        linkName.textContent = data.linkedName;
        return;
      }

      const candidates = data.lineCandidates || [];
      linkSelect.innerHTML = '';

      if (candidates.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'LINEの患者さんがいません';
        option.value = '';
        linkSelect.appendChild(option);
        linkButton.disabled = true;
        return;
      }

      linkButton.disabled = false;
      candidates.forEach((candidate) => {
        const option = document.createElement('option');
        option.value = candidate.id;
        option.textContent = candidate.name;
        linkSelect.appendChild(option);
      });
    } catch (err) {
      linkBox.hidden = true;
      linkLineNote.hidden = true;
    }
  }

  linkButton.addEventListener('click', async () => {
    const lineUserId = linkSelect.value;
    if (!selectedId || !lineUserId) return;

    if (!confirm(`「${selectedName}」さんと「${linkSelect.selectedOptions[0].textContent}」さん（LINE）を同一人物として紐づけます。お薬手帳が1冊にまとまります。よろしいですか？`)) {
      return;
    }

    linkButton.disabled = true;
    linkStatus.textContent = '紐づけています...';

    try {
      const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/medication-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUserId }),
      });
      const data = await res.json();

      if (!res.ok) {
        linkStatus.textContent = data.error || '紐づけできませんでした。';
        return;
      }

      await refreshMedicationLink();
      await refreshMedications(); // 統合後のお薬手帳を読み直す
    } catch (err) {
      linkStatus.textContent = '紐づけできませんでした。';
    } finally {
      linkButton.disabled = false;
    }
  });

  linkUnlinkButton.addEventListener('click', async () => {
    if (!selectedId) return;
    if (!confirm('連携を解除しますか？\nお薬手帳の内容は両方に残ります（以後は同期しません）。')) return;

    linkUnlinkButton.disabled = true;
    try {
      await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/medication-link', {
        method: 'DELETE',
      });
      await refreshMedicationLink();
      await refreshMedications();
    } finally {
      linkUnlinkButton.disabled = false;
    }
  });

  // 処方箋・お薬手帳の写真から薬品名を読み取る
  // 読み取り結果は登録せず「登録するお薬」に積むだけ。薬剤師が確認してから登録する
  const scanInput = document.getElementById('console-scan-input');
  const scanLabel = document.getElementById('console-scan-label');
  const scanStatus = document.getElementById('console-scan-status');

  function setScanStatus(text, kind) {
    scanStatus.textContent = text;
    scanStatus.className = 'drug-scan-status' + (kind ? ' drug-scan-' + kind : '');
  }

  scanInput.addEventListener('change', async () => {
    const file = scanInput.files[0];
    if (!file) return;

    if (!selectedId) {
      setScanStatus('患者さんを選んでから読み取ってください。', 'error');
      scanInput.value = '';
      return;
    }

    scanLabel.classList.add('is-loading');
    setScanStatus('画像を読み取っています…（10秒ほどかかります）');

    try {
      const body = new FormData();
      body.append('image', file);

      const res = await fetch(
        '/api/admin/patients/' + encodeURIComponent(selectedId) + '/medications/scan',
        { method: 'POST', body }
      );
      const data = await res.json();

      if (!res.ok) {
        setScanStatus(data.error || '画像を読み取れませんでした。', 'error');
        return;
      }

      const drugs = data.drugs || [];
      if (drugs.length === 0) {
        setScanStatus(
          data.note || '薬品名を読み取れませんでした。明るい場所で、文字にピントを合わせて撮り直してください。',
          'error'
        );
        return;
      }

      const added = drugPicker.addNames(drugs.map((d) => d.name));
      const unmatched = drugs.filter((d) => !d.matched).map((d) => d.name);

      const messages = [`${added}件を「登録するお薬」に追加しました。内容をご確認のうえ登録してください。`];
      if (unmatched.length > 0) {
        // マスタに無い名前は誤読の可能性があるため、薬剤師に気づいてもらう
        messages.push(`⚠️ 医薬品マスタに該当がありません（誤読の可能性）：${unmatched.join('、')}`);
      }
      if (data.note) messages.push(`📝 ${data.note}`);

      setScanStatus(messages.join('\n'), unmatched.length > 0 ? 'warn' : 'ok');
    } catch (err) {
      setScanStatus('画像を読み取れませんでした。通信環境をご確認ください。', 'error');
    } finally {
      scanLabel.classList.remove('is-loading');
      scanInput.value = ''; // 同じ画像を選び直せるようにする
    }
  });

  function buildMedicationRow(med, { deletable }) {
    const row = document.createElement('div');
    row.className = 'console-med-row';

    const info = document.createElement('div');
    info.className = 'console-med-info';

    const name = document.createElement('span');
    name.className = 'console-med-name';
    name.textContent = med.name;
    info.appendChild(name);

    const meta = document.createElement('span');
    meta.className = 'console-med-meta';
    const date = new Date(med.recordedAt).toLocaleDateString('ja-JP');
    // 薬剤師の手帳は見出しで分かるので、出所ラベルは患者さんの手帳側にだけ出す
    meta.textContent = deletable
      ? date + '登録'
      : `${date}登録・${MED_SOURCE_LABELS[med.source] || MED_SOURCE_LABELS.legacy}`;
    info.appendChild(meta);

    row.appendChild(info);

    if (deletable) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'resolution-btn resolution-no';
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`「${med.name}」を削除しますか？`)) return;
        deleteBtn.disabled = true;
        await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/medications/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: med.name }),
        });
        await refreshMedications();
      });
      row.appendChild(deleteBtn);
    }

    return row;
  }

  function renderMedicationBook(target, medications, { deletable, emptyText }) {
    target.innerHTML = '';

    if (medications.length === 0) {
      const p = document.createElement('p');
      p.className = 'console-med-empty';
      p.textContent = emptyText;
      target.appendChild(p);
      return;
    }

    medications.forEach((med) => target.appendChild(buildMedicationRow(med, { deletable })));
  }

  async function refreshMedications() {
    if (!selectedId) return;
    const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/medications');
    const data = await res.json();
    const medications = data.medications || [];

    renderMedicationBook(
      medPharmacistList,
      medications.filter((m) => m.source === 'pharmacist'),
      { deletable: true, emptyText: 'まだ登録がありません。上の検索から登録できます。' }
    );

    renderMedicationBook(
      medPatientList,
      medications.filter((m) => m.source !== 'pharmacist'),
      { deletable: false, emptyText: '患者さんご自身の登録はまだありません。' }
    );
  }

  reminderAddButton.addEventListener('click', async () => {
    if (!selectedId || !reminderTime.value) return;

    reminderAddButton.disabled = true;
    try {
      const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time: reminderTime.value, message: reminderMessage.value.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        reminderTime.value = '';
        reminderMessage.value = '';
        await refreshReminder();
      } else {
        window.alert(data.error || '設定できませんでした。');
      }
    } catch (err) {
      window.alert('通信エラーが発生しました。');
    } finally {
      reminderAddButton.disabled = false;
    }
  });

  async function refreshThread() {
    if (!selectedId) return;
    const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/messages');
    const data = await res.json();
    renderThread(data.messages || []);
  }

  let editingInterventionId = null;

  function buildInterventionRow(record) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #EEE; font-size:14px;';

    const date = new Date(record.recordedAt).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
    const textWrap = document.createElement('div');
    textWrap.style.flex = '1';

    const label = document.createElement('div');
    label.style.fontWeight = 'bold';
    label.textContent = INTERVENTION_LABELS[record.type] || record.type;

    const meta = document.createElement('div');
    meta.style.cssText = 'color:var(--muted); font-size:12px;';
    meta.textContent = date + (record.note ? ' ・ ' + record.note : '');

    textWrap.appendChild(label);
    textWrap.appendChild(meta);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'resolution-btn resolution-yes';
    editBtn.textContent = '編集';
    editBtn.addEventListener('click', () => startEditIntervention(record));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'resolution-btn resolution-no';
    deleteBtn.textContent = '削除';
    deleteBtn.addEventListener('click', () => deleteIntervention(record.id));

    row.appendChild(textWrap);
    row.appendChild(editBtn);
    row.appendChild(deleteBtn);
    return row;
  }

  function renderInterventions(records) {
    if (records.length === 0) {
      interventionList.innerHTML = '<p style="color:var(--muted); font-size:13px;">まだ記録がありません。</p>';
      return;
    }

    // 記録は新しい順に並んでいるので、月ごとにまとめても先頭（最新月）が自然に一番上になる
    const groups = new Map();
    records.forEach((record) => {
      const monthKey = record.recordedAt.slice(0, 7); // "YYYY-MM"
      if (!groups.has(monthKey)) groups.set(monthKey, []);
      groups.get(monthKey).push(record);
    });

    interventionList.innerHTML = '';
    let isFirstGroup = true;
    groups.forEach((groupRecords, monthKey) => {
      const [year, month] = monthKey.split('-');
      const monthLabel = `${year}年${parseInt(month, 10)}月（${groupRecords.length}件）`;

      const section = document.createElement('div');
      section.className = 'intervention-month-group';

      const header = document.createElement('button');
      header.type = 'button';
      header.className = 'intervention-month-header';

      const body = document.createElement('div');
      body.className = 'intervention-month-body';
      const expanded = isFirstGroup; // 最新月だけ最初から開いておく
      body.style.display = expanded ? 'block' : 'none';
      header.textContent = monthLabel + (expanded ? ' ▾' : ' ▸');

      header.addEventListener('click', () => {
        const isOpen = body.style.display !== 'none';
        body.style.display = isOpen ? 'none' : 'block';
        header.textContent = monthLabel + (isOpen ? ' ▸' : ' ▾');
      });

      groupRecords.forEach((record) => body.appendChild(buildInterventionRow(record)));

      section.appendChild(header);
      section.appendChild(body);
      interventionList.appendChild(section);
      isFirstGroup = false;
    });
  }

  function startEditIntervention(record) {
    editingInterventionId = record.id;
    interventionType.value = record.type;
    interventionNote.value = record.note || '';
    interventionAddButton.textContent = '更新する';
    interventionCancelButton.style.display = 'inline-block';
  }

  function resetInterventionForm() {
    editingInterventionId = null;
    interventionType.value = 'follow_up';
    interventionNote.value = '';
    interventionAddButton.textContent = '記録する';
    interventionCancelButton.style.display = 'none';
  }

  interventionCancelButton.addEventListener('click', resetInterventionForm);

  async function deleteIntervention(id) {
    if (!selectedId) return;
    if (!window.confirm('この対応記録を削除しますか？この操作は取り消せません。')) return;

    try {
      const res = await fetch(
        '/api/admin/patients/' + encodeURIComponent(selectedId) + '/interventions/' + encodeURIComponent(id),
        { method: 'DELETE' }
      );
      const data = await res.json();
      if (data.ok) {
        if (editingInterventionId === id) resetInterventionForm();
        await refreshInterventions();
      } else {
        window.alert(data.error || '削除できませんでした。');
      }
    } catch (err) {
      window.alert('通信エラーが発生しました。');
    }
  }

  async function refreshInterventions() {
    if (!selectedId) return;
    const res = await fetch('/api/admin/patients/' + encodeURIComponent(selectedId) + '/interventions');
    const data = await res.json();
    renderInterventions(data.records || []);
  }

  interventionAddButton.addEventListener('click', async () => {
    if (!selectedId) return;

    interventionAddButton.disabled = true;
    try {
      const isEditing = !!editingInterventionId;
      const url = isEditing
        ? '/api/admin/patients/' + encodeURIComponent(selectedId) + '/interventions/' + encodeURIComponent(editingInterventionId)
        : '/api/admin/patients/' + encodeURIComponent(selectedId) + '/interventions';

      const res = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: interventionType.value, note: interventionNote.value.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        resetInterventionForm();
        await refreshInterventions();
      } else {
        window.alert(data.error || '記録できませんでした。');
      }
    } catch (err) {
      window.alert('通信エラーが発生しました。');
    } finally {
      interventionAddButton.disabled = false;
    }
  });

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
