import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function seedStarterData(appRoot, dataRoot, registryPath, reviewRoot) {
  const markerPath = path.join(dataRoot, "data", ".starter-data-v1.json");
  try {
    await stat(markerPath);
    return { seeded: false, reason: "already_seeded" };
  } catch {
    // Continue below. A missing marker means this app-data folder has never
    // received starter content, even if an earlier app version created an
    // empty registry file before the starter-copy step existed.
  }

  let existingItems = [];
  try { existingItems = JSON.parse(await readFile(registryPath, "utf8")); }
  catch { /* a new data folder has no registry yet */ }
  if (Array.isArray(existingItems) && existingItems.length > 0) {
    await mkdir(path.dirname(markerPath), { recursive: true });
    await writeFile(markerPath, `${JSON.stringify({ schemaVersion: 1, skippedAt: new Date().toISOString(), reason: "existing_items" }, null, 2)}\n`);
    return { seeded: false, reason: "existing_items" };
  }

  const starterRoot = path.join(appRoot, "starter");
  const starterItems = JSON.parse(await readFile(path.join(starterRoot, "generated-review-items.json"), "utf8"));
  await cp(path.join(starterRoot, "review"), reviewRoot, { recursive: true });
  const hydratedItems = JSON.parse(JSON.stringify(starterItems).replaceAll("__USER_DATA__", dataRoot));
  await mkdir(path.dirname(registryPath), { recursive: true });
  await writeFile(registryPath, `${JSON.stringify(hydratedItems, null, 2)}\n`);
  await writeFile(markerPath, `${JSON.stringify({ schemaVersion: 1, seededAt: new Date().toISOString(), items: hydratedItems.map((item) => item.id) }, null, 2)}\n`);
  return { seeded: true, items: hydratedItems.length };
}
