// Minimal Firebase RTDB security-rules evaluator, enough for database.rules.json.
// Semantics: a granted .write on the path or any ancestor allows the write; .validate is then
// checked on the written node and all its descendants (post-write data). Errors in an expression = false.
import fs from 'node:fs';

// string helper that rules expressions use
// eslint-disable-next-line no-extend-native
String.prototype.matches = function (re) { return re.test(this); };

const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const getAt = (tree, path) => path.reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), tree);

class Snap {
  constructor(tree, path) { this.tree = tree; this.path = path; }
  val() { const v = getAt(this.tree, this.path); return v === undefined ? null : v; }
  exists() { return this.val() !== null; }
  child(p) {
    if (typeof p !== 'string' && typeof p !== 'number') throw new Error('bad child');
    return new Snap(this.tree, [...this.path, ...String(p).split('/')]);
  }
  parent() { if (!this.path.length) throw new Error('no parent'); return new Snap(this.tree, this.path.slice(0, -1)); }
  isString() { return typeof this.val() === 'string'; }
  isNumber() { return typeof this.val() === 'number'; }
  hasChildren(keys) { const v = this.val(); return !!v && typeof v === 'object' && (!keys || keys.every(k => v[k] != null)); }
}

export function loadRules(file = new URL('../database.rules.json', import.meta.url)) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).rules;
}

function ev(expr, ctx) {
  if (typeof expr === 'boolean') return expr;
  try {
    const fn = new Function('auth', 'now', 'root', 'data', 'newData', 'vars', `with (vars) { return (${expr}); }`);
    return fn(ctx.auth, ctx.now, new Snap(ctx.oldTree, []), new Snap(ctx.oldTree, ctx.path), new Snap(ctx.newTree, ctx.path), ctx.vars) === true;
  } catch { return false; }
}

const childRule = (node, key) => {
  if (node[key] && typeof node[key] === 'object') return [node[key], null];
  const w = Object.keys(node).find(k => k.startsWith('$'));
  return w ? [node[w], [w, key]] : [null, null];
};

/** writes: [{path: string[], value}] applied atomically. Returns true if every write is allowed and valid. */
export function checkUpdate(rules, tree, writes, auth, now) {
  const newTree = clone(tree) ?? {};
  for (const w of writes) {
    if (!w.path.length) throw new Error('root write');
    let n = newTree;
    for (const k of w.path.slice(0, -1)) { if (n[k] == null || typeof n[k] !== 'object') n[k] = {}; n = n[k]; }
    const last = w.path[w.path.length - 1];
    if (w.value === null || w.value === undefined) delete n[last]; else n[last] = clone(w.value);
  }
  for (const w of writes) {
    // walk rules along the path, looking for a granting .write
    let node = rules, vars = {}, granted = ev(node['.write'] ?? false, { auth, now, oldTree: tree, newTree, path: [], vars });
    for (let i = 0; i < w.path.length && !granted; i++) {
      const [next, v] = childRule(node, w.path[i]);
      if (!next) { node = null; break; }
      node = next; if (v) vars = { ...vars, [v[0]]: v[1] };
      granted = ev(node['.write'] ?? false, { auth, now, oldTree: tree, newTree, path: w.path.slice(0, i + 1), vars });
    }
    if (!granted) return false;
    // validate the written subtree
    let vnode = rules, vvars = {};
    for (const k of w.path) {
      const [next, v] = vnode ? childRule(vnode, k) : [null, null];
      vnode = next; if (v) vvars = { ...vvars, [v[0]]: v[1] };
    }
    if (!validateSubtree(vnode, newTree, w.path, vvars, auth, now, tree)) return false;
  }
  Object.assign(tree, newTree);
  for (const k of Object.keys(tree)) if (!(k in newTree)) delete tree[k];
  return true;
}

function validateSubtree(rnode, newTree, path, vars, auth, now, oldTree) {
  const val = getAt(newTree, path);
  if (val === undefined || val === null) return true;
  if (rnode && rnode['.validate'] !== undefined && !ev(rnode['.validate'], { auth, now, oldTree, newTree, path, vars })) return false;
  if (val && typeof val === 'object') {
    for (const k of Object.keys(val)) {
      const [next, v] = rnode ? childRule(rnode, k) : [null, null];
      if (!validateSubtree(next, newTree, [...path, k], v ? { ...vars, [v[0]]: v[1] } : vars, auth, now, oldTree)) return false;
    }
  }
  return true;
}

/** read access: root-level direct get of a path */
export function checkRead(rules, tree, path, auth, now = Date.now()) {
  let node = rules, vars = {};
  if (ev(node['.read'] ?? false, { auth, now, oldTree: tree, newTree: tree, path: [], vars })) return true;
  for (let i = 0; i < path.length; i++) {
    const [next, v] = childRule(node, path[i]);
    if (!next) return false;
    node = next; if (v) vars = { ...vars, [v[0]]: v[1] };
    if (ev(node['.read'] ?? false, { auth, now, oldTree: tree, newTree: tree, path: path.slice(0, i + 1), vars })) return true;
  }
  return false;
}
