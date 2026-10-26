/**
 * 稳定序列化与 FNV-1a 32 位哈希。
 *
 * - stableStringify：对象键按非 locale 字典序排列，数组保留领域顺序，
 *   2 空格缩进、LF、不附末尾换行。拒绝非有限数/循环引用/undefined。
 * - hashScene：规范投影 Scene 字段后求 UTF-8 FNV-1a 32 位哈希。
 * - hashDemands：复制并按 (scheduledTick, id) 排序后求哈希。
 * - canonicalSceneJson：场景规范化完整内容字符串。
 *
 * FNV-1a：初值 2166136261，每字节异或后以 Math.imul 乘 16777619 再 >>>0。
 * 输出小写补零至 8 位十六进制。
 *
 * 纯函数，不修改调用方对象，不依赖 Math.random。
 */
import type { Scene, GridPos } from '../domain/types';
import type { ExogenousDemand } from './types';
import { HASH_VERSION, SERIALIZATION_VERSION } from './constants';

export { HASH_VERSION, SERIALIZATION_VERSION };

/** FNV-1a 初始值 */
const FNV_OFFSET = 2166136261 >>> 0;
/** FNV-1a 质数 */
const FNV_PRIME = 16777619;

/** 将字符串编码为 UTF-8 字节数组 */
function utf8Bytes(str: string): number[] {
  return Array.from(new TextEncoder().encode(str));
}

/** 对 UTF-8 字节序列计算 FNV-1a 32 位哈希，返回小写补零 8 位十六进制 */
function fnv1aHex(str: string): string {
  const bytes = utf8Bytes(str);
  let hash = FNV_OFFSET;
  for (const b of bytes) {
    hash ^= b;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 对结构化值计算 FNV-1a 无符号数值（用于冲突优先级） */
export function fnv1aUint(str: string): number {
  const bytes = utf8Bytes(str);
  let hash = FNV_OFFSET;
  for (const b of bytes) {
    hash ^= b;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/** 非.locale 字典序比较 */
function lexCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 稳定序列化内部实现 */
function stringifyValue(value: unknown, indent: number, seen: Set<unknown>): string {
  const pad = '  '.repeat(indent);

  if (value === null) return 'null';
  if (value === undefined) {
    throw new Error('stableStringify: undefined is not JSON-representable');
  }
  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('stableStringify: non-finite number is not JSON-representable');
    }
    return String(value);
  }
  if (t === 'string') return JSON.stringify(value);
  if (t === 'bigint') {
    throw new Error('stableStringify: bigint is not JSON-representable');
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('stableStringify: circular reference detected');
    seen.add(value);
    if (value.length === 0) {
      seen.delete(value);
      return '[]';
    }
    const entries: string[] = [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw new Error('stableStringify: sparse array is not JSON-representable');
      }
      entries.push(`${pad}  ${stringifyValue(value[i], indent + 1, seen)}`);
    }
    const inner = entries.join(',\n');
    seen.delete(value);
    return `[\n${inner}\n${pad}]`;
  }

  if (t === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('stableStringify: project non-JSON objects before serialization');
    }
    if (seen.has(value)) throw new Error('stableStringify: circular reference detected');
    seen.add(value);
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort(lexCompare);
    if (keys.length === 0) {
      seen.delete(value);
      return '{}';
    }
    const inner = keys
      .map((k) => `${pad}  ${JSON.stringify(k)}: ${stringifyValue(obj[k], indent + 1, seen)}`)
      .join(',\n');
    seen.delete(value);
    return `{\n${inner}\n${pad}}`;
  }

  throw new Error(`stableStringify: unsupported type ${t}`);
}

/**
 * 稳定 JSON 序列化。
 * 对象键按非 locale 字典序排列，数组保留领域顺序，2 空格缩进、LF、不附末尾换行。
 * 拒绝非有限数/循环引用/undefined。内部 Map/Set 须先投影为 JSON 数据。
 */
export function stableStringify(value: unknown): string {
  return stringifyValue(value, 0, new Set<unknown>());
}

/** 规范化 GridPos 为稳定对象 */
function normPos(p: GridPos): { x: number; y: number } {
  return { x: p.x, y: p.y };
}

/** 规范化 Scene 为稳定 JSON 对象（不修改原对象） */
function canonicalScene(scene: Scene): unknown {
  const obstacles = [...scene.obstacles].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  }).map(normPos);

  const entrances = [...scene.entrances]
    .sort((a, b) => lexCompare(a.id, b.id))
    .map((e) => ({ id: e.id, pos: normPos(e.pos) }));

  const exits = [...scene.exits]
    .sort((a, b) => lexCompare(a.id, b.id))
    .map((e) => ({ id: e.id, pos: normPos(e.pos) }));

  const booths = [...scene.booths]
    .sort((a, b) => lexCompare(a.id, b.id))
    .map((b) => ({
      id: b.id,
      footprint: normPos(b.footprint),
      serviceCell: normPos(b.serviceCell),
      queueCells: b.queueCells.map(normPos),
      serviceTicksMin: b.serviceTicksMin,
      serviceTicksMax: b.serviceTicksMax,
    }));

  return {
    schemaVersion: scene.schemaVersion,
    width: scene.width,
    height: scene.height,
    obstacles,
    entrances,
    exits,
    booths,
  };
}

/** 场景规范化完整内容字符串，可用于提交前 no-op 比较 */
export function canonicalSceneJson(scene: Scene): string {
  return stableStringify(canonicalScene(scene));
}

/** 场景 hash：规范投影后求 UTF-8 FNV-1a 32 位哈希，输出小写补零 8 位十六进制 */
export function hashScene(scene: Scene): string {
  return fnv1aHex(canonicalSceneJson(scene));
}

/** 需求 hash：复制并按 (scheduledTick, id) 排序完整输入后求哈希 */
export function hashDemands(demands: ExogenousDemand[]): string {
  const sorted = [...demands].sort((a, b) => {
    if (a.scheduledTick !== b.scheduledTick) return a.scheduledTick - b.scheduledTick;
    return lexCompare(a.id, b.id);
  }).map((d) => ({
    id: d.id,
    scheduledTick: d.scheduledTick,
    entranceId: d.entranceId,
    boothId: d.boothId,
    serviceTicks: d.serviceTicks,
  }));
  return fnv1aHex(stableStringify(sorted));
}
