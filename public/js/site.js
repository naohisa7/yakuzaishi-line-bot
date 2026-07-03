(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── スクロールで要素をふわっと表示 ──
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  const observeReveal = (el) => {
    if (reduceMotion) {
      el.classList.add('in-view');
      return;
    }
    revealObserver.observe(el);
  };

  document.querySelectorAll('.reveal-on-scroll').forEach(observeReveal);

  // ── カードのマウス追従3Dチルト ──
  const attachTilt = (card) => {
    if (reduceMotion) return;
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      const rotateY = px * 12;
      const rotateX = -py * 12;
      card.style.transform = `translateY(-4px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  };

  document.querySelectorAll('.tilt-card').forEach(attachTilt);

  window.SiteAnim = { observeReveal, attachTilt };

  // ── スクロールに応じたパララックス ──
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (parallaxEls.length && !reduceMotion) {
    let ticking = false;
    const applyParallax = () => {
      const y = window.scrollY;
      parallaxEls.forEach((el) => {
        const speed = parseFloat(el.dataset.parallax) || 0.2;
        el.style.transform = `translateY(${y * speed}px)`;
      });
      ticking = false;
    };
    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          requestAnimationFrame(applyParallax);
          ticking = true;
        }
      },
      { passive: true }
    );
  }

  // ── ナビゲーションのスクロール連動ガラス演出 ──
  const nav = document.querySelector('.top-nav');
  if (nav) {
    const updateNav = () => {
      nav.classList.toggle('scrolled', window.scrollY > 20);
    };
    updateNav();
    window.addEventListener('scroll', updateNav, { passive: true });
  }

  // ── ヒーロー全体のマウス追従パララックス ──
  const heroContent = document.querySelector('.hero-content');
  if (heroContent && !reduceMotion) {
    const hero = document.querySelector('.hero');
    hero.addEventListener('mousemove', (e) => {
      const rect = hero.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      heroContent.style.transform = `translate(${px * 16}px, ${py * 16}px)`;
    });
    hero.addEventListener('mouseleave', () => {
      heroContent.style.transform = '';
    });
  }
})();
