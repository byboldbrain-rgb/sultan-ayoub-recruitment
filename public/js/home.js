(() => {
  // ---------- Reveal on scroll ----------
  const revealEls = Array.from(document.querySelectorAll('[data-reveal]'));
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!prefersReduced) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        const delay = Number(el.getAttribute('data-delay') || 0);
        setTimeout(() => el.classList.add('is-visible'), delay);
        io.unobserve(el);
      }
    }, { threshold: 0.18 });

    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-visible'));
  }

  // ---------- Header compact on scroll ----------
  const header = document.getElementById('homeHeader');
  const setHeader = () => {
    if (!header) return;
    header.classList.toggle('is-compact', window.scrollY > 8);
  };
  setHeader();
  window.addEventListener('scroll', setHeader, { passive: true });

  // ---------- Carousel ----------
  const root = document.getElementById('bannerCarousel');
  if (root) {
    const slides = Array.from(root.querySelectorAll('.carousel__slide'));
    const dots = Array.from(root.querySelectorAll('.dot-btn'));
    const prevBtn = root.querySelector('[data-action="prev"]');
    const nextBtn = root.querySelector('[data-action="next"]');

    let idx = 0;
    let timer = null;
    const intervalMs = 5200;

    const activate = (n) => {
      idx = (n + slides.length) % slides.length;
      slides.forEach((s, i) => s.classList.toggle('is-active', i === idx));
      dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
    };

    const next = () => activate(idx + 1);
    const prev = () => activate(idx - 1);

    const start = () => {
      stop();
      timer = setInterval(next, intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };

    // events
    nextBtn && nextBtn.addEventListener('click', () => { next(); start(); });
    prevBtn && prevBtn.addEventListener('click', () => { prev(); start(); });

    dots.forEach((d) => {
      d.addEventListener('click', () => {
        const n = Number(d.getAttribute('data-slide') || 0);
        activate(n);
        start();
      });
    });

    // pause on hover
    root.addEventListener('mouseenter', stop);
    root.addEventListener('mouseleave', start);

    // keyboard
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { next(); start(); }
      if (e.key === 'ArrowLeft')  { prev(); start(); }
    });

    activate(0);
    start();
  }

  // ---------- Subtle parallax for blobs (mouse move) ----------
  const blobs = Array.from(document.querySelectorAll('.bg-blob'));
  if (!prefersReduced && blobs.length) {
    let raf = null;
    window.addEventListener('mousemove', (e) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const x = (e.clientX / window.innerWidth) - 0.5;
        const y = (e.clientY / window.innerHeight) - 0.5;

        blobs.forEach((b, i) => {
          const k = (i + 1) * 6;
          b.style.transform = `translate3d(${x * k}px, ${y * k}px, 0)`;
        });
      });
    }, { passive: true });
  }
})();
