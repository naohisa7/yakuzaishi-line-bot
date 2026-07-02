(async function () {
  const res = await fetch('/api/profile');
  const data = await res.json();
  document.getElementById('profile-text').textContent = data.text;
})();
