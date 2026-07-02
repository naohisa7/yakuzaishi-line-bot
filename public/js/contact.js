(function () {
  const form = document.getElementById('contact-form');
  const errorBox = document.getElementById('contact-error');
  const successBox = document.getElementById('contact-success');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    const name = document.getElementById('contact-name').value.trim();
    const email = document.getElementById('contact-email').value.trim();
    const message = document.getElementById('contact-message').value.trim();

    if (!name || !email || !message) {
      errorBox.textContent = 'すべての項目を入力してください。';
      errorBox.style.display = 'block';
      return;
    }

    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message }),
    });
    const data = await res.json();

    if (!data.ok) {
      errorBox.textContent = data.message || '送信に失敗しました。しばらくしてから再度お試しください。';
      errorBox.style.display = 'block';
      return;
    }

    form.style.display = 'none';
    successBox.style.display = 'block';
  });
})();
