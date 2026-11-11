import React, { useRef, useState } from 'react';
import { Icon } from '../Icons.jsx';
import Menu from '../ui/Menu.jsx';
import { NUM_FORMATS } from '../../lib/sheet-format.mjs';

/**
 * The floating format bar under the grid (Claude Sheets): B, I, U ▾, 123 ▾, ⋯ and Ask Artemis.
 * common: { b, i, u, s, num } shared by the selection; onPatch(patch) formats it; more: items of the ⋯ menu.
 */
export default function FormatBar({ common, onPatch, more, onAsk }) {
  const [menu, setMenu] = useState(null); // { kind, rect }
  const open = (kind) => (e) => setMenu(menu && menu.kind === kind ? null : { kind, rect: e.currentTarget.getBoundingClientRect() });
  const close = () => setMenu(null);
  const items = !menu ? null
    : menu.kind === 'underline' ? [
      { label: 'Underline', hint: '⌘U', checked: !!common.u, onClick: () => onPatch({ u: !common.u }) },
      { label: 'Strikethrough', hint: '⌘⇧X', checked: !!common.s, onClick: () => onPatch({ s: !common.s }) }
    ]
    : menu.kind === 'num' ? NUM_FORMATS.map((f) => ({ label: f.label, hint: f.sample || '', checked: (common.num || 'auto') === f.id, onClick: () => onPatch({ num: f.id === 'auto' ? null : f.id }) }))
    : more;
  return (
    <div className="fbar" role="toolbar" aria-label="Format cells" onMouseDown={(e) => e.preventDefault() /* keep the grid focused */}>
      <button type="button" className={`fbar-btn fbar-b${common.b ? ' on' : ''}`} title="Bold (⌘B)" aria-pressed={!!common.b} onClick={() => onPatch({ b: !common.b })}>B</button>
      <button type="button" className={`fbar-btn fbar-i${common.i ? ' on' : ''}`} title="Italic (⌘I)" aria-pressed={!!common.i} onClick={() => onPatch({ i: !common.i })}>I</button>
      <span className="fbar-split">
        <button type="button" className={`fbar-btn fbar-u${common.u ? ' on' : ''}`} title="Underline (⌘U)" aria-pressed={!!common.u} onClick={() => onPatch({ u: !common.u })}>U</button>
        <button type="button" className="fbar-caret" title="More text styles" aria-label="More text styles" onClick={open('underline')}><Icon name="chevronDown" size={12} /></button>
      </span>
      <span className="fbar-sep" />
      <span className="fbar-split">
        <button type="button" className={`fbar-btn fbar-num${common.num ? ' on' : ''}`} title="Number format" onClick={open('num')}>123</button>
        <button type="button" className="fbar-caret" title="Number format" aria-label="Number format" onClick={open('num')}><Icon name="chevronDown" size={12} /></button>
      </span>
      <span className="fbar-sep" />
      <button type="button" className={`fbar-btn${menu && menu.kind === 'more' ? ' on' : ''}`} title="More formatting" aria-label="More formatting" onClick={open('more')}><Icon name="dots" size={18} /></button>
      {onAsk && <button type="button" className="fbar-ask" onClick={onAsk} title="Ask Artemis about the selected cells">Ask Artemis</button>}
      {menu && <Menu anchor={menu.rect} placement="above" align={menu.kind === 'more' ? 'start' : 'start'} items={items} onClose={close} width={menu.kind === 'more' ? 270 : 230} />}
    </div>
  );
}
