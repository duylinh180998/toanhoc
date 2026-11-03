#!/usr/bin/env node
/**
 * Đóng gói toàn bộ game thành MỘT file HTML duy nhất: dist/mathgraph-arena.html
 *   node tools/build.mjs
 *
 * - Gộp css/style.css vào <style>.
 * - Gộp các ES module (bắt đầu từ js/main.js) theo thứ tự phụ thuộc; mỗi module được bọc trong
 *   một IIFE riêng nên tên biến giữa các file không bao giờ đụng nhau.
 * - Nếu đã `npm install` (có node_modules/mathjs) thì nhúng luôn math.js ⇒ file chạy offline 100%,
 *   mở trực tiếp bằng double-click (file://). Nếu chưa, giữ thẻ <script> CDN.
 *
 * Quy ước code để bundler đơn giản này hoạt động: chỉ dùng
 *   import { a, b } from './x.js';   và   export const|let|function|class ...
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'dist', 'mathgraph-arena.html');
const MATHJS_LOCAL = join(ROOT, 'node_modules', 'mathjs', 'lib', 'browser', 'math.js');

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;

const modules = new Map(); // path tuyệt đối → { id, code, imports: [{ names, path }], exports }
const order = [];

async function load(path, stack = []) {
  if (modules.has(path)) return;
  if (stack.includes(path)) throw new Error(`Vòng lặp import: ${[...stack, path].map((p) => relative(ROOT, p)).join(' → ')}`);
  const source = await readFile(path, 'utf8');
  const imports = [...source.matchAll(IMPORT_RE)].map(([, names, spec]) => ({
    names: names.split(',').map((n) => n.trim()).filter(Boolean),
    path: resolve(dirname(path), spec),
  }));
  for (const name of imports.flatMap((i) => i.names)) {
    if (/\s+as\s+/.test(name)) throw new Error(`${relative(ROOT, path)}: bundler không hỗ trợ "import { a as b }"`);
  }
  const exports = [...source.matchAll(EXPORT_RE)].map((m) => m[1]);
  const id = `__mod_${relative(ROOT, path).replace(/[^\w]/g, '_')}`;
  modules.set(path, { id, source, imports, exports });
  for (const dep of imports) await load(dep.path, [...stack, path]);
  order.push(path); // hậu thứ tự DFS ⇒ phụ thuộc luôn đứng trước
}

function wrap(path) {
  const mod = modules.get(path);
  const header = mod.imports
    .map((dep) => `const { ${dep.names.join(', ')} } = ${modules.get(dep.path).id};`)
    .join('\n');
  const body = mod.source.replace(IMPORT_RE, '').replace(/^export\s+/gm, '');
  return `// ── ${relative(ROOT, path)} ──\nconst ${mod.id} = (() => {\n${header}\n${body}\nreturn { ${mod.exports.join(', ')} };\n})();\n`;
}

const escapeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await load(join(ROOT, 'js', 'main.js'));
  const bundle = order.map(wrap).join('\n');
  const css = await readFile(join(ROOT, 'css', 'style.css'), 'utf8');
  let html = await readFile(join(ROOT, 'index.html'), 'utf8');

  html = html.replace(/<link rel="stylesheet" href="css\/style\.css">/, () => `<style>\n${css}\n</style>`);
  html = html.replace(/<script type="module" src="js\/main\.js"><\/script>/, () => `<script type="module">\n${escapeScript(bundle)}\n</script>`);

  const offline = await exists(MATHJS_LOCAL);
  if (offline) {
    const mathjs = await readFile(MATHJS_LOCAL, 'utf8');
    html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/mathjs@[^"]+"><\/script>/, () => `<script>\n${escapeScript(mathjs)}\n</script>`);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`✔ ${relative(ROOT, OUT)} (${kb} KB, ${order.length} module)`);
  console.log(offline
    ? '  math.js đã được nhúng — file chạy offline, mở trực tiếp bằng trình duyệt.'
    : '  math.js tải từ CDN (cần Internet). Chạy "npm install" trước khi build để nhúng offline.');
}

main().catch((err) => {
  console.error(`✘ Build lỗi: ${err.message}`);
  process.exit(1);
});
