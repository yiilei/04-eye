import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const currentDataHome = path.join(os.homedir(), "Library", "Application Support", "采光");
export const legacyDataHome = path.join(os.homedir(), "Library", "Application Support", "04的眼");

const exists = async (filename) => stat(filename).then(() => true).catch(() => false);
const readJson = async (filename, fallback) => {
  try { return JSON.parse(await readFile(filename, "utf8")); } catch { return fallback; }
};
const atomicJson = async (filename, value) => {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, filename);
};

function replaceRoot(value, oldRoot, newRoot) {
  if (typeof value === "string") return value.startsWith(oldRoot) ? `${newRoot}${value.slice(oldRoot.length)}` : value;
  if (Array.isArray(value)) return value.map((entry) => replaceRoot(entry, oldRoot, newRoot));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceRoot(entry, oldRoot, newRoot)]));
  }
  return value;
}

async function copyMissingTree(source, target) {
  if (!await exists(source)) return;
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true, force: false, errorOnExist: false, preserveTimestamps: true });
}

function mergeById(legacy, current, keyFor) {
  const merged = new Map();
  for (const item of legacy) merged.set(keyFor(item), item);
  for (const item of current) merged.set(keyFor(item), item);
  return [...merged.values()].filter(Boolean);
}

export async function migrateLegacyData(newRoot = currentDataHome, oldRoot = legacyDataHome) {
  const resolvedNew = path.resolve(newRoot);
  const resolvedOld = path.resolve(oldRoot);
  const marker = path.join(resolvedNew, "data", ".legacy-migration-v1.json");
  if (await exists(marker)) return { migrated: false, reason: "already_migrated" };
  if (resolvedNew === resolvedOld || !await exists(resolvedOld)) return { migrated: false, reason: "legacy_missing" };

  await mkdir(path.join(resolvedNew, "data"), { recursive: true });
  for (const folder of ["review", "trash", "xhs-cli"]) {
    await copyMissingTree(path.join(resolvedOld, folder), path.join(resolvedNew, folder));
  }

  const oldData = path.join(resolvedOld, "data");
  const newData = path.join(resolvedNew, "data");
  const oldRegistry = replaceRoot(await readJson(path.join(oldData, "generated-review-items.json"), []), resolvedOld, resolvedNew);
  const newRegistry = await readJson(path.join(newData, "generated-review-items.json"), []);
  const registry = mergeById(oldRegistry, newRegistry, (item) => item?.id);
  await atomicJson(path.join(newData, "generated-review-items.json"), registry);

  for (const filename of ["review-decisions.json", "review-trash.json"]) {
    const legacy = replaceRoot(await readJson(path.join(oldData, filename), {}), resolvedOld, resolvedNew);
    const current = await readJson(path.join(newData, filename), {});
    await atomicJson(path.join(newData, filename), { ...legacy, ...current });
  }

  const legacyPins = await readJson(path.join(oldData, "xhs-pending-pins.json"), { accounts: [] });
  const currentPins = await readJson(path.join(newData, "xhs-pending-pins.json"), { accounts: [] });
  const accounts = mergeById(legacyPins.accounts || [], currentPins.accounts || [], (account) => account?.profileId || account?.profileUrl);
  await atomicJson(path.join(newData, "xhs-pending-pins.json"), {
    schemaVersion: 1,
    updatedAt: currentPins.updatedAt || legacyPins.updatedAt || null,
    accounts,
  });

  const legacyPreferences = await readJson(path.join(oldData, "user-preferences.json"), null);
  const currentPreferences = await readJson(path.join(newData, "user-preferences.json"), null);
  const newestPreferences = !currentPreferences ? legacyPreferences : !legacyPreferences ? currentPreferences
    : String(currentPreferences.updatedAt || "") >= String(legacyPreferences.updatedAt || "") ? currentPreferences : legacyPreferences;
  if (newestPreferences) await atomicJson(path.join(newData, "user-preferences.json"), newestPreferences);

  const legacyState = await readJson(path.join(oldData, "scheduler-state.json"), null);
  const currentState = await readJson(path.join(newData, "scheduler-state.json"), null);
  if (legacyState || currentState) await atomicJson(path.join(newData, "scheduler-state.json"), { ...(legacyState || {}), ...(currentState || {}) });

  await atomicJson(marker, { schemaVersion: 1, migratedAt: new Date().toISOString(), from: resolvedOld });
  return { migrated: true, from: resolvedOld, to: resolvedNew, registryItems: registry.length };
}
