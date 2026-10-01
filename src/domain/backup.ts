import type { Node, NodeTimeMode, RepeatRule } from './node';
import type { DeadlineSettings } from './deadline';
import { validateTree } from './validate';

export type CalendarView = 'items' | 'projects';
export interface BackupFile {
  version: 1;
  exportedAt: string;
  nodes: Node[];
  settings: DeadlineSettings;
  calendarView: CalendarView;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const nullableString = (value: unknown) => value === null || typeof value === 'string';

function isNode(value: unknown): value is Node {
  if (!object(value)) return false;
  return typeof value.id === 'string' && typeof value.projectId === 'string' && nullableString(value.parentId)
    && typeof value.title === 'string' && typeof value.sortOrder === 'number'
    && ['auto', 'manual'].includes(value.nodeTimeMode as NodeTimeMode) && nullableString(value.nodeTime)
    && nullableString(value.completedAt) && nullableString(value.progressNote)
    && (value.deletedAt === undefined || nullableString(value.deletedAt))
    && (value.description === undefined || nullableString(value.description))
    && (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every(tag => typeof tag === 'string')))
    && ['none', 'weekly', 'monthly'].includes(value.repeatRule as RepeatRule) && nullableString(value.repeatAnchor)
    && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}

function isSettings(value: unknown): value is DeadlineSettings {
  if (!object(value)) return false;
  return ['deepDays', 'lightDays'].every(key => Number.isFinite(value[key]) && Number(value[key]) >= 0)
    && ['deepColor', 'lightColor', 'doneColor'].every(key => typeof value[key] === 'string' && /^#[0-9a-f]{6}$/i.test(value[key] as string));
}

export function createBackup(nodes: Node[], settings: DeadlineSettings, calendarView: CalendarView): BackupFile {
  return { version: 1, exportedAt: new Date().toISOString(), nodes, settings, calendarView };
}

export function parseBackup(text: string): BackupFile {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('备份文件不是有效的 JSON'); }
  if (!object(value) || value.version !== 1 || typeof value.exportedAt !== 'string'
    || !Array.isArray(value.nodes) || !value.nodes.every(isNode) || !isSettings(value.settings)
    || !['items', 'projects'].includes(value.calendarView as string)) {
    throw new Error('备份文件格式不正确或版本不受支持');
  }
  if (new Set(value.nodes.map(node => node.id)).size !== value.nodes.length) throw new Error('备份中存在重复内容');
  const projects = new Map<string, Node[]>();
  for (const node of value.nodes) projects.set(node.projectId, [...(projects.get(node.projectId) ?? []), node]);
  for (const nodes of projects.values()) {
    if (validateTree(nodes).length) throw new Error('备份中的项目结构不完整');
  }
  return value as unknown as BackupFile;
}
