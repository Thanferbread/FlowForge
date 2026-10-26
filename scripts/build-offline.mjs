import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Inline the real production build, so the public source ZIP is usable without Node.js.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const target = path.join(root, 'submission', '离线体验');
const publicEntry = path.join(root, '打开FlowForge.html');

function readAsset(url) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) throw new Error(`External build asset: ${url}`);
  const file = path.resolve(dist, decodeURIComponent(url.replace(/^\.?\//, '')));
  if (!file.startsWith(dist + path.sep)) throw new Error(`Asset outside dist: ${url}`);
  return fs.readFileSync(file, 'utf8');
}

function assertSelfContainedJavaScript(source) {
  const ast = ts.createSourceFile('offline-bundle.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (ast.parseDiagnostics.length > 0) throw new Error('Production bundle could not be parsed');
  function visit(node) {
    const staticImport = ts.isImportDeclaration(node)
      || (ts.isExportDeclaration(node) && node.moduleSpecifier)
      || (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference));
    const dynamicImport = ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
    if (staticImport || dynamicImport) {
      throw new Error('Offline build requires a single JavaScript bundle without imports');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}

let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replace(/<div id="root">[\s\S]*?<\/div>/, '<div id="root"><p style="padding: 24px; font-family: system-ui, sans-serif;">FlowForge 正在启动，请使用桌面 Chrome 或 Edge。</p></div>');
let scriptCount = 0;
html = html.replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g, (_match, url) => {
  // Vite currently emits a single self-contained module. Refuse split chunks rather
  // than producing an offline entry that silently depends on sibling files.
  const source = readAsset(url).replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  assertSelfContainedJavaScript(source);
  const code = source.replace(/<\/script/gi, '<\\/script');
  scriptCount += 1;
  return `<script type="module">${code}</script>`;
});
html = html.replace(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g, (_match, url) => {
  const css = readAsset(url);
  const urls = Array.from(css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi));
  if (/@import\b/i.test(css) || urls.some((match) => !/^(?:data:|#)/i.test(match[1] ?? match[2] ?? match[3]))) {
    throw new Error('Offline build requires inline CSS assets');
  }
  return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
});
if (scriptCount !== 1 || /<script\b[^>]*\bsrc=|<link\b[^>]*\b(?:stylesheet|modulepreload)\b/i.test(html)) {
  throw new Error('Offline build contains unresolved script or stylesheet dependencies');
}

const notices = 'FlowForge offline bundle: third-party notices\n\n' + ['react', 'react-dom', 'scheduler']
  .map((name) => `${name}\n${fs.readFileSync(path.join(root, 'node_modules', name, 'LICENSE'), 'utf8')}`)
  .join('\n\n');
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notices, 'utf8');
html = html.replace('</head>', `<!--\n${notices.replace(/-->/g, '-- >')}\n-->\n</head>`);

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(publicEntry, html, 'utf8');
fs.writeFileSync(path.join(target, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(target, '打开说明.txt'), '双击本目录 index.html 使用离线版；公开源码ZIP解压后请双击根目录“打开FlowForge.html”。\r\n无需联网、安装Node.js或安装依赖。建议桌面Chrome或Edge。\r\n根目录 index.html 是开发入口，须使用 npm ci 和 npm run dev 启动。\r\n数据仅在当前页面内存中；离开前请导出场景和报告。\r\n', 'utf8');
console.log(`Offline app: ${publicEntry} (${Buffer.byteLength(html)} bytes)`);
console.log(`Submission copy: ${path.join(target, 'index.html')}`);
