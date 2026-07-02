(async function () {
  const id = location.pathname.split('/').filter(Boolean).pop();
  const res = await fetch('/api/articles/' + encodeURIComponent(id));

  if (!res.ok) {
    document.getElementById('article-title').textContent = '記事が見つかりません';
    return;
  }

  const data = await res.json();
  document.getElementById('article-title').textContent = data.title;
  document.getElementById('article-date').textContent = new Date(data.createdAt).toLocaleDateString('ja-JP');
  document.getElementById('article-body').textContent = data.body;
})();
