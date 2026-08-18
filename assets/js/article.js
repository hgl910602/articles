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
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Close sidebar on mobile
      document.getElementById('sidebar').classList.remove('open');
    }
  });
});
