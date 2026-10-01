import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Picker, ScrollView, Text, Textarea, View } from '@tarojs/components';
import { Tree } from '../../domain/tree';
import { calendarDays, projectCalendarEntries, shiftMonth } from '../../domain/calendar';
import type { CalendarEntry } from '../../domain/calendar';
import type { Node, RepeatRule } from '../../domain/node';
import { effectiveCompletedAt, effectiveNodeTime, progress } from '../../domain/aggregate';
import { deadlineTone, defaultDeadlineSettings, localToday } from '../../domain/deadline';
import type { DeadlineSettings } from '../../domain/deadline';
import { createBackup, parseBackup } from '../../domain/backup';
import type { CalendarView } from '../../domain/backup';
import { RECURRING_PROJECT_ID } from '../../service/projectService';
import { services } from '../../platform/taro';

const SETTINGS_KEY = 'smart-note.deadline-settings';
const CALENDAR_VIEW_KEY = 'smart-note.calendar-view';
type PageKey = 'projects' | 'calendar' | 'recurring' | 'settings';
type ProjectFilter = 'active' | 'completed' | 'trash';
// 抽屉栈：showProject 表示栈底是不是「项目详情」，path 是叠在它上面的节点路径。
// 从项目列表直接点事项/子项时 showProject=false，关掉就回到列表，不会绕进项目详情。
type SheetState = { projectId: string; path: string[]; showProject: boolean };

// Taro 的 H5 路由会在浏览器前进/后退时重建页面组件，把视图状态放在模块里才能扛住这次重建。
const viewStore = {
  page: 'projects' as PageKey,
  sheet: null as SheetState | null,
  projectFilter: 'active' as ProjectFilter,
  itemPath: [] as { id: string; projectId: string }[],
  sheetDepth: 0,
  scrollY: 0,
};

const stepBack = (state: SheetState | null): SheetState | null => {
  if (!state) return null;
  if (!state.path.length) return null;
  const path = state.path.slice(0, -1);
  return path.length === 0 && !state.showProject ? null : { ...state, path };
};
const now = () => new Date().toISOString();
const date = (value: string | null) => value?.slice(0, 10) ?? '';
const shortDate = (value: string | null) => date(value).slice(5);

async function saveBackupFile(name: string, content: string) {
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEB) {
    const path = `${Taro.env.USER_DATA_PATH}/${name}`;
    Taro.getFileSystemManager().writeFileSync(path, content, 'utf8');
    await Taro.shareFileMessage({ filePath: path, fileName: name });
    return;
  }
  const file = new File([content], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: '备忘录备份' });
  else {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file); link.download = file.name; link.click();
    URL.revokeObjectURL(link.href);
  }
}

async function chooseBackupFile(): Promise<string> {
  if (Taro.getEnv() !== Taro.ENV_TYPE.WEB) {
    const result = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['json'] });
    return String(Taro.getFileSystemManager().readFileSync(result.tempFiles[0].path, 'utf8'));
  }
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => { if (input.files?.[0]) resolve(await input.files[0].text()); };
    input.click();
  });
}

async function confirmAction(title: string, content: string, confirmText = '删除', confirmColor = '#a94040') {
  return (await Taro.showModal({ title, content, cancelText: '取消', confirmText, confirmColor })).confirm;
}

/**
 * 完成 / 取消完成一个节点，点一个圈 = 完成 / 取消完成一整支任务。
 * 完成状态只有一个来源：叶子节点存自己的状态，父级由叶子算出来。
 * 所以这里只写叶子——节点自己就是叶子时只改它自己，是父级（事项 / 项目）就批量改它的后代叶子，
 * 父级的状态再由这些叶子重新算出来。
 */
async function setCompletion(node: Node, completed: boolean, refresh?: () => void): Promise<void> {
  await services.node.setSubtreeCompletion(node.id, completed, now());
  refresh?.();
}

async function confirmDelete(title: string, hint: string) {
  return confirmAction(`删除“${title}”？`, hint);
}

/** 垃圾桶里的永久删除，必须二次确认。 */
async function confirmPurge(title: string) {
  return confirmAction(`彻底删除“${title}”？`, '项目及其中的事项和子项将被永久删除，且无法恢复。', '彻底删除');
}

async function confirmEmptyTrash() {
  return confirmAction('清空垃圾桶？', '垃圾桶中的所有项目及其内容将被永久删除，且无法恢复。', '清空');
}

type MenuAction = { label: string; danger?: boolean; run: () => void };

/** 低频管理操作统一收进右上角 ··· 弹出的菜单。 */
function SheetMenu({ title, actions, onClose }: { title: string; actions: MenuAction[]; onClose: () => void }) {
  return <View className='sheet-backdrop' onClick={event => { event.stopPropagation(); onClose(); }}>
    <View className='action-sheet' onClick={event => event.stopPropagation()}>
      <Text className='action-title'>{title}</Text>
      {actions.map(action => <View key={action.label} className={`action-row ${action.danger ? 'action-row-danger' : ''}`} onClick={event => { event.stopPropagation(); onClose(); action.run(); }}><Text>{action.label}</Text></View>)}
    </View>
  </View>;
}

// Taro 的 H5 路由会在浏览器返回时重建页面，React 里注册的监听会被一起解绑，
// 所以 popstate 监听放在模块作用域只注册一次，并直接改模块状态。
const sheetHandlers: (() => void)[] = [];
if (typeof window !== 'undefined' && Taro.getEnv() === Taro.ENV_TYPE.WEB) {
  window.addEventListener('popstate', () => {
    if (viewStore.sheetDepth <= 0) return;
    viewStore.sheetDepth -= 1;
    viewStore.sheet = stepBack(viewStore.sheet);
    viewStore.itemPath = viewStore.itemPath.slice(0, -1);
    if (sheetHandlers.length) sheetHandlers[sheetHandlers.length - 1]();
  });
}

function useSheetHistory(depth: number, goBack: () => void) {
  const handler = useRef(goBack);
  handler.current = goBack;
  const web = Taro.getEnv() === Taro.ENV_TYPE.WEB;
  useEffect(() => {
    if (!web) return;
    const entry = () => handler.current();
    sheetHandlers.push(entry);
    return () => { const at = sheetHandlers.indexOf(entry); if (at >= 0) sheetHandlers.splice(at, 1); };
  }, [web]);
  useEffect(() => {
    if (!web || typeof window === 'undefined') return;
    if (depth > viewStore.sheetDepth) {
      window.history.pushState({ ...window.history.state, snSheetDepth: depth }, '');
      viewStore.sheetDepth = depth;
    } else if (depth < viewStore.sheetDepth) viewStore.sheetDepth = depth;
  }, [depth, web]);
}

type DragTouch = { touches?: { clientX?: number; clientY?: number }[]; detail?: { touches?: { clientX?: number; clientY?: number }[] } };

// H5 把原生事件直接透传，小程序放在 detail 里，两边都读一下。
const touchY = (event: DragTouch) => event.touches?.[0]?.clientY ?? event.detail?.touches?.[0]?.clientY ?? null;
const touchX = (event: DragTouch) => event.touches?.[0]?.clientX ?? event.detail?.touches?.[0]?.clientX ?? null;

// 刚左滑完会带出一次 click，用它挡掉误触（打开详情、切换完成等）。
let swipeGuardUntil = 0;
const swipeBlocked = () => Date.now() < swipeGuardUntil;
const tap = (run: (event: any) => void) => (event: any) => { if (!swipeBlocked()) run(event); };

const SWIPE_DESIGN = () => (typeof window !== 'undefined' && window.innerWidth > 600 ? 152 : 192);

// 样式里的 px 在 H5 会被换算成 rem，小程序里是 rpx，所以滑动距离得按同样的比例换算，
// 优先量真实按钮宽度，量不到再退回设计稿比例。
function swipeReveal(row?: any): number {
  const design = SWIPE_DESIGN();
  const measured = row?.querySelector?.('.swipe-actions')?.getBoundingClientRect?.().width;
  if (measured) return measured;
  if (typeof document !== 'undefined') {
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    if (Number.isFinite(root) && root > 0) return design * (root / 40);
  }
  const width = Taro.getWindowInfo?.().windowWidth;
  return width ? design * (width / 750) : design;
}

