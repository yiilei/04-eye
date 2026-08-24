import path from "node:path";

export function isolatedXhsEnv(dataHome, baseEnv = process.env) {
  return {
    ...baseEnv,
    XHS_CLI_CONFIG_DIR: path.join(dataHome, "xhs-cli"),
    XHS_CLI_DISABLE_BROWSER_COOKIE: "1",
    NO_COLOR: "1",
  };
}
