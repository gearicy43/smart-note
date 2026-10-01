import { useEffect, useState, useCallback, useRef } from 'react';
import { useServices } from './AppContext';
import { Tree } from '../domain/tree';
import { NodeRow } from './NodeRow';
import { DatePill } from './DatePill';
import { effectiveCompletedAt, progress } from '../domain/aggregate';
import { DeadlineSettings, deadlineTone, localToday } from '../domain/deadline';

export function ProjectTree({ projectId, settings, onDeleted, onChanged, onDuplicated }: { projectId: string; settings: DeadlineSettings; onDeleted: () => void; onChanged: () => void; onDuplicated: (id: string) => void }) {
  const { project, node } = useServices();
  const [tree, setTree] = useState<Tree | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [addingRoot, setAddingRoot] = useState(false);
  const [rootDraft, setRootDraft] = useState('');
  const addRootRef = useRef<HTMLInputElement>(null);
  const now = () => new Date().toISOString();

  const refresh = useCallback(async () => {
    setTree(new Tree(await project.loadTree(projectId)));
  }, [project, projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (addingRoot && addRootRef.current) addRootRef.current.focus();
  }, [addingRoot]);

  if (!tree) return <div className="loading">加载中…</div>;
  if (tree.all().length === 0) return <div className="empty-state">项目不存在或已被删除</div>;

  const root = tree.root();
  const rootTime = root.nodeTime;
  const rootDone = effectiveCompletedAt(root, tree);
  const { done, total } = progress(root, tree);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const children = tree.childrenOf(root.id);

  async function saveTitle() {
    const t = titleDraft.trim();
    if (t && t !== root.title) {
      await node.updateNode(root.id, { title: t }, now());
      refresh();
      onChanged();
    }
    setEditingTitle(false);
  }

  async function duplicateProject() {
    const copy = await project.duplicateProject(projectId, `${root.title}（副本）`, now());
    onDuplicated(copy.id);
  }

  async function deleteProject() {
    if (!confirm(`删除整个项目「${root.title}」？此操作不可恢复。`)) return;
    await project.deleteProject(projectId);
    onDeleted();
  }

  async function createRoot() {
    const t = rootDraft.trim();
    if (!t) return;
    await node.createNode({ projectId, parentId: root.id, title: t, now: now() });
    setRootDraft('');
    setAddingRoot(false);
    refresh();
  }

  return (
    <div className="ptree">
      {/* Project overview */}
      <div className="ph">
        <div className="ph-top">
          {editingTitle ? (
            <input
              className="node-title-input ph-title-input"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
            />
          ) : (
            <h1
              className="ph-title"
              onClick={() => {
                setTitleDraft(root.title);
                setEditingTitle(true);
              }}
              title="点击重命名"
            >
              {root.title}
            </h1>
          )}
          <div className="ph-actions">
            <button className="btn-ghost" onClick={duplicateProject}>复制项目</button>
            <button className="btn-ghost danger" onClick={deleteProject}>删除项目</button>
          </div>
        </div>

        <p className="ph-description">按项目整理事项。每个事项都可以继续添加子项。</p>
        <div className="ph-stats">
          <span className="stat-label">最晚截止</span>
            <span className={`deadline-${deadlineTone(rootTime, !!rootDone, localToday(), settings)}`}>
              <DatePill tone="amber" icon="" value={rootTime} emptyLabel="选择日期" onChange={async value => { await node.updateNode(root.id, { nodeTime: value }, now()); refresh(); }} onClear={async () => { await node.updateNode(root.id, { nodeTime: null }, now()); refresh(); }} title="项目截止日期，可留空" />
            </span>
          {rootDone ? (
            <DatePill
              tone="sage"
              icon="✓"
              value={rootDone}

              readOnly
              title="项目完成时间：最后一项完成时，自动聚合"
            />
          ) : (
            <span className="ph-stat-inline" title="完成时间由子项聚合">
              <span className="dp-ghost sage">✓ 完成时间 —</span>
            </span>
          )}
          <span className="stat-label">进展</span>
          <span className="ph-pg">
            <span className="pg-track">
              <div className="pg-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="pg-text">{done}/{total}</span>
          </span>
        </div>
      </div>

      {/* Tree */}
      <div className="tree-heading"><h2>项目事项</h2><button className="btn-seal" onClick={() => setAddingRoot(true)}>＋ 添加事项</button></div>
      <div className="tree-container">
        {addingRoot && (
          <div className="add-inline-form root-add" style={{ paddingLeft: 14 }}>
            <input
              ref={addRootRef}
              className="add-inline-input"
              placeholder="输入标题，回车添加…"
              value={rootDraft}
              onChange={(e) => setRootDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createRoot();
                if (e.key === 'Escape') {
                  setRootDraft('');
                  setAddingRoot(false);
                }
              }}
              onBlur={() => {
                if (!rootDraft.trim()) setAddingRoot(false);
              }}
            />
            <button className="add-inline-btn" onClick={createRoot}>
              添加
            </button>
            <button
              className="add-inline-cancel"
              onClick={() => {
                setRootDraft('');
                setAddingRoot(false);
              }}
            >
              取消
            </button>
          </div>
        )}

        {children.length === 0 && !addingRoot ? (
          <div className="tree-empty">还没有事项，点击「添加事项」写下第一条</div>
        ) : (
          children.map((c) => <NodeRow key={c.id} node={c} tree={tree} depth={0} settings={settings} reload={refresh} />)
        )}
      </div>
    </div>
  );
}
