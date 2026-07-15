(function () {
  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const loginError = document.getElementById('login-error');
  const formError = document.getElementById('form-error');
  const articleList = document.getElementById('article-list');
  const formTitle = document.getElementById('form-title');
  const titleInput = document.getElementById('title-input');
  const bodyInput = document.getElementById('body-input');
  const saveButton = document.getElementById('save-button');
  const cancelEditButton = document.getElementById('cancel-edit-button');

  let editingId = null;

  function showSection(section) {
    [loginSection, dashboardSection].forEach((s) => (s.style.display = 'none'));
    section.style.display = 'block';
  }

  async function init() {
    const res = await fetch('/api/admin/session-status');
    const data = await res.json();

    if (data.authenticated) {
      showSection(dashboardSection);
      await loadArticles();
    } else {
      showSection(loginSection);
    }
  }

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
    await loadArticles();
  });

  async function loadArticles() {
    const res = await fetch('/api/admin/articles');
    const data = await res.json();
    renderArticles(data.articles || []);
  }

  function renderArticles(articles) {
    if (articles.length === 0) {
      articleList.innerHTML = '<div class="card">まだ記事がありません。</div>';
      return;
    }

    articleList.innerHTML = '';
    articles.forEach((article) => {
      const date = new Date(article.createdAt).toLocaleDateString('ja-JP');
      const card = document.createElement('div');
      card.className = 'card';

      const title = document.createElement('h3');
      title.textContent = article.title;

      const dateEl = document.createElement('p');
      dateEl.className = 'article-date';
      dateEl.textContent = date;

      const bodyPreview = document.createElement('p');
      bodyPreview.className = 'plain-text';
      bodyPreview.textContent = article.body.length > 80 ? article.body.slice(0, 80) + '…' : article.body;

      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '10px';
      row.style.marginTop = '10px';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'resolution-btn resolution-yes';
      editBtn.textContent = '編集';
      editBtn.addEventListener('click', () => startEdit(article));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'resolution-btn resolution-no';
      deleteBtn.textContent = '削除';
      deleteBtn.addEventListener('click', () => deleteArticleConfirm(article));

      row.appendChild(editBtn);
      row.appendChild(deleteBtn);

      card.appendChild(title);
      card.appendChild(dateEl);
      card.appendChild(bodyPreview);
      card.appendChild(row);
      articleList.appendChild(card);
    });
  }

  function startEdit(article) {
    editingId = article.id;
    formTitle.textContent = '記事を編集';
    titleInput.value = article.title;
    bodyInput.value = article.body;
    cancelEditButton.style.display = 'inline-block';
    formError.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetForm() {
    editingId = null;
    formTitle.textContent = '新しい記事を追加';
    titleInput.value = '';
    bodyInput.value = '';
    cancelEditButton.style.display = 'none';
    formError.style.display = 'none';
  }

  cancelEditButton.addEventListener('click', resetForm);

  saveButton.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    formError.style.display = 'none';

    if (!title || !body) {
      formError.textContent = 'タイトルと本文を入力してください。';
      formError.style.display = 'block';
      return;
    }

    const url = editingId ? '/api/admin/articles/' + editingId : '/api/admin/articles';
    const method = editingId ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    });
    const data = await res.json();

    if (!data.ok) {
      formError.textContent = data.error || '保存できませんでした。';
      formError.style.display = 'block';
      return;
    }

    resetForm();
    await loadArticles();
  });

  async function deleteArticleConfirm(article) {
    if (!window.confirm(`「${article.title}」を削除しますか？この操作は取り消せません。`)) return;
    await fetch('/api/admin/articles/' + article.id, { method: 'DELETE' });
    if (editingId === article.id) resetForm();
    await loadArticles();
  }

  init();
})();
