// Dotted-path helpers over plain JSON objects, immutable-style (clone on write).

export function getPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

export function setPath<T>(obj: T, path: string, value: unknown): T {
  const clone = structuredClone(obj) as any;
  const keys = path.split('.');
  let cur = clone;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key];
  }
  cur[keys[keys.length - 1]] = value;
  return clone;
}

// Delete a path and prune empty parent objects along the way.
export function deletePath<T>(obj: T, path: string): T {
  const clone = structuredClone(obj) as any;
  const keys = path.split('.');
  const parents: any[] = [clone];
  let cur = clone;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] == null || typeof cur[key] !== 'object') return clone;
    cur = cur[key];
    parents.push(cur);
  }
  delete cur[keys[keys.length - 1]];
  for (let i = parents.length - 1; i > 0; i--) {
    if (Object.keys(parents[i]).length === 0) delete parents[i - 1][keys[i - 1]];
  }
  return clone;
}
