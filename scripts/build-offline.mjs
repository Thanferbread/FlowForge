import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const dist = path.join(root, 'dist');
const target = path.join(root, 'submission', '离线体验');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (_match, url) => {
  const file = path.resolve(dist, url.replace(/^\.?\//, ''));
  if (!file.startsWith(dist + path.sep)) throw new Error('Asset outside dist');
  const code = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${code}</script>`;
});
html = html.replace(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g, (_match, url) => {
  const file = path.resolve(dist, url.replace(/^\.?\//, ''));
  if (!file.startsWith(dist + path.sep)) throw new Error('Asset outside dist');
  return `<style>${fs.readFileSync(file, 'utf8').replace(/<\/style/gi, '<\\/style')}</style>`;
});
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(target, '打开说明.txt'), '双击 index.html 使用本地离线版。无需联网或安装依赖。建议桌面 Chrome 或 Edge。\r\n若浏览器限制本地模块，请在源码目录运行 npm ci 和 npm run dev，或使用静态服务器托管本目录。\r\n数据仅在当前页面内存中；离开前请导出场景和报告。\r\n', 'utf8');
console.log(`Offline app: ${path.join(target, 'index.html')} (${Buffer.byteLength(html)} bytes)`);
