import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

/** Dropdown with a search box. groups: [{ label, items: [[id, name], ...] }]. */
export default function ModelPicker({ value, groups = [], onChange, emptyLabel = '', up = true, align = 'right', className = '', title = 'Model' }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ref = useRef(null);
  const input = useRef(null);
  const list = useRef(null);
  const pop = useRef(null);
  const [shift, setShift] = useState({ x: 0, flip: false });

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  useEffect(() => { if (open) { setQ(''); setSel(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  // keep the list on the screen: slide it sideways when it would run past an edge, and open it the other way when there is no room below / above
  useLayoutEffect(() => {
    if (!open) { setShift({ x: 0, flip: false }); return; }
    const el = pop.current, wrap = ref.current; if (!el || !wrap) return;
    const r = el.getBoundingClientRect(), b = wrap.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight, m = 8;
    let x = 0;
    if (r.right > vw - m) x = vw - m - r.right;
    if (r.left + x < m) x = m - r.left;
    const room = up ? b.top : vh - b.bottom, other = up ? vh - b.bottom : b.top;
    setShift({ x: Math.round(x), flip: r.height + 14 > room && other > room });
  }, [open]);
  const flat = useMemo(() => {
    const all = [];
    if (emptyLabel) all.push({ id: '', name: emptyLabel, group: '' });
    for (const g of groups) for (const [id, name] of g.items) all.push({ id, name, group: g.label });
    return all;
  }, [groups, emptyLabel]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return flat;
    return flat.filter((m) => `${m.name} ${m.id} ${m.group}`.toLowerCase().includes(t));
  }, [flat, q]);
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { list.current?.querySelector('.mp-item.on')?.scrollIntoView({ block: 'nearest' }); }, [sel, open]);

  const current = flat.find((m) => m.id === value);
  const label = current ? current.name.replace(/\s*\(.*?per 1M\)\s*$/, '') : (value || emptyLabel || 'Choose a model');
  const pick = (m) => { if (!m) return; onChange(m.id); setOpen(false); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(shown[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };

  let lastGroup = null;
  return (
    <span className={`mp-wrap ${className}`} ref={ref}>
      <button type="button" className="mp-btn" title={title} onClick={() => setOpen(!open)}>
        <span className="mp-label">{label}</span><Icon name="chevronDown" size={13} />
      </button>
      {open && (
        <div ref={pop} className={`mp-pop ${(shift.flip ? !up : up) ? 'up' : 'down'} ${align}`} style={shift.x ? { transform: `translateX(${shift.x}px)` } : undefined}>
          <input ref={input} className="mp-search" placeholder="Search models…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          <div className="mp-list" ref={list}>
            {shown.length === 0 && <div className="muted small mp-none">No model matches "{q}".</div>}
            {shown.map((m, i) => {
              const head = m.group !== lastGroup && m.group ? m.group : null;
              lastGroup = m.group;
              return (
                <React.Fragment key={m.group + m.id}>
                  {head && <div className="mp-group">{head}</div>}
                  <button type="button" className={`mp-item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(m)}>
                    <span className="mp-check">{m.id === value ? <Icon name="check" size={14} /> : null}</span>
                    <span className="mp-name">{m.name}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}
