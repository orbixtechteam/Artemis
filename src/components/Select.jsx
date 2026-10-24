import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icons.jsx';

const text = (n) => React.Children.toArray(n).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : '')).join('');

/** Reads <option> and <optgroup> children into a flat list, so Select is a drop-in for <select>. */
function parse(children) {
  const out = [];
  const walk = (nodes, group) => {
    React.Children.forEach(nodes, (c) => {
      if (!c || !c.type) return;
      if (c.type === React.Fragment) return walk(c.props.children, group);
      if (c.type === 'optgroup') return walk(c.props.children, c.props.label);
      if (c.type === 'option') { const label = text(c.props.children); out.push({ value: c.props.value !== undefined ? String(c.props.value) : label, label, group: group || '', disabled: !!c.props.disabled }); }
    });
  };
  walk(children, '');
  return out;
}

/** Custom dropdown with the same API as <select> (value, onChange(e) with e.target.value, <option>/<optgroup> children). */
export default function Select({ value, onChange, children, className = '', title, disabled, style, id, placeholder = 'Choose…', 'aria-label': ariaLabel, 'aria-labelledby': ariaLabelledby }) {
  const opts = useMemo(() => parse(children), [children]);
  const valueId = useId();
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const [pos, setPos] = useState(null);
  const [q, setQ] = useState('');
  const find = useRef(null);
  const btn = useRef(null);
  const pop = useRef(null);
  const v = value === undefined || value === null ? '' : String(value);
  const cur = opts.find((o) => o.value === v);
  const pill = /pill-select/.test(className);
  const searchable = opts.length >= 8; // long lists (models) get a search box
  const needle = q.trim().toLowerCase();
  const list = useMemo(() => (needle ? opts.filter((o) => (o.label + ' ' + o.group + ' ' + o.value).toLowerCase().includes(needle)) : opts), [opts, needle]);

  const place = () => {
    const el = btn.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const below = vh - r.bottom - 12, above = r.top - 12;
    const up = below < 220 && above > below;
    const maxH = Math.max(120, Math.min(340, up ? above : below));
    const minW = Math.max(r.width, 150);
    let left = r.left;
    if (left + minW > vw - 8) left = Math.max(8, r.right - minW);
    setPos({ left, minWidth: minW, maxHeight: maxH, ...(up ? { bottom: vh - r.top + 6 } : { top: r.bottom + 6 }) });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (btn.current && btn.current.contains(e.target)) return; if (pop.current && pop.current.contains(e.target)) return; setOpen(false); };
    const close = (e) => { if (pop.current && e && e.target && pop.current.contains(e.target)) return; setOpen(false); };
    document.addEventListener('mousedown', down);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', down); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);
  useEffect(() => { if (open) pop.current?.querySelector('.sel-item.act')?.scrollIntoView({ block: 'nearest' }); }, [act, open, pos]);
  useEffect(() => { if (open && searchable && pos) find.current?.focus({ preventScroll: true }); }, [open, pos, searchable]);

  const toggle = () => { if (disabled) return; if (!open) { setQ(''); setAct(Math.max(0, opts.findIndex((o) => o.value === v))); } setOpen(!open); };
  const pick = (o) => { if (!o || o.disabled) return; setOpen(false); btn.current?.focus(); if (o.value !== v && onChange) onChange({ target: { value: o.value, type: 'select-one' }, currentTarget: { value: o.value } }); };
  const step = (d) => { if (!list.length) return; let i = act; for (let k = 0; k < list.length; k++) { i = (i + d + list.length) % list.length; if (!list[i].disabled) break; } setAct(i); };
  const onKey = (e) => {
    if (disabled) return;
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); toggle(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) { e.preventDefault(); pick(list[act]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1 && !searchable) { const i = opts.findIndex((o, k) => k > act && o.label.toLowerCase().startsWith(e.key.toLowerCase())); const j = i >= 0 ? i : opts.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase())); if (j >= 0) setAct(j); }
  };

  let last = null;
  return (
    <>
      <button type="button" id={id} ref={btn} className={`sel ${pill ? '' : 'field-sel'} ${className} ${open ? 'open' : ''}`} style={style} title={title} disabled={disabled} onClick={toggle} onKeyDown={onKey} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} aria-labelledby={ariaLabelledby ? ariaLabelledby + ' ' + valueId : undefined}>
        <span className="sel-label" id={valueId}>{cur ? cur.label : (v || placeholder)}</span>
        <Icon name={pill ? 'chevronDown' : 'chevronUpDown'} size={pill ? 13 : 12} />
      </button>
      {open && pos && createPortal(
        <div ref={pop} className="sel-pop" role="listbox" style={pos}>
          {searchable && (
            <div className="sel-search">
              <input ref={find} value={q} placeholder="Search…" spellCheck={false} onChange={(e) => { setQ(e.target.value); setAct(0); }} onKeyDown={onKey} />
            </div>
          )}
          {list.map((o, i) => {
            const head = o.group && o.group !== last ? o.group : null; last = o.group;
            return (
              <React.Fragment key={o.group + '|' + o.value + '|' + i}>
                {head && <div className="sel-group">{head}</div>}
                <button type="button" role="option" aria-selected={o.value === v} disabled={o.disabled} className={`sel-item ${i === act ? 'act' : ''}`} onMouseEnter={() => setAct(i)} onClick={() => pick(o)}>
                  <span className="sel-check">{o.value === v ? <Icon name="check" size={14} /> : null}</span>
                  <span className="sel-name">{o.label}</span>
                </button>
              </React.Fragment>
            );
          })}
          {list.length === 0 && <div className="sel-group">{needle ? 'No match' : 'Nothing to choose'}</div>}
        </div>,
        document.body
      )}
    </>
  );
}
Select.acceptsLabel = true; // a settings Row may give it the row label as its accessible name
