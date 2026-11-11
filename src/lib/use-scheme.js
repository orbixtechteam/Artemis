import { useEffect, useState } from 'react';

/** 'dark' or 'light': what the window actually shows (Light, Dark, System, or a custom theme), read from the painted
 *  background so embedded editors (whiteboard, code) match it. Follows theme switches and the OS setting. */
export function currentScheme() {
  if (typeof document === 'undefined') return 'light';
  const s = document.documentElement.dataset.scheme;
  if (s === 'dark' || s === 'light') return s;
  const bg = getComputedStyle(document.body).backgroundColor || '';
  const m = bg.match(/\d+(\.\d+)?/g);
  if (m && m.length >= 3) {
    const [r, g, b] = m.map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'dark' : 'light';
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useScheme() {
  const [scheme, setScheme] = useState(currentScheme);
  useEffect(() => {
    const update = () => requestAnimationFrame(() => setScheme(currentScheme()));
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-scheme', 'data-vars', 'style', 'class'] });
    const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq) mq.addEventListener('change', update);
    return () => { obs.disconnect(); if (mq) mq.removeEventListener('change', update); };
  }, []);
  return scheme;
}
