import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("embedded browser JavaScript parses, not just the Python wrapper", () => {
  const expressions = JSON.parse(execFileSync("/usr/bin/python3", ["-c", `
import ast, json
from pathlib import Path
tree = ast.parse(Path('scripts/xhs-events-browser.py').read_text())
print(json.dumps([n.args[0].value for n in ast.walk(tree)
 if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
 and n.func.attr in ('evaluate', 'evaluate_all') and n.args
 and isinstance(n.args[0], ast.Constant)]))
`], { encoding: "utf8" }));
  assert.ok(expressions.length >= 2);
  for (const expression of expressions) assert.doesNotThrow(() => new Function(`return (${expression});`));
});
