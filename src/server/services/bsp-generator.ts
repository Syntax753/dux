// Binary Space Partitioning — splits space into non-overlapping partitions.
// Each partition becomes a room. Corridor agent connects them.

export interface BSPPartition {
  id: string;
  x: number;      // top-left of the PARTITION (not the room)
  y: number;
  w: number;       // partition width
  h: number;       // partition height
}

export interface BSPSibling {
  leftId: string;
  rightId: string;
}

export interface BSPResult {
  totalWidth: number;
  totalHeight: number;
  partitions: BSPPartition[];
  siblings: BSPSibling[]; // pairs of partitions that should be connected
}

interface BSPNode {
  x: number;
  y: number;
  w: number;
  h: number;
  id?: string;
  left?: BSPNode;
  right?: BSPNode;
}

const MIN_PARTITION = 7;

export function generateBSPLayout(roomCount: number): BSPResult {
  const cols = Math.ceil(Math.sqrt(roomCount * 1.5));
  const rows = Math.ceil(roomCount / cols * 1.5);
  const totalWidth = cols * 12;
  const totalHeight = rows * 12;

  const root: BSPNode = { x: 0, y: 0, w: totalWidth, h: totalHeight };

  // Split until we have enough leaves
  while (true) {
    const leaves = getLeaves(root);
    if (leaves.length >= roomCount) break;

    // Find largest splittable leaf
    let best: BSPNode | null = null;
    let bestArea = 0;
    for (const leaf of leaves) {
      if ((leaf.w >= MIN_PARTITION * 2 || leaf.h >= MIN_PARTITION * 2) && leaf.w * leaf.h > bestArea) {
        best = leaf;
        bestArea = leaf.w * leaf.h;
      }
    }
    if (!best) break;

    split(best);
  }

  // Assign IDs to leaves (take first roomCount)
  const leaves = getLeaves(root);
  const partitions: BSPPartition[] = [];
  for (let i = 0; i < Math.min(roomCount, leaves.length); i++) {
    const id = `room_${i + 1}`;
    leaves[i].id = id;
    partitions.push({ id, x: leaves[i].x, y: leaves[i].y, w: leaves[i].w, h: leaves[i].h });
  }

  // Collect sibling pairs from the BSP tree
  const siblings: BSPSibling[] = [];
  collectSiblings(root, siblings);

  return { totalWidth, totalHeight, partitions, siblings };
}

function split(node: BSPNode): void {
  // Choose split direction — prefer splitting the longer axis
  const canSplitH = node.h >= MIN_PARTITION * 2;
  const canSplitV = node.w >= MIN_PARTITION * 2;

  if (!canSplitH && !canSplitV) return;

  let horizontal: boolean;
  if (canSplitH && canSplitV) {
    horizontal = node.h > node.w ? true : node.w > node.h ? false : Math.random() < 0.5;
  } else {
    horizontal = canSplitH;
  }

  if (horizontal) {
    const min = node.y + MIN_PARTITION;
    const max = node.y + node.h - MIN_PARTITION;
    const splitY = min + Math.floor(Math.random() * (max - min + 1));
    node.left = { x: node.x, y: node.y, w: node.w, h: splitY - node.y };
    node.right = { x: node.x, y: splitY, w: node.w, h: node.y + node.h - splitY };
  } else {
    const min = node.x + MIN_PARTITION;
    const max = node.x + node.w - MIN_PARTITION;
    const splitX = min + Math.floor(Math.random() * (max - min + 1));
    node.left = { x: node.x, y: node.y, w: splitX - node.x, h: node.h };
    node.right = { x: splitX, y: node.y, w: node.x + node.w - splitX, h: node.h };
  }
}

function getLeaves(node: BSPNode): BSPNode[] {
  if (!node.left && !node.right) return [node];
  const result: BSPNode[] = [];
  if (node.left) result.push(...getLeaves(node.left));
  if (node.right) result.push(...getLeaves(node.right));
  return result;
}

function collectSiblings(node: BSPNode, siblings: BSPSibling[]): void {
  if (!node.left || !node.right) return;

  collectSiblings(node.left, siblings);
  collectSiblings(node.right, siblings);

  // Connect a room from each side
  const leftId = findLeafId(node.left);
  const rightId = findLeafId(node.right);
  if (leftId && rightId) {
    siblings.push({ leftId, rightId });
  }
}

function findLeafId(node: BSPNode): string | null {
  if (node.id) return node.id;
  if (node.left) { const r = findLeafId(node.left); if (r) return r; }
  if (node.right) { const r = findLeafId(node.right); if (r) return r; }
  return null;
}
