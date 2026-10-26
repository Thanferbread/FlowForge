/**
 * 文件 IO 工具测试：downloadJson / readJsonFile。
 * 使用 jsdom 环境提供 Blob/URL/FileReader/HTMLAnchorElement 等 DOM API。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downloadJson, readJsonFile } from '../fileIo';

describe('downloadJson', () => {
  beforeEach(() => {
    // jsdom 未实现 Blob URL；只补齐缺失的浏览器 API，下载逻辑仍调用真实函数。
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn((_blob: Blob) => 'blob:flowforge-test');
      static revokeObjectURL = vi.fn((_url: string) => {});
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('应创建 Blob 并触发一次下载点击', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true);
    });
    const createObjectUrlSpy = vi.mocked(URL.createObjectURL);
    const revokeObjectUrlSpy = vi.mocked(URL.revokeObjectURL);
    const json = '{"test":true}';
    const filename = 'scene.json';

    downloadJson(json, filename);

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    const blob = createObjectUrlSpy.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
    expect(await readJsonFile(new File([blob], filename))).toBe(json);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe('blob:flowforge-test');
    expect(anchor.download).toBe(filename);
    expect(anchor.isConnected).toBe(false);
    expect(revokeObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:flowforge-test');
    expect(document.querySelector('a')).toBeNull();
  });

  it('不同 JSON 内容应生成不同 Blob', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectUrlSpy = vi.mocked(URL.createObjectURL);
    downloadJson('{"a":1}', 'a.json');
    downloadJson('{"b":2}', 'b.json');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(2);
    const firstBlob = createObjectUrlSpy.mock.calls[0][0] as Blob;
    const secondBlob = createObjectUrlSpy.mock.calls[1][0] as Blob;
    expect(firstBlob).toBeInstanceOf(Blob);
    expect(secondBlob).toBeInstanceOf(Blob);
    expect(firstBlob).not.toBe(secondBlob);
    expect(await readJsonFile(new File([firstBlob], 'a.json'))).toBe('{"a":1}');
    expect(await readJsonFile(new File([secondBlob], 'b.json'))).toBe('{"b":2}');
    expect(clickSpy).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe('readJsonFile', () => {
  it('应读取文件文本内容', async () => {
    const file = new File(['{"hello":"world"}'], 'test.json', { type: 'application/json' });
    const text = await readJsonFile(file);
    expect(text).toBe('{"hello":"world"}');
  });

  it('应支持中文内容', async () => {
    const file = new File(['{"名称":"测试"}'], 'cn.json', { type: 'application/json' });
    const text = await readJsonFile(file);
    expect(text).toBe('{"名称":"测试"}');
  });
});
