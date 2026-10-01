import { useState } from 'react';
import { ProjectList } from './ui/ProjectList';
import { ProjectTree } from './ui/ProjectTree';
import { RecurringList } from './ui/RecurringList';
import { SystemSettings, SYSTEM_SETTINGS_ID } from './ui/SystemSettings';
import { RECURRING_PROJECT_ID } from './service/projectService';
import { DeadlineSettings, defaultDeadlineSettings } from './domain/deadline';

export function App() {
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState<DeadlineSettings>(() => {
    try { return { ...defaultDeadlineSettings, ...JSON.parse(localStorage.getItem('smart-note.deadline-settings') ?? '{}') }; }
    catch { return defaultDeadlineSettings; }
  });
  const changeSettings = (next: DeadlineSettings) => {
    setSettings(next);
    localStorage.setItem('smart-note.deadline-settings', JSON.stringify(next));
  };
  const changed = () => setRevision(value => value + 1);
  return (
    <div className="app" style={{ '--deadline-deep': settings.deepColor, '--deadline-light': settings.lightColor, '--deadline-done': settings.doneColor } as React.CSSProperties}>
        <ProjectList selectedId={selected} onSelect={setSelected} revision={revision} />
        <main className="main">
          {selected === SYSTEM_SETTINGS_ID ? (
            <SystemSettings settings={settings} onChange={changeSettings} />
          ) : selected === RECURRING_PROJECT_ID ? (
            <RecurringList settings={settings} />
          ) : selected ? (
            <ProjectTree key={selected} projectId={selected} settings={settings} onDeleted={() => { setSelected(null); changed(); }} onChanged={changed} onDuplicated={id => { changed(); setSelected(id); }} />
          ) : (
            <div className="empty-state">
              <div className="empty-icon">✎</div>
              <div className="empty-text">选择项目，开始记录你的事项</div>
            </div>
          )}
        </main>
    </div>
  );
}
