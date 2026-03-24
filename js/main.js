/* ═══════════════════════════════════════════════
   CLINTON COUNTY MOTORSPORTS — main.js
   ═══════════════════════════════════════════════ */

'use strict';

/* ─── Navbar scroll behavior ───────────────── */
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

if (window.scrollY > 40) navbar.classList.add('scrolled');

/* ─── Mobile Menu ──────────────────────────── */
const navToggle = document.getElementById('navToggle');
const navMenu   = document.getElementById('navMenu');

function closeMenu() {
  navMenu.classList.remove('open');
  navToggle.classList.remove('active');
  navToggle.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

navToggle.addEventListener('click', () => {
  const isOpen = navMenu.classList.contains('open');
  if (isOpen) {
    closeMenu();
  } else {
    navMenu.classList.add('open');
    navToggle.classList.add('active');
    navToggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
    closeAllDropdowns();
  }
});

navMenu.querySelectorAll('a.nav-link, a[role="menuitem"]').forEach(link => {
  link.addEventListener('click', closeMenu);
});

/* ─── Generic Dropdown Handling ────────────── */
const dropdowns = document.querySelectorAll('.nav-item.dropdown');

function closeAllDropdowns(except = null) {
  dropdowns.forEach(dd => {
    if (dd === except) return;
    dd.classList.remove('open');
    const btn = dd.querySelector('.dropdown-toggle');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
}

dropdowns.forEach(dropdown => {
  const toggle = dropdown.querySelector('.dropdown-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    closeAllDropdowns(dropdown);
    dropdown.classList.toggle('open', !isOpen);
    toggle.setAttribute('aria-expanded', String(!isOpen));
  });

  // Keyboard nav inside dropdown
  const items = dropdown.querySelectorAll('[role="menuitem"]');
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      dropdown.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      if (items[0]) items[0].focus();
    }
  });

  items.forEach((item, i) => {
    item.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items[i + 1]) items[i + 1].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items[i - 1]) items[i - 1].focus(); else toggle.focus(); }
      else if (e.key === 'Escape') { dropdown.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
    });
  });
});

// Close dropdowns on outside click
document.addEventListener('click', () => closeAllDropdowns());

/* ─── Scroll Reveal ──────────────────────────── */
const animatedEls = document.querySelectorAll('[data-animate]');

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el    = entry.target;
      const delay = parseInt(el.dataset.delay || '0', 10);
      setTimeout(() => el.classList.add('in-view'), delay);
      revealObserver.unobserve(el);
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
);

animatedEls.forEach(el => revealObserver.observe(el));

/* ─── Counter Animation ────────────────────── */
const counters = document.querySelectorAll('.stat-num[data-count]');

function animateCounter(el) {
  const target = parseInt(el.dataset.count, 10);
  const suffix = el.dataset.suffix || '';
  const dur    = 1600;
  const start  = performance.now();
  function tick(now) {
    const eased = 1 - Math.pow(1 - Math.min((now - start) / dur, 1), 2);
    el.textContent = Math.round(eased * target) + suffix;
    if (eased < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

const counterObserver = new IntersectionObserver(
  (entries) => entries.forEach(e => { if (e.isIntersecting) { animateCounter(e.target); counterObserver.unobserve(e.target); } }),
  { threshold: 0.5 }
);
counters.forEach(el => counterObserver.observe(el));

/* ─── Smooth scroll for anchor links ──────── */
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', (e) => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      e.preventDefault();
      const navH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) || 76;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - navH, behavior: 'smooth' });
    }
  });
});
