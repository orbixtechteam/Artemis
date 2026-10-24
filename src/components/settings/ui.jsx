import React, { useEffect, useId, useState } from 'react';

/*
 * Building blocks of the Settings page, in the macOS "inset grouped" style:
 *   <Page title description>          a section: large title, one-line description, then groups
 *   <Group title footer>              a rounded card of rows with an optional small header and footnote
 *   <Row label description>control   label (+ secondary text) on the left, the control right-aligned;
 *                                     `stacked` puts a wide control (URL, key, textarea, list) under the label
 *   <SwitchRow>                       a Row with a Switch
 *   <Switch>                          role="switch" toggle (Space / Enter work because it is a button)
 *   <SecretInput>                     password field that commits on blur / Enter, never per keystroke
 *   <Segmented>                       a macOS segmented control for 2–4 short choices
 *   <Note>                            muted paragraph between groups
 */

export function Page({ title, description, aside, children }) {
  return (
    <div className="pref-page">
      <header className="pref-page-head">
        <div className="pref-page-titles">
          <h1 className="pref-page-title">{title}</h1>
          {description && <p className="pref-page-desc">{description}</p>}
        </div>
        {aside}
      </header>
      {children}
    </div>
  );
}

export function Group({ title, footer, children, className = '', plain = false }) {
  const id = useId();
  return (
    <section className={`pref-group ${className}`} aria-labelledby={title ? id : undefined}>
      {title && <h2 className="pref-group-title" id={id}>{title}</h2>}
      <div className={plain ? 'pref-plain' : 'pref-card'}>{children}</div>
      {footer && <div className="pref-group-foot">{footer}</div>}
    </section>
  );
}

// Give a single control child the row label as its accessible name, unless it already has one.
const LABELLABLE = ['input', 'textarea', 'select', 'button'];
const labelled = (children, labelId) => {
  const arr = React.Children.toArray(children).filter(Boolean);
  if (arr.length !== 1 || !React.isValidElement(arr[0])) return children;
  const el = arr[0]; const p = el.props || {};
  if (p['aria-label'] || p['aria-labelledby']) return children;
  const ok = typeof el.type === 'string' ? LABELLABLE.includes(el.type) : el.type === Switch || !!(el.type && el.type.acceptsLabel);
  return ok ? React.cloneElement(el, { 'aria-labelledby': labelId }) : children;
};

export function Row({ label, description, error, children, stacked = false, className = '', below }) {
  const id = useId();
  const labelId = id + 'l';
  return (
    <div className={`pref-row ${stacked ? 'stacked' : ''} ${error ? 'has-err' : ''} ${className}`}>
      <div className="pref-row-main">
        {(label || description || error) && (
          <div className="pref-row-text">
            {label && <div className="pref-row-label" id={labelId}>{label}</div>}
            {description && <div className="pref-row-desc">{description}</div>}
            {error && <div className="pref-row-err" role="alert">{error}</div>}
          </div>
        )}
        {children && !stacked && <div className="pref-row-control">{label ? labelled(children, labelId) : children}</div>}
      </div>
      {children && stacked && <div className="pref-row-wide">{label ? labelled(children, labelId) : children}</div>}
      {below}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled, ...rest }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={rest['aria-labelledby'] ? undefined : label} disabled={disabled}
      className={`pref-switch ${checked ? 'on' : ''}`} onClick={() => onChange && onChange(!checked)} {...rest}>
      <span className="pref-switch-knob" aria-hidden="true" />
    </button>
  );
}

export function SwitchRow({ label, description, checked, onChange, disabled, error, children }) {
  return (
    <Row label={label} description={description} error={error} below={children}>
      <Switch checked={checked} onChange={onChange} label={typeof label === 'string' ? label : undefined} disabled={disabled} />
    </Row>
  );
}

/** A password field for secrets: typing stays local; it is committed on blur or Enter (and then cleared by the caller if wanted). */
export function SecretInput({ value: initial = '', onCommit, placeholder, clearOnCommit = false, ...rest }) {
  const [v, setV] = useState(initial);
  useEffect(() => { setV(initial); }, [initial]);
  const commit = () => { if (!v.trim() || !onCommit) return; onCommit(v.trim()); if (clearOnCommit) setV(''); };
  return (
    <input type="password" autoComplete="off" spellCheck={false} className="pref-input wide" value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} {...rest} />
  );
}

export function Note({ children, tone = '' }) {
  return <p className={`pref-note ${tone}`}>{children}</p>;
}

/** A row of buttons inside a group (form actions like Add / Done, test buttons). */
export function Buttons({ children, end = false }) {
  return <div className={`pref-buttons ${end ? 'end' : ''}`}>{children}</div>;
}

/** A few mutually exclusive choices side by side (macOS segmented control). options: [[value, label], ...] */
export function Segmented({ value, options, onChange, label, ...rest }) {
  return (
    <div className="pref-seg" role="radiogroup" aria-label={rest['aria-labelledby'] ? undefined : label} {...rest}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange && onChange(v)}>{text}</button>
      ))}
    </div>
  );
}
Segmented.acceptsLabel = true;
