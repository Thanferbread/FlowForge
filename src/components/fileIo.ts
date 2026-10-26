/**
 * 浏览器文件 IO 工具：导出下载与导入读取。
 *
 * 依赖 Blob/URL/FileReader 等 DOM API，故放在 src/components/ 而非 src/domain/
 * （domain 层须保持纯函数、不依赖 DOM，可被 Vitest 在 node 环境直接测试）。
 */

/** 触发浏览器下载 JSON 文件 */
export function downloadJson(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  try {
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
  } finally {
    try {
      if (a.parentNode) a.parentNode.removeChild(a);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** 读取文件为文本，解析由 importScene 负责（单一职责） */
export function readJsonFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('文件内容无法读取为文本'));
      }
    };
    reader.onerror = () => {
      reject(new Error(reader.error?.message ?? '文件读取失败'));
    };
    reader.readAsText(file);
  });
}
