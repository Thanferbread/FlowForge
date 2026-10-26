import { describe, expect, it } from 'vitest';
import { stableStringify } from '../hash';

describe('R01: stable JSON round trips', () => {
  it('round trips nested objects, arrays, null and Unicode', () => {
    const value = { z: ['中文', 0, null, { b: false, a: '换行\n引号"' }], a: 1 };
    const json = stableStringify(value);
    expect(JSON.parse(json)).toEqual(value);
    expect(json).toBe(stableStringify({ a: 1, z: value.z }));
    expect(json.endsWith('\n')).toBe(false);
  });

  it.each([undefined, { a: undefined }, [undefined], Number.NaN, Infinity])(
    'rejects non-JSON values rather than silently discarding them: %j',
    (value) => expect(() => stableStringify(value)).toThrow(),
  );

  it('rejects sparse arrays and non-JSON containers', () => {
    expect(() => stableStringify(Array(2))).toThrow();
    expect(() => stableStringify(new Map([['a', 1]]))).toThrow();
    expect(() => stableStringify(new Set([1]))).toThrow();
  });

  it('rejects cycles while allowing repeated independent references', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow();
    const shared = { value: 1 };
    expect(JSON.parse(stableStringify([shared, shared]))).toEqual([{ value: 1 }, { value: 1 }]);
  });
});
