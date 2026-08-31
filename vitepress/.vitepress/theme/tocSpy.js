// 滚动跟随高亮：正文滚到哪一节，左栏目录对应链接加 .spy-current（样式见 custom.css）。
// 顶层 SSR 守卫：构建期无 window，直接跳过（曾因裸访问 document 导致 SSR 崩溃退化成纯客户端渲染）。
if (typeof window !== 'undefined') {
  const ACTIVE = 'spy-current';
  let headings = [];
  let links = [];
  let lastPath = null;
  let raf = 0;

  function collect() {
    headings = Array.from(
      document.querySelectorAll('.vp-doc h1[id], .vp-doc h2[id], .vp-doc h3[id], .vp-doc h4[id]')
    );
    links = Array.from(document.querySelectorAll('.VPSidebar .nav a[href]'));
    lastPath = location.pathname;
  }

  function highlight() {
    // 取最后一个滚过视口上部判定线的标题
    const line = 100;
    let current = headings[0] ?? null;
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= line) current = h;
      else break;
    }
    // 滚到底时锁定最后一个标题
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      current = headings[headings.length - 1] ?? current;
    }
    for (const a of links) {
      const hash = (a.getAttribute('href').split('#')[1] ?? '').trim();
      const hit = current && (hash ? hash === current.id : a.getAttribute('href') === location.pathname);
      a.classList.toggle(ACTIVE, Boolean(hit));
    }
  }

  function onScroll() {
    // VitePress 是 SPA，切页不重载：路径变了先重新收集标题与链接
    if (location.pathname !== lastPath) collect();
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      highlight();
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('popstate', () => setTimeout(onScroll, 50));
  window.addEventListener('click', () => setTimeout(onScroll, 80), true);
  window.addEventListener('load', () => {
    collect();
    highlight();
  });
  collect();
  highlight();
}
