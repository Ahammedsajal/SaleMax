const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25000;

function createGracefulShutdownHandler({
  io,
  cleanup,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  onError = () => {},
  processRef = process,
  cleanupController,
}) {
  const controller = cleanupController || require('node-cleanup');
  return function gracefulShutdown(exitCode, signal) {
    // node-cleanup's callback is synchronous. Returning a Promise does not make
    // it wait, so only defer signal exits and explicitly relay the signal later.
    if (!signal) return undefined;

    controller.uninstall();

    let terminated = false;
    let deadline;
    const terminate = () => {
      if (terminated) return;
      terminated = true;
      processRef.clearTimeout(deadline);
      processRef.kill(processRef.pid, signal);
    };

    deadline = processRef.setTimeout(terminate, timeoutMs);

    Promise.resolve()
      .then(async () => {
        if (io && typeof io.close === 'function') {
          await new Promise((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              resolve();
            };
            try {
              io.close(done);
            } catch (error) {
              onError('socket_close', error);
              done();
            }
          });
        }
        if (typeof cleanup === 'function') await cleanup();
      })
      .catch((error) => onError('cleanup', error))
      .finally(terminate);

    // Prevent node-cleanup from exiting before the asynchronous shutdown path.
    return false;
  };
}

function installGracefulShutdown(options = {}) {
  const cleanupController = options.cleanupController || require('node-cleanup');
  cleanupController(createGracefulShutdownHandler({
    ...options,
    cleanupController,
  }));
}

module.exports = {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  createGracefulShutdownHandler,
  installGracefulShutdown,
};
