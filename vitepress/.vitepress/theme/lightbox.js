/*
 * 正文图片点击放大：全屏遮罩 + 居中大图，点任意处或 Esc 关闭。
 * 以普通模块在客户端入口直接执行；顶层带 SSR 守卫，import 阶段即在浏览器绑事件。
 */
let overlay = null;
let styleEl = null;

const STYLE = `
.img-lightbox {
  position: fixed; inset: 0; z-index: 999;
  display: flex; align-items: center; justify-content: center;
  padding: 32px;
  background: rgba(15, 18, 25, 0.78);
  cursor: zoom-out;
}
.img-lightbox img {
  max-width: 100%; max-height: 100%;
  border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.45);
}
`;

function ensureOverlay() {
  if (overlay) return overlay;
  styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);
  overlay = document.createElement('div');
  overlay.className = 'img-lightbox';
  overlay.hidden = true;
  overlay.addEventListener('click', closeLightbox);
  document.body.appendChild(overlay);
  return overlay;
}

function openLightbox(src, alt) {
  const box = ensureOverlay();
  box.innerHTML = '';
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  box.appendChild(img);
  box.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  if (!overlay) return;
  overlay.hidden = true;
  overlay.innerHTML = '';
  document.body.style.overflow = '';
}

function onDocClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLImageElement)) return;
  // 只放大正文内容图：必须在 .vp-doc 里，且渲染宽度达到内容图量级
  //（各文章图片标记不统一：img-figure / article-figure / 裸 img，故不做外层 class 限定，
  //  用渲染宽度排除 logo 和小图标）
  if (!target.closest('.vp-doc')) return;
  if (target.clientWidth < 120) return;
  event.preventDefault();
  openLightbox(target.currentSrc || target.src, target.alt);
}

function onKeydown(event) {
  if (event.key === 'Escape') closeLightbox();
}

// SSR 阶段没有 document，跳过绑定；客户端 hydration 前后均会执行本模块。
// 捕获阶段监听：document 上最早拿到点击，不受任何祖先 stopPropagation 影响
if (typeof document !== 'undefined') {
  ensureOverlay();
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onKeydown, true);
}
