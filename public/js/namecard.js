// 患者さんに渡す名刺（認証コード入りカード）の共有コンポーネント。
// /mycard（本人）と /pharmacists（owner）の両方で使う。
// data: { name, patientAuthCode, lineFriendUrl, patientSiteUrl, patientCodeUrl, patientCardQr(SVG) }
(function () {
  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  window.buildNameCard = function (data) {
    const code = data.patientAuthCode;

    const card = el('div', 'namecard');

    // ヘッダー
    const head = el('div', 'namecard-head');
    head.appendChild(el('span', 'namecard-logo', '💊'));
    head.appendChild(el('span', 'namecard-service', 'かかりつけ薬剤師 相談窓口'));
    card.appendChild(head);

    // 本体（左：担当名＋コード／右：QR2つ）
    const body = el('div', 'namecard-body');

    const left = el('div', 'namecard-left');
    left.appendChild(el('div', 'namecard-role', 'あなたの担当薬剤師'));
    left.appendChild(el('div', 'namecard-name', data.name));
    const codebox = el('div', 'namecard-codebox');
    codebox.appendChild(el('div', 'namecard-codelabel', '認証コード'));
    codebox.appendChild(el('div', 'namecard-code', code || '未設定'));
    left.appendChild(codebox);
    body.appendChild(left);

    const right = el('div', 'namecard-right');

    // LINE友だち追加QR（全員共通の公式アカウント）
    const lineQr = el('div', 'namecard-qr');
    const lineImg = document.createElement('img');
    lineImg.src = '/images/line-qr.png';
    lineImg.alt = 'LINE友だち追加QR';
    lineQr.appendChild(lineImg);
    lineQr.appendChild(el('div', 'namecard-qr-cap', 'LINEで相談'));
    right.appendChild(lineQr);

    // HP用QR（スキャンで /patient が開き、認証コードが入力済み）
    if (data.patientCardQr) {
      const hpQr = el('div', 'namecard-qr');
      const holder = el('div', 'namecard-qr-svg');
      holder.innerHTML = data.patientCardQr; // サーバー生成のSVG（信頼できる）
      hpQr.appendChild(holder);
      hpQr.appendChild(el('div', 'namecard-qr-cap', 'ホームページで相談'));
      right.appendChild(hpQr);
    }
    body.appendChild(right);
    card.appendChild(body);

    // 使い方
    const steps = el('div', 'namecard-steps');
    steps.appendChild(el('span', null, 'LINE：友だち追加 → 認証コードを送信'));
    steps.appendChild(el('span', null, 'ホームページ：QRを読み取る（コード入力済み）'));
    steps.appendChild(el('span', 'namecard-url', (data.patientSiteUrl || '').replace(/^https?:\/\//, '')));
    card.appendChild(steps);

    return card;
  };

  // A4一枚の案内チラシ（患者さんにそのままお渡しできる大きめの版）
  window.buildNameFlyer = function (data) {
    const f = el('div', 'nameflyer');

    const head = el('div', 'nameflyer-head');
    head.appendChild(el('span', 'nameflyer-logo', '💊'));
    head.appendChild(el('span', 'nameflyer-brand', 'かかりつけ薬剤師 相談窓口'));
    f.appendChild(head);

    const intro = el('div', 'nameflyer-intro');
    intro.appendChild(el('div', 'nameflyer-role', 'あなたの担当薬剤師'));
    intro.appendChild(el('div', 'nameflyer-name', data.name));
    intro.appendChild(el('p', 'nameflyer-lead', 'お薬のこと・体調のこと、LINEやホームページでいつでもご相談いただけます。'));
    f.appendChild(intro);

    const qrs = el('div', 'nameflyer-qrs');
    const lineBox = el('div', 'nameflyer-qrbox');
    const lImg = document.createElement('img');
    lImg.src = '/images/line-qr.png';
    lImg.alt = 'LINE友だち追加QR';
    lineBox.appendChild(lImg);
    lineBox.appendChild(el('div', 'nameflyer-qrcap', 'LINEで相談'));
    qrs.appendChild(lineBox);
    if (data.patientCardQr) {
      const hpBox = el('div', 'nameflyer-qrbox');
      const holder = el('div', 'nameflyer-qrsvg');
      holder.innerHTML = data.patientCardQr;
      hpBox.appendChild(holder);
      hpBox.appendChild(el('div', 'nameflyer-qrcap', 'ホームページで相談'));
      qrs.appendChild(hpBox);
    }
    f.appendChild(qrs);

    const codeBox = el('div', 'nameflyer-codebox');
    codeBox.appendChild(el('div', 'nameflyer-codelabel', 'あなた専用の認証コード'));
    codeBox.appendChild(el('div', 'nameflyer-code', data.patientAuthCode || '未設定'));
    f.appendChild(codeBox);

    const steps = el('div', 'nameflyer-steps');
    const s1 = el('div', 'nameflyer-step');
    s1.appendChild(el('div', 'nameflyer-step-title', '📱 LINEで登録'));
    const ol1 = document.createElement('ol');
    ['QRコードを読み取って友だち追加', '上の認証コードを送信'].forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ol1.appendChild(li);
    });
    s1.appendChild(ol1);
    const s2 = el('div', 'nameflyer-step');
    s2.appendChild(el('div', 'nameflyer-step-title', '💻 ホームページで登録'));
    const ol2 = document.createElement('ol');
    ['QRコードを読み取る（認証コードは入力済み）', 'お名前を入力して同意する'].forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ol2.appendChild(li);
    });
    s2.appendChild(ol2);
    steps.appendChild(s1);
    steps.appendChild(s2);
    f.appendChild(steps);

    const foot = el('div', 'nameflyer-foot');
    foot.appendChild(el('span', null, (data.patientSiteUrl || '').replace(/^https?:\/\//, '')));
    f.appendChild(foot);

    return f;
  };

  // 指定した要素だけを印刷する（ページの他の要素は @media print で隠す）
  function printNode(node) {
    let area = document.getElementById('namecard-print-area');
    if (!area) {
      area = document.createElement('div');
      area.id = 'namecard-print-area';
      document.body.appendChild(area);
    }
    area.innerHTML = '';
    area.appendChild(node);

    document.body.classList.add('printing-card');
    const cleanup = () => {
      document.body.classList.remove('printing-card');
      window.removeEventListener('afterprint', cleanup);
      area.removeEventListener('click', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // 印刷ダイアログが出ない端末では、前面に出た内容をタップすると閉じられる（保険）
    area.addEventListener('click', cleanup);
    window.print();
  }

  // 名刺を印刷する。count を 2以上にするとA4に複数枚を並べる（切り取って使える）
  window.printNameCard = function (data, count) {
    count = count && count > 0 ? Math.min(Math.floor(count), 40) : 1;
    const sheet = document.createElement('div');
    sheet.className = count > 1 ? 'namecard-sheet' : 'namecard-single';
    for (let i = 0; i < count; i++) {
      sheet.appendChild(window.buildNameCard(data));
    }
    printNode(sheet);
  };

  // A4チラシを印刷する
  window.printNameFlyer = function (data) {
    printNode(window.buildNameFlyer(data));
  };

  // 名刺のモーダル：レイアウト（名刺サイズ／A4に10枚／A4チラシ）を切り替えると
  // 画面のプレビューも切り替わる。スマホで印刷できない場合は、この画面を
  // スクリーンショットして配れる。/pharmacists と /mycard の両方で使う。
  window.openCardModal = function (cardData) {
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
  };
})();
