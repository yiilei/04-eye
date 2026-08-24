import { cp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function seedStarterData(appRoot, dataRoot, registryPath, reviewRoot) {
  try {
    await stat(registryPath);
    return { seeded: false };
  } catch {
    const starterRoot = path.join(appRoot, "starter");
    const starterItems = JSON.parse(await readFile(path.join(starterRoot, "generated-review-items.json"), "utf8"));
    await cp(path.join(starterRoot, "review"), reviewRoot, { recursive: true });
    const hydratedItems = JSON.parse(JSON.stringify(starterItems).replaceAll("__USER_DATA__", dataRoot));
    await writeFile(registryPath, `${JSON.stringify(hydratedItems, null, 2)}\n`);
    return { seeded: true, items: hydratedItems.length };
  }
}
