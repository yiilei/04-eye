import path from "node:path";
import { fileURLToPath } from "node:url";

const bundledXhsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", "xhs-cli");

export function isolatedXhsEnv(dataHome, baseEnv = process.env) {
  return {
    ...baseEnv,
    PYTHONPATH: [bundledXhsRoot, baseEnv.PYTHONPATH].filter(Boolean).join(path.delimiter),
    XHS_CLI_CONFIG_DIR: path.join(dataHome, "xhs-cli"),
    XHS_CLI_DISABLE_BROWSER_COOKIE: baseEnv.XHS_CLI_DISABLE_BROWSER_COOKIE ?? "1",
    CAIGUANG_CHROME_FALLBACK: baseEnv.CAIGUANG_CHROME_FALLBACK ?? "1",
    NO_COLOR: "1",
  };
}
