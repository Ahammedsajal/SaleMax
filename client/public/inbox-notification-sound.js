(() => {
  'use strict';
  const prototype = window.HTMLMediaElement?.prototype;
  if (!prototype || prototype.__sxNotificationSoundRecovery) return;

  const nativePlay = prototype.play;
  const pending = new Set();
  const isNotificationTone = media => {
    if (!(media instanceof HTMLAudioElement)) return false;
    const source = media.currentSrc || media.src || '';
    return /\/notification\/interface-124464\.mp3(?:[?#]|$)/i.test(source)
      || /raw\.githubusercontent\.com\/akx\/Notifications\/refs\/heads\/master\/WAV\//i.test(source);
  };

  prototype.play = function (...args) {
    const result = nativePlay.apply(this, args);
    if (!isNotificationTone(this)) return result;
    return result.catch(error => {
      if (error?.name !== 'NotAllowedError') throw error;
      // Retry once from the next real user gesture after autoplay rejection.
      pending.add(this);
      return undefined;
    });
  };
  Object.defineProperty(prototype, '__sxNotificationSoundRecovery', { value: true });

  const retryPending = () => {
    for (const media of pending) {
      pending.delete(media);
      nativePlay.call(media).catch(error => {
        if (error?.name === 'NotAllowedError') pending.add(media);
      });
    }
  };
  for (const eventName of ['pointerdown', 'keydown', 'touchstart']) {
    document.addEventListener(eventName, retryPending, { capture: true, passive: true });
  }
})();
