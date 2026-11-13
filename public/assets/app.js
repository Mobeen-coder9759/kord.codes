/* =========================================================
   Kord - Core Interactive Logic & Scroll Routing
   ========================================================= */

// Contact submissions go only to the same-origin Cloudflare Pages Function: /api/contact

document.addEventListener('DOMContentLoaded', () => {

  const wrapper = document.querySelector('.horizontal-wrapper');
  const links = document.querySelectorAll('.nav-link');
  const underline = document.querySelector('.nav-underline');
  const navLinksContainer = document.querySelector('.nav-links');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // --- 1. "Progress Bar" Navbar Underline ---
  function updateUnderline(activeLink) {
    if (!activeLink || links.length === 0) return;
    
    const containerRect = navLinksContainer.getBoundingClientRect();
    const firstLinkRect = links[0].getBoundingClientRect();
    const activeLinkRect = activeLink.getBoundingClientRect();

    // On phones, highlight just the active tab and keep it visible in the
    // horizontally scrollable glass navbar. Desktop progress bar is unchanged.
    if (window.matchMedia('(max-width: 767px)').matches) {
      underline.style.width = `${activeLinkRect.width}px`;
      underline.style.transform = `translateX(${activeLinkRect.left - firstLinkRect.left + links[0].offsetLeft}px)`;
      const scroller = navLinksContainer.parentElement;
      const target = activeLink.offsetLeft + activeLink.offsetWidth / 2 - scroller.clientWidth / 2;
      scroller.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
      return;
    }
    const newWidth = activeLinkRect.right - firstLinkRect.left;
    const startPos = firstLinkRect.left - containerRect.left;

    underline.style.width = `${newWidth}px`;
    underline.style.transform = `translateX(${startPos}px)`;
  }

  // --- 2. Track Current Panel ---
  let currentPanel = document.querySelector('#hero');

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        currentPanel = entry.target; 
        
        const id = entry.target.getAttribute('id');
        const activeLink = document.querySelector(`.nav-link[href="#${id}"]`);
        
        links.forEach(l => l.classList.remove('active'));
        if (activeLink) {
          activeLink.classList.add('active');
          updateUnderline(activeLink);
        }
      }
    });
  }, {
    root: wrapper,
    threshold: 0.5
  });

  const panels = document.querySelectorAll('.panel');
  panels.forEach(panel => observer.observe(panel));

  // --- 3. Testimonials (Proof) Setup ---
  const proof = document.getElementById('proof');
  let currentProofSlide = 0;
  let totalProofSlides = 0;
  let proofShowSlide = null;
  let lastProofWheelTime = 0;
  var arrivalDir = 1;

  if (proof) {
    const slides = proof.querySelectorAll('.flow-slide');
    const tabs = proof.querySelectorAll('.flow-tab');
    totalProofSlides = slides.length;

    proofShowSlide = function(index, replay = false) {
      currentProofSlide = (index + slides.length) % slides.length;
      if (replay) {
        slides.forEach(s => s.classList.remove('is-active'));
        tabs.forEach(t => t.classList.remove('is-active'));
        void proof.offsetWidth;
      }
      slides.forEach((s, n) => s.classList.toggle('is-active', n === currentProofSlide));
      tabs.forEach((t, n) => {
        t.classList.toggle('is-active', n === currentProofSlide);
        t.setAttribute('aria-selected', String(n === currentProofSlide));
      });
    };

    tabs.forEach((tab, n) => {
      tab.addEventListener('click', () => proofShowSlide(n, true));
      tab.querySelector('.tab-progress').addEventListener('animationend', () => {
        if (tab.classList.contains('is-active') && currentProofSlide < slides.length - 1) proofShowSlide(currentProofSlide + 1);
      });
    });

    function countUp() {
      proof.querySelectorAll('[data-count]').forEach(el => {
        const target = Number(el.dataset.count);
        const suffix = el.dataset.suffix || '';
        if (reduceMotion) { el.textContent = target + suffix; return; }
        const start = performance.now();
        const duration = 1200;
        (function tick(now) {
          const p = Math.min((now - start) / duration, 1);
          el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        })(start);
      });
    }

    new IntersectionObserver(([entry]) => {
      proof.classList.toggle('in-view', entry.isIntersecting);
      if (entry.isIntersecting) {
        // coming from the left -> start at testimonial 1, coming back from the right -> start at 4
        proofShowSlide(arrivalDir < 0 ? totalProofSlides - 1 : 0, true);
        arrivalDir = 1;
        countUp();
      }
    }, { root: wrapper, threshold: 0.6 }).observe(proof);
  }

  // --- 4. Smart Wheel Router: ONE page / ONE testimonial per scroll gesture ---
  const panelList = Array.from(document.querySelectorAll('.panel'));
  let pageIndex = 0;
  let navUntil = 0;        // ignore input while a page/slide animation is running
  let needFresh = false;   // after any move, require a brand-new gesture before the next one
  let lastWheelTs = 0;
  let lastAbs = 0;
  let acc = 0;
  // arrivalDir: 1 = arrived moving forward, -1 = arrived moving back (declared above)
  const STEP_THRESHOLD = 40;

  function syncPageIndex() {
    const i = Math.round(wrapper.scrollLeft / wrapper.clientWidth);
    pageIndex = Math.max(0, Math.min(panelList.length - 1, i));
  }
  let scrollIdleTimer;
  wrapper.addEventListener('scroll', () => {
    clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(syncPageIndex, 120);
  });

  // Nav / button anchor clicks: let native smooth-scroll run, then re-sync
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', () => {
      arrivalDir = 1;
      navUntil = performance.now() + 800;
      needFresh = true;
    });
  });

  function goToPage(index, dir) {
    index = Math.max(0, Math.min(panelList.length - 1, index));
    if (index === pageIndex) return;
    arrivalDir = dir;
    pageIndex = index;
    navUntil = performance.now() + 750;
    needFresh = true;
    wrapper.scrollTo({ left: index * wrapper.clientWidth, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  // --- Phone: up/down finger swipes also advance the HORIZONTAL panels. ---
  // Left/right finger swipes remain native. Long sections keep normal internal
  // vertical scrolling, and move to adjacent panels only at their boundaries.
  const phoneLayout = window.matchMedia('(max-width: 767px)');
  let fingerGesture = null;
  const VERTICAL_SWIPE_MIN = 55;

  function canScrollVerticallyFrom(target, direction) {
    let node = target instanceof Element ? target : target.parentElement;
    const panel = panelList[pageIndex];
    while (node && node !== wrapper && node !== panel) {
      const style = window.getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight + 3) {
        const atTop = node.scrollTop <= 2;
        const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 3;
        if ((direction > 0 && !atBottom) || (direction < 0 && !atTop)) return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  wrapper.addEventListener('touchstart', (event) => {
    if (!phoneLayout.matches || event.touches.length !== 1) {
      fingerGesture = null;
      return;
    }
    const touch = event.touches[0];
    fingerGesture = { x: touch.clientX, y: touch.clientY, mode: null };
  }, { passive: true });

  wrapper.addEventListener('touchmove', (event) => {
    if (!phoneLayout.matches || !fingerGesture || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const dx = touch.clientX - fingerGesture.x;
    const dy = touch.clientY - fingerGesture.y;
    if (!fingerGesture.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 9) return;
      if (Math.abs(dx) >= Math.abs(dy) * 0.95) {
        fingerGesture.mode = 'horizontal'; // browser handles the existing side swipe
      } else {
        // Finger up means scroll forward, finger down means scroll backward.
        const dir = dy < 0 ? 1 : -1;
        syncPageIndex();
        fingerGesture.mode = canScrollVerticallyFrom(event.target, dir) ? 'inner-scroll' : 'panel';
      }
    }
    if (fingerGesture.mode === 'panel') {
      // Avoid browser rubber-banding while interpreting the vertical gesture.
      event.preventDefault();
    }
  }, { passive: false });

  wrapper.addEventListener('touchend', (event) => {
    if (!phoneLayout.matches || !fingerGesture) return;
    const gesture = fingerGesture;
    fingerGesture = null;
    if (gesture.mode !== 'panel' || !event.changedTouches.length) return;
    const end = event.changedTouches[0];
    const dx = end.clientX - gesture.x;
    const dy = end.clientY - gesture.y;
    if (Math.abs(dy) < VERTICAL_SWIPE_MIN || Math.abs(dy) <= Math.abs(dx) * 1.2) return;
    if (performance.now() < navUntil) return;

    syncPageIndex();
    const dir = dy < 0 ? 1 : -1;
    const panel = panelList[pageIndex];
    // Match the desktop wheel experience: progress through testimonials first.
    if (panel && panel.id === 'proof' && proofShowSlide) {
      if (dir > 0 && currentProofSlide < totalProofSlides - 1) {
        proofShowSlide(currentProofSlide + 1, true);
        navUntil = performance.now() + 350;
        return;
      }
      if (dir < 0 && currentProofSlide > 0) {
        proofShowSlide(currentProofSlide - 1, true);
        navUntil = performance.now() + 350;
        return;
      }
    }
    goToPage(pageIndex + dir, dir);
  }, { passive: true });

  wrapper.addEventListener('touchcancel', () => { fingerGesture = null; }, { passive: true });

  wrapper.addEventListener('wheel', (evt) => {
    evt.preventDefault();

    const now = performance.now();
    let delta = Math.abs(evt.deltaX) > Math.abs(evt.deltaY) ? evt.deltaX : evt.deltaY;
    if (evt.deltaMode === 1) delta *= 33;
    else if (evt.deltaMode === 2) delta *= window.innerHeight;
    const abs = Math.abs(delta);
    if (abs < 1) return;

    // Is this the start of a new scroll gesture (vs. trackpad inertia / same flick)?
    const gap = now - lastWheelTs;
    const fresh = gap > 110 || abs > lastAbs * 1.6 + 8;
    lastWheelTs = now;
    lastAbs = abs;
    if (fresh) { acc = 0; needFresh = false; }

    if (now < navUntil) return;   // a page change is animating, ignore everything

    const panel = panelList[pageIndex];

    // 4a. Vertical pages (Services, FAQ): scroll inside first
    const vc = panel && panel.querySelector('.vertical-scroll-container');
    if (vc) {
      const atTop = vc.scrollTop <= 0;
      const atBottom = Math.ceil(vc.scrollTop + vc.clientHeight) >= vc.scrollHeight - 10;
      if ((delta > 0 && !atBottom) || (delta < 0 && !atTop)) {
        vc.scrollBy({ top: delta, behavior: 'auto' });
        needFresh = true;   // reaching the edge needs a NEW gesture to leave the page
        return;
      }
    }

    // Everything below moves a slide/page, so it needs a deliberate, fresh gesture
    acc += delta;
    if (Math.abs(acc) < STEP_THRESHOLD) return;
    const dir = acc > 0 ? 1 : -1;
    acc = 0;
    if (needFresh) return;

    // 4b. Testimonials: walk through all 4, each replacing the previous, then move on
    if (panel && panel.id === 'proof' && proofShowSlide) {
      if (dir > 0 && currentProofSlide < totalProofSlides - 1) {
        proofShowSlide(currentProofSlide + 1, true);
        needFresh = true;
        navUntil = now + 500;
        return;
      }
      if (dir < 0 && currentProofSlide > 0) {
        proofShowSlide(currentProofSlide - 1, true);
        needFresh = true;
        navUntil = now + 500;
        return;
      }
    }

    // 4c. Move exactly one page
    goToPage(pageIndex + dir, dir);

  }, { passive: false });


  window.addEventListener('load', () => {
    const initialActive = document.querySelector('.nav-link.active') || links[0];
    updateUnderline(initialActive);
  });

  window.addEventListener('resize', () => {
    const activeLink = document.querySelector('.nav-link.active');
    updateUnderline(activeLink);
  });

  // --- 5. FAQ: "Ask the Agent" chat ---
  const chips = document.querySelectorAll('.faq-chip');
  const chatBody = document.getElementById('chat-body');
  if (chips.length && chatBody) {
    let chatRun = 0;

    function addMessage(kind, text) {
      const el = document.createElement('div');
      el.className = `msg msg-${kind}`;
      el.textContent = text;
      chatBody.appendChild(el);
      return el;
    }

    function addTyping() {
      const el = document.createElement('div');
      el.className = 'msg msg-ai typing';
      el.innerHTML = '<span></span><span></span><span></span>';
      chatBody.appendChild(el);
      return el;
    }

    function typeInto(el, text, run) {
      if (reduceMotion) { el.textContent = text; return; }
      const words = text.split(' ');
      let i = 0;
      (function step() {
        if (run !== chatRun) return;
        el.textContent = words.slice(0, ++i).join(' ');
        if (i < words.length) setTimeout(step, 28);
      })();
    }

    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const run = ++chatRun;
        chips.forEach(c => c.classList.toggle('is-active', c === chip));
        chatBody.innerHTML = '';
        addMessage('user', chip.querySelector('.chip-text').textContent);
        const typing = addTyping();
        setTimeout(() => {
          if (run !== chatRun) return;
          typing.remove();
          typeInto(addMessage('ai', ''), chip.dataset.answer, run);
        }, reduceMotion ? 0 : 900);
      });
    });
  }

  // --- 6. Contact: protected Heroku API → n8n, with real delivery confirmation ---
  const form = document.getElementById('contact-form');
  const log = document.getElementById('exec-log');
  if (form && log) {
    const steps = log.querySelectorAll('.exec-step');
    const result = document.getElementById('exec-result');
    const resultTitle = document.getElementById('exec-result-title');
    const resultText = document.getElementById('exec-result-text');
    const logTitle = log.querySelector('.exec-title');
    const submitButton = form.querySelector('[type="submit"]');
    const feedback = document.getElementById('lw-form-status');
    const turnstileBox = document.getElementById('lw-turnstile');
    let widgetId = null;
    let formReady = false;
    let localTestMode = false;
    let useTurnstile = false;

    function showFeedback(message) {
      feedback.textContent = message || '';
      feedback.hidden = !message;
    }
    function resetLog() {
      steps.forEach(s => { s.className = 'exec-step'; });
      result.hidden = true;
      logTitle.textContent = 'Executing workflow…';
    }
    function refreshChallenge() {
      if (useTurnstile && widgetId !== null && window.turnstile) {
        window.turnstile.reset(widgetId);
      }
    }
    function enableForm() {
      formReady = true;
      submitButton.disabled = false;
      if (!localTestMode) showFeedback('');
    }
    function loadTurnstile(sitekey) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.onload = () => {
          try {
            turnstileBox.hidden = false;
            widgetId = window.turnstile.render(turnstileBox, {
              sitekey,
              appearance: 'interaction-only', // <-- To hide the cloudfare shit
              action: 'kord_contact', // Updated to match backend security settings
              size: window.innerWidth < 440 ? 'compact' : 'normal',
              'expired-callback': () => showFeedback('Verification expired. Please try again.'),
              'error-callback': () => showFeedback('Verification could not load. Please retry.')
            });
            useTurnstile = true;
            resolve();
          } catch (error) { reject(error); }
        };
        script.onerror = () => reject(new Error('Turnstile unavailable'));
        document.head.appendChild(script);
      });
    }
    (async () => {
      try {
        const response = await fetch('/api/config', { cache: 'no-store' });
        if (!response.ok) throw new Error('Configuration unavailable');
        const config = await response.json();
        if (!config.formEnabled) {
          showFeedback('Contact form is not connected yet. Please check again soon.');
          return;
        }
        localTestMode = config.localTestMode === true;
        if (localTestMode) {
          showFeedback('LOCAL TEST MODE: submissions will not be delivered.');
          enableForm();
        } else if (typeof config.turnstileSiteKey === 'string' && config.turnstileSiteKey) {
          await loadTurnstile(config.turnstileSiteKey);
          enableForm();
        } else {
          showFeedback('Security verification is not configured yet.');
        }
      } catch (error) {
        showFeedback('Contact form is temporarily unavailable.');
      }
    })();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!formReady) return;
      const fd = new FormData(form);
      const token = useTurnstile && widgetId !== null && window.turnstile
        ? window.turnstile.getResponse(widgetId) : '';
      if (useTurnstile && !token) {
        showFeedback('Complete the security verification before submitting.');
        return;
      }
      const payload = {
        name: fd.get('name'),
        email: fd.get('email'),
        phone: fd.get('phone'),
        city: fd.get('city'),
        message: fd.get('message'),
        topics: fd.getAll('topics'),
        source: 'kord-website',
        submittedAt: new Date().toISOString(),
        turnstileToken: token
      };
      showFeedback('');
      form.hidden = true;
      log.hidden = false;
      resetLog();
      let ok = false;
      let responseData = null;
      let errorMessage = 'Could not submit your request. Please try again.';
      const request = (async () => {
        try {
          const response = await fetch('/api/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          responseData = await response.json().catch(() => ({}));
          if (!response.ok || responseData.success !== true) {
            errorMessage = responseData.message || errorMessage;
            return;
          }
          ok = true;
        } catch (error) {
          errorMessage = 'Network error. Check your connection and try again.';
        }
      })();

      const pause = reduceMotion ? 0 : 500;
      for (let i = 0; i < steps.length; i++) {
        steps[i].classList.add('is-running');
        await wait(pause);
        if (i === 2) await request;
        steps[i].classList.remove('is-running');
        if (i === 2 && !ok) { steps[i].classList.add('is-failed'); break; }
        steps[i].classList.add('is-done');
      }
      if (ok && responseData.testMode === true) {
        logTitle.textContent = 'Local test complete';
        resultTitle.textContent = 'Test only. Nothing was sent.';
        resultText.textContent = 'The form and backend worked locally. Connect your n8n webhook to deliver real leads.';
      } else if (ok) {
        logTitle.textContent = 'Workflow executed';
        resultTitle.textContent = 'Request received.';
        resultText.textContent = `Thanks, ${payload.name}. We'll reach out within 24 hours.`;
      } else {
        logTitle.textContent = 'Workflow failed';
        resultTitle.textContent = 'Submission unsuccessful.';
        resultText.textContent = errorMessage;
      }
      result.hidden = false;
      const again = document.getElementById('exec-again');
      again.textContent = ok ? 'Send another' : 'Try again';
      again.dataset.ok = String(ok);
    });

    document.getElementById('exec-again').addEventListener('click', (e) => {
      if (e.currentTarget.dataset.ok === 'true') form.reset();
      refreshChallenge();
      log.hidden = true;
      form.hidden = false;
      if (localTestMode) showFeedback('LOCAL TEST MODE: submissions will not be delivered.');
    });
  }

});

