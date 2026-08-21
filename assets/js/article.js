// TOC toggle
document.getElementById('toc-toggle').addEventListener('click', function() {
  document.getElementById('sidebar').classList.toggle('open');
});

// Active section highlighting in sidebar
const headings = document.querySelectorAll('h2, h3, h4');
const navLinks = document.querySelectorAll('#sidebar nav a');
const headingMap = {};
headings.forEach(h => {
  if (h.id) headingMap[h.id] = h;
});

function updateActiveLink() {
  let current = '';
  for (const id in headingMap) {
    const rect = headingMap[id].getBoundingClientRect();
    if (rect.top <= 100) {
      current = id;
    }
  }
  navLinks.forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('href') === '#' + current) {
      link.classList.add('active');
    }
  });
}

window.addEventListener('scroll', updateActiveLink);
updateActiveLink();

// Smooth scroll for TOC links
document.querySelectorAll('#sidebar nav a').forEach(link => {
  link.addEventListener('click', function(e) {
    const href = this.getAttribute('href');
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      history.pushState(null, '', href);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Close sidebar on mobile
      document.getElementById('sidebar').classList.remove('open');
    }
  });
});

// Lightbox: click any article image to view full size
(function() {
  // Build lightbox DOM once
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', '图片预览');
  const img = document.createElement('img');
  img.alt = '';
  const hint = document.createElement('div');
  hint.className = 'lightbox-hint';
  hint.textContent = '点击任意处或按 ESC 关闭';
  box.appendChild(img);
  box.appendChild(hint);
  document.body.appendChild(box);

  function open(trigger) {
    img.src = trigger.currentSrc || trigger.src;
    img.alt = trigger.alt || '';
    box.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    box.classList.remove('open');
    document.body.style.overflow = '';
  }

  // Covers both .article-figure and .article-figure.table-figure images
  document.querySelectorAll('.article-figure img').forEach(el => {
    el.addEventListener('click', function(e) {
      e.preventDefault();
      open(this);
    });
  });

  // Close on backdrop click (clicking the image itself also closes)
  box.addEventListener('click', close);
  // Close with ESC
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && box.classList.contains('open')) close();
  });
})();
