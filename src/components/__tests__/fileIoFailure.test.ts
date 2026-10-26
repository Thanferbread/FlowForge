// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { downloadJson } from '../fileIo';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('a failed download releases its Blob URL and temporary link, then permits retry', () => {
  const create = vi.fn().mockReturnValue('blob:failed-download');
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementationOnce(() => { throw new Error('download unavailable'); })
    .mockImplementation(() => {});
  expect(() => downloadJson('{"tick":1}', 'report.json')).toThrow('download unavailable');
  expect(document.querySelector('a')).toBeNull();
  expect(revoke).toHaveBeenCalledWith('blob:failed-download');
  expect(() => downloadJson('{"tick":1}', 'retry.json')).not.toThrow();
  expect(click).toHaveBeenCalledTimes(2);
  expect(revoke).toHaveBeenCalledTimes(2);
  expect(document.querySelector('a')).toBeNull();
});
