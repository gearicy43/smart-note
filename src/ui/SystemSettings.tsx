import { DeadlineSettings, defaultDeadlineSettings } from '../domain/deadline';

export const SYSTEM_SETTINGS_ID = 'smart-note:settings';

export function SystemSettings({ settings, onChange }: { settings: DeadlineSettings; onChange: (settings: DeadlineSettings) => void }) {
  return <div className="ptree settings-page">
    <div className="ph"><h1 className="ph-title">系统设置</h1><p className="ph-description">设置截止提醒的时间范围与颜色。更改会立即应用到所有项目和定期事项。</p></div>
    <section className="settings-card">
      <h2>截止提醒</h2>
      <p>临近截止日期时高亮事项；已完成的事项始终显示完成颜色。</p>
      <div className="settings-row">
        <span className="settings-swatch" style={{ background: settings.deepColor }} />
        <label htmlFor="deep-days">紧急提醒</label>
        <span>截止前</span>
        <input id="deep-days" type="number" min="0" max="365" value={settings.deepDays} onChange={e => {
          const deepDays = Math.max(0, Math.min(365, Number(e.target.value) || 0));
          onChange({ ...settings, deepDays, lightDays: Math.max(deepDays, settings.lightDays) });
        }} />
        <span>天内</span>
        <input type="color" aria-label="紧急提醒颜色" value={settings.deepColor} onChange={e => onChange({ ...settings, deepColor: e.target.value })} />
      </div>
      <div className="settings-row">
        <span className="settings-swatch" style={{ background: settings.lightColor }} />
        <label htmlFor="light-days">提前提醒</label>
        <span>截止前</span>
        <input id="light-days" type="number" min={settings.deepDays} max="365" value={settings.lightDays} onChange={e => onChange({ ...settings, lightDays: Math.max(settings.deepDays, Math.min(365, Number(e.target.value) || 0)) })} />
        <span>天内</span>
        <input type="color" aria-label="提前提醒颜色" value={settings.lightColor} onChange={e => onChange({ ...settings, lightColor: e.target.value })} />
      </div>
      <div className="settings-row">
        <span className="settings-swatch" style={{ background: settings.doneColor }} />
        <label>已完成</label>
        <span>显示完成颜色</span>
        <input type="color" aria-label="完成颜色" value={settings.doneColor} onChange={e => onChange({ ...settings, doneColor: e.target.value })} />
      </div>
      <button className="btn-ghost settings-reset" onClick={() => onChange(defaultDeadlineSettings)}>恢复默认</button>
    </section>
  </div>;
}
