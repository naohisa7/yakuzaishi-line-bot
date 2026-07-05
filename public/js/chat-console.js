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
    await refreshThread();
    await refreshInterventions();
    await refreshReminder();
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
