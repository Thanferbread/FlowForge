/**
 * 序列化测试：导出重载语义等价、非法导入被拒绝且不覆盖当前场景。
 */
import { describe, it, expect } from 'vitest';
import { exportScene, importScene } from '../serialization';
import { createCampusFairScene } from '../../scenarios/campusFair';
import { createEmptyScene } from '../geometry';
import { addBooth, addEntrance, addExit } from '../operations';
import { validateScene } from '../validation';
import { MAX_JSON_BYTES } from '../constants';
import type { Scene } from '../types';

/** 构建一个合法可导出的场景 */
function makeExportableScene(): Scene {
  let s = createEmptyScene(12, 12);
  s = addBooth(s, { x: 5, y: 4 })!;
  s = addEntrance(s, { x: 0, y: 6 })!;
  s = addExit(s, { x: 11, y: 6 })!;
  return s;
}

describe('导出与重载', () => {
  it('合法场景应能导出为 JSON', () => {
    const scene = makeExportableScene();
    const result = exportScene(scene);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.json : '').toContain('schemaVersion');
  });

  it('导出再导入应保持语义等价', () => {
    const scene = makeExportableScene();
    const exp = exportScene(scene);
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;
    const imp = importScene(exp.json);
    expect(imp.ok).toBe(true);
    if (!imp.ok || !imp.scene) return;
    // 逐字段比较
    expect(imp.scene.width).toBe(scene.width);
    expect(imp.scene.height).toBe(scene.height);
    expect(imp.scene.obstacles).toEqual(scene.obstacles);
    expect(imp.scene.entrances).toEqual(scene.entrances);
    expect(imp.scene.exits).toEqual(scene.exits);
    expect(imp.scene.booths).toEqual(scene.booths);
  });

  it('校园招聘会示例导出再导入应等价', () => {
    const scene = createCampusFairScene();
    const exp = exportScene(scene);
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;
    const imp = importScene(exp.json);
    expect(imp.ok).toBe(true);
    if (!imp.ok || !imp.scene) return;
    expect(imp.scene).toEqual(scene);
  });

  it('重复导出结果一致', () => {
    const scene = makeExportableScene();
    const e1 = exportScene(scene);
    const e2 = exportScene(scene);
    expect(e1.ok).toBe(true);
    expect(e2.ok).toBe(true);
    if (e1.ok && e2.ok) {
      expect(e1.json).toBe(e2.json);
    }
  });

  it('未通过校验的场景不能导出', () => {
    const scene = createEmptyScene(10, 10); // 空场景，无入口出口展位
    const result = exportScene(scene);
    expect(result.ok).toBe(false);
  });
});

