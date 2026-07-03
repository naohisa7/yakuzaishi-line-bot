(async function () {
  const container = document.getElementById('article-list');
  const res = await fetch('/api/articles');
  const data = await res.json();

  if (data.articles.length === 0) {
    container.innerHTML = '<div class="card">まだ記事がありません。</div>';
    return;
  }

  container.innerHTML = '';
  data.articles.forEach((a, i) => {
    const date = new Date(a.createdAt).toLocaleDateString('ja-JP');
    const card = document.createElement('a');
    const direction = i % 2 === 0 ? 'reveal-left' : 'reveal-right';
    card.className = `card article-card tilt-card reveal-on-scroll ${direction}`;
    card.href = '/articles/' + a.id;

    const title = document.createElement('h3');
    const icon = document.createElement('span');
    icon.className = 'article-icon';
    icon.textContent = '📄';
    const titleText = document.createElement('span');
    titleText.textContent = a.title;
    title.appendChild(icon);
    title.appendChild(titleText);

    const dateEl = document.createElement('p');
    dateEl.className = 'article-date';
    dateEl.textContent = date;

    card.appendChild(title);
    card.appendChild(dateEl);
    container.appendChild(card);

    if (window.SiteAnim) {
      window.SiteAnim.observeReveal(card);
      window.SiteAnim.attachTilt(card);
    }
  });
})();