/** 列表 / 详情行左滑露出的快捷操作；一次只展开一行。 */
function SwipeRow({ id, openId, setOpenId, actions, children }: {
  id: string; openId: string | null; setOpenId: (id: string | null) => void;
  actions: MenuAction[]; children: React.ReactNode;
}) {
  const open = openId === id;
  const [drag, setDrag] = useState<number | null>(null);
  const startX = useRef<number | null>(null);
  const reveal = useRef(SWIPE_DESIGN());
  const rowRef = useRef<any>(null);
  const base = open ? -reveal.current : 0;
  const offset = drag ?? base;
  const handlers = {
    onTouchStart: (event: any) => { const x = touchX(event as DragTouch); if (x == null) return; reveal.current = swipeReveal(rowRef.current); startX.current = x; setDrag(base); },
    onTouchMove: (event: any) => {
      const x = touchX(event as DragTouch);
      if (startX.current == null || x == null) return;
      setDrag(Math.max(-reveal.current, Math.min(0, base + x - startX.current)));
    },
    onTouchEnd: () => {
      if (startX.current == null) return;
      const moved = drag ?? base;
      startX.current = null;
      setDrag(null);
      if (Math.abs(moved - base) > 8) swipeGuardUntil = Date.now() + 400;
      setOpenId(moved <= -reveal.current / 3 ? id : null);
    },
  };
  return <View className='swipe-row' ref={rowRef}>
    <View className='swipe-actions'>
      {actions.map(action => <Text key={action.label} className={`swipe-action ${action.danger ? 'swipe-action-danger' : ''}`} onClick={() => { setOpenId(null); action.run(); }}>{action.label}</Text>)}
    </View>
    <View className={`swipe-content ${drag != null ? 'dragging' : ''}`} style={offset ? { transform: `translateX(${offset}px)` } : undefined} {...handlers}>{children}</View>
  </View>;
}

const copyDeleteActions = (node: Node, copy: (node: Node) => void, remove: (node: Node) => void): MenuAction[] => [
  { label: '复制', run: () => copy(node) },
  { label: '删除', danger: true, run: () => remove(node) },
];

type SwipeConfig = { openId: string | null; setOpenId: (id: string | null) => void; actions: (item: Node) => MenuAction[] };

/** Bottom sheets share one affordance: drag the grab bar down to dismiss. */
function useSheetDrag(close: () => void) {
  const [offset, setOffset] = useState(0);
  const startY = useRef<number | null>(null);
  const props: { onTouchStart: (event: any) => void; onTouchMove: (event: any) => void; onTouchEnd: () => void } = {
    onTouchStart: event => { startY.current = touchY(event as DragTouch); },
    onTouchMove: event => {
      const y = touchY(event as DragTouch);
      if (startY.current != null && typeof y === 'number') setOffset(Math.max(0, y - startY.current));
    },
    onTouchEnd: () => {
      const moved = offset;
      startY.current = null;
      setOffset(0);
      if (moved > 90) close();
    },
  };
  return { style: offset ? { transform: `translateY(${offset}px)` } : undefined, props };
}

function useScrollRestore() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const scroller = document.querySelector('.taro_page');
    if (!scroller) return;
    const save = () => { viewStore.scrollY = scroller.scrollTop; };
    scroller.addEventListener('scroll', save, { passive: true });
    const timers = [0, 150, 400].map(delay => setTimeout(() => {
      if (viewStore.scrollY > 0 && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop = viewStore.scrollY;
    }, delay));
    return () => { timers.forEach(clearTimeout); scroller.removeEventListener('scroll', save); };
  }, []);
}

function DateField({ value, onChange, label = '选择日期', onClear }: {
  value: string | null;
  onChange?: (value: string) => void;
  label?: string;
  onClear?: () => void;
}) {
  return <View className='date-field'>
    {onChange ? <Picker mode='date' value={date(value) || localToday()} onChange={event => onChange(event.detail.value)}>
      <Text className='date-button'>{shortDate(value) || label}</Text>
    </Picker> : <Text className='date-button'>{shortDate(value) || '—'}</Text>}
    {value && onClear && <Text className='date-clear' onClick={onClear}>清除</Text>}
  </View>;
}

type Attribute = 'description' | 'tags' | 'progressNote';

