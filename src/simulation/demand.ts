/**
 * 外生需求生成与注入校验。
 *
 * - generateDemands：scheduledTick=floor(i×H/N)，入口/展位按稳定 ID 排序，
 *   服务时长取展位闭区间整数，每条需求消费三次 next()，按 (scheduledTick, id) 排序。
 * - validateInjectedDemands：逐条校验 ID 唯一非空、scheduledTick 非负安全整数、
 *   引用有效、服务时长在闭区间内、数组长度与资源预算。
 *
 * 纯函数，不依赖 React/Canvas/DOM/Math.random。
 */
import type { Scene } from '../domain/types';
import type { SimulationConfig, ExogenousDemand, Rng } from './types';
import { MAX_INPUT_RECORDS, MAX_H_TIMES_DEMANDS } from './constants';

/** 非.locale 字典序比较 */
function lexCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * 自动生成外生需求。
 *
 * - demandCount=0 返回空数组。
 * - scheduledTick = floor(i × H / N)。
 * - 入口/展位候选先按稳定 ID 排序（非 localeCompare）。
 * - 每条需求固定消费三次 next（入口、展位、服务时长），即使候选数为 1 也消费一次。
 * - 最后按 (scheduledTick 升序, id 升序) 稳定排序。
 */
export function generateDemands(
  scene: Scene,
  config: SimulationConfig,
  rng: Rng,
): ExogenousDemand[] {
  const N = config.demandCount;
  if (N <= 0) return [];

  const entranceCandidates = [...scene.entrances].sort((a, b) => lexCompare(a.id, b.id));
  const boothCandidates = [...scene.booths].sort((a, b) => lexCompare(a.id, b.id));

  if (entranceCandidates.length === 0 || boothCandidates.length === 0) return [];

  const demands: ExogenousDemand[] = [];
  for (let i = 0; i < N; i++) {
    const scheduledTick = Math.floor((i * config.H) / N);

    const entranceIdx = rng.next() % entranceCandidates.length;
    const boothIdx = rng.next() % boothCandidates.length;
    const booth = boothCandidates[boothIdx];
    const serviceRange = booth.serviceTicksMax - booth.serviceTicksMin + 1;
    const serviceTicks = booth.serviceTicksMin + (rng.next() % serviceRange);

    demands.push({
      id: `agent-${i + 1}`,
      scheduledTick,
      entranceId: entranceCandidates[entranceIdx].id,
      boothId: booth.id,
      serviceTicks,
    });
  }

  demands.sort((a, b) => {
    if (a.scheduledTick !== b.scheduledTick) return a.scheduledTick - b.scheduledTick;
    return lexCompare(a.id, b.id);
  });

  return demands;
}

/**
 * 校验注入需求。
 *
 * - ID 非空唯一（重复返回「需求 ID 重复」）。
 * - scheduledTick 为非负安全整数。
 * - entranceId 引用场景存在的入口。
 * - boothId 引用场景存在的展位。
 * - serviceTicks 为正整数且在目标展位 [serviceTicksMin, serviceTicksMax] 闭区间内。
 * - 数组长度 ≤ MAX_INPUT_RECORDS 且 H × 完整长度 ≤ MAX_H_TIMES_DEMANDS。
 * - 不与自动生成拼接。时域外记录（scheduledTick ≥ H）通过校验。
 */
export function validateInjectedDemands(
  demands: ExogenousDemand[],
  scene: Scene,
  config: SimulationConfig,
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(demands)) {
    return { ok: false, error: '需求列表不是数组' };
  }

  if (demands.length > MAX_INPUT_RECORDS) {
    return { ok: false, error: `需求记录数 ${demands.length} 超过上限 ${MAX_INPUT_RECORDS}` };
  }

  if (config.H * demands.length > MAX_H_TIMES_DEMANDS) {
    return { ok: false, error: `H × 记录数 ${config.H * demands.length} 超过预算 ${MAX_H_TIMES_DEMANDS}` };
  }

  const entranceIds = new Set(scene.entrances.map((e) => e.id));
  const boothMap = new Map(scene.booths.map((b) => [b.id, b]));
  const seenIds = new Set<string>();

  for (let i = 0; i < demands.length; i++) {
    const d = demands[i];

    if (d === null || typeof d !== 'object' || Array.isArray(d)) {
      return { ok: false, error: `第 ${i + 1} 条需求不是对象` };
    }

    if (!d.id || typeof d.id !== 'string') {
      return { ok: false, error: `第 ${i + 1} 条需求 ID 为空或非字符串` };
    }
    if (seenIds.has(d.id)) {
      return { ok: false, error: '需求 ID 重复' };
    }
    seenIds.add(d.id);

    if (!Number.isSafeInteger(d.scheduledTick) || d.scheduledTick < 0) {
      return { ok: false, error: `需求 ${d.id} 的 scheduledTick 不是非负安全整数` };
    }

    if (!entranceIds.has(d.entranceId)) {
      return { ok: false, error: `需求 ${d.id} 引用不存在的入口 ${d.entranceId}` };
    }

    const booth = boothMap.get(d.boothId);
    if (!booth) {
      return { ok: false, error: `需求 ${d.id} 引用不存在的展位 ${d.boothId}` };
    }

    if (!Number.isInteger(d.serviceTicks) || d.serviceTicks < 1) {
      return { ok: false, error: `需求 ${d.id} 的 serviceTicks 不是正整数` };
    }
    if (d.serviceTicks < booth.serviceTicksMin || d.serviceTicks > booth.serviceTicksMax) {
      return { ok: false, error: `需求 ${d.id} 的 serviceTicks ${d.serviceTicks} 不在展位 ${d.boothId} 的闭区间 [${booth.serviceTicksMin}, ${booth.serviceTicksMax}] 内` };
    }
  }

  return { ok: true };
}
