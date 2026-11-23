(() => {
  'use strict';

  const PLATFORM_HOSTS = new Set([
    '7network.live',
    'www.7network.live',
    'crm.salemax.qa',
    'localhost',
    '127.0.0.1',
  ]);
  const BUTTON_ID = 'sevennetwork-install-button';
  const DIALOG_ID = 'sevennetwork-install-dialog';

  if (!PLATFORM_HOSTS.has(window.location.hostname)) return;

  function isUserWorkspace() {
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    if (pathname !== '/user') return false;
    const page = new URLSearchParams(window.location.search).get('page')?.toLowerCase();
    return !['login', 'signin', 'sign-in', 'signup'].includes(page || '');
  }

  let deferredInstallPrompt = null;
  let button;
  let dialog;
  let themeObserver;
  let routeObserver;
  let lastRoute = '';

  const COPY = {
    en: {
      button: 'Install 7Network',
      title: 'Install 7Network',
      intro: 'Add 7Network to your device for quick, full-screen access.',
      close: 'Close',
      gotIt: 'Got it',
      ios: [
        'On iPhone or iPad, open this page in Safari.',
        'Tap Share, then choose Add to Home Screen.',
      ],
      macSafari: [
        'In Safari on your Mac, open the File menu.',
        'Choose Add to Dock.',
      ],
      generic: [
        'This browser has not offered a one-tap install prompt for this page.',
        'Open the browser menu and choose Install 7Network or Add to Home Screen. Chrome and Edge can open this install dialog from the button when the app meets their install requirements.',
      ],
    },
    ar: {
      button: 'تثبيت 7Network',
      title: 'تثبيت 7Network',
      intro: 'أضف 7Network إلى جهازك للوصول إليه بسرعة في نافذة مستقلة.',
      close: 'إغلاق',
      gotIt: 'حسنًا',
      ios: [
        'على iPhone أو iPad، افتح هذه الصفحة في Safari.',
        'اضغط على مشاركة، ثم اختر إضافة إلى الشاشة الرئيسية.',
      ],
      macSafari: [
        'في Safari على Mac، افتح قائمة ملف.',
        'اختر إضافة إلى Dock.',
      ],
      generic: [
        'لم يوفر هذا المتصفح خيار التثبيت بنقرة واحدة لهذه الصفحة.',
        'افتح قائمة المتصفح واختر تثبيت 7Network أو إضافة إلى الشاشة الرئيسية. يمكن لـ Chrome وEdge فتح نافذة التثبيت من الزر عند استيفاء متطلبات التثبيت.',
      ],
    },
  };

  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function supportsWebInstall() {
    return typeof Navigator !== 'undefined' && typeof Navigator.prototype.install === 'function';
  }

  function canPromptInstall() {
    return supportsWebInstall() || Boolean(deferredInstallPrompt);
  }

  function isArabic() {
    return /^ar(?:-|$)/i.test(document.documentElement.lang || '') ||
      document.documentElement.dir.toLowerCase() === 'rtl';
  }

  function languageCopy() {
    return COPY[isArabic() ? 'ar' : 'en'];
  }

  function clientInstructions(copy) {
    const userAgent = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/i.test(userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = /Safari/i.test(userAgent) && !/(Chrome|Chromium|CriOS|Edg|OPR|Android)/i.test(userAgent);

    if (ios) return copy.ios;
    if (safari && /Macintosh|Mac OS X/i.test(userAgent)) return copy.macSafari;
    return copy.generic;
  }

  function currentTheme() {
    const elements = [
      document.getElementById('root'),
      document.body,
      document.documentElement,
    ].filter(Boolean);

    for (const element of elements) {
      const scheme = element.getAttribute('data-mui-color-scheme') || element.getAttribute('data-theme');
      if (scheme) return /dark/i.test(scheme) ? 'dark' : 'light';

      const color = getComputedStyle(element).backgroundColor;
      const channels = color.match(/[\d.]+/g)?.map(Number);
      if (!channels || channels.length < 3 || (channels.length === 4 && channels[3] < 0.9)) continue;
      const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
      return luminance < 145 ? 'dark' : 'light';
    }

    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateTheme() {
    if (!dialog) return;
    dialog.dataset.theme = currentTheme();
  }

  function updateButton() {
    if (!button) return;
    const copy = languageCopy();
    button.querySelector('[data-install-label]').textContent = copy.button;
    button.setAttribute('aria-label', copy.button);
    button.lang = isArabic() ? 'ar' : 'en';
    button.dir = isArabic() ? 'rtl' : 'ltr';
    button.hidden = isInstalled() || !canPromptInstall();
    updateTheme();
  }

  function closeDialog() {
    if (dialog?.open) dialog.close();
  }

  function showInstructions() {
    if (!dialog) return;

    const copy = languageCopy();
    const instructions = clientInstructions(copy);
    dialog.lang = isArabic() ? 'ar' : 'en';
    dialog.dir = isArabic() ? 'rtl' : 'ltr';
    dialog.dataset.theme = currentTheme();
    dialog.querySelector('[data-install-title]').textContent = copy.title;
    dialog.querySelector('[data-install-intro]').textContent = copy.intro;
    dialog.querySelector('[data-install-close]').setAttribute('aria-label', copy.close);
    dialog.querySelector('[data-install-done]').textContent = copy.gotIt;

    const list = dialog.querySelector('[data-install-steps]');
    list.replaceChildren(...instructions.map((instruction) => {
      const item = document.createElement('li');
      item.textContent = instruction;
      return item;
    }));

    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[data-install-done]').focus();
  }

  function markInstalled() {
    deferredInstallPrompt = null;
    closeDialog();
    updateButton();
  }

  function createButton() {
    if (document.getElementById(BUTTON_ID)) {
      button = document.getElementById(BUTTON_ID);
      return;
    }

    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.className = 'sevennetwork-install-button';
    button.type = 'button';
    button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4"/></svg><span data-install-label></span>';
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') return;
      const installApiAvailable = supportsWebInstall();
      const installPrompt = deferredInstallPrompt;
      if (!installApiAvailable && !installPrompt) {
        updateButton();
        return;
      }

      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-disabled', 'true');
      try {
        let installResult;
        if (installApiAvailable) {
          // Call directly in the click handler to preserve transient user activation.
          installResult = navigator.install();
        } else {
          deferredInstallPrompt = null;
          installResult = installPrompt.prompt();
        }

        Promise.resolve(installResult)
          .then(async () => {
            if (installApiAvailable) {
              markInstalled();
              return;
            }
            const choice = await installPrompt.userChoice;
            if (choice?.outcome === 'accepted') markInstalled();
            else updateButton();
          })
          .catch((error) => {
            updateButton();
            if (error?.name !== 'AbortError') showInstructions();
          })
          .finally(() => {
            if (button) {
              button.removeAttribute('aria-busy');
              button.removeAttribute('aria-disabled');
            }
          });
      } catch (error) {
        updateButton();
        button.removeAttribute('aria-busy');
        button.removeAttribute('aria-disabled');
        if (error?.name !== 'AbortError') showInstructions();
      }
    });

    document.body.appendChild(button);
    updateButton();
  }

  function createDialog() {
    if (document.getElementById(DIALOG_ID)) return;

    dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.className = 'sevennetwork-install-dialog';
    dialog.setAttribute('aria-labelledby', 'sevennetwork-install-title');
    dialog.innerHTML = [
      '<section class="sevennetwork-install-card">',
      '<button class="sevennetwork-install-close" type="button" data-install-close>',
      '<span aria-hidden="true">×</span>',
      '</button>',
      '<h2 id="sevennetwork-install-title" data-install-title></h2>',
      '<p data-install-intro></p>',
      '<ol data-install-steps></ol>',
      '<button class="sevennetwork-install-done" type="button" data-install-done></button>',
      '</section>',
    ].join('');

    dialog.querySelector('[data-install-close]').addEventListener('click', closeDialog);
    dialog.querySelector('[data-install-done]').addEventListener('click', closeDialog);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener('close', () => {
      if (button && !button.hidden) button.focus();
    });
    document.body.appendChild(dialog);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    if (isInstalled()) return;
    event.preventDefault();
    deferredInstallPrompt = event;
    updateButton();
  });
  window.addEventListener('appinstalled', markInstalled);
  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', updateButton);
  new MutationObserver(updateButton).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang', 'dir', 'data-theme', 'data-mui-color-scheme'],
  });

  function watchTheme() {
    if (themeObserver) return;
    themeObserver = new MutationObserver(updateTheme);
    const options = {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-mui-color-scheme'],
    };
    for (const element of [document.body, document.getElementById('root')]) {
      if (element) themeObserver.observe(element, options);
    }
  }

  function syncRoute() {
    if (!document.body) return;
    const route = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (route === lastRoute) return;
    lastRoute = route;

    if (!isUserWorkspace()) {
      closeDialog();
      button?.remove();
      dialog?.remove();
      button = undefined;
      dialog = undefined;
      return;
    }

    createButton();
    createDialog();
    updateButton();
    watchTheme();
  }

  function mount() {
    if (!document.body) return;
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    routeObserver = new MutationObserver(() => {
      const route = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (route !== lastRoute) syncRoute();
    });
    routeObserver.observe(document.body, { childList: true, subtree: true });
    syncRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
