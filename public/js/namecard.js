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

  // 名刺だけを印刷する（ページの他の要素は @media print で隠す）
  // count を 2以上にすると、A4用紙に複数枚を並べて印刷する（切り取って使える）
  window.printNameCard = function (data, count) {
    count = count && count > 0 ? Math.min(Math.floor(count), 40) : 1;

    let area = document.getElementById('namecard-print-area');
    if (!area) {
      area = document.createElement('div');
      area.id = 'namecard-print-area';
      document.body.appendChild(area);
    }
    area.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = count > 1 ? 'namecard-sheet' : 'namecard-single';
    for (let i = 0; i < count; i++) {
      sheet.appendChild(window.buildNameCard(data));
    }
    area.appendChild(sheet);

    document.body.classList.add('printing-card');
    const cleanup = () => {
      document.body.classList.remove('printing-card');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };
})();
