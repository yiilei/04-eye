export function schedulerInstallationIsCurrent({
  loaded,
  runnerSource,
  plistSource,
  schedulerEntry,
  runtimeNode,
  localRuntimeRunner,
  stdoutPath,
  stderrPath,
  runtimeNodeExists,
}) {
  if (!loaded || !runtimeNodeExists) return false;
  if (!runnerSource.includes(JSON.stringify(runtimeNode))) return false;
  if (!runnerSource.includes(JSON.stringify(schedulerEntry))) return false;
  return [localRuntimeRunner, stdoutPath, stderrPath]
    .every((expectedPath) => plistSource.includes(expectedPath));
}
