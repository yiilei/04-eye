import { access, readFile } from "node:fs/promises";
import path from "node:path";

// Check native entry points before signing/replacing an app. A successful web
// build does not detect a missing Electron-side relative module.
export async function checkLocalModuleGraph(root, entries = ["desktop/main.mjs"]) {
  const seen = new Set();
  const pending = entries.map(entry => path.resolve(root, entry));
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, "utf8");
    const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.[^"']+)["']/g);
    for (const match of imports) {
      const dependency = path.resolve(path.dirname(file), match[1]);
      await access(dependency).catch(() => { throw new Error(`打包缺少模块：${path.relative(root, file)} -> ${match[1]}`); });
      if (dependency.endsWith(".mjs")) pending.push(dependency);
    }
  }
  return seen.size;
}
