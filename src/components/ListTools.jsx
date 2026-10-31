import React from 'react';
import Select from './Select.jsx';
import { SORTS } from '../lib/listfilter.mjs';

/** The search field and sort menu above a list page. */
export default function ListTools({ q, onQ, sort, onSort, placeholder }) {
  return (
    <div className="auto-bar list-tools">
      <input type="search" className="auto-search" placeholder={placeholder} aria-label={placeholder} value={q} spellCheck={false} onChange={(e) => onQ(e.target.value)} />
      <Select value={sort} title="Sort" onChange={(e) => onSort(e.target.value)}>
        {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </Select>
    </div>
  );
}