function toggleDropdown(element) {
  const parentModule = element.closest('.service-module');
  parentModule.classList.toggle('active');
}

// --- 8. Tech Stack 2D Physics Engine ---
function initPhysicsEngine() {
  const arena = document.getElementById('physics-arena');
  if (!arena) return;

  const circleElements = Array.from(arena.querySelectorAll('.tech-circle'));
  const radius = circleElements.length ? circleElements[0].offsetWidth / 2 : 60; 
  const speed = window.matchMedia('(max-width: 767px)').matches ? 1.6 : 3; 
  let nodes = [];
  let width = arena.clientWidth;
  let height = arena.clientHeight;

  window.addEventListener('resize', () => {
    width = arena.clientWidth;
    height = arena.clientHeight;
  });

  circleElements.forEach(element => {
    let x, y;
    let overlapping = true;
    let attempts = 0;

    while (overlapping && attempts < 100) {
      x = radius + Math.random() * (width - 2 * radius);
      y = radius + Math.random() * (height - 2 * radius);
      overlapping = false;

      for (let node of nodes) {
        const dx = x - node.x;
        const dy = y - node.y;
        if (Math.sqrt(dx * dx + dy * dy) < radius * 2) {
          overlapping = true;
          break;
        }
      }
      attempts++;
    }

    const angle = Math.random() * 2 * Math.PI;
    nodes.push({ element, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius });
  });

  function updatePhysics() {
    nodes.forEach(node => {
      node.x += node.vx;
      node.y += node.vy;

      if (node.x - node.radius <= 0) { node.x = node.radius; node.vx *= -1; } 
      else if (node.x + node.radius >= width) { node.x = width - node.radius; node.vx *= -1; }

      if (node.y - node.radius <= 0) { node.y = node.radius; node.vy *= -1; } 
      else if (node.y + node.radius >= height) { node.y = height - node.radius; node.vy *= -1; }
    });

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        let n1 = nodes[i], n2 = nodes[j];
        let dx = n2.x - n1.x, dy = n2.y - n1.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        let minDist = n1.radius + n2.radius;

        if (dist < minDist) {
          let nx = dx / dist, ny = dy / dist;
          let overlap = minDist - dist;
          
          n1.x -= nx * (overlap / 2); n1.y -= ny * (overlap / 2);
          n2.x += nx * (overlap / 2); n2.y += ny * (overlap / 2);

          let velAlongNormal = (n2.vx - n1.vx) * nx + (n2.vy - n1.vy) * ny;
          if (velAlongNormal > 0) continue;

          let impulse = -velAlongNormal; 
          n1.vx -= nx * impulse; n1.vy -= ny * impulse;
          n2.vx += nx * impulse; n2.vy += ny * impulse;
        }
      }
    }

    nodes.forEach(node => {
      node.element.style.transform = `translate(${node.x - node.radius}px, ${node.y - node.radius}px)`;
    });

    requestAnimationFrame(updatePhysics);
  }

  requestAnimationFrame(updatePhysics);
}

initPhysicsEngine();

// Event handlers are externalized so a strict script-src CSP can block inline JavaScript.
document.querySelectorAll('.service-module').forEach(el => {
  el.addEventListener('click', () => toggleDropdown(el));
});
