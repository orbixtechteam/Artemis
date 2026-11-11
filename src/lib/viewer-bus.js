// Small event bus for the viewers that sit above everything: the image lightbox. Any component can open it.

/** items: [{ src, name, path?, caption? }], index: the one shown first. */
export const openLightbox = (items, index = 0) => {
  const list = (items || []).filter((i) => i && i.src);
  if (list.length) window.dispatchEvent(new CustomEvent('artemis:lightbox', { detail: { items: list, index: Math.max(0, Math.min(index, list.length - 1)) } }));
};
export const onLightbox = (fn) => { const h = (e) => fn(e.detail); window.addEventListener('artemis:lightbox', h); return () => window.removeEventListener('artemis:lightbox', h); };
