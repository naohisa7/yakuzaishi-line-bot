(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── PWA用サービスワーカー登録 ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // ── ホーム画面への追加バナー ──
  (function () {
    const banner = document.getElementById('install-banner');
    if (!banner) return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) return;

    const DISMISS_KEY = 'installBannerDismissedAt';
    const DISMISS_DAYS = 14;
    const dismissedAt = localStorage.getItem(DISMISS_KEY);
    if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_DAYS * 86400000) return;

    const installBtn = document.getElementById('install-btn');
    const dismissBtn = document.getElementById('install-dismiss');
    const instructions = document.getElementById('install-instructions');
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    let deferredPrompt = null;

    const dismiss = () => {
      banner.style.display = 'none';
      if (instructions) instructions.style.display = 'none';
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    };

    if (dismissBtn) dismissBtn.addEventListener('click', dismiss);

    if (isIOS) {
      // iOS Safariは自動インストールできないため手順を案内する
      banner.style.display = 'flex';
      if (installBtn) {
        installBtn.textContent = '追加方法を見る';
        installBtn.addEventListener('click', () => {
          if (!instructions) return;
          instructions.style.display = instructions.style.display === 'block' ? 'none' : 'block';
        });
      }
    } else {
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        banner.style.display = 'flex';
      });

      if (installBtn) {
        installBtn.addEventListener('click', async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          await deferredPrompt.userChoice;
          deferredPrompt = null;
          banner.style.display = 'none';
        });
      }

      window.addEventListener('appinstalled', () => {
        banner.style.display = 'none';
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      });
    }
  })();

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
