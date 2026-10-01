import { Node } from './node';
import { Tree } from './tree';

export type ChildrenOf = (id: string) => Node[];

/* ------------------------------------------------------------------ */
/* effectiveNodeTime                                                    */
/* ------------------------------------------------------------------ */

export function effectiveNodeTime(node: Node, tree: Tree): string | null {
  return effectiveNodeTimeC(node, (id) => tree.childrenOf(id));
}

export function effectiveNodeTimeC(node: Node, childrenOf: ChildrenOf): string | null {
  if (node.parentId === null) return node.nodeTime;
  const children = childrenOf(node.id);
  // leaf (no children): use own nodeTime
  if (children.length === 0) return node.nodeTime;
  if (node.nodeTimeMode === 'manual') return node.nodeTime;

  // non-leaf auto: aggregate = max of children's effective times
  const times = children
    .map((c) => effectiveNodeTimeC(c, childrenOf))
    .filter((t): t is string => t != null);
  return times.length ? times.sort().at(-1)! : null;
}

/* ------------------------------------------------------------------ */
/* effectiveCompletedAt                                                */
/*                                                                      */
/* A non-leaf node is "complete" only when ALL its children (recursive) */
/* are complete. The completion time = the latest among children —     */
/* i.e. when the last item was finished.                               */
/* ------------------------------------------------------------------ */

export function effectiveCompletedAt(node: Node, tree: Tree): string | null {
  return effectiveCompletedAtC(node, (id) => tree.childrenOf(id));
}

export function effectiveCompletedAtC(node: Node, childrenOf: ChildrenOf): string | null {
  const children = childrenOf(node.id);
  // leaf: own completedAt
  if (children.length === 0) return node.completedAt;

  // non-leaf: only complete when ALL children are complete
  const childCompletions = children.map((c) => effectiveCompletedAtC(c, childrenOf));
  if (childCompletions.some((t) => t === null)) return null;

  // all children complete → latest completion time = when last item finished
  return childCompletions.filter((t): t is string => t != null).sort().at(-1)!;
}

/* ------------------------------------------------------------------ */
/* 完成状态：只有叶子节点保存，父级一律由叶子算出来                    */
/*                                                                      */
/* 叶子 = 没有子节点的节点，用户点 ○/✓ 直接控制它自己的 completedAt。  */
/* 非叶子不看自己存的完成标志，只看后代叶子是不是都完成了。             */
/* effectiveCompletedAt 就是这条唯一的规则：项目列表的「活动中 / 已完成」*/
/* 也用它，所以不会出现「界面绿勾但项目还在活动中」。                   */
/* ------------------------------------------------------------------ */

/** 子树里的叶子节点，也就是真正保存完成状态的那些节点。 */
export function leafIds(tree: Tree, id: string): string[] {
  const ids: string[] = [];
  const walk = (current: string) => {
    const children = tree.childrenOf(current);
    if (children.length === 0) { ids.push(current); return; }
    for (const child of children) walk(child.id);
  };
  walk(id);
  return ids;
}

/* ------------------------------------------------------------------ */
/* progress (leaf count, display only)                                 */
/* ------------------------------------------------------------------ */

export function progress(node: Node, tree: Tree): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const walk = (n: Node) => {
    const kids = tree.childrenOf(n.id);
    if (kids.length === 0) {
      // leaf
      if (n.parentId === null) return;
      total++;
      if (n.completedAt) done++;
      return;
    }
    for (const k of kids) walk(k);
  };
  walk(node);
  return { done, total };
}
