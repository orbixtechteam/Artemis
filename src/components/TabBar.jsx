import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import TitleText from './TitleText.jsx';
import { clampSlot, isNoopSlot, orderTabs } from '../lib/tabs.mjs';

/** A small right-click menu. items: [{ label, onClick, danger?, disabled? } | { sep: true }] */
export function ContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (e && e.type === 'mousedown' && ref.current && ref.current.contains(e.target)) return; onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    const wheel = (e) => { if (ref.current && ref.current.contains(e.target)) return; onClose(); }; // a long menu scrolls; scrolling elsewhere closes it
    window.addEventListener('mousedown', close); window.addEventListener('blur', close); window.addEventListener('resize', close); window.addEventListener('keydown', key); window.addEventListener('wheel', wheel, { passive: true });
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('resize', close); window.removeEventListener('keydown', key); window.removeEventListener('wheel', wheel); };
  }, [menu]);
  if (!menu) return null;
  // a long menu (many projects) fits the window and scrolls instead of running off the screen
  const maxH = window.innerHeight - 16;
  const x = Math.min(menu.x, window.innerWidth - 230), y = Math.max(8, Math.min(menu.y, window.innerHeight - Math.min(maxH, menu.items.length * 30 + 16) - 8));
  return (
    <div className="ctx-menu" ref={ref} style={{ left: x, top: y, maxHeight: maxH, overflowY: 'auto' }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) => it.sep
        ? <div key={i} className="ctx-sep" />
        : <button key={i} className={`ctx-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }}>{it.label}{it.hint ? <span className="ctx-hint">{it.hint}</span> : null}</button>)}
    </div>
  );
}

/**
 * The row of tabs under the top bar. info(tab) returns { title, icon, running, awaiting }.
 * Tabs can be dragged inside the strip (onMove(id, slot), slot = gap index in the shown order); pinned tabs stay left of the others.
 */
export default function TabBar({ tabs, active, info, onSelect, onClose, onNew, onMenu, onMove }) {
  const strip = useRef(null);
  const dragId = useRef(null);
  const [drop, setDrop] = useState(null); // slot where the dragged tab would land (null: nowhere / no change)
  const [dragging, setDragging] = useState(null);
  const ordered = orderTabs(tabs);
  const sig = ordered.map((t) => t.id).join(',');
  useEffect(() => { const el = strip.current && strip.current.querySelector('.atab.on'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active, sig]);

  const endDrag = () => { dragId.current = null; setDragging(null); setDrop(null); };
  const aim = (slot) => {
    const id = dragId.current; if (!id) return;
    setDrop(isNoopSlot(ordered, id, slot) ? null : clampSlot(ordered, id, slot));
  };
  const edgeScroll = (e) => { // dragging near either end of the strip scrolls it
    const el = strip.current; if (!el) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left + 24) el.scrollLeft -= 14; else if (e.clientX > r.right - 24) el.scrollLeft += 14;
  };
  const onStripOver = (e) => {
    if (!dragId.current) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; edgeScroll(e);
    if (e.target === strip.current) { // empty space after the last tab
      const last = strip.current.lastElementChild;
      if (last && e.clientX > last.getBoundingClientRect().right) aim(ordered.length);
    }
  };
  const onStripDrop = (e) => {
    if (!dragId.current) return;
    e.preventDefault();
    const id = dragId.current, slot = drop;
    endDrag();
    if (slot != null && onMove) onMove(id, slot);
  };

  return (
    <div className="tabbar nodrag" onContextMenu={(e) => { if (e.target === e.currentTarget || e.target === strip.current) { e.preventDefault(); onMenu(e, null); } }}>
      <div className={`atabs ${dragging ? 'dragging' : ''}`} ref={strip} role="tablist"
        onWheel={(e) => { if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY; }}
        onDragOver={onStripOver} onDrop={onStripDrop}
        onDragLeave={(e) => { if (strip.current && !strip.current.contains(e.relatedTarget)) setDrop(null); }}>
        {ordered.map((t, i) => {
          const f = info(t);
          const mark = drop === i ? 'drop-before' : drop === ordered.length && i === ordered.length - 1 ? 'drop-after' : '';
          return (
            <div key={t.id} data-tab-id={t.id} role="tab" aria-selected={t.id === active}
              className={`atab ${t.id === active ? 'on' : ''} ${t.pinned ? 'pinned' : ''} ${f.awaiting ? 'awaiting' : f.running ? 'running' : ''} ${dragging === t.id ? 'dragged' : ''} ${mark}`}
              title={t.pinned ? f.title + ' (pinned)' : f.title}
              draggable
              onDragStart={(e) => {
                dragId.current = t.id; setDragging(t.id);
                try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-artemis-tab', t.id); } catch {}
              }}
              onDragOver={(e) => {
                if (!dragId.current) return;
                const r = e.currentTarget.getBoundingClientRect();
                aim(i + (e.clientX > r.left + r.width / 2 ? 1 : 0));
              }}
              onDragEnd={endDrag}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); if (!t.pinned) onClose(t.id); } }}
              onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
              onClick={() => onSelect(t.id)} onContextMenu={(e) => { e.preventDefault(); onMenu(e, t.id); }}>
              <Icon name={f.running ? 'spinner' : f.awaiting ? 'warning' : f.icon} size={14} className="atab-ico" />
              {!t.pinned && <TitleText className="atab-title" text={f.title} />}
              {t.pinned ? <Icon name="pin" size={10} className="atab-pin" /> : <button className="atab-x" draggable={false} title="Close tab (⌘W)" aria-label="Close tab (⌘W)" onClick={(e) => { e.stopPropagation(); onClose(t.id); }}><Icon name="x" size={12} /></button>}
            </div>
          );
        })}
      </div>
      <button className="atab-new" title="New tab (⌘T)" aria-label="New tab (⌘T)" onClick={onNew}><Icon name="plus" size={15} /></button>
    </div>
  );
}
