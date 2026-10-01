import Taro from '@tarojs/taro';
import { createServices } from '../core';
import type { Node } from '../domain/node';
import type { NodeRepository } from '../repository/types';

const STORAGE_KEY = 'smart-note.nodes.v1';

export class TaroRepository implements NodeRepository {
  private nodes = new Map<string, Node>();

  constructor() {
    const saved = Taro.getStorageSync(STORAGE_KEY);
    if (Array.isArray(saved)) {
      for (const node of saved as Node[]) this.nodes.set(node.id, node);
    }
  }

  private save() {
    Taro.setStorageSync(STORAGE_KEY, [...this.nodes.values()]);
  }

  async loadProject(projectId: string) {
    return [...this.nodes.values()].filter(node => node.projectId === projectId);
  }

  async listProjects() {
    return [...this.nodes.values()].filter(node => node.parentId === null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async upsertNode(node: Node) {
    this.nodes.set(node.id, node);
    this.save();
  }

  async deleteNode(id: string) {
    const pending = [id];
    while (pending.length) {
      const current = pending.pop()!;
      for (const node of this.nodes.values()) {
        if (node.parentId === current) pending.push(node.id);
      }
      this.nodes.delete(current);
    }
    this.save();
  }

  async saveProjectTree(nodes: Node[]) {
    const projectId = nodes.find(node => node.parentId === null)?.id ?? nodes[0]?.projectId;
    if (projectId) {
      for (const node of this.nodes.values()) {
        if (node.projectId === projectId) this.nodes.delete(node.id);
      }
    }
    for (const node of nodes) this.nodes.set(node.id, node);
    this.save();
  }

  async replaceAll(nodes: Node[]) {
    this.nodes = new Map(nodes.map(node => [node.id, node]));
    this.save();
  }
}

const id = () => `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
export const services = createServices(new TaroRepository(), id);
