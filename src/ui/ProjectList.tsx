import { useEffect, useState } from 'react';
import { useServices } from './AppContext';
import { Node } from '../domain/node';
import { RECURRING_PROJECT_ID } from '../service/projectService';
import { SYSTEM_SETTINGS_ID } from './SystemSettings';

export function ProjectList({
  selectedId,
  onSelect,
  revision,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  revision: number;
}) {
  const { project } = useServices();
  const [items, setItems] = useState<Node[]>([]);

  const refresh = () => project.listProjects().then(setItems);
  useEffect(() => {
    refresh();
  }, [revision]);

  async function create() {
    const p = await project.createProject('新项目', new Date().toISOString());
    await refresh();
    onSelect(p.id);
  }

  async function duplicate(id: string) {
    const source = items.find(item => item.id === id);
    const p = await project.duplicateProject(id, `${source?.title ?? '项目'}（副本）`, new Date().toISOString());
    await refresh();
    onSelect(p.id);
  }

  async function remove(id: string) {
    if (!confirm('删除该项目？不可恢复。')) return;
    if (id === selectedId) onSelect(null);
    await project.deleteProject(id);
    await refresh();
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <span className="logo-mark" />
          <span className="sidebar-title-text">备忘录</span>
        </div>
        <div className="sidebar-sub">按项目，记下每一步</div>
        <div className="sidebar-section-label">我的项目</div>
        <button className="btn-seal" onClick={create}>＋ 新建项目</button>
      </div>
      <div className="project-list">
        {items.map((p) => (
          <div
            key={p.id}
            className={`project-item ${p.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(p.id)}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(p.id); }}
          >
            <span className="project-name">{p.title}</span>
            <span className="project-actions">
              <button
                className="icon-btn"
                title="复制项目当模板"
                onClick={(e) => {
                  e.stopPropagation();
                  duplicate(p.id);
                }}
              >
                复制
              </button>
              <button
                className="icon-btn danger"
                title="删除项目"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(p.id);
                }}
              >
                删除
              </button>
            </span>
          </div>
        ))}
        {items.length === 0 && <div className="sidebar-empty">还没有项目</div>}
      </div>
      <div className="sidebar-recurring">
        <button className={`recurring-nav ${selectedId === RECURRING_PROJECT_ID ? 'active' : ''}`} onClick={() => onSelect(RECURRING_PROJECT_ID)}>↻ <span>定期事项</span></button>
      </div>
      <div className="sidebar-system">
        <button className={`recurring-nav ${selectedId === SYSTEM_SETTINGS_ID ? 'active' : ''}`} onClick={() => onSelect(SYSTEM_SETTINGS_ID)}>⚙ <span>系统设置</span></button>
      </div>
    </aside>
  );
}
