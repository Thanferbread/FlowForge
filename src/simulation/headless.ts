/**
 * Headless 纯计算入口。
 *
 * 复用 createEngine 与有界 runTo(H)，不依赖文件/时钟/DOM。
 * 初始化失败返回 {ok:false, error} 无报告；
 * 执行失败附最后有效边界的部分报告。
 *
 * 不能用 while(!isComplete) 忽略 failed 而无限执行。
 */
import type { Scene } from '../domain/types';
import type { SimulationConfig, ExogenousDemand, RunReport } from './types';
import { createEngine } from './engine';

/**
 * 运行 headless 仿真。
 * @param scene 场景
 * @param config 配置
 * @param demands 注入需求（省略则自动生成）
 * @returns 成功返回完整报告，失败返回错误（可选部分报告）
 */
export function runHeadless(
  scene: Scene,
  config: SimulationConfig,
  demands?: ExogenousDemand[],
): { ok: true; report: RunReport } | { ok: false; error: string; report?: RunReport } {
  const result = createEngine(scene, config, demands);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const engine = result.engine;
  const advanceResult = engine.runTo(config.H);

  const report = engine.getReport();

  if (!advanceResult.ok) {
    return { ok: false, error: advanceResult.error, report };
  }

  return { ok: true, report };
}
