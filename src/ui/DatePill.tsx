import { useState, useRef, useEffect, ChangeEvent } from 'react';

export type PillTone = 'amber' | 'sage' | 'seal';

function fmt(v: string | null): string | null {
  return v ? v.slice(0, 10) : null;
}

/**
 * A small notebook-style date pill.
 *
 * - Empty  → a faint labelled button ("＋ 节点时间") that opens a date input.
 * - Filled → shows the date + an optional trailing tag ("聚合"/"手动") and a
 *           small ✕ to clear; clicking the date re-opens the editor.
 * - editing writes through `onChange`; clearing writes `null`.
 * - `readOnly` renders a non-interactive pill (used for *derived* values like
 *   a group's auto-aggregated completion time).
 */
export function DatePill({
  value,
  emptyLabel,
  icon = '⧗',
  tone = 'amber',
  tag,
  readOnly = false,
  title,
  onChange,
  onClear,
  clearLabel = '清除日期',
}: {
  value: string | null;
  emptyLabel?: string;
  icon?: string;
  tone?: PillTone;
  /** Optional trailing chip text, e.g. "聚合" / "手动". */
  tag?: string;
  readOnly?: boolean;
  title?: string;
  onChange?: (v: string | null) => void;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing && ref.current) ref.current.focus();
  }, [editing]);

  const canEdit = !readOnly && !!onChange;
  const v = fmt(value);

  function commit(raw: string) {
    const next = raw || null;
    onChange?.(next);
    setEditing(false);
  }

  if (canEdit && editing) {
    return (
      <input
        ref={ref}
        type="date"
        className={`dp-input tone-${tone}`}
        defaultValue={v ?? ''}
        title={title}
        onChange={(e: ChangeEvent<HTMLInputElement>) => commit(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  if (v) {
    return (
      <span className={`dp tone-${tone} has-val ${readOnly ? 'ro' : ''}`} title={title}>
        {canEdit ? (
          <button className="dp-value-button" aria-label={title ?? `修改日期 ${v}`} onClick={() => setEditing(true)}>
            <span className="dp-ico">{icon}</span><span className="dp-val">{v}</span>{tag ? <span className="dp-tag">{tag}</span> : null}
          </button>
        ) : <><span className="dp-ico">{icon}</span><span className="dp-val">{v}</span>{tag ? <span className="dp-tag">{tag}</span> : null}</>}
        {canEdit && onClear ? (
          <button
            className="dp-clear"
            title={clearLabel}
            aria-label={clearLabel}
            onClick={(e) => {
              onClear();
            }}
          >
            ✕
          </button>
        ) : null}
      </span>
    );
  }

  // empty state (only meaningful when editable)
  if (canEdit) {
    return (
      <button
        className={`dp tone-${tone} empty`}
        title={title}
        onClick={() => setEditing(true)}
      >
        <span className="dp-ico">{icon}</span>
        <span className="dp-label">{emptyLabel ?? '设置时间'}</span>
      </button>
    );
  }
  // readOnly + empty → nothing meaningful to show
  return null;
}
