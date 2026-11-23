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
  const INSTALL_ROW_SELECTOR = '[data-sx-sidebar-list] > li[data-sx-pwa-install-nav]';

  if (!PLATFORM_HOSTS.has(window.location.hostname)) return;

  function isUserWorkspace() {
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    if (pathname !== '/user') return false;
    const page = new URLSearchParams(window.location.search).get('page')?.toLowerCase();
    return !['login', 'signin', 'sign-in', 'signup'].includes(page || '');
  }

  let deferredInstallPrompt = null;
  let activeInstallButton;
  let installInProgress = false;
  let appInstalled = false;
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
    return appInstalled || window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
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
    const copy = languageCopy();
    const visible = !isInstalled() && canPromptInstall();
    for (const row of document.querySelectorAll(INSTALL_ROW_SELECTOR)) {
      const button = row.querySelector('.sevennetwork-install-nav-button');
      const primary = row.querySelector('.MuiListItemText-primary');
      if (!button || !primary) continue;
      if (primary.textContent !== copy.button) primary.textContent = copy.button;
      row.setAttribute('aria-label', copy.button);
      row.lang = isArabic() ? 'ar' : 'en';
      row.dir = isArabic() ? 'rtl' : 'ltr';
      button.setAttribute('aria-label', copy.button);
      button.setAttribute('title', copy.button);
      button.lang = row.lang;
      button.dir = row.dir;
      button.disabled = installInProgress;
      button.toggleAttribute('aria-busy', installInProgress);
      row.hidden = !visible;
    }
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
    appInstalled = true;
    deferredInstallPrompt = null;
    closeDialog();
    updateButton();
  }

  async function requestInstall(button) {
    if (installInProgress) return;
    const installApiAvailable = supportsWebInstall();
    const installPrompt = deferredInstallPrompt;
    if (!installApiAvailable && !installPrompt) {
      updateButton();
      return;
    }

    activeInstallButton = button;
    installInProgress = true;
    updateButton();
    try {
      if (installApiAvailable) {
        // Call directly in the click handler to preserve transient user activation.
        await navigator.install();
        markInstalled();
      } else {
        deferredInstallPrompt = null;
        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        if (choice?.outcome === 'accepted') markInstalled();
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showInstructions();
    } finally {
      installInProgress = false;
      updateButton();
    }
  }

  function cloneSidebarInstallRow(list) {
    const template = [...list.children].find((row) => row.tagName === 'LI' && !row.hasAttribute('data-sx-nav-section'));
    if (!template) return null;

    const row = template.cloneNode(true);
    row.hidden = false;
    row.removeAttribute('style');
    row.removeAttribute('aria-label');
    row.removeAttribute('title');
    for (const attribute of [...row.attributes]) {
      if (attribute.name.startsWith('data-sx-') || attribute.name === 'data-salemax-pipeline-link') {
        row.removeAttribute(attribute.name);
      }
    }
    row.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    row.querySelectorAll('[data-sx-tenant-label], [data-sx-native-label-hidden]').forEach((node) => {
      if (node.hasAttribute('data-sx-native-label-hidden')) node.removeAttribute('data-sx-native-label-hidden');
      else node.remove();
    });

    const currentButton = row.querySelector('.MuiListItemButton-root, [role="button"], button, a');
    if (!currentButton) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${currentButton.className} sevennetwork-install-nav-button`;
    button.removeAttribute('style');
    while (currentButton.firstChild) button.append(currentButton.firstChild);
    currentButton.replaceWith(button);
    button.classList.remove('Mui-selected');
    button.removeAttribute('aria-current');
    button.removeAttribute('href');
    button.setAttribute('aria-label', languageCopy().button);
    button.setAttribute('title', languageCopy().button);

    const icon = row.querySelector('.MuiListItemIcon-root svg');
    if (icon) {
      icon.removeAttribute('data-sx-training-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('focusable', 'false');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '1.8');
      icon.setAttribute('stroke-linecap', 'round');
      icon.setAttribute('stroke-linejoin', 'round');
      icon.innerHTML = '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4"/>';
    }

    const primary = row.querySelector('.MuiListItemText-primary');
    if (!primary || !icon) return null;
    primary.textContent = languageCopy().button;
    row.dataset.sxPwaInstallNav = '1';
    row.dataset.sxCanonicalSalesNav = 'dashboard';
    row.setAttribute('aria-label', languageCopy().button);
    return row;
  }

  function syncSidebarRows() {
    if (!isUserWorkspace()) return;
    for (const list of document.querySelectorAll('[data-sx-sidebar-list]')) {
      if (list.querySelector(':scope > li[data-sx-pwa-install-nav]')) continue;
      const row = cloneSidebarInstallRow(list);
      if (row) list.append(row);
    }
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
      if (activeInstallButton?.isConnected && !activeInstallButton.disabled && !activeInstallButton.closest('li')?.hidden) {
        activeInstallButton.focus();
      }
    });
    document.body.appendChild(dialog);
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    if (isInstalled()) return;
    event.preventDefault();
    deferredInstallPrompt = event;
    updateButton();
  });
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-sx-pwa-install-nav] .sevennetwork-install-nav-button')
      : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    requestInstall(target);
  }, true);
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
      document.getElementById(BUTTON_ID)?.remove();
      document.querySelectorAll('[data-sx-pwa-install-nav]').forEach((row) => row.remove());
      dialog?.remove();
      activeInstallButton = undefined;
      dialog = undefined;
      return;
    }

    syncSidebarRows();
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
      else syncSidebarRows();
    });
    routeObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-sx-sidebar-list'],
    });
    syncRoute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