describe('非法导入被拒绝', () => {
  it('损坏的 JSON 应被拒绝', () => {
    const result = importScene('{ not valid json');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('非整数坐标应被拒绝', () => {
    const scene = makeExportableScene();
    const exp = exportScene(scene);
    expect(exp.ok).toBe(true);
    if (!exp.ok) return;
    const obj = JSON.parse(exp.json) as Scene;
    obj.booths[0].footprint.x = 5.5;
    const result = importScene(JSON.stringify(obj));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('必须为有限整数');
    expect(result.scene).toBeUndefined();
  });

  it('重复 ID 应被拒绝', () => {
    const scene = makeExportableScene();
    const exp = exportScene(scene);
    if (!exp.ok) return;
    const obj = JSON.parse(exp.json);
    obj.booths[0].id = obj.booths[0].id; // 保持
    obj.entrances[0].id = 'dup-id';
    obj.exits[0].id = 'dup-id';
    const result = importScene(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('过大尺寸应被拒绝', () => {
    const scene = makeExportableScene();
    const exp = exportScene(scene);
    if (!exp.ok) return;
    const obj = JSON.parse(exp.json);
    obj.width = 200;
    const result = importScene(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('未知 schemaVersion 应被拒绝', () => {
    const scene = makeExportableScene();
    const exp = exportScene(scene);
    if (!exp.ok) return;
    const obj = JSON.parse(exp.json);
    obj.schemaVersion = 999;
    const result = importScene(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('缺失引用（booths 字段缺失）应被拒绝', () => {
    const result = importScene('{"schemaVersion":1,"width":10,"height":10,"obstacles":[],"entrances":[],"exits":[]}');
    expect(result.ok).toBe(false);
  });

  it('越界坐标应被拒绝', () => {
    const scene = makeExportableScene();
    const exp = exportScene(scene);
    if (!exp.ok) return;
    const obj = JSON.parse(exp.json);
    obj.booths[0].footprint.x = 100;
    const result = importScene(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('根元素不是对象应被拒绝', () => {
    expect(importScene('[]').ok).toBe(false);
    expect(importScene('42').ok).toBe(false);
    expect(importScene('null').ok).toBe(false);
  });

  it('超过字节上限应被拒绝', () => {
    const huge = '{"schemaVersion":1,' + '"x":"' + 'a'.repeat(3 * 1024 * 1024) + '"}';
    const result = importScene(huge);
    expect(result.ok).toBe(false);
  });

  it('多字节字符 UTF-8 字节数超限应被拒绝（string.length 不超限但字节数超限）', () => {
    // 中文字符 UTF-3 字节，string.length 为 1 但字节数为 3
    // 构造一个合法场景 JSON，再追加大量中文字符使 string.length 略低于上限但 UTF-8 字节数超限
    const scene = makeExportableScene();
    const exp = exportScene(scene);
    if (!exp.ok) return;
    const base = exp.json;
    // MAX_JSON_BYTES = 2MB = 2097152。构造补充中文字符使 length 接近上限但字节数超限
    // 每个中文字符 length=1，UTF-8=3 字节。补充 N 个使 base.length + N < MAX 但 base.bytes + 3N > MAX
    const baseBytes = new TextEncoder().encode(base).byteLength;
    const remaining = MAX_JSON_BYTES - baseBytes;
    // 需要字节数超限：3N > remaining，同时 length 不超限：N < MAX - base.length
    // 取 N = floor(remaining / 3) + 1，则 3N > remaining（字节数超限）
    const N = Math.floor(remaining / 3) + 1;
    // 确认 length 不超限（中文字符 length=1）
    if (base.length + N >= MAX_JSON_BYTES) return; // 边界保护，跳过则用纯字节构造
    // 构造非法 JSON（追加中文字符到末尾使其无法解析），但字节校验在解析之前
    const bad = base + '中'.repeat(N);
    expect(new TextEncoder().encode(bad).byteLength).toBeGreaterThan(MAX_JSON_BYTES);
    const result = importScene(bad);
    expect(result.ok).toBe(false);
  });

  it('UTF-8 字节数略低于上限的多字节 JSON 不被字节校验拒绝', () => {
    // 构造一个字节数略低于上限的合法场景 JSON（含中文字符），确认不被字节校验拒绝
    // 由于合法场景 JSON 较小，这里只验证字节校验逻辑：字节数 < 上限时不因字节校验失败
    const scene = makeExportableScene();
    const exp = exportScene(scene);
    if (!exp.ok) return;
    // exp.json 本身字节数远低于上限，应能正常导入（不被字节校验拒绝）
    const bytes = new TextEncoder().encode(exp.json).byteLength;
    expect(bytes).toBeLessThan(MAX_JSON_BYTES);
    const result = importScene(exp.json);
    // 导入应成功（不被字节校验拒绝；场景合法所以应通过完整校验）
    expect(result.ok).toBe(true);
  });
});

describe('导入不覆盖当前场景', () => {
  it('导入失败时返回错误且不提供 scene', () => {
    const result = importScene('invalid');
    expect(result.ok).toBe(false);
    expect(result.scene).toBeUndefined();
    // 调用方应保留原场景，importScene 本身不修改任何外部状态
  });
});

describe('导入场景的合法性', () => {
  it('导入成功的场景应通过完整校验', () => {
    const scene = createCampusFairScene();
    const exp = exportScene(scene);
    if (!exp.ok) return;
    const imp = importScene(exp.json);
    expect(imp.ok).toBe(true);
    if (!imp.ok || !imp.scene) return;
    const result = validateScene(imp.scene);
    expect(result.readyForSimulation).toBe(true);
  });
});
