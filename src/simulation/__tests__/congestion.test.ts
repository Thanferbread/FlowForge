/** 精确验证拥堵连续采样阈值、失败原因和暴露并集。 */
import { describe, expect, it } from 'vitest';
import { detectCongestion, exposeCongestion } from '../congestion';
import type { AgentRecord, MovementFailure } from '../types';

function failure(reason: MovementFailure['reason'] = 'occupied'): MovementFailure {
  return { agentId: 'blocked', sampleTick: 1, pos: { x: 1, y: 1 }, state: 'walking', reason };
}

function agent(id: string, state: AgentRecord['state'], x: number, y: number): AgentRecord {
  return {
    id, state, pos: { x, y },
    demand: { id, scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 4 },
    remainingService: null, admitTick: 0, enqueueTick: null, serviceStartTick: null,
    serviceCompleteTick: null, reachExitTick: null, exitTick: null, selectedExitId: null,
    consecutiveFailures: 0, replanCount: 0, replanPath: null,
  };
}

describe('S14: 连续拥堵判定', () => {
  const center = { x: 1, y: 1 };
  const dense = [{ center, density: 0.6 }];

  it('前四次不拥堵，第五次起拥堵，暴露不追计前四次', () => {
    let streaks = new Map<string, number>();
    let totalExposure = 0;
    const walker = agent('blocked', 'walking', 1, 1);
    for (let tick = 1; tick <= 6; tick++) {
      const result = detectCongestion(streaks, dense, [{ ...failure(), sampleTick: tick }]);
      streaks = result.updatedStreaks;
      expect(streaks.get('1,1')).toBe(tick);
      expect(result.centers).toEqual(tick < 5 ? [] : [center]);
      const exposure = exposeCongestion(result.centers, [walker], 3, 3);
      expect(exposure).toBe(tick < 5 ? 0 : 1);
      totalExposure += exposure;
    }
    expect(totalExposure).toBe(2);
  });

  it.each(['occupied', 'conflict'] as const)('%s 失败可触发第 5 次拥堵', (reason) => {
    expect(detectCongestion(new Map([['1,1', 4]]), dense, [failure(reason)]).centers).toEqual([center]);
  });

  it('纯 no-path 失败不触发拥堵，并清零此前连续计数', () => {
    const result = detectCongestion(new Map([['1,1', 4]]), dense, [failure('no-path')]);
    expect(result.centers).toEqual([]);
    expect(result.updatedStreaks.get('1,1')).toBe(0);
  });

  it.each([
    { description: '密度降低', density: 0.59, failures: [failure()] },
    { description: '无面积采样', density: null, failures: [failure()] },
    { description: '没有占位/竞争失败', density: 0.9, failures: [] },
    { description: '失败人员在邻域外', density: 0.9, failures: [{ ...failure(), pos: { x: 3, y: 1 } }] },
  ])('$description 时中断，之后重新连续五次才触发', ({ density, failures }) => {
    const interrupted = detectCongestion(new Map([['1,1', 4]]), [{ center, density }], failures);
    expect(interrupted.centers).toEqual([]);
    expect(interrupted.updatedStreaks.get('1,1')).toBe(0);
    let streaks = interrupted.updatedStreaks;
    for (let tick = 1; tick <= 5; tick++) {
      const result = detectCongestion(streaks, dense, [failure()]);
      expect(result.centers).toEqual(tick < 5 ? [] : [center]);
      streaks = result.updatedStreaks;
    }
  });
});

describe('S15: 拥堵暴露的空间并集', () => {
  it('重叠与重复邻域中每名 walking/exiting 只计一次，不计排队服务或界外人员', () => {
    const agents = [
      agent('overlap', 'walking', 1, 1), agent('exiting', 'exiting', 2, 1),
      agent('edge', 'walking', 0, 0), agent('queued', 'queued', 1, 0),
      agent('serving', 'serving', 2, 0), agent('outside-union', 'walking', 4, 2),
      agent('outside-map', 'walking', -1, 0),
    ];
    const centers = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }];
    expect(exposeCongestion(centers, agents, 5, 3)).toBe(3);
    expect(exposeCongestion([], agents, 5, 3)).toBe(0);
  });
});
