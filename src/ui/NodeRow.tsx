import { useEffect, useRef, useState } from 'react';
import { Node } from '../domain/node';
import { Tree } from '../domain/tree';
import { effectiveCompletedAt, effectiveNodeTime, progress } from '../domain/aggregate';
import { useServices } from './AppContext';
import { DatePill } from './DatePill';
import { DeadlineSettings, deadlineTone, localToday } from '../domain/deadline';

export function NodeRow({ node, tree, depth, settings, reload }: {
  node: Node;
  tree: Tree;
  depth: number;
  settings: DeadlineSettings;
  reload: () => void;
}) {
  const { node: service } = useServices();
  const children = tree.childrenOf(node.id);
  const isGroup = children.length > 0;
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(node.title);
  const [note, setNote] = useState(node.progressNote ?? '');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const addRef = useRef<HTMLInputElement>(null);
  const { done, total } = progress(node, tree);
  const deadline = effectiveNodeTime(node, tree);
  const completed = effectiveCompletedAt(node, tree);
  const tone = deadlineTone(deadline, !!completed, localToday(), settings);
  const now = () => new Date().toISOString();

  useEffect(() => setNote(node.progressNote ?? ''), [node.progressNote]);
  useEffect(() => { if (adding) addRef.current?.focus(); }, [adding]);

  async function saveTitle() {
    const next = title.trim();
    setEditing(false);
    if (!next) { setTitle(node.title); return; }
    if (next !== node.title) {
      await service.updateNode(node.id, { title: next }, now());
      reload();
    }
  }

  async function saveNote() {
    if (note === (node.progressNote ?? '')) return;
    await service.updateNode(node.id, { progressNote: note.trim() || null }, now());
    reload();
  }

  async function addChild() {
    const next = draft.trim();
    if (!next) return;
    await service.createNode({ projectId: node.projectId, parentId: node.id, title: next, now: now() });
    setDraft('');
    setAdding(false);
    setExpanded(true);
    reload();
  }

  async function remove() {
    if (!confirm(`删除「${node.title}」${isGroup ? '及其所有子项' : ''}？`)) return;
    await service.deleteNode(node.id);
    reload();
  }

  return (
    <div className="node-row" style={{ '--depth': depth } as React.CSSProperties}>
      <div className={`node-line deadline-${tone} ${isGroup ? 'group' : 'leaf'} ${node.completedAt && !isGroup ? 'completed' : ''}`} style={{ paddingLeft: 22 + depth * 26 }}>
        <div className="node-primary">
          {isGroup ? (
            <button className={`toggle ${expanded ? '' : 'collapsed'}`} onClick={() => setExpanded(!expanded)} aria-label={expanded ? '折叠子项' : '展开子项'}>⌄</button>
          ) : (
            <button className={`node-check ${node.completedAt ? 'checked' : ''}`} onClick={async () => {
              await service.markComplete(node.id, !node.completedAt, now());
              reload();
            }} aria-label={node.completedAt ? '取消完成' : '标记完成'}>{node.completedAt ? '✓' : ''}</button>
          )}
          {editing ? (
            <input className="node-title-input" autoFocus value={title} onChange={e => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={e => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') { setTitle(node.title); setEditing(false); }
            }} />
          ) : (
            <button className="node-title-text" onClick={() => { setTitle(node.title); setEditing(true); }} title="点击修改内容">{node.title}</button>
          )}
          {isGroup && <span className="group-count">{done}/{total} 完成</span>}
          <div className="node-actions">
            <button className="icon-btn" onClick={() => setAdding(true)} title="添加下一级">＋ 子项</button>
            <button className="icon-btn danger" onClick={remove} title="删除">删除</button>
          </div>
        </div>
        <div className="node-detail">
          <span className="detail-label">最晚截止</span>
          <DatePill
            value={deadline}
            tone="amber"
            icon=""
            tag={isGroup ? (node.nodeTimeMode === 'manual' ? '手动' : '自动') : undefined}
            emptyLabel="选择日期"
            title={isGroup ? '点击设置大项截止日期；未手填时取子项最晚日期' : '设置截止日期'}
            onChange={async value => {
              if (!value) return;
              await service.updateNode(node.id, isGroup ? { nodeTime: value, nodeTimeMode: 'manual' } : { nodeTime: value }, now());
              reload();
            }}
            onClear={deadline && (!isGroup || node.nodeTimeMode === 'manual') ? async () => {
              await service.updateNode(node.id, isGroup ? { nodeTime: null, nodeTimeMode: 'auto' } : { nodeTime: null }, now());
              reload();
            } : undefined}
            clearLabel={isGroup ? '恢复自动截止日期' : '清除截止日期'}
          />
          <span className="detail-separator" />
          <span className="detail-label">完成时间</span>
          {completed ? (
            <DatePill value={completed} tone="sage" icon="" readOnly={isGroup} onChange={isGroup ? undefined : async value => {
              if (!value) return;
              await service.markComplete(node.id, true, `${value}T00:00:00.000Z`);
              reload();
            }} />
          ) : <span className="detail-empty">未完成</span>}
          <span className="detail-separator" />
          <span className="detail-label">进展</span>
          <input className="note-input" value={note} onChange={e => setNote(e.target.value)} onBlur={saveNote} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} placeholder="添加进展…" aria-label={`${node.title}的进展`} />
        </div>
      </div>
      {adding && <div className="add-inline-form" style={{ paddingLeft: 48 + depth * 26 }}>
        <input ref={addRef} className="add-inline-input" value={draft} placeholder="写下新的子项" onChange={e => setDraft(e.target.value)} onKeyDown={e => {
          if (e.key === 'Enter') addChild();
          if (e.key === 'Escape') { setDraft(''); setAdding(false); }
        }} />
        <button className="add-inline-btn" onClick={addChild}>添加</button>
        <button className="add-inline-cancel" onClick={() => { setDraft(''); setAdding(false); }}>取消</button>
      </div>}
      {isGroup && expanded && <div className="node-children">{children.map(child => <NodeRow key={child.id} node={child} tree={tree} depth={depth + 1} settings={settings} reload={reload} />)}</div>}
    </div>
  );
}
