(async function () {
  const container = document.getElementById('article-list');
  const res = await fetch('/api/articles');
  const data = await res.json();

  if (data.articles.length === 0) {
    container.innerHTML = '<div class="card">まだ記事がありません。</div>';
    return;
  }

  container.innerHTML = '';
  const colors = ['c-teal', 'c-amber', 'c-purple', 'c-rose', 'c-sky'];
  data.articles.forEach((a, i) => {
    const date = new Date(a.createdAt).toLocaleDateString('ja-JP');
    const card = document.createElement('a');
    const direction = i % 2 === 0 ? 'reveal-left' : 'reveal-right';
    card.className = `card article-card tilt-card reveal-on-scroll ${direction}`;
    card.href = '/articles/' + a.id;

    if (i === 0) {
      const ribbon = document.createElement('span');
      ribbon.className = 'ribbon';
      ribbon.textContent = 'NEW';
      card.appendChild(ribbon);
    }

    const icon = document.createElement('div');
    icon.className = 'card-icon-circle sm ' + colors[i % colors.length];
    icon.textContent = '📄';
    card.appendChild(icon);

    const textWrap = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = a.title;
    const dateEl = document.createElement('p');
    dateEl.className = 'article-date';
    dateEl.textContent = date;
    textWrap.appendChild(title);
    textWrap.appendChild(dateEl);
    card.appendChild(textWrap);

    container.appendChild(card);

    if (window.SiteAnim) {
      window.SiteAnim.observeReveal(card);
      window.SiteAnim.attachTilt(card);
    }
  });
})();
