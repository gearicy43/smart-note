import { Node, createNode } from '../domain/node';
import { duplicateProjectTree } from '../domain/duplicate';
import { effectiveCompletedAt } from '../domain/aggregate';
import { Tree } from '../domain/tree';
import { NodeRepository } from '../repository/types';

export type IdGen = () => string;
export const RECURRING_PROJECT_ID = 'smart-note:recurring';

export class ProjectService {
  private recurringReady?: Promise<void>;
  constructor(private repo: NodeRepository, private idGen: IdGen) {}

  /**
   * 项目分组。项目的完成状态和界面上的绿勾用的是同一个计算：
   * 项目自己没有事项时是叶子，看它自己的 completedAt；
   * 有事项时一律由后代叶子算出来，项目根存的 completedAt 不参与判断。
   */
  async listGrouped(): Promise<{ active: Node[]; completed: Node[]; trashed: Node[] }> {
    await this.ensureRecurringRoot();
    const roots = (await this.repo.listProjects()).filter(node => node.id !== RECURRING_PROJECT_ID);
    const grouped = { active: [] as Node[], completed: [] as Node[], trashed: [] as Node[] };
    for (const root of roots) {
      if (root.deletedAt) { grouped.trashed.push(root); continue; }
      const nodes = await this.repo.loadProject(root.id);
      const done = effectiveCompletedAt(root, new Tree(nodes));
      (done ? grouped.completed : grouped.active).push(root);
    }
    return grouped;
  }

  async listProjects(): Promise<Node[]> {
    return (await this.listGrouped()).active;
  }

  async listArchivedProjects(): Promise<Node[]> {
    return (await this.listGrouped()).completed;
  }

  /** 垃圾桶：软删除的项目，恢复时按当时的叶子状态回到活动中 / 已完成。 */
  async listTrashedProjects(): Promise<Node[]> {
    return (await this.listGrouped()).trashed;
  }

  ensureRecurringRoot(): Promise<void> {
    if (!this.recurringReady) this.recurringReady = this.prepareRecurring().catch(error => {
      this.recurringReady = undefined;
      throw error;
    });
    return this.recurringReady;
  }

  private async prepareRecurring(): Promise<void> {
    const projects = await this.repo.listProjects();
    if (!projects.some(node => node.id === RECURRING_PROJECT_ID)) {
      await this.repo.upsertNode(createNode({ id: RECURRING_PROJECT_ID, projectId: RECURRING_PROJECT_ID, parentId: null, title: '定期事项', now: new Date().toISOString() }));
    }
    for (const project of projects) {
      if (project.id === RECURRING_PROJECT_ID) continue;
      const nodes = await this.repo.loadProject(project.id);
      for (const task of nodes) {
        if ((task.repeatRule !== 'none' || task.repeatAnchor !== null) && !nodes.some(node => node.parentId === task.id)) {
          await this.repo.upsertNode({ ...task, projectId: RECURRING_PROJECT_ID, parentId: RECURRING_PROJECT_ID });
        }
      }
    }
  }

  async loadTree(projectId: string): Promise<Node[]> {
    return this.repo.loadProject(projectId);
  }

  async exportAll(): Promise<Node[]> {
    await this.ensureRecurringRoot();
    const projects = await this.repo.listProjects();
    return (await Promise.all(projects.map(project => this.repo.loadProject(project.id)))).flat();
  }

  async restoreAll(nodes: Node[]): Promise<void> {
    await this.repo.replaceAll(nodes);
    this.recurringReady = undefined;
    await this.ensureRecurringRoot();
  }

  async createProject(title: string, now: string): Promise<Node> {
    const id = this.idGen();
    const p = createNode({ id, projectId: id, parentId: null, title, now });
    await this.repo.upsertNode(p);
    return p;
  }

  async duplicateProject(projectId: string, newTitle: string, now: string): Promise<Node> {
    const nodes = await this.repo.loadProject(projectId);
    const copy = duplicateProjectTree(nodes, newTitle, now, this.idGen);
    await this.repo.saveProjectTree(copy);
    return copy.find((n) => n.parentId == null)!;
  }

  /**
   * 删除项目 = 移入垃圾桶：只给项目根节点打软删除标记，下面的树原样保留，
   * 所以恢复是完整的，也不会和「完成」共用同一个状态。
   */
  async deleteProject(projectId: string, now = new Date().toISOString()): Promise<void> {
    const root = (await this.repo.listProjects()).find(node => node.id === projectId);
    if (!root) return;
    await this.repo.upsertNode({ ...root, deletedAt: now, updatedAt: now });
  }

  /** 从垃圾桶恢复：项目回到它删除前的分组（活动中 / 已完成）。 */
  async restoreProject(projectId: string, now = new Date().toISOString()): Promise<void> {
    const root = (await this.repo.listProjects()).find(node => node.id === projectId);
    if (!root) return;
    await this.repo.upsertNode({ ...root, deletedAt: null, updatedAt: now });
  }

  /** 彻底删除：项目连同全部事项、子项一起从库里移除。 */
  async purgeProject(projectId: string): Promise<void> {
    await this.repo.deleteNode(projectId);
  }

  async emptyTrash(): Promise<void> {
    for (const project of await this.listTrashedProjects()) await this.repo.deleteNode(project.id);
  }
}
