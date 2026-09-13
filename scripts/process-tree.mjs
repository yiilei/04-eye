export function signalProcessTree(pid, signal = "SIGTERM", sendSignal = process.kill) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    // Managed capture children start in their own POSIX process group. Sending
    // to the negative PID reaches the wrapper and every descendant it spawned.
    sendSignal(-pid, signal);
    return true;
  } catch (groupError) {
    if (groupError?.code === "EPERM") throw groupError;
    try {
      sendSignal(pid, signal);
      return true;
    } catch (processError) {
      if (processError?.code === "ESRCH") return false;
      throw processError;
    }
  }
}

export async function terminateProcessTree(pid, { signal = "SIGTERM", graceMs = 5_000 } = {}) {
  signalProcessTree(pid, signal);
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, graceMs)));
  // A wrapper can exit before a descendant that ignored SIGTERM. The process
  // group remains addressable by its original ID, so always perform the final
  // sweep instead of trusting the wrapper's exit event.
  signalProcessTree(pid, "SIGKILL");
}

export function waitForManagedChild(child, { timeoutMs, graceMs = 5_000 } = {}) {
  return new Promise((resolve) => {
    let finished = false;
    let timedOut = false;
    let hardKillTimer;
    let exitResult = { code: null, signal: null, error: null };
    const finish = (code = exitResult.code, signal = exitResult.signal, error = exitResult.error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      clearTimeout(hardKillTimer);
      resolve({ code, signal, error, timedOut });
    };
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalProcessTree(child.pid, "SIGTERM");
      hardKillTimer = setTimeout(() => {
        signalProcessTree(child.pid, "SIGKILL");
        finish();
      }, graceMs);
    }, Math.max(1, Number(timeoutMs) || 45 * 60_000));
    timeoutTimer.unref?.();
    child.once("error", (error) => {
      exitResult = { code: null, signal: null, error };
      if (!timedOut) finish();
    });
    child.once("exit", (code, signal) => {
      exitResult = { code, signal, error: null };
      if (!timedOut) finish();
    });
  });
}
