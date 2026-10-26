import { describe, it, expect } from 'vitest';
import type { AgentView } from '../types';
import {
  clampProgress,
  isOrthoAdjacent,
  interpolatePos,
  computeAgentDisplays,
  computeProgress,
} from '../interpolation';

function agent(id: string, x: number, y: number, state: AgentView['state'] = 'walking'): AgentView {
  return { id, pos: { x, y }, state, remainingService: null };
}

describe('clampProgress', () => {
  it('夹紧到 [0, 1]', () => {
    expect(clampProgress(-0.5)).toBe(0);
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(0.5)).toBe(0.5);
    expect(clampProgress(1)).toBe(1);
    expect(clampProgress(1.5)).toBe(1);
  });
  it('NaN safely aligns to the committed position and infinity clamps', () => {
    expect(clampProgress(NaN)).toBe(1);
    expect(clampProgress(Infinity)).toBe(1);
    expect(clampProgress(-Infinity)).toBe(0);
  });
});

describe('isOrthoAdjacent', () => {
  it('正交相邻返回 true', () => {
    expect(isOrthoAdjacent({ x: 5, y: 5 }, { x: 6, y: 5 })).toBe(true);
    expect(isOrthoAdjacent({ x: 5, y: 5 }, { x: 5, y: 6 })).toBe(true);
    expect(isOrthoAdjacent({ x: 5, y: 5 }, { x: 4, y: 5 })).toBe(true);
    expect(isOrthoAdjacent({ x: 5, y: 5 }, { x: 5, y: 4 })).toBe(true);
  });
  it('同格、对角、远距离返回 false', () => {
    expect(isOrthoAdjacent({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(false);
    expect(isOrthoAdjacent({ x: 5, y: 5 }, { x: 6, y: 6 })).toBe(false);
    expect(isOrthoAdjacent({ x: 5, y: 5 }, { x: 7, y: 5 })).toBe(false);
    expect(isOrthoAdjacent({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false);
  });
  it('fractional or non-finite model positions are never treated as adjacent grid cells', () => {
    expect(isOrthoAdjacent({ x: 0.25, y: 0 }, { x: 1.25, y: 0 })).toBe(false);
    expect(isOrthoAdjacent({ x: NaN, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });
});

describe('interpolatePos', () => {
  it('progress=0 返回 from', () => {
    const pos = interpolatePos({ x: 3, y: 4 }, { x: 4, y: 4 }, 0);
    expect(pos).toEqual({ x: 3, y: 4 });
  });
  it('progress=1 返回 to', () => {
    const pos = interpolatePos({ x: 3, y: 4 }, { x: 4, y: 4 }, 1);
    expect(pos).toEqual({ x: 4, y: 4 });
  });
  it('progress=0.5 返回中点', () => {
    const pos = interpolatePos({ x: 3, y: 4 }, { x: 5, y: 4 }, 0.5);
    expect(pos).toEqual({ x: 4, y: 4 });
  });
  it('越界时间夹紧', () => {
    expect(interpolatePos({ x: 0, y: 0 }, { x: 2, y: 0 }, -1)).toEqual({ x: 0, y: 0 });
    expect(interpolatePos({ x: 0, y: 0 }, { x: 2, y: 0 }, 2)).toEqual({ x: 2, y: 0 });
  });
  it('Y 方向插值', () => {
    const pos = interpolatePos({ x: 3, y: 3 }, { x: 3, y: 6 }, 1 / 3);
    expect(pos.x).toBe(3);
    expect(pos.y).toBeCloseTo(4, 10);
  });
});

describe('computeAgentDisplays', () => {
  it('相邻移动插值', () => {
    const prev = [agent('a1', 5, 5)];
    const curr = [agent('a1', 6, 5)];
    const displays = computeAgentDisplays(prev, curr, 0.5);
    expect(displays).toHaveLength(1);
    expect(displays[0].displayPos).toEqual({ x: 5.5, y: 5 });
  });
  it('progress=0 对齐到 prev', () => {
    const prev = [agent('a1', 5, 5)];
    const curr = [agent('a1', 6, 5)];
    const displays = computeAgentDisplays(prev, curr, 0);
    expect(displays[0].displayPos).toEqual({ x: 5, y: 5 });
  });
  it('progress=1 对齐到 curr', () => {
    const prev = [agent('a1', 5, 5)];
    const curr = [agent('a1', 6, 5)];
    const displays = computeAgentDisplays(prev, curr, 1);
    expect(displays[0].displayPos).toEqual({ x: 6, y: 5 });
  });
  it('同格静止（等待/排队/服务）', () => {
    const prev = [agent('a1', 5, 5, 'queued')];
    const curr = [agent('a1', 5, 5, 'queued')];
    const displays = computeAgentDisplays(prev, curr, 0.5);
    expect(displays[0].displayPos).toEqual({ x: 5, y: 5 });
  });
  it('新入场者对齐到 curr，不从 (0,0) 飞入', () => {
    const prev: AgentView[] = [];
    const curr = [agent('a1', 10, 3)];
    const displays = computeAgentDisplays(prev, curr, 0.5);
    expect(displays).toHaveLength(1);
    expect(displays[0].displayPos).toEqual({ x: 10, y: 3 });
  });
  it('离场者不包含在结果中', () => {
    const prev = [agent('a1', 5, 5), agent('a2', 6, 6)];
    const curr = [agent('a2', 6, 6)];
    const displays = computeAgentDisplays(prev, curr, 0.5);
    expect(displays).toHaveLength(1);
    expect(displays[0].id).toBe('a2');
  });
  it('非相邻跳跃安全对齐到 curr', () => {
    const prev = [agent('a1', 0, 0)];
    const curr = [agent('a1', 5, 5)];
    const displays = computeAgentDisplays(prev, curr, 0.5);
    expect(displays[0].displayPos).toEqual({ x: 5, y: 5 });
  });
  it('状态变化使用 curr 状态', () => {
    const prev = [agent('a1', 5, 5, 'walking')];
    const curr = [agent('a1', 5, 5, 'queued')];
    const displays = computeAgentDisplays(prev, curr, 0.5);
    expect(displays[0].state).toBe('queued');
  });
  it('多人混合：移动+静止+新入+离场', () => {
    const prev = [agent('a1', 5, 5), agent('a2', 3, 3, 'queued'), agent('a3', 7, 7)];
    const curr = [agent('a1', 6, 5), agent('a2', 3, 3, 'queued'), agent('a4', 10, 10)];
    const displays = computeAgentDisplays(prev, curr, 0.5);
    expect(displays).toHaveLength(3);
    const d1 = displays.find((d) => d.id === 'a1')!;
    expect(d1.displayPos).toEqual({ x: 5.5, y: 5 });
    const d2 = displays.find((d) => d.id === 'a2')!;
    expect(d2.displayPos).toEqual({ x: 3, y: 3 });
    const d4 = displays.find((d) => d.id === 'a4')!;
    expect(d4.displayPos).toEqual({ x: 10, y: 10 });
    expect(displays.find((d) => d.id === 'a3')).toBeUndefined();
  });
  it('连续正交转弯：逐段插值不合成对角线', () => {
    const prev = [agent('a1', 5, 5)];
    const curr = [agent('a1', 6, 5)];
    const mid = computeAgentDisplays(prev, curr, 0.5);
    expect(mid[0].displayPos).toEqual({ x: 5.5, y: 5 });
    const next = computeAgentDisplays(curr, [agent('a1', 6, 6)], 0.5);
    expect(next[0].displayPos).toEqual({ x: 6, y: 5.5 });
  });
  it('空输入返回空数组', () => {
    expect(computeAgentDisplays([], [], 0.5)).toEqual([]);
  });
});

describe('computeProgress', () => {
  it('正常计算进度', () => {
    expect(computeProgress(500, 0, 1000)).toBe(0.5);
    expect(computeProgress(0, 0, 1000)).toBe(0);
    expect(computeProgress(1000, 0, 1000)).toBe(1);
  });
  it('越界夹紧', () => {
    expect(computeProgress(-100, 0, 1000)).toBe(0);
    expect(computeProgress(2000, 0, 1000)).toBe(1);
  });
  it('零或负间隔返回 1', () => {
    expect(computeProgress(500, 0, 0)).toBe(1);
    expect(computeProgress(500, 0, -1)).toBe(1);
  });
  it('4x 速度（250ms 间隔）', () => {
    expect(computeProgress(125, 0, 250)).toBe(0.5);
  });
  it('16x 速度（62.5ms 间隔）', () => {
    expect(computeProgress(31.25, 0, 62.5)).toBe(0.5);
  });
  it('invalid clocks align safely instead of propagating NaN to Canvas', () => {
    expect(computeProgress(NaN, 0, 1000)).toBe(1);
    expect(computeProgress(500, Infinity, 1000)).toBe(1);
    expect(computeProgress(500, 0, NaN)).toBe(1);
  });
});
