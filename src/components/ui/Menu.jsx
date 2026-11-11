import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icons.jsx';

/**
 * A popover menu with submenus, Claude-style (rounded panel, 15 px rows, value hints on the right, › for submenus).
 * anchor: a DOMRect (opens below / above it) or { x, y } (a right-click point). items:
 *   { label, hint?, icon?, onClick?, items? (submenu), checked?, disabled?, danger?, keep? (stays open) }
 *   { sep: true }
 *   { swatches: [colors], value, onPick(color), clearLabel? }   a colour grid
 */
export default function Menu({ anchor, items, onClose, placement = 'below', align = 'start', width = 250 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => { setPos(place(ref.current, anchor, placement, align)); }, [anchor, placement, align]);
  useEffect(() => {
    const out = (e) => { if (ref.current && !ref.current.contains(e.target) && !(e.target.closest && e.target.closest('.menu'))) onClose(); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('mousedown', out, true); window.addEventListener('keydown', key, true); window.addEventListener('blur', onClose);
    return () => { window.removeEventListener('mousedown', out, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  // in <body>: a menu opened from a transformed bar (the floating format bar) would otherwise be placed relative to that bar
  return createPortal(<MenuPanel ref={ref} style={{ ...pos, width }} items={items} onClose={onClose} />, document.body);
}

/** Where a panel goes: next to its anchor, flipped and clamped so it stays in the window. */
function place(el, anchor, placement, align) {
  if (!el || !anchor) return { left: 0, top: 0 };
  const w = el.offsetWidth, h = el.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, m = 8;
  const isRect = anchor.width !== undefined;
  let left = isRect ? (align === 'end' ? anchor.right - w : anchor.left) : anchor.x;
  let top = isRect ? (placement === 'above' ? anchor.top - h - 6 : anchor.bottom + 6) : anchor.y;
  if (isRect && placement === 'above' && top < m) top = anchor.bottom + 6;
  if (isRect && placement !== 'above' && top + h > vh - m) top = anchor.top - h - 6;
  return { left: Math.max(m, Math.min(left, vw - w - m)), top: Math.max(m, Math.min(top, vh - h - m)) };
}

const MenuPanel = React.forwardRef(function MenuPanel({ items, onClose, style }, ref) {
  const [sub, setSub] = useState(null); // { i, rect }
  const subRef = useRef(null);
  const [subPos, setSubPos] = useState(null);
  useLayoutEffect(() => {
    if (!sub || !subRef.current) { setSubPos(null); return; }
    const el = subRef.current, w = el.offsetWidth, h = el.offsetHeight;
    let left = sub.rect.right + 2; if (left + w > window.innerWidth - 8) left = sub.rect.left - w - 2;
    const top = Math.max(8, Math.min(sub.rect.top - 6, window.innerHeight - h - 8));
    setSubPos({ left, top });
  }, [sub]);
  const run = (it) => { if (it.disabled) return; if (!it.keep) onClose(); it.onClick && it.onClick(); };
  return (
    <>
      <div className="menu" ref={ref} style={style} role="menu" onContextMenu={(e) => e.preventDefault()}>
        {items.filter(Boolean).map((it, i) => {
          if (it.sep) return <div key={i} className="menu-sep" role="separator" />;
          if (it.swatches) return <Swatches key={i} it={it} onClose={onClose} />;
          const hasSub = Array.isArray(it.items);
          const open = sub && sub.i === i;
          return (
            <button key={i} type="button" role="menuitem" className={`menu-item${it.danger ? ' danger' : ''}${open ? ' open' : ''}`} disabled={it.disabled}
              aria-haspopup={hasSub || undefined} aria-expanded={hasSub ? !!open : undefined}
              onMouseEnter={(e) => setSub(hasSub ? { i, rect: e.currentTarget.getBoundingClientRect() } : null)}
              onClick={(e) => { if (hasSub) setSub({ i, rect: e.currentTarget.getBoundingClientRect() }); else run(it); }}
              onKeyDown={(e) => { if (hasSub && e.key === 'ArrowRight') { e.preventDefault(); setSub({ i, rect: e.currentTarget.getBoundingClientRect() }); } }}>
              <span className="menu-check">{it.checked ? <Icon name="check" size={14} /> : it.icon ? <Icon name={it.icon} size={15} /> : null}</span>
              <span className="menu-label">{it.label}</span>
              {it.hint !== undefined && it.hint !== '' && <span className="menu-hint">{it.hint}</span>}
              {hasSub && <Icon name="chevronRight" size={14} className="menu-more" />}
            </button>
          );
        })}
      </div>
      {sub && items[sub.i] && items[sub.i].items && (
        <div className="menu" ref={subRef} style={{ ...(subPos || { left: -9999, top: -9999 }), width: items[sub.i].width || 200 }} role="menu">
          {items[sub.i].items.filter(Boolean).map((it, j) => (it.sep ? <div key={j} className="menu-sep" /> : it.swatches ? <Swatches key={j} it={it} onClose={onClose} /> : (
            <button key={j} type="button" role="menuitem" className={`menu-item${it.danger ? ' danger' : ''}`} disabled={it.disabled} onClick={() => run(it)}>
              <span className="menu-check">{it.checked ? <Icon name="check" size={14} /> : it.icon ? <Icon name={it.icon} size={15} /> : null}</span>
              <span className="menu-label" style={it.style}>{it.label}</span>
              {it.hint !== undefined && it.hint !== '' && <span className="menu-hint">{it.hint}</span>}
            </button>
          )))}
        </div>
      )}
    </>
  );
});

function Swatches({ it, onClose }) {
  return (
    <div className="menu-swatches">
      <div className="menu-swatch-grid">
        {it.swatches.map((c) => (
          <button key={c} type="button" className={`menu-swatch${it.value === c ? ' on' : ''}`} style={{ background: c }} title={c} aria-label={c}
            onClick={() => { it.onPick(c); onClose(); }} />
        ))}
      </div>
      <button type="button" className="menu-item menu-reset" onClick={() => { it.onPick(null); onClose(); }}>
        <span className="menu-check" /><span className="menu-label">{it.clearLabel || 'Reset'}</span>
      </button>
    </div>
  );
}
