const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25000;

function createGracefulShutdownHandler({
  io,
  cleanup,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  onError = () => {},
  processRef = process,
}) {
  let shutdownPromise;

  return function gracefulShutdown(signal) {
    if (!signal) return Promise.resolve();
    if (shutdownPromise) return shutdownPromise;

    let terminated = false;
    const terminate = () => {
      if (terminated) return;
      terminated = true;
      processRef.clearTimeout(deadline);
      processRef.kill(processRef.pid, signal);
    };
    const deadline = processRef.setTimeout(terminate, timeoutMs);

    shutdownPromise = (async () => {
      try {
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
      } catch (error) {
        onError('cleanup', error);
      } finally {
        terminate();
      }
    })();

    return shutdownPromise;
  };
}

function installGracefulShutdown(options = {}) {
  const processRef = options.processRef || process;
  const shutdown = createGracefulShutdownHandler({ ...options, processRef });
  processRef.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  processRef.once('SIGINT', () => { void shutdown('SIGINT'); });
}

module.exports = {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  createGracefulShutdownHandler,
  installGracefulShutdown,
};
