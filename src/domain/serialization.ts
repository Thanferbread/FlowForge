/**
 * 场景 JSON 序列化与反序列化。
 *
 * 导出：仅允许完整合法场景导出（validateScene.readyForSimulation）。
 * 导入：先检查字节上限，再 JSON.parse，然后逐字段类型守卫（不信任 TS 断言），
 *   最后运行完整校验。任何环节失败都返回错误，不部分覆盖当前场景。
 *
 * 纯函数，不依赖 React/Canvas。
 */
import type { Scene, Booth, Portal, GridPos } from './types';
import { SCHEMA_VERSION } from './types';
import { validateScene } from './validation';
import { MAX_JSON_BYTES } from './constants';

/** 导入结果 */
export interface ImportResult {
  ok: boolean;
  scene?: Scene;
  /** 失败时的中文错误描述 */
  error?: string;
}

/** 计算 UTF-8 字节数（TextEncoder 为 Web 标准 API，Node 24 与浏览器均内置） */
function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

/** 导出场景为 JSON 字符串（仅合法场景可导出） */
export function exportScene(scene: Scene): { ok: true; json: string } | { ok: false; error: string } {
  const result = validateScene(scene);
  if (!result.readyForSimulation) {
    const msgs = result.issues.map((i) => i.message).join('；');
    return { ok: false, error: `场景未通过校验，无法导出：${msgs}` };
  }
  const json = JSON.stringify(scene, null, 2);
  if (utf8ByteLength(json) > MAX_JSON_BYTES) {
    return { ok: false, error: `导出结果超过 ${MAX_JSON_BYTES} 字节上限` };
  }
  return { ok: true, json };
}

/** 判断数值是否为有限整数 */
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}

/** 解析坐标，失败时写入 issues */
function parsePos(v: unknown, ctx: string, issues: string[]): GridPos | null {
  if (typeof v !== 'object' || v === null) {
    issues.push(`${ctx} 必须是对象`);
    return null;
  }
  const o = v as Record<string, unknown>;
  if (!isInt(o.x)) {
    issues.push(`${ctx}.x 必须为有限整数`);
    return null;
  }
  if (!isInt(o.y)) {
    issues.push(`${ctx}.y 必须为有限整数`);
    return null;
  }
  return { x: o.x, y: o.y };
}

/** 解析 Portal 数组 */
function parsePortals(arr: unknown, ctx: string, issues: string[]): Portal[] {
  if (!Array.isArray(arr)) {
    issues.push(`${ctx} 必须是数组`);
    return [];
  }
  const result: Portal[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== 'object' || item === null) {
      issues.push(`${ctx}[${i}] 必须是对象`);
      continue;
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.id !== 'string' || obj.id.length === 0) {
      issues.push(`${ctx}[${i}].id 必须为非空字符串`);
      continue;
    }
    const pos = parsePos(obj.pos, `${ctx}[${i}].pos`, issues);
    if (pos) result.push({ id: obj.id, pos });
  }
  return result;
}

/** 解析 Booth 数组 */
function parseBooths(arr: unknown, ctx: string, issues: string[]): Booth[] {
  if (!Array.isArray(arr)) {
    issues.push(`${ctx} 必须是数组`);
    return [];
  }
  const result: Booth[] = [];
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i];
    if (typeof item !== 'object' || item === null) {
      issues.push(`${ctx}[${i}] 必须是对象`);
      continue;
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.id !== 'string' || obj.id.length === 0) {
      issues.push(`${ctx}[${i}].id 必须为非空字符串`);
      continue;
    }
    const footprint = parsePos(obj.footprint, `${ctx}[${i}].footprint`, issues);
    const serviceCell = parsePos(obj.serviceCell, `${ctx}[${i}].serviceCell`, issues);
    let queueCells: GridPos[] = [];
    if (Array.isArray(obj.queueCells)) {
      queueCells = [];
      for (let j = 0; j < obj.queueCells.length; j++) {
        const q = parsePos(obj.queueCells[j], `${ctx}[${i}].queueCells[${j}]`, issues);
        if (q) queueCells.push(q);
      }
    } else {
      issues.push(`${ctx}[${i}].queueCells 必须是数组`);
    }
    if (!isInt(obj.serviceTicksMin)) {
      issues.push(`${ctx}[${i}].serviceTicksMin 必须为有限整数`);
    }
    if (!isInt(obj.serviceTicksMax)) {
      issues.push(`${ctx}[${i}].serviceTicksMax 必须为有限整数`);
    }
    if (footprint && serviceCell && isInt(obj.serviceTicksMin) && isInt(obj.serviceTicksMax)) {
      result.push({
        id: obj.id,
        footprint,
        serviceCell,
        queueCells,
        serviceTicksMin: obj.serviceTicksMin,
        serviceTicksMax: obj.serviceTicksMax,
      });
    }
  }
  return result;
}

/** 从未知数据解析 Scene，严格类型守卫 */
function parseScene(data: unknown, issues: string[]): Scene | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    issues.push('根元素必须是对象');
    return null;
  }
  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== SCHEMA_VERSION) {
    issues.push(`schemaVersion 必须为 ${SCHEMA_VERSION}，当前为 ${String(obj.schemaVersion)}`);
  }
  if (!isInt(obj.width)) issues.push('width 必须为有限整数');
  if (!isInt(obj.height)) issues.push('height 必须为有限整数');

  const obstacles: GridPos[] = [];
  if (Array.isArray(obj.obstacles)) {
    for (let i = 0; i < obj.obstacles.length; i++) {
      const p = parsePos(obj.obstacles[i], `obstacles[${i}]`, issues);
      if (p) obstacles.push(p);
    }
  } else {
    issues.push('obstacles 必须是数组');
  }

  const entrances = parsePortals(obj.entrances, 'entrances', issues);
  const exits = parsePortals(obj.exits, 'exits', issues);
  const booths = parseBooths(obj.booths, 'booths', issues);

  if (issues.length > 0) return null;
  if (!isInt(obj.width) || !isInt(obj.height)) return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    width: obj.width,
    height: obj.height,
    obstacles,
    entrances,
    exits,
    booths,
  };
}

/** 从 JSON 字符串导入场景，失败时返回错误且不修改任何外部状态 */
export function importScene(jsonText: string): ImportResult {
  if (utf8ByteLength(jsonText) > MAX_JSON_BYTES) {
    return { ok: false, error: `文件超过 2 MB 上限` };
  }
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
  }

  const issues: string[] = [];
  const scene = parseScene(data, issues);
  if (issues.length > 0 || !scene) {
    return { ok: false, error: issues.join('；') || '场景数据不完整' };
  }

  const result = validateScene(scene);
  if (!result.readyForSimulation) {
    const msgs = result.issues.map((i) => i.message).join('；');
    return { ok: false, error: `场景校验未通过：${msgs}` };
  }

  return { ok: true, scene };
}
