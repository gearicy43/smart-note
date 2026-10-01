// Platform-neutral entry point for a mini-program or native UI.
import { NodeService } from './service/nodeService';
import { ProjectService } from './service/projectService';
import type { NodeRepository } from './repository/types';

export function createServices(repository: NodeRepository, idGen: () => string) {
  return {
    node: new NodeService(repository, idGen),
    project: new ProjectService(repository, idGen),
  };
}

export { NodeService } from './service/nodeService';
export { ProjectService, RECURRING_PROJECT_ID } from './service/projectService';
export type { NodeRepository } from './repository/types';
export type { Node, NodeTimeMode, RepeatRule } from './domain/node';
export { createNode, createProject } from './domain/node';
export { Tree } from './domain/tree';
export { effectiveNodeTime, effectiveCompletedAt, progress } from './domain/aggregate';
export { duplicateProjectTree } from './domain/duplicate';
export { validateTree } from './domain/validate';
export { deadlineTone, defaultDeadlineSettings } from './domain/deadline';
export type { DeadlineSettings } from './domain/deadline';
export { nextRepeatDate } from './domain/repeat';