function NodeAttributes({ item, due, completed, update, changeDue, clearDue, changeCompleted }: {
  item: Node;
  due: string | null;
  completed: string | null;
  update: (patch: Parameters<typeof services.node.updateNode>[1]) => void | Promise<void>;
  changeDue: (value: string) => void;
  clearDue?: () => void;
  changeCompleted?: (value: string) => void;
}) {
  const [editing, setEditing] = useState<Attribute | null>(null);
  const [draft, setDraft] = useState('');
  function open(attribute: Attribute) {
    setDraft(attribute === 'tags' ? (item.tags ?? []).join('、') : item[attribute] ?? '');
    setEditing(attribute);
  }
  async function save() {
    if (!editing) return;
    const patch = editing === 'tags'
      ? { tags: [...new Set(draft.split(/[，,、]/).map(tag => tag.trim()).filter(Boolean))] }
      : { [editing]: draft.trim() || null };
    await update(patch);
    setEditing(null);
  }
  return <View className='attributes'>
    {item.description && <Text className='attribute-line' onClick={() => open('description')}>≡ {item.description}</Text>}
    {!!item.tags?.length && <View className='attribute-line' onClick={() => open('tags')}><Text>◇ </Text>{item.tags.map(tag => <Text className='attribute-tag' key={tag}>#{tag}</Text>)}</View>}
    {due && <View className='attribute-line'><Text className='mini-icon'>▦</Text><DateField value={due} onChange={changeDue} onClear={clearDue} /></View>}
    {item.progressNote && <Text className='attribute-line' onClick={() => open('progressNote')}>↗ {item.progressNote}</Text>}
    {completed && <View className='attribute-line'><Text className='mini-icon'>✓</Text>{changeCompleted ? <DateField value={completed} onChange={changeCompleted} /> : <Text>{shortDate(completed)}</Text>}</View>}
    <View className='attribute-actions'>
      {!item.description && <View className='attribute-pill' onClick={() => open('description')}><Text>≡ 描述</Text></View>}
      {!item.tags?.length && <View className='attribute-pill' onClick={() => open('tags')}><Text>◇ 标签</Text></View>}
      {!due && <View className='attribute-pill'><DateField value={null} label='▦ 截止' onChange={changeDue} /></View>}
      {!item.progressNote && <View className='attribute-pill' onClick={() => open('progressNote')}><Text>↗ 进展</Text></View>}
    </View>
    {editing && <View className='attribute-edit'>
      {editing === 'description' ? <Textarea className='optional-input' value={draft} placeholder='添加描述' autoHeight onInput={e => setDraft(e.detail.value)} /> : <Input className='optional-input' value={draft} placeholder={editing === 'tags' ? '输入标签，用逗号分隔' : '记录进展'} onInput={e => setDraft(e.detail.value)} onConfirm={save} />}
      <View className='attribute-edit-actions'><Text onClick={() => setEditing(null)}>取消</Text><Text onClick={save}>保存</Text></View>
    </View>}
  </View>;
}

function ItemRow({ title, description, metadata, metadataColor, completed, accessory = '›', onOpen, onCheck, onAccessory, className = '' }: {
  title: string; description?: string | null; metadata?: string; metadataColor?: string; completed?: boolean;
  accessory?: string; onOpen: () => void; onCheck?: () => void; onAccessory?: () => void; className?: string;
}) {
  return <View className={`item-row ${className}`} onClick={onOpen}>
    <Text className={`item-check ${completed ? 'done' : ''}`} onClick={event => { if (onCheck) { event.stopPropagation(); onCheck(); } }}>{completed ? '✓' : '○'}</Text>
    <View className={`item-content ${completed ? 'done' : ''}`}><Text className={`item-title ${completed ? 'done' : ''}`}>{title}</Text>{description && <Text className='item-description'>{description}</Text>}{metadata && <Text className='item-metadata' style={metadataColor ? { color: metadataColor } : undefined}>{metadata}</Text>}</View>
    <Text className='item-accessory' onClick={event => { if (onAccessory) { event.stopPropagation(); onAccessory(); } }}>{accessory}</Text>
  </View>;
}

function TaskRow({ item, tree, depth, settings, refresh, open, swipe }: {
  item: Node;
  tree: Tree;
  depth: number;
  settings: DeadlineSettings;
  refresh: () => void;
  open: (id: string) => void;
  swipe?: SwipeConfig;
}) {
  const children = tree.childrenOf(item.id);
  const group = children.length > 0;
  const deadline = effectiveNodeTime(item, tree);
  const completedAt = effectiveCompletedAt(item, tree);
  const completed = !!completedAt;
  const count = progress(item, tree);
  const tone = deadlineTone(deadline, !!completedAt, localToday(), settings);
  const [expanded, setExpanded] = useState(true);

  const row = <ItemRow title={item.title} description={item.description} metadata={[group ? `${count.done}/${count.total}` : '', deadline ? shortDate(deadline) : '', completedAt ? `✓ ${shortDate(completedAt)}` : '', ...(item.tags ?? []).map(tag => `#${tag}`)].filter(Boolean).join(' · ')} metadataColor={completed ? undefined : tone === 'deep' ? settings.deepColor : tone === 'light' ? settings.lightColor : tone === 'done' ? settings.doneColor : undefined} completed={completed} accessory={group ? expanded ? '⌄' : '›' : '›'} onOpen={() => open(item.id)} onAccessory={group ? () => setExpanded(!expanded) : undefined} onCheck={() => setCompletion(item, !completed, refresh)} />;
  return <View className={`task task-${tone}`} style={{ marginLeft: `${depth * 14}px` }}>
    {swipe ? <SwipeRow id={item.id} openId={swipe.openId} setOpenId={swipe.setOpenId} actions={swipe.actions(item)}>{row}</SwipeRow> : row}
    {group && expanded && <View className='children'>{children.map(child => <TaskRow key={child.id} item={child} tree={tree} depth={depth + 1} settings={settings} refresh={refresh} open={open} swipe={swipe} />)}</View>}
  </View>;
}

function TaskSheet({ item, tree, settings, refresh, goTo, back, close }: { item: Node; tree: Tree; settings: DeadlineSettings; refresh: () => void; goTo: (id: string) => void; back: () => void; close: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [swipeId, setSwipeId] = useState<string | null>(null);
  useEffect(() => { setTitle(item.title); setDraft(''); }, [item.id, item.title]);
  const children = tree.childrenOf(item.id);
  const parent = item.parentId ? tree.get(item.parentId) : undefined;
  const deadline = effectiveNodeTime(item, tree);
  const completedAt = effectiveCompletedAt(item, tree);
  const completed = !!completedAt;
  const count = progress(item, tree);
  async function update(patch: Parameters<typeof services.node.updateNode>[1]) { await services.node.updateNode(item.id, patch, now()); refresh(); }
  async function commitTitle() {
    const next = title.trim();
    if (next && next !== item.title) await update({ title: next });
    else if (!next) setTitle(item.title);
  }
  async function goBack() { await commitTitle(); back(); }
  async function dismiss() { await commitTitle(); close(); }
  async function add() {
    if (!draft.trim()) return;
    await services.node.createNode({ projectId: item.projectId, parentId: item.id, title: draft.trim(), now: now() });
    setDraft(''); refresh();
  }
  async function copyItem() { await services.node.duplicateNode(item.id, now()); refresh(); }
  async function removeItem() {
    const hint = children.length ? '删除后将同时删除其下的所有子项，此操作不可撤销。' : '此操作不可撤销。';
    if (!await confirmDelete(item.title, hint)) return;
    await services.node.deleteNode(item.id); refresh(); close();
  }
  // 子项列表和项目详情里的规则一样：左滑 = 复制 / 删除。
  const swipe: SwipeConfig = { openId: swipeId, setOpenId: setSwipeId, actions: child => copyDeleteActions(child, async node => { await services.node.duplicateNode(node.id, now()); refresh(); }, async node => {
    const hint = tree.childrenOf(node.id).length ? '删除后将同时删除其下的所有子项，此操作不可撤销。' : '此操作不可撤销。';
    if (!await confirmDelete(node.title, hint)) return;
    await services.node.deleteNode(node.id); refresh();
  }) };
  const drag = useSheetDrag(dismiss);
  return <View className='sheet-backdrop' onClick={dismiss}>
    <View className='task-sheet' style={drag.style} onClick={event => event.stopPropagation()}>
      <View className='sheet-grab' {...drag.props}><View className='sheet-handle' /></View>
      <View className='sheet-nav'>
        <Text className='sheet-nav-back' onClick={goBack}>‹ 返回</Text>
        <Text className='sheet-nav-title'>{item.parentId === item.projectId ? '事项详情' : '子项详情'}</Text>
        <View className='sheet-nav-actions'>
          <Text className='sheet-nav-more' onClick={() => setMenuOpen(true)}>···</Text>
          <Text className='sheet-nav-done' onClick={dismiss}>关闭</Text>
        </View>
      </View>
      <ScrollView className='sheet-scroll' scrollY onClick={() => { if (!swipeBlocked()) setSwipeId(null); }}>
        <View className='sheet-title-row'><Text className={`check ${completed ? 'done' : ''}`} onClick={() => setCompletion(item, !completed, refresh)}>{completed ? '✓' : '○'}</Text><Input className={`sheet-title ${completed ? 'done' : ''}`} value={title} onInput={e => setTitle(e.detail.value)} onBlur={() => { if (title.trim() && title.trim() !== item.title) update({ title: title.trim() }); else setTitle(item.title); }} /></View>
        {parent && <Text className='sheet-parent' onClick={() => parent.parentId ? goTo(parent.id) : close()}>↳ {parent.title}</Text>}
        <NodeAttributes key={item.id} item={item} due={deadline} completed={completedAt} update={update} changeDue={value => update(children.length ? { nodeTime: value, nodeTimeMode: 'manual' } : { nodeTime: value })} clearDue={deadline && (!children.length || item.nodeTimeMode === 'manual') ? () => update(children.length ? { nodeTime: null, nodeTimeMode: 'auto' } : { nodeTime: null }) : undefined} changeCompleted={children.length ? undefined : async value => { await services.node.markComplete(item.id, true, `${value}T00:00:00.000Z`); refresh(); }} />
        {item.projectId !== RECURRING_PROJECT_ID && <><View className='sheet-section-title'>子项 {children.length ? `${count.done}/${count.total}` : ''}</View>
          {children.map(child => <TaskRow key={child.id} item={child} tree={tree} depth={0} settings={settings} refresh={refresh} open={goTo} swipe={swipe} />)}
          <View className='add-line sheet-add'><Input value={draft} placeholder='添加子项' onInput={e => setDraft(e.detail.value)} onConfirm={add} /><Text className='add-icon' onClick={add}>＋</Text></View></>}
      </ScrollView>
    </View>
    {menuOpen && <SheetMenu title={item.title} onClose={() => setMenuOpen(false)} actions={[{ label: '复制事项', run: copyItem }, { label: '删除事项', danger: true, run: removeItem }]} />}
  </View>;
}

function ProjectSheet({ root, path, settings, refresh, openProject, onRestore, close, goTo, back, closeNode }: {
  root: Node; path: string[]; settings: DeadlineSettings; refresh: () => void;
  openProject: (id: string) => void; onRestore: (target: ProjectFilter) => void; close: () => void;
  goTo: (id: string) => void; back: () => void; closeNode: () => void;
}) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [title, setTitle] = useState(root.title);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [swipeId, setSwipeId] = useState<string | null>(null);
  const selectedTask = path.length ? path[path.length - 1] : null;
  const load = useCallback(() => services.project.loadTree(root.id).then(setNodes), [root.id]);
  useEffect(() => { setTitle(root.title); load(); }, [root.id, root.title, load]);
  const tree = nodes.length ? new Tree(nodes) : null;
  const children = tree?.childrenOf(root.id) ?? [];
  const count = tree ? progress(root, tree) : { done: 0, total: 0 };
  const completed = tree ? effectiveCompletedAt(root, tree) : root.completedAt;
  const rootCompleted = !!completed;

  async function reload() { await load(); refresh(); }
  // 「返回」和「关闭」都是先落盘再退出，区别只在语义：关闭 = 本次编辑结束。
  async function finish() {
    const next = title.trim();
    if (next && next !== root.title) {
      await services.node.updateNode(root.id, { title: next }, now());
      // 列表 / 日历等外层展示的是另一份状态，落盘后要同步刷新。
      refresh();
    } else if (!next) setTitle(root.title);
    close();
  }
  async function add() {
    if (!draft.trim()) return;
    await services.node.createNode({ projectId: root.id, parentId: root.id, title: draft.trim(), now: now() });
    setDraft(''); reload();
  }
  async function update(patch: Parameters<typeof services.node.updateNode>[1]) { await services.node.updateNode(root.id, patch, now()); reload(); }
  // 点项目圆圈 = 全部完成 / 取消整个项目完成：直接批量写下面的叶子，项目状态再算出来。
  // 所以项目最上面的 ○ 就是天然的「全部完成」按钮，不需要再单独设计一个。
  async function toggleProjectCompleted() {
    const wasCompleted = rootCompleted;
    await setCompletion(root, !wasCompleted);
    refresh();
    if (wasCompleted) onRestore('active'); else close();
  }
  async function copyProject() {
    const copy = await services.project.duplicateProject(root.id, `${root.title}（副本）`, now());
    refresh(); openProject(copy.id);
  }
  async function removeProject() {
    if (!await confirmDelete(root.title, '项目将移入垃圾桶，可以随时恢复。')) return;
    await services.project.deleteProject(root.id, now()); refresh(); close();
  }
  async function restoreProject() {
    await services.project.restoreProject(root.id, now());
    refresh();
    // 恢复到删除前的分组，用户马上能看到它。
    onRestore(rootCompleted ? 'completed' : 'active');
  }
  async function purgeProject() {
    if (!await confirmPurge(root.title)) return;
    await services.project.purgeProject(root.id); refresh(); close();
  }
  // 项目详情里的事项 / 子项左滑规则和列表页一致。
  const swipe: SwipeConfig = { openId: swipeId, setOpenId: setSwipeId, actions: item => copyDeleteActions(item, async node => { await services.node.duplicateNode(node.id, now()); reload(); }, async node => {
    const hint = tree?.childrenOf(node.id).length ? '删除后将同时删除其下的所有子项，此操作不可撤销。' : '此操作不可撤销。';
    if (!await confirmDelete(node.title, hint)) return;
    await services.node.deleteNode(node.id); reload();
  }) };

  const drag = useSheetDrag(finish);
  return <View className='sheet-backdrop' onClick={finish}>
    <View className='task-sheet project-sheet' style={drag.style} onClick={event => event.stopPropagation()}>
    <View className='sheet-grab' {...drag.props}><View className='sheet-handle' /></View>
    <View className='sheet-nav'>
      <Text className='sheet-nav-back' onClick={finish}>‹ 返回</Text>
      <Text className='sheet-nav-title'>项目详情</Text>
      <View className='sheet-nav-actions'><Text className='sheet-nav-more' onClick={() => setMenuOpen(true)}>···</Text><Text className='sheet-nav-done' onClick={finish}>关闭</Text></View>
    </View>
    <ScrollView className='sheet-scroll' scrollY onClick={() => { if (!swipeBlocked()) setSwipeId(null); }}>
    <View className='page-head'>{tree && <Text className={`root-check ${rootCompleted ? 'done' : ''}`} onClick={toggleProjectCompleted}>{rootCompleted ? '✓' : '○'}</Text>}<Input className={`page-title ${rootCompleted ? 'done' : ''}`} value={title} onInput={e => setTitle(e.detail.value)} onBlur={async () => { if (title.trim() && title.trim() !== root.title) { await services.node.updateNode(root.id, { title: title.trim() }, now()); refresh(); } }} />{children.length > 0 && <Text className='count'>{count.done}/{count.total} 完成</Text>}</View>
    <NodeAttributes item={root} due={root.nodeTime} completed={completed} update={update} changeDue={value => update({ nodeTime: value })} clearDue={root.nodeTime ? () => update({ nodeTime: null }) : undefined} changeCompleted={children.length ? undefined : value => { void services.node.markComplete(root.id, true, `${value}T00:00:00.000Z`).then(refresh); }} />
    <View className='section-title'>项目事项 {children.length ? `${count.done}/${count.total}` : ''}</View>
    <View className='add-line'><Input value={draft} placeholder='添加事项' onInput={e => setDraft(e.detail.value)} onConfirm={add} /><Text className='add-icon' onClick={add}>＋</Text></View>
    {children.length ? children.map(item => <TaskRow key={item.id} item={item} tree={tree!} depth={0} settings={settings} refresh={reload} open={goTo} swipe={swipe} />) : <View className='empty'>还没有事项，先添加一条吧</View>}
    </ScrollView>
    </View>
    {menuOpen && <SheetMenu title={root.title} onClose={() => setMenuOpen(false)} actions={root.deletedAt
      ? [{ label: '恢复项目', run: restoreProject }, { label: '彻底删除', danger: true, run: purgeProject }]
      : [{ label: '复制项目及全部子项', run: copyProject }, { label: '删除项目', danger: true, run: removeProject }]} />}
    {selectedTask && tree?.get(selectedTask) && <TaskSheet item={tree.get(selectedTask)!} tree={tree} settings={settings} refresh={reload} goTo={goTo} back={back} close={closeNode} />}
  </View>;
}

function RecurringPage({ settings }: { settings: DeadlineSettings }) {
  const [items, setItems] = useState<Node[]>([]);
  const [title, setTitle] = useState('');
  const [rule, setRule] = useState<Exclude<RepeatRule, 'none'>>('weekly');
  const [due, setDue] = useState(localToday());
  const refresh = useCallback(async () => { await services.project.ensureRecurringRoot(); setItems((await services.project.loadTree(RECURRING_PROJECT_ID)).filter(item => item.parentId === RECURRING_PROJECT_ID)); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const active = items.filter(item => !item.completedAt);
  const history = items.filter(item => !!item.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  async function add() {
    if (!title.trim()) return;
    await services.node.createNode({ projectId: RECURRING_PROJECT_ID, parentId: RECURRING_PROJECT_ID, title: title.trim(), nodeTime: due, repeatRule: rule, repeatAnchor: due, now: now() });
    setTitle(''); refresh();
  }
  return <View className='page'>
    <Text className='description'>独立于项目；完成后自动生成下一次。</Text>
    <View className='add-line'><Input value={title} placeholder='每周或每月要做的事' onInput={e => setTitle(e.detail.value)} onConfirm={add} /><Text onClick={add}>添加</Text></View>
    <View className='panel-row'><Text className='field-name'>重复</Text><Text className={rule === 'weekly' ? 'choice active' : 'choice'} onClick={() => setRule('weekly')}>每周</Text><Text className={rule === 'monthly' ? 'choice active' : 'choice'} onClick={() => setRule('monthly')}>每月</Text><Text className='field-name'>首次日期</Text><DateField value={due} onChange={setDue} /></View>
    <View className='section-title'>待完成 · {active.length}</View>
    {active.length ? active.map(item => <RecurringRow key={item.id} item={item} settings={settings} refresh={refresh} />) : <View className='empty'>还没有定期事项</View>}
    {history.length > 0 && <><View className='section-title'>完成记录 · {history.length}</View>{history.map(item => <RecurringRow key={item.id} item={item} settings={settings} refresh={refresh} />)}</>}
  </View>;
}

function RecurringRow({ item, settings, refresh }: { item: Node; settings: DeadlineSettings; refresh: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.progressNote ?? '');
  const [datesOpen, setDatesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setTitle(item.title); setNote(item.progressNote ?? ''); }, [item.title, item.progressNote]);
  const tone = deadlineTone(item.nodeTime, !!item.completedAt, localToday(), settings);
  async function update(patch: Parameters<typeof services.node.updateNode>[1]) { await services.node.updateNode(item.id, patch, now()); refresh(); }
  // 定期事项也走「右上角 ··· = 完整管理操作」，正文里不再单放一个红色删除。
  async function removeItem() {
    if (!await confirmDelete(item.title, '此操作不可撤销。')) return;
    await services.node.deleteNode(item.id); refresh();
  }
  return <View className={`task task-${tone}`} style={{ borderLeftColor: tone === 'deep' ? settings.deepColor : tone === 'light' ? settings.lightColor : tone === 'done' ? settings.doneColor : '#ddd8cd' }}>
    <View className='task-head'><Text className='check' onClick={async () => { if (!item.completedAt) { const patch = { title: title.trim() || item.title, progressNote: note.trim() || null }; await services.node.updateNode(item.id, patch, now()); await services.node.markComplete(item.id, true, now()); refresh(); } }}>{item.completedAt ? '✓' : '○'}</Text><Input className={`task-title ${item.completedAt ? 'done' : ''}`} value={title} disabled={!!item.completedAt} onInput={e => setTitle(e.detail.value)} onBlur={() => { if (title.trim() && title.trim() !== item.title) update({ title: title.trim() }); }} /><Text className='task-more' onClick={() => setMenuOpen(true)}>···</Text></View>
    <View className='date-toggle task-date-toggle' onClick={() => setDatesOpen(!datesOpen)}><Text className='mini-icon'>▦</Text><Text className='date-summary'>{shortDate(item.nodeTime) || '＋'}{item.completedAt ? `  ✓ ${shortDate(item.completedAt)}` : ''}</Text><Text>{datesOpen ? '⌄' : '›'}</Text></View>
    {datesOpen && <View className='task-details'><Text className='mini-icon'>▦</Text><DateField value={item.nodeTime} label='＋' onChange={item.completedAt ? undefined : value => update({ nodeTime: value, repeatAnchor: value })} />{item.completedAt && <><Text className='mini-icon'>✓</Text><Text className='field-value'>{shortDate(item.completedAt)}</Text></>}</View>}
    {!item.completedAt && <View className='task-details'><Text className='field-name'>重复</Text>{(['none', 'weekly', 'monthly'] as RepeatRule[]).map(rule => <Text key={rule} className={item.repeatRule === rule ? 'choice active' : 'choice'} onClick={() => update({ repeatRule: rule, repeatAnchor: item.nodeTime })}>{rule === 'none' ? '无' : rule === 'weekly' ? '每周' : '每月'}</Text>)}</View>}
    <View className='task-details'><Text className='field-name'>进展</Text>{item.completedAt ? <Text className='field-value'>{item.progressNote || '—'}</Text> : <Input className='note' value={note} placeholder='记录进展…' onInput={e => setNote(e.detail.value)} onBlur={() => { if (note !== (item.progressNote ?? '')) update({ progressNote: note.trim() || null }); }} />}</View>
    {menuOpen && <SheetMenu title={item.title} onClose={() => setMenuOpen(false)} actions={[{ label: '复制事项', run: async () => { await services.node.duplicateNode(item.id, now()); refresh(); } }, { label: '删除事项', danger: true, run: removeItem }]} />}
  </View>;
}

function CalendarPage({ projects, settings, view, setView, refreshProjects }: {
  projects: Node[];
  settings: DeadlineSettings;
  view: CalendarView;
  setView: (view: CalendarView) => void;
  refreshProjects: () => void;
}) {
  const [selectedDate, selectDate] = useState(localToday());
  const [month, setMonth] = useState(localToday().slice(0, 7));
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [trees, setTrees] = useState<Record<string, Node[]>>({});
  const [itemPath, setItemPath] = useState<{ id: string; projectId: string }[]>(viewStore.itemPath);
  const selectedItem = itemPath.length ? itemPath[itemPath.length - 1] : null;
  const updatePath = useCallback((updater: (path: { id: string; projectId: string }[]) => { id: string; projectId: string }[]) => {
    setItemPath(path => { const next = updater(path); viewStore.itemPath = next; return next; });
  }, []);
  const openItem = useCallback((id: string, projectId: string) => updatePath(() => [{ id, projectId }]), [updatePath]);
  const goToItem = useCallback((id: string) => updatePath(path => {
    const current = path[path.length - 1];
    if (!current) return path;
    const at = path.findIndex(entry => entry.id === id);
    return at >= 0 ? path.slice(0, at + 1) : [...path, { id, projectId: current.projectId }];
  }), [updatePath]);
  const backItem = useCallback(() => updatePath(path => path.slice(0, -1)), [updatePath]);
  const closeItem = useCallback(() => updatePath(() => []), [updatePath]);
  useSheetHistory(itemPath.length, backItem);
  const [revision, reload] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all(projects.map(project => services.project.loadTree(project.id))).then(async trees => {
      const recurring = await services.project.loadTree(RECURRING_PROJECT_ID);
      if (!active) return;
      setTrees({ ...Object.fromEntries(projects.map((project, index) => [project.id, trees[index]])), [RECURRING_PROJECT_ID]: recurring });
      const projectEntries = trees.flatMap((nodes, index) => projectCalendarEntries(projects[index], nodes));
      const recurringEntries: CalendarEntry[] = recurring.filter(item => item.parentId === RECURRING_PROJECT_ID && item.nodeTime).map(item => ({ id: item.id, projectId: RECURRING_PROJECT_ID, title: item.title, projectTitle: '定期事项', due: date(item.nodeTime), completed: !!item.completedAt, kind: 'recurring' }));
      setEntries([...projectEntries, ...recurringEntries]);
    });
    return () => { active = false; };
  }, [projects, revision]);
  const days = calendarDays(month);
  const daily = entries.filter(item => item.due === selectedDate);
  const groups = new Map<string, CalendarEntry[]>();
  for (const item of daily) {
    if (!groups.has(item.projectId)) groups.set(item.projectId, []);
    groups.get(item.projectId)!.push(item);
  }
  function changeMonth(offset: number) {
    const next = shiftMonth(month, offset);
    setMonth(next);
    selectDate(`${next}-01`);
  }
  return <View className='calendar-page'>
    <View className='calendar-head'><Text onClick={() => changeMonth(-1)}>‹</Text><Text>{month.slice(0, 4)} 年 {Number(month.slice(5))} 月</Text><Text onClick={() => changeMonth(1)}>›</Text></View>
    <View className='calendar-grid'>{['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map(day => <Text className='calendar-weekday' key={day}>{day}</Text>)}
      {days.map(day => {
        const items = entries.filter(item => item.due === day);
        return <View key={day} className={`calendar-day ${day.slice(0, 7) === month ? '' : 'outside'} ${day === selectedDate ? 'selected' : ''}`} onClick={() => { selectDate(day); if (day.slice(0, 7) !== month) setMonth(day.slice(0, 7)); }}><Text>{Number(day.slice(8))}</Text>{items.length > 0 && <View className={`calendar-dot ${items.every(item => item.completed) ? 'complete' : ''}`} style={{ backgroundColor: items.every(item => item.completed) ? settings.doneColor : '#26292d' }} />}</View>;
      })}
    </View>
    <View className='calendar-agenda'><View className='calendar-agenda-head'><Text className='section-title'>{shortDate(selectedDate)} · {daily.length} 项</Text><View className='calendar-view-switch'><Text className={view === 'items' ? 'active' : ''} onClick={() => setView('items')}>按子项</Text><Text className={view === 'projects' ? 'active' : ''} onClick={() => setView('projects')}>按项目</Text></View></View>
      {daily.length && view === 'projects' ? [...groups].map(([projectId, items]) => {
        const count = items.filter(item => item.kind === 'task' || item.kind === 'recurring').length;
        const summary = [items.some(item => item.kind === 'single-project') ? '项目 · 无子项' : items.some(item => item.kind === 'project') ? '项目截止' : '', count ? `${count} 项事项` : ''].filter(Boolean).join(' · ');
        return <ItemRow key={projectId} title={items[0].projectTitle} metadata={summary} completed={items.every(item => item.completed)} onOpen={() => openItem(projectId === RECURRING_PROJECT_ID ? items[0].id : projectId, projectId)} />;
      }) : daily.length ? daily.map(item => {
        const tone = deadlineTone(item.due, item.completed, localToday(), settings);
        return <ItemRow key={item.id} title={item.title} description={trees[item.projectId]?.find(node => node.id === item.id)?.description} metadata={item.kind === 'single-project' ? '项目截止' : item.kind === 'project' ? '项目截止' : item.projectTitle} metadataColor={tone === 'deep' ? settings.deepColor : tone === 'light' ? settings.lightColor : tone === 'done' ? settings.doneColor : undefined} completed={item.completed} onOpen={() => openItem(item.id, item.projectId)} />;
      }) : <View className='empty'>这一天没有设置截止日期的事项</View>}
    </View>
    {selectedItem && trees[selectedItem.projectId]?.some(node => node.id === selectedItem.id) && <TaskSheet item={trees[selectedItem.projectId].find(node => node.id === selectedItem.id)!} tree={new Tree(trees[selectedItem.projectId])} settings={settings} refresh={() => { reload(value => value + 1); refreshProjects(); }} goTo={goToItem} back={backItem} close={closeItem} />}
  </View>;
}

function SettingsPage({ settings, save, calendarView, setCalendarView, exportBackup, importBackup }: { settings: DeadlineSettings; save: (next: DeadlineSettings) => void; calendarView: CalendarView; setCalendarView: (view: CalendarView) => void; exportBackup: () => void; importBackup: () => void }) {
  const [editingDays, setEditingDays] = useState<'deepDays' | 'lightDays' | null>(null);
  const [draftDays, setDraftDays] = useState('');
  const rows: { label: string; days?: 'deepDays' | 'lightDays'; color: 'deepColor' | 'lightColor' | 'doneColor' }[] = [
    { label: '紧急提醒', days: 'deepDays', color: 'deepColor' },
    { label: '提前提醒', days: 'lightDays', color: 'lightColor' },
    { label: '已完成', color: 'doneColor' },
  ];
  function commitDays() {
    if (!editingDays) return;
    const days = Math.max(0, Math.min(365, Number(draftDays) || 0));
    save(editingDays === 'deepDays' ? { ...settings, deepDays: days, lightDays: Math.max(days, settings.lightDays) } : { ...settings, lightDays: Math.max(settings.deepDays, days) });
    setEditingDays(null);
  }
  return <View className='page settings-page'><Text className='description'>自定义截止提醒的时间和颜色</Text>
    <Text className='section-title'>提醒</Text><View className='settings-list'>{rows.map(row => <View className='setting-row' key={row.label}><Text className='setting-label'>{row.label}</Text><View className='setting-value'>{row.days && <Text onClick={() => { setEditingDays(row.days!); setDraftDays(String(settings[row.days!])); }}>{settings[row.days]} 天内</Text>}</View><ColorEditor value={settings[row.color]} onChange={color => save({ ...settings, [row.color]: color })} /></View>)}</View>
    {editingDays && <View className='sheet-backdrop' onClick={() => setEditingDays(null)}><View className='setting-sheet' onClick={event => event.stopPropagation()}><Text className='section-title'>提醒时间</Text><View className='day-editor'><Input type='number' value={draftDays} focus onInput={event => setDraftDays(event.detail.value)} onConfirm={commitDays} /><Text>天内</Text></View><Button onClick={commitDays}>完成</Button></View></View>}
    <View className='calendar-setting'><Text className='setting-label'>日历默认展示</Text><View className='calendar-view-switch'><Text className={calendarView === 'items' ? 'active' : ''} onClick={() => setCalendarView('items')}>按子项</Text><Text className={calendarView === 'projects' ? 'active' : ''} onClick={() => setCalendarView('projects')}>按项目</Text></View></View>
    <Text className='section-title data-title'>数据</Text><View className='settings-list'><View className='data-row' onClick={exportBackup}><View><Text className='setting-label'>导出备份</Text><Text className='setting-help'>保存全部项目、事项和设置</Text></View><Text className='item-accessory'>›</Text></View><View className='data-row' onClick={importBackup}><View><Text className='setting-label'>从备份恢复</Text><Text className='setting-help'>选择之前导出的 JSON 文件</Text></View><Text className='item-accessory'>›</Text></View></View>
    <Button className='reset-button' onClick={() => save(defaultDeadlineSettings)}>恢复默认</Button>
  </View>;
}

function ColorEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const colors = ['#b42318', '#d14f57', '#ed787a', '#e38b28', '#d5ab35', '#479266', '#3b9b8f', '#437db3', '#7769ae', '#3d4148'];
  return <View className='color-editor'><View className='color-trigger' onClick={() => setOpen(true)}><View className='swatch' style={{ backgroundColor: value }} /></View>{open && <View className='sheet-backdrop' onClick={() => setOpen(false)}><View className='setting-sheet' onClick={event => event.stopPropagation()}><Text className='section-title'>选择颜色</Text><View className='color-options'>{colors.map(color => <View key={color} className='color-target' onClick={() => { onChange(color); setOpen(false); }}><View className='color-option' style={{ backgroundColor: color }}>{value.toLowerCase() === color && <Text>✓</Text>}</View></View>)}</View></View></View>}</View>;
}

function OutlineRow({ item, tree, depth, openNode, refresh, swipeId, setSwipeId, copyTarget, deleteTarget }: {
  item: Node; tree: Tree; depth: number; openNode: (id: string) => void; refresh: () => void;
  swipeId: string | null; setSwipeId: (id: string | null) => void;
  copyTarget: (node: Node) => void; deleteTarget: (node: Node) => void;
}) {
  const children = tree.childrenOf(item.id);
  const [expanded, setExpanded] = useState(true);
  const count = children.length ? progress(item, tree) : null;
  const due = effectiveNodeTime(item, tree);
  const done = !!effectiveCompletedAt(item, tree);
  // 圆圈 = 完成 / 取消完成这一整支（叶子改自己，父级批量改下面所有叶子）；标题区域只打开自己这一级的详情。
  return <View>
    <SwipeRow id={item.id} openId={swipeId} setOpenId={setSwipeId} actions={copyDeleteActions(item, copyTarget, deleteTarget)}>
      <View className='outline-row' style={{ marginLeft: `${depth * 17}px` }}><Text className={`outline-check ${done ? 'done' : ''}`} onClick={tap(event => { event.stopPropagation(); setCompletion(item, !done, refresh); })}>{done ? '✓' : '○'}</Text><View className={`outline-main ${done ? 'done' : ''}`} onClick={tap(() => openNode(item.id))}><Text className='outline-title'>{item.title}</Text><Text className='outline-meta'>{[count ? `${count.done}/${count.total}` : '', due ? shortDate(due) : ''].filter(Boolean).join(' · ')}</Text></View>{children.length > 0 && <Text className='task-expand' onClick={tap(event => { event.stopPropagation(); setExpanded(!expanded); })}>{expanded ? '⌄' : '›'}</Text>}</View>
    </SwipeRow>
    {expanded && children.map(child => <OutlineRow key={child.id} item={child} tree={tree} depth={depth + 1} openNode={openNode} refresh={refresh} swipeId={swipeId} setSwipeId={setSwipeId} copyTarget={copyTarget} deleteTarget={deleteTarget} />)}
  </View>;
}

const PROJECT_FILTERS: { key: ProjectFilter; label: string }[] = [
  { key: 'active', label: '活动中项目' },
  { key: 'completed', label: '已完成项目' },
  { key: 'trash', label: '垃圾桶' },
];

function ProjectFilterBar({ value, counts, onChange, onEmptyTrash }: { value: ProjectFilter; counts: Record<ProjectFilter, number>; onChange: (next: ProjectFilter) => void; onEmptyTrash: () => void }) {
  const [open, setOpen] = useState(false);
  const label = PROJECT_FILTERS.find(item => item.key === value)?.label ?? '活动中项目';
  return <View className='project-filter'>
    <View className='project-filter-trigger' onClick={() => setOpen(!open)}><Text>{label}</Text><Text className='project-filter-count'>{counts[value]}</Text><Text className='project-filter-caret'>{open ? '˄' : '˅'}</Text></View>
    {open && <View className='project-filter-menu'>
      {PROJECT_FILTERS.map(item => <View key={item.key} className={`project-filter-option ${item.key === value ? 'active' : ''}`} onClick={() => { onChange(item.key); setOpen(false); }}><View className='project-filter-main'><Text>{item.label}</Text><Text className='project-filter-count'>{counts[item.key]}</Text></View>{item.key === value && <Text className='project-filter-check'>✓</Text>}</View>)}
      {value === 'trash' && counts.trash > 0 && <View className='project-filter-option project-filter-danger' onClick={() => { setOpen(false); onEmptyTrash(); }}><Text>清空垃圾桶</Text></View>}
    </View>}
  </View>;
}

function ProjectListRow({ project, nodes, summary, settings, openProject, openNode, refresh, swipeId, setSwipeId, copyTarget, deleteTarget }: {
  project: Node; nodes: Node[]; summary?: { done: number; total: number; completed: boolean }; settings: DeadlineSettings;
  openProject: () => void; openNode: (id: string) => void; refresh: () => void;
  swipeId: string | null; setSwipeId: (id: string | null) => void;
  copyTarget: (node: Node) => void; deleteTarget: (node: Node) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const tree = nodes.length ? new Tree(nodes) : null;
  const children = tree?.childrenOf(project.id) ?? [];
  const tone = deadlineTone(project.nodeTime, !!summary?.completed, localToday(), settings);
  const meta = [summary?.total ? `${summary.done}/${summary.total}` : '', project.nodeTime ? shortDate(project.nodeTime) : '', summary?.completed && !summary.total ? '✓' : ''].filter(Boolean).join(' · ');
  // 项目和界面上的绿勾用同一个计算：全部后代叶子完成 = 项目完成。
  const finished = tree ? !!effectiveCompletedAt(project, tree) : !!project.completedAt;
  return <View className='project-list-group'>
    <SwipeRow id={project.id} openId={swipeId} setOpenId={setSwipeId} actions={copyDeleteActions(project, copyTarget, deleteTarget)}>
      <View className='project-list-item'><Text className={`project-list-check ${finished ? 'done' : ''}`} onClick={tap(event => { event.stopPropagation(); setCompletion(project, !finished, refresh); })}>{finished ? '✓' : '○'}</Text><View className={`project-list-copy ${finished ? 'done' : ''}`} onClick={tap(openProject)}><Text className={`project-list-title ${finished ? 'done' : ''}`}>{project.title}</Text>{project.description && <Text className='project-list-description'>{project.description}</Text>}{meta && <Text className={`project-list-meta meta-${tone}`} style={{ color: tone === 'deep' ? settings.deepColor : tone === 'light' ? settings.lightColor : tone === 'done' ? settings.doneColor : undefined }}>{meta}</Text>}</View>{children.length > 0 ? <Text className='project-list-arrow' onClick={tap(event => { event.stopPropagation(); setExpanded(!expanded); })}>{expanded ? '⌄' : '›'}</Text> : <Text className='project-list-arrow' onClick={tap(openProject)}>›</Text>}</View>
    </SwipeRow>
    {expanded && tree && <View className='project-outline'>{children.map(item => <OutlineRow key={item.id} item={item} tree={tree} depth={0} openNode={openNode} refresh={refresh} swipeId={swipeId} setSwipeId={setSwipeId} copyTarget={copyTarget} deleteTarget={deleteTarget} />)}</View>}
  </View>;
}

export default function Index() {
  const [projects, setProjects] = useState<Node[]>([]);
  const [archived, setArchived] = useState<Node[]>([]);
  const [trashed, setTrashed] = useState<Node[]>([]);
  const [summaries, setSummaries] = useState<Record<string, { done: number; total: number; completed: boolean; completedAt: string | null }>>({});
  const [projectTrees, setProjectTrees] = useState<Record<string, Node[]>>({});
  const [sheet, setSheet] = useState<SheetState | null>(viewStore.sheet);
  const applySheet = useCallback((next: SheetState | null) => { viewStore.sheet = next; setSheet(next); }, []);
  // 点列表里的项目：项目详情层。
  const openProjectSheet = useCallback((projectId: string) => applySheet({ projectId, path: [], showProject: true }), [applySheet]);
  // 点列表里的事项/子项：直接开它自己的详情，不带项目详情层。
  const openNodeSheet = useCallback((projectId: string, nodeId: string) => applySheet({ projectId, path: [nodeId], showProject: false }), [applySheet]);
  const closeSheet = useCallback(() => applySheet(null), [applySheet]);
  const sheetGoTo = useCallback((id: string) => setSheet(prev => {
    if (!prev || prev.path[prev.path.length - 1] === id) return prev;
    const at = prev.path.lastIndexOf(id);
    const next = { ...prev, path: at >= 0 ? prev.path.slice(0, at + 1) : [...prev.path, id] };
    viewStore.sheet = next;
    return next;
  }), []);
  const sheetBack = useCallback(() => setSheet(prev => { const next = stepBack(prev); viewStore.sheet = next; return next; }), []);
  const sheetCloseNode = useCallback(() => setSheet(prev => {
    if (!prev) return prev;
    const next = prev.showProject ? { ...prev, path: [] } : null;
    viewStore.sheet = next;
    return next;
  }), []);
  const [filter, setFilterState] = useState<ProjectFilter>(viewStore.projectFilter);
  const setFilter = useCallback((next: ProjectFilter) => {
    viewStore.projectFilter = next;
    setFilterState(next);
  }, []);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [page, setPageState] = useState<PageKey>(viewStore.page);
  const setPage = useCallback((next: PageKey) => { if (next !== 'projects' && viewStore.sheet) applySheet(null); viewStore.page = next; setPageState(next); }, [applySheet]);
  // 每次重新进入「项目」Tab 都回到「活动中项目」。
  const openProjectsTab = useCallback(() => { setFilter('active'); setCreating(false); setPage('projects'); }, [setFilter, setPage]);
  useScrollRestore();
  useSheetHistory(page === 'projects' && sheet ? (sheet.showProject ? 1 : 0) + sheet.path.length : 0, sheetBack);
  const [calendarView, setCalendarView] = useState<CalendarView>(() => Taro.getStorageSync(CALENDAR_VIEW_KEY) === 'projects' ? 'projects' : 'items');
  const [settings, setSettings] = useState<DeadlineSettings>(() => {
    try {
      const saved = Taro.getStorageSync(SETTINGS_KEY);
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      return parsed && typeof parsed === 'object' ? { ...defaultDeadlineSettings, ...parsed } : defaultDeadlineSettings;
    } catch { return defaultDeadlineSettings; }
  });
  const refresh = useCallback(async () => {
    const { active: rows, completed: archivedRows, trashed: trashedRows } = await services.project.listGrouped();
    setProjects(rows);
    setArchived(archivedRows);
    setTrashed(trashedRows);
    const all = [...rows, ...archivedRows, ...trashedRows];
    const trees = await Promise.all(all.map(row => services.project.loadTree(row.id)));
    setProjectTrees(Object.fromEntries(all.map((row, index) => [row.id, trees[index]])));
    setSummaries(Object.fromEntries(all.map((row, index) => {
      const tree = new Tree(trees[index]);
      return [row.id, { ...progress(row, tree), completed: !!effectiveCompletedAt(row, tree), completedAt: effectiveCompletedAt(row, tree) }];
    })));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const [swipeId, setSwipeId] = useState<string | null>(null);
  const copyTarget = useCallback(async (node: Node) => {
    if (node.parentId === null) await services.project.duplicateProject(node.id, `${node.title}（副本）`, now());
    else await services.node.duplicateNode(node.id, now());
    refresh();
  }, [refresh]);
  const deleteTarget = useCallback(async (node: Node) => {
    // 项目进垃圾桶（可恢复），事项 / 子项仍然直接删除。
    const hint = node.parentId === null
      ? '项目将移入垃圾桶，可以随时恢复。'
      : '删除后将同时删除其下的所有子项，此操作不可撤销。';
    if (!await confirmDelete(node.title, hint)) return;
    if (node.parentId === null) await services.project.deleteProject(node.id, now());
    else await services.node.deleteNode(node.id);
    refresh();
  }, [refresh]);
  const restoreTarget = useCallback(async (node: Node) => {
    await services.project.restoreProject(node.id, now());
    // 恢复到它删除前所在的分组，用户马上就能看到。
    setFilter(node.completedAt ? 'completed' : 'active');
    await refresh();
  }, [refresh, setFilter]);
  const purgeTarget = useCallback(async (node: Node) => {
    if (!await confirmPurge(node.title)) return;
    await services.project.purgeProject(node.id);
    refresh();
  }, [refresh]);
  const emptyTrash = useCallback(async () => {
    if (!trashed.length || !await confirmEmptyTrash()) return;
    await services.project.emptyTrash();
    refresh();
  }, [refresh, trashed.length]);
  const allProjects = useMemo(() => [...projects, ...archived, ...trashed], [projects, archived, trashed]);
  const filterCounts = useMemo(() => ({ active: projects.length, completed: archived.length, trash: trashed.length }), [projects.length, archived.length, trashed.length]);
  const current = sheet ? allProjects.find(project => project.id === sheet.projectId) : undefined;
  const nodeNodes = sheet && !sheet.showProject ? projectTrees[sheet.projectId] ?? [] : [];
  const nodeTree = nodeNodes.length ? new Tree(nodeNodes) : null;
  const nodeItem = nodeTree && sheet ? nodeTree.get(sheet.path[sheet.path.length - 1]) : undefined;
  async function create() {
    if (!newTitle.trim()) return;
    const project = await services.project.createProject(newTitle.trim(), now());
    setNewTitle(''); setCreating(false);
    refresh(); openProjectSheet(project.id); setPage('projects');
  }
  function changeFilter(next: ProjectFilter) {
    if (next !== 'active') { setCreating(false); setNewTitle(''); }
    setFilter(next);
  }
  function saveSettings(next: DeadlineSettings) { setSettings(next); Taro.setStorageSync(SETTINGS_KEY, next); }
  function saveCalendarView(next: CalendarView) { setCalendarView(next); Taro.setStorageSync(CALENDAR_VIEW_KEY, next); }
  async function exportBackup() {
    try {
      const backup = createBackup(await services.project.exportAll(), settings, calendarView);
      await saveBackupFile(`smart-note-${localToday()}.json`, JSON.stringify(backup, null, 2));
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      Taro.showModal({ title: '无法导出', content: '当前设备未能保存备份文件', showCancel: false });
    }
  }
  async function importBackup() {
      try {
        const backup = parseBackup(await chooseBackupFile());
        const accepted = await Taro.showModal({ title: '从备份恢复？', content: `将用 ${shortDate(backup.exportedAt)} 的备份替换当前全部内容。`, confirmText: '恢复', confirmColor: '#a94040' });
        if (!accepted.confirm) return;
        await services.project.restoreAll(backup.nodes);
        saveSettings(backup.settings); saveCalendarView(backup.calendarView);
        closeSheet(); setPage('projects'); await refresh();
        Taro.showToast({ title: '恢复完成', icon: 'success' });
      } catch (error) {
        if (error instanceof Error && /cancel/i.test(error.message)) return;
        Taro.showModal({ title: '无法恢复', content: error instanceof Error ? error.message : '备份文件读取失败', showCancel: false });
      }
  }

  return <View className='app' onClick={() => { if (!swipeBlocked()) setSwipeId(null); }}>
    <View className='header'><Text className='back-link'>备忘录</Text></View>
    <View className='screen-heading'><Text className='brand'>{page === 'projects' ? '项目' : page === 'calendar' ? '日历' : page === 'recurring' ? '定期事项' : '设置'}</Text>{page === 'projects' && <ProjectFilterBar value={filter} counts={filterCounts} onChange={changeFilter} onEmptyTrash={emptyTrash} />}</View>
    {page === 'projects' && <View className='project-list'>
      {filter === 'active' && creating && <View className='create-project'><Input value={newTitle} focus placeholder='输入项目或事项名称' onInput={e => setNewTitle(e.detail.value)} onConfirm={create} /><Text onClick={create}>创建</Text><Text onClick={() => { setCreating(false); setNewTitle(''); }}>取消</Text></View>}
      {filter === 'trash' && (trashed.length ? trashed.map(project => <SwipeRow key={project.id} id={project.id} openId={swipeId} setOpenId={setSwipeId} actions={[{ label: '恢复', run: () => restoreTarget(project) }, { label: '彻底删除', danger: true, run: () => purgeTarget(project) }]}><ItemRow className='trashed-row' title={project.title} description={project.description} metadata={project.deletedAt ? `删除于 ${shortDate(project.deletedAt)}` : ''} onOpen={() => openProjectSheet(project.id)} /></SwipeRow>) : <View className='empty start'>垃圾桶是空的</View>)}
      {filter === 'active' && (projects.length ? projects.map(project => <ProjectListRow key={project.id} project={project} nodes={projectTrees[project.id] ?? []} summary={summaries[project.id]} settings={settings} openProject={() => openProjectSheet(project.id)} openNode={id => openNodeSheet(project.id, id)} refresh={refresh} swipeId={swipeId} setSwipeId={setSwipeId} copyTarget={copyTarget} deleteTarget={deleteTarget} />) : !creating && <View className='empty start'>还没有项目，点击右下角新建</View>)}
      {filter === 'completed' && (archived.length ? archived.map(project => <SwipeRow key={project.id} id={project.id} openId={swipeId} setOpenId={setSwipeId} actions={copyDeleteActions(project, copyTarget, deleteTarget)}><ItemRow className='completed-row' title={project.title} description={project.description} metadata={[summaries[project.id]?.completedAt ? `✓ ${shortDate(summaries[project.id].completedAt)}` : '', summaries[project.id]?.total ? `${summaries[project.id].done}/${summaries[project.id].total}` : ''].filter(Boolean).join(' · ')} completed onOpen={() => openProjectSheet(project.id)} onCheck={() => setCompletion(project, false, refresh)} /></SwipeRow>) : <View className='empty start'>还没有已完成的项目</View>)}
    </View>}
    {page === 'projects' && current && sheet?.showProject && <ProjectSheet key={current.id} root={current} path={sheet.path} settings={settings} refresh={refresh} openProject={openProjectSheet} onRestore={target => { setFilter(target); closeSheet(); }} close={closeSheet} goTo={sheetGoTo} back={sheetBack} closeNode={sheetCloseNode} />}
    {page === 'projects' && sheet && !sheet.showProject && nodeItem && nodeTree && <TaskSheet item={nodeItem} tree={nodeTree} settings={settings} refresh={refresh} goTo={sheetGoTo} back={sheetBack} close={sheetCloseNode} />}
    {page === 'recurring' && <RecurringPage settings={settings} />}
    {page === 'calendar' && <CalendarPage projects={projects} settings={settings} view={calendarView} setView={saveCalendarView} refreshProjects={refresh} />}
    {page === 'settings' && <SettingsPage settings={settings} save={saveSettings} calendarView={calendarView} setCalendarView={saveCalendarView} exportBackup={exportBackup} importBackup={importBackup} />}
    {page === 'projects' && !sheet && !creating && filter === 'active' && <Text className='floating-add' onClick={() => setCreating(true)}>＋</Text>}
    <View className='bottom-nav'><View className={page === 'projects' ? 'nav-item active' : 'nav-item'} onClick={openProjectsTab}><Text className='nav-icon'>▣</Text><Text>项目</Text></View><View className={page === 'calendar' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('calendar')}><Text className='nav-icon'>▦</Text><Text>日历</Text></View><View className={page === 'recurring' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('recurring')}><Text className='nav-icon'>◷</Text><Text>定期</Text></View><View className={page === 'settings' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('settings')}><Text className='nav-icon'>⚙</Text><Text>设置</Text></View></View>
  </View>;
}
