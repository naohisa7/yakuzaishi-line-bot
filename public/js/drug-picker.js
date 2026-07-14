/**
 * お薬の検索・選択ウィジェット（患者さん用の /medications と 薬剤師用の /console で共用）
 *
 * 3文字以上入力すると候補が出て、選ぶと「登録予定リスト」に積まれる。
 * 選ぶたびに検索欄がクリアされるので、続けて次のお薬を検索・選択できる。
 * 最後に登録ボタンで、選んだお薬をまとめて登録する。
 *
 * 使い方:
 *   const picker = DrugPicker.create({
 *     input, status, results, pendingBox, pendingList, pendingCount, registerButton,
 *     searchUrl: '/api/drugs/search',
 *     onRegister: async (names) => { ... },  // 登録処理（成功時にthrowしない）
 *   });
 */
window.DrugPicker = (function () {
  const MIN_QUERY_LENGTH = 3;
  const SEARCH_DEBOUNCE_MS = 250;

  function create(options) {
    const { input, status, results, pendingBox, pendingList, pendingCount, registerButton, searchUrl, onRegister } =
      options;

    let pending = [];
    let searchTimer = null;
    let latestQuery = '';

    function clearResults() {
      results.innerHTML = '';
      results.hidden = true;
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
        removeBtn.setAttribute('aria-label', name + ' を取り消す');
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
      input.value = '';
      latestQuery = '';
      clearResults();
      status.textContent = '「' + name + '」を追加しました。続けて検索できます。';
      input.focus();
    }

    function renderResults(drugs) {
      clearResults();
      if (drugs.length === 0) {
        status.textContent = '該当するお薬が見つかりませんでした。';
        return;
      }

      status.textContent = '';
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
        results.appendChild(item);
      });
      results.hidden = false;
    }

    async function runSearch(query) {
      try {
        const res = await fetch(searchUrl + '?q=' + encodeURIComponent(query));
        const data = await res.json();
        if (query !== latestQuery) return; // 入力が進んでいたら古い結果は捨てる
        renderResults(data.drugs || []);
      } catch (err) {
        if (query !== latestQuery) return;
        clearResults();
        status.textContent = '検索できませんでした。通信環境をご確認ください。';
      }
    }

    input.addEventListener('input', () => {
      const query = input.value.trim();
      latestQuery = query;
      clearTimeout(searchTimer);

      if (query.length < MIN_QUERY_LENGTH) {
        clearResults();
        status.textContent =
          query.length === 0 ? '' : 'あと' + (MIN_QUERY_LENGTH - query.length) + '文字入力してください。';
        return;
      }

      status.textContent = '検索中...';
      searchTimer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
    });

    // 候補が出ている状態でのEnterによる意図しない送信を防ぐ
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });

    registerButton.addEventListener('click', async () => {
      if (pending.length === 0) return;

      const originalLabel = registerButton.textContent;
      registerButton.disabled = true;
      registerButton.textContent = '登録しています...';

      try {
        await onRegister([...pending]);
        pending = [];
        renderPending();
        status.textContent = 'お薬手帳に登録しました。';
      } catch (err) {
        status.textContent = '登録できませんでした。時間をおいて再度お試しください。';
      } finally {
        registerButton.disabled = false;
        registerButton.textContent = originalLabel;
      }
    });

    renderPending();

    return {
      // 患者を切り替えたときなど、選択状態を捨てたい場合に呼ぶ
      reset() {
        pending = [];
        input.value = '';
        latestQuery = '';
        status.textContent = '';
        clearResults();
        renderPending();
      },
    };
  }

  return { create, MIN_QUERY_LENGTH };
})();
