import React, { useState } from 'react';
import { Icon } from '../Icons.jsx';
import Menu from '../ui/Menu.jsx';

const ZOOMS = [50, 75, 90, 100, 125, 150, 200];

/** ƒx and the selected cell's value or formula; on the right the save state, undo / redo and zoom. */
export default function FormulaBar({ cellLabel, value, onChange, onKeyDown, onBlur, status, zoom, onZoom, onUndo, onRedo, canUndo, canRedo }) {
  const [menu, setMenu] = useState(null);
  return (
    <div className="fxbar">
      <span className="fxbar-cell" title="Selected cell">{cellLabel}</span>
      <span className="fxbar-fx" aria-hidden="true">ƒx</span>
      <input className="fxbar-input" value={value} onChange={onChange} onKeyDown={onKeyDown} onBlur={onBlur} spellCheck={false}
        placeholder="Type a value, or = for a formula" aria-label="Cell value or formula" />
      {status && <span className={`fxbar-status ${status.kind || ''}`} role="status">{status.text}</span>}
      <button type="button" className="fxbar-btn" title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onClick={onUndo}><Icon name="undo" size={15} /></button>
      <button type="button" className="fxbar-btn" title="Redo (⌘⇧Z)" aria-label="Redo" disabled={!canRedo} onClick={onRedo}><Icon name="redo" size={15} /></button>
      <button type="button" className="fxbar-zoom" onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())} aria-label="Zoom">{zoom}% <Icon name="chevronDown" size={12} /></button>
      {menu && <Menu anchor={menu} align="end" width={140} onClose={() => setMenu(null)}
        items={ZOOMS.map((z) => ({ label: z + '%', checked: z === zoom, onClick: () => onZoom(z) }))} />}
    </div>
  );
}
