import { useCallback, useEffect, useState } from 'react';
import { Node, RepeatRule } from '../domain/node';
import { DeadlineSettings, deadlineTone, localToday } from '../domain/deadline';
import { RECURRING_PROJECT_ID } from '../service/projectService';
import { useServices } from './AppContext';
import { DatePill } from './DatePill';

export function RecurringList({ settings }: { settings: DeadlineSettings }) {
  const { project, node } = useServices();
  const [items, setItems] = useState<Node[]>([]);
  const [title, setTitle] = useState('');
  const [rule, setRule] = useState<Exclude<RepeatRule, 'none'>>('weekly');
  const [date, setDate] = useState(localToday());
  const refresh = useCallback(async () => {
    await project.ensureRecurringRoot();
    setItems((await project.loadTree(RECURRING_PROJECT_ID)).filter(item => item.parentId === RECURRING_PROJECT_ID));
  }, [project]);
  useEffect(() => { refresh(); }, [refresh]);
  const active = items.filter(item => !item.completedAt);
  const history = items.filter(item => item.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));

  async function add() {
    if (!title.trim() || !date) return;
    await node.createNode({ projectId: RECURRING_PROJECT_ID, parentId: RECURRING_PROJECT_ID, title: title.trim(), now: new Date().toISOString(), nodeTime: date, repeatRule: rule, repeatAnchor: date });
    setTitle('');
    refresh();
  }

  return <div className="ptree recurring-page">
    <div className="ph"><h1 className="ph-title">定期事项</h1><p className="ph-description">每周、每月要做的事放在这里，独立于项目。完成后会自动生成下一次。</p></div>
    <div className="tree-heading"><h2>待完成 · {active.length}</h2></div>
    <div className="recurring-create">
      <input className="add-inline-input" aria-label="新定期事项" placeholder="写下定期事项…" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
      <select aria-label="重复周期" value={rule} onChange={e => setRule(e.target.value as Exclude<RepeatRule, 'none'>)}><option value="weekly">每周</option><option value="monthly">每月</option></select>
      <input type="date" aria-label="首次日期" value={date} onChange={e => setDate(e.target.value)} />
      <button className="btn-seal" onClick={add}>添加</button>
    </div>
    <div className="tree-container">
      {active.length ? active.map(item => <RecurringRow key={item.id} item={item} settings={settings} refresh={refresh} />) : <div className="tree-empty">还没有定期事项</div>}
    </div>
    {history.length > 0 && <><div className="tree-heading recurring-history-heading"><h2>完成记录 · {history.length}</h2></div><div className="tree-container">{history.map(item => <RecurringRow key={item.id} item={item} settings={settings} refresh={refresh} />)}</div></>}
  </div>;
}

function RecurringRow({ item, settings, refresh }: { item: Node; settings: DeadlineSettings; refresh: () => void }) {
  const { node } = useServices();
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.progressNote ?? '');
  useEffect(() => { setTitle(item.title); setNote(item.progressNote ?? ''); }, [item.title, item.progressNote]);
  const done = !!item.completedAt;
  const tone = deadlineTone(item.nodeTime, done, localToday(), settings);
  const saveTitle = async () => {
    const next = title.trim();
    if (!next) { setTitle(item.title); return; }
    if (next !== item.title) { await node.updateNode(item.id, { title: next }, new Date().toISOString()); refresh(); }
  };
  const saveNote = async () => {
    if (note !== (item.progressNote ?? '')) { await node.updateNode(item.id, { progressNote: note.trim() || null }, new Date().toISOString()); refresh(); }
  };
  const remove = async () => {
    if (!confirm(`删除「${item.title}」这条${done ? '完成记录' : '定期事项'}？`)) return;
    await node.deleteNode(item.id);
    refresh();
  };
  return <div className={`recurring-row deadline-${tone}`}>
    <div className="recurring-main">
      {done ? <span className="node-check checked">✓</span> : <button className="node-check" aria-label={`完成${item.title}`} onClick={async () => { await saveTitle(); await saveNote(); await node.markComplete(item.id, true, new Date().toISOString()); refresh(); }} />}
      {done ? <span className="recurring-title completed">{item.title}</span> : <input className="recurring-title-input" aria-label="事项内容" value={title} onChange={e => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}
      <button className="icon-btn danger" onClick={remove}>删除</button>
    </div>
    <div className="recurring-meta">
      <span className="detail-label">{done ? '原定日期' : '下次日期'}</span>
      <DatePill value={item.nodeTime} tone="amber" icon="" readOnly={done} onChange={done ? undefined : async value => { if (!value) return; await node.updateNode(item.id, { nodeTime: value, repeatAnchor: value }, new Date().toISOString()); refresh(); }} />
      <span className="detail-separator" />
      {done ? <><span className="detail-label">完成时间</span><DatePill value={item.completedAt} tone="sage" icon="" readOnly /></> : <><span className="detail-label">重复</span><select className="repeat-select" aria-label="重复周期" value={item.repeatRule} onChange={async e => { await node.updateNode(item.id, { repeatRule: e.target.value as RepeatRule, repeatAnchor: item.nodeTime }, new Date().toISOString()); refresh(); }}><option value="none">不重复</option><option value="weekly">每周</option><option value="monthly">每月</option></select></>}
      <span className="detail-separator" /><span className="detail-label">进展</span>
      {done ? <span className="recurring-note">{item.progressNote || '—'}</span> : <input className="note-input" aria-label="进展" placeholder="添加进展…" value={note} onChange={e => setNote(e.target.value)} onBlur={saveNote} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}
    </div>
  </div>;
}
