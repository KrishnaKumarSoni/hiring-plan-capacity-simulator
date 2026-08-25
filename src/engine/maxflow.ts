// Edmonds-Karp max-flow on a small dense graph. Capacities are integers
// (we scale hours to minutes before calling). Node counts here are tiny
// (~interviewers + pools + 2), so BFS augmentation is plenty fast.

export interface FlowResult {
  maxFlow: number;
  // flow[u][v] = net flow pushed from u to v
  flow: number[][];
  // reachable[u] = true if u is reachable from source in the residual graph (min-cut side S)
  reachable: boolean[];
}

export function maxFlow(n: number, capacity: number[][], source: number, sink: number): FlowResult {
  const flow: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let total = 0;

  for (;;) {
    // BFS for shortest augmenting path
    const parent = new Array(n).fill(-1);
    parent[source] = source;
    const queue = [source];
    while (queue.length > 0 && parent[sink] === -1) {
      const u = queue.shift()!;
      for (let v = 0; v < n; v++) {
        if (parent[v] === -1 && capacity[u][v] - flow[u][v] > 0) {
          parent[v] = u;
          queue.push(v);
        }
      }
    }
    if (parent[sink] === -1) break;

    let bottleneck = Infinity;
    for (let v = sink; v !== source; v = parent[v]) {
      const u = parent[v];
      bottleneck = Math.min(bottleneck, capacity[u][v] - flow[u][v]);
    }
    for (let v = sink; v !== source; v = parent[v]) {
      const u = parent[v];
      flow[u][v] += bottleneck;
      flow[v][u] -= bottleneck;
    }
    total += bottleneck;
  }

  const reachable = new Array(n).fill(false);
  reachable[source] = true;
  const queue = [source];
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (let v = 0; v < n; v++) {
      if (!reachable[v] && capacity[u][v] - flow[u][v] > 0) {
        reachable[v] = true;
        queue.push(v);
      }
    }
  }

  return { maxFlow: total, flow, reachable };
}
