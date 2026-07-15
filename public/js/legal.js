(async function () {
  // プライバシーポリシー・利用規約の本文は、同意フローと同じサーバー側の定数を
  // /api/legal から取得して表示する（本文の二重管理を避けるため）
  const target = document.getElementById('legal-text');
  const which = document.body.getAttribute('data-legal'); // 'privacy' または 'terms'

  try {
    const res = await fetch('/api/legal');
    const data = await res.json();
    const text = data[which];

    if (!text) {
      target.textContent = '内容を表示できませんでした。';
      return;
    }

    // 「【見出し】」を大きめに、「■ 小見出し」を強調して読みやすくする
    target.innerHTML = '';
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trimEnd();

      if (/^【.*】$/.test(line.trim())) {
        // 最上部の大見出しはページ見出しと重複するので出さない
        continue;
      }

      const p = document.createElement('p');
      if (line.startsWith('■')) {
        p.className = 'legal-heading';
        p.textContent = line.replace(/^■\s*/, '');
      } else if (line === '') {
        p.className = 'legal-space';
      } else {
        p.className = 'legal-line';
        p.textContent = line;
      }
      target.appendChild(p);
    }
  } catch (err) {
    target.textContent = '内容を読み込めませんでした。通信環境をご確認ください。';
  }
})();
