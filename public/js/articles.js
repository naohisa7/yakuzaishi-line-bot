(async function () {
  const container = document.getElementById('article-list');
  const res = await fetch('/api/articles');
  const data = await res.json();

  if (data.articles.length === 0) {
    container.innerHTML = '<div class="card">まだ記事がありません。</div>';
    return;
  }

  container.innerHTML = '';
  data.articles.forEach((a) => {
    const date = new Date(a.createdAt).toLocaleDateString('ja-JP');
    const card = document.createElement('a');
    card.className = 'card article-card';
    card.href = '/articles/' + a.id;

    const title = document.createElement('h3');
    title.textContent = a.title;
    const dateEl = document.createElement('p');
    dateEl.className = 'article-date';
    dateEl.textContent = date;

    card.appendChild(title);
    card.appendChild(dateEl);
    container.appendChild(card);
  });
})();
