// 薬剤師ログインの共通処理：ログイン画面の「お名前」プルダウンを名簿から埋める。
// 名簿が空だったり取得に失敗した場合は、従来どおりパスワードのみのログイン（フォールバック）になる。
(function () {
  async function populate() {
    const select = document.getElementById('pharmacist-select');
    if (!select) return;
    try {
      const res = await fetch('/api/pharmacists');
      const data = await res.json();
      const list = (data && data.pharmacists) || [];
      if (list.length === 0) {
        // 名簿がまだ無い（移行前）ときは、名前欄を隠してパスワードのみで運用
        const wrap = document.getElementById('pharmacist-select-wrap');
        if (wrap) wrap.style.display = 'none';
        return;
      }
      for (const p of list) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      }
    } catch {
      const wrap = document.getElementById('pharmacist-select-wrap');
      if (wrap) wrap.style.display = 'none';
    }
  }

  // ログイン時に選択中の薬剤師IDを返す（未選択なら空文字＝共通パスワードのフォールバック）
  window.getSelectedPharmacistId = function () {
    const select = document.getElementById('pharmacist-select');
    return select ? select.value : '';
  };

  document.addEventListener('DOMContentLoaded', populate);
})();
