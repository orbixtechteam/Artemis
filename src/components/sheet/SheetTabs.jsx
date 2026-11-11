import React, { useState } from 'react';
import { Icon } from '../Icons.jsx';
import Menu from '../ui/Menu.jsx';

/** The bar under the grid: add a sheet, a list of all sheets, and the tabs (the active one is a pill with its own menu). */
export default function SheetTabs({ sheets, active, onSelect, onAdd, onRename, onDuplicate, onDelete, stats }) {
  const [menu, setMenu] = useState(null); // { kind: 'list' | 'tab', rect }
  const [renaming, setRenaming] = useState(null); // { i, value }
  const doRename = () => { if (renaming && renaming.value.trim()) onRename(renaming.i, renaming.value.trim()); setRenaming(null); };
  const items = !menu ? null : menu.kind === 'list'
    ? sheets.map((s, i) => ({ label: s.name, checked: i === active, onClick: () => onSelect(i) }))
    : [
      { label: 'Rename', icon: 'edit', onClick: () => setRenaming({ i: active, value: sheets[active].name }) },
      { label: 'Duplicate', icon: 'copy', onClick: () => onDuplicate(active) },
      { sep: true },
      { label: 'Delete', icon: 'trash', danger: true, disabled: sheets.length < 2, onClick: () => onDelete(active) }
    ];
  return (
    <div className="shtabs">
      <button type="button" className="shtabs-icon" title="Add sheet" aria-label="Add sheet" onClick={onAdd}><Icon name="plus" size={17} /></button>
      <button type="button" className="shtabs-icon wide" title="All sheets" aria-label="All sheets" onClick={(e) => setMenu({ kind: 'list', rect: e.currentTarget.getBoundingClientRect() })}>
        <Icon name="list" size={16} /><Icon name="chevronDown" size={11} />
      </button>
      <div className="shtabs-list" role="tablist">
        {sheets.map((s, i) => (renaming && renaming.i === i
          ? <input key={i} className="shtabs-rename" autoFocus value={renaming.value} onChange={(e) => setRenaming({ i, value: e.target.value })}
              onBlur={doRename} onKeyDown={(e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenaming(null); }} />
          : (
            <button key={i} type="button" role="tab" aria-selected={i === active} className={`shtabs-tab${i === active ? ' on' : ''}`}
              onClick={(e) => (i === active ? setMenu({ kind: 'tab', rect: e.currentTarget.getBoundingClientRect() }) : onSelect(i))}
              onDoubleClick={() => setRenaming({ i, value: s.name })}>
              <span>{s.name}</span>{i === active && <Icon name="chevronDown" size={12} />}
            </button>
          )))}
      </div>
      {stats && <span className="shtabs-stats">{stats}</span>}
      {menu && <Menu anchor={menu.rect} placement="above" items={items} onClose={() => setMenu(null)} width={200} />}
    </div>
  );
}
