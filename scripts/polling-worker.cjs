'use strict';

function createPollingWorker({ tick, intervalMs, close, onError = () => {}, once = false }) {
  if (typeof tick !== 'function' || typeof close !== 'function'
      || typeof onError !== 'function' || !Number.isSafeInteger(intervalMs)
      || intervalMs < 1 || typeof once !== 'boolean') {
    throw new Error('INVALID_POLLING_WORKER_OPTIONS');
  }

  let started = false;
  let stopping = false;
  let timer = null;
  let inFlight = null;
  let stopPromise = null;

  async function cycle() {
    if (stopping) return;
    const current = Promise.resolve().then(() => stopping ? undefined : tick());
    inFlight = current;
    try {
      await current;
    } catch (error) {
      try { onError(error); } catch {}
    } finally {
      if (inFlight === current) inFlight = null;
    }

    if (stopping) return;
    if (once) {
      await stop();
      return;
    }
    timer = setTimeout(() => { void cycle(); }, intervalMs);
  }

  function start() {
    if (started) return;
    started = true;
    void cycle();
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    if (timer) clearTimeout(timer);
    timer = null;
    stopPromise = (async () => {
      const active = inFlight;
      if (active) {
        try { await active; } catch {}
      }
      await close();
    })();
    return stopPromise;
  }

  return { start, stop };
}

module.exports = { createPollingWorker };
