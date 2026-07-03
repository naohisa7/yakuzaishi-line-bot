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

  async function loadMedications() {
    const res = await fetch('/api/medications');
    const data = await res.json();
    render(data.medications || []);
  }

  function render(medications) {
    if (medications.length === 0) {
      container.innerHTML =
        '<div class="card">まだお薬手帳に記録がありません。LINEやチャットでお薬の名前・写真を送っていただくと、確認できたものから自動的に記録されます。</div>';
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
      const dateEl = document.createElement('p');
      dateEl.className = 'article-date';
      dateEl.textContent = date + '確認';
      info.appendChild(title);
      info.appendChild(dateEl);
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
