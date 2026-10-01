export interface DeadlineSettings { deepDays: number; lightDays: number; deepColor: string; lightColor: string; doneColor: string }
export const defaultDeadlineSettings: DeadlineSettings = { deepDays: 2, lightDays: 3, deepColor: '#963b3d', lightColor: '#d9918f', doneColor: '#61a775' };

export function deadlineTone(date: string | null, completed: boolean, today: string, settings: DeadlineSettings): 'done' | 'deep' | 'light' | 'normal' {
  if (completed) return 'done';
  if (!date) return 'normal';
  const days = Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days <= settings.deepDays) return 'deep';
  if (days <= settings.lightDays) return 'light';
  return 'normal';
}

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
