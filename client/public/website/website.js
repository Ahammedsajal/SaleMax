(() => {
  "use strict";
  const root = document.documentElement;
  const OPENAI_PIXEL_ID = "7f1xi4bh2i2PvmUAM8RNCh";
  const OPENAI_CONSENT_KEY = "7network_openai_ads_measurement_consent_v1";
  const consentPanel = document.getElementById("analytics-consent");
  const consentSave = document.getElementById("analytics-accept");
  const consentReject = document.getElementById("analytics-reject");
  const consentSettings = document.getElementById("analytics-settings");
  const openAiConsentChoice = document.getElementById("openai-analytics-choice");
  let openAiConsent = readOpenAiConsent();
  let openAiPixelLoaded = false;
  function readOpenAiConsent() {
    try {
      const value = localStorage.getItem(OPENAI_CONSENT_KEY);
      return value === "granted" || value === "denied" ? value : null;
    } catch (_) {
      return null;
    }
  }
  function persistOpenAiConsent(value) {
    openAiConsent = value;
    try {
      localStorage.setItem(OPENAI_CONSENT_KEY, value);
    } catch (_) {
      // The choice remains active for this page even if storage is unavailable.
    }
  }
  function showConsentPanel(focusSave = true) {
    openAiConsentChoice.checked = openAiConsent === "granted";
    consentSettings.hidden = true;
    consentPanel.hidden = false;
    if (focusSave) consentSave.focus({ preventScroll: true });
  }
  function loadOpenAiPixel() {
    if (openAiConsent !== "granted" || openAiPixelLoaded) return;
    openAiPixelLoaded = true;
    if (!window.oaiq) {
      const queue = function () {
        queue.q.push(arguments);
      };
      queue.q = [];
      window.oaiq = queue;
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://bzrcdn.openai.com/sdk/oaiq.min.js";
      document.head.appendChild(script);
    }
    window.oaiq("consent", true);
    window.oaiq("init", { pixelId: OPENAI_PIXEL_ID });
  }
  function saveOpenAiConsent(value) {
    persistOpenAiConsent(value);
    if (value === "granted") {
      loadOpenAiPixel();
    } else if (window.oaiq) {
      window.oaiq("consent", false);
    }
    consentPanel.hidden = true;
    consentSettings.hidden = false;
    consentSettings.focus({ preventScroll: true });
  }
  function sendOpenAiLead(eventId) {
    if (openAiConsent !== "granted" || !openAiPixelLoaded || !window.oaiq)
      return;
    window.oaiq(
      "measure",
      "lead_created",
      { type: "customer_action" },
      { event_id: eventId },
    );
  }
  // Keep ad measurement opt-in available from Privacy settings, without
  // interrupting every first-time visitor with a tracking prompt.
  consentSettings.hidden = false;
  if (openAiConsent === "granted") loadOpenAiPixel();
  consentSave.addEventListener("click", () =>
    saveOpenAiConsent(openAiConsentChoice.checked ? "granted" : "denied"),
  );
  consentReject.addEventListener("click", () => saveOpenAiConsent("denied"));
  consentSettings.addEventListener("click", () => showConsentPanel());
  let language =
    new URLSearchParams(location.search).get("lang") === "ar" ? "ar" : "en";
  const headlineMiddle = document.getElementById("hero-headline-middle");
  const enquiryDialog = document.getElementById("enquiry-dialog");
  const enquiryForm = document.getElementById("enquiry-form");
  const demoPromptKey = "7network.website-demo-prompt.v1";
  let autoOpenedDemo = false;
  function saveDemoPromptState(action) {
    try {
      localStorage.setItem(demoPromptKey, JSON.stringify({ action, at: Date.now() }));
    } catch (_) {
      // The form remains usable when browser storage is unavailable.
    }
  }
  document.querySelectorAll("[data-open-enquiry]").forEach((button) =>
    button.addEventListener("click", () => {
      saveDemoPromptState("engaged");
      if (!enquiryDialog?.open) enquiryDialog?.showModal();
      enquiryForm?.elements.name?.focus();
    }),
  );
  document.querySelectorAll("[data-close-enquiry]").forEach((button) =>
    button.addEventListener("click", () => enquiryDialog?.close()),
  );
  enquiryDialog?.addEventListener("click", (event) => {
    if (event.target === enquiryDialog) enquiryDialog.close();
  });
  enquiryDialog?.addEventListener("close", () => {
    if (autoOpenedDemo) saveDemoPromptState("dismissed");
    autoOpenedDemo = false;
  });
  const headlineStates = [
    {
      en: "Team Inbox",
      ar: "صندوق محادثات الفريق",
      gradient: "linear-gradient(100deg, #12629b, #3254a4)",
    },
    {
      en: "WhatsApp Campaigns",
      ar: "حملات واتساب",
      gradient: "linear-gradient(100deg, #137146, #1d8055)",
    },
    {
      en: "Business Management",
      ar: "إدارة الأعمال",
      gradient: "linear-gradient(100deg, #5d358f, #7950aa)",
    },
    {
      en: "Sales CRM",
      ar: "نظام CRM للمبيعات",
      gradient: "linear-gradient(100deg, #bc1f3d, #cc4c43)",
    },
    {
      en: "Lead Management",
      ar: "إدارة العملاء المحتملين",
      gradient: "linear-gradient(100deg, #8b5a00, #a36a00)",
    },
    {
      en: "Workflow Automation",
      ar: "أتمتة سير العمل",
      gradient: "linear-gradient(100deg, #0c6e71, #117e6c)",
    },
  ];
  const reducedHeadlineMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let headlineIndex = 0;
  let headlineTimer = null;
  function renderHeadline(index, animate = false) {
    if (!headlineMiddle) return;
    const next = headlineStates[index][language];
    const update = () => {
      headlineMiddle.textContent = next;
      headlineMiddle.style.backgroundImage = headlineStates[index].gradient;
      headlineMiddle.classList.remove("is-changing");
    };
    if (animate && !reducedHeadlineMotion.matches) {
      headlineMiddle.classList.add("is-changing");
      window.setTimeout(update, 220);
    } else update();
  }
  function startHeadlineRotation() {
    window.clearInterval(headlineTimer);
    if (document.hidden) return;
    headlineTimer = window.setInterval(() => {
      headlineIndex = (headlineIndex + 1) % headlineStates.length;
      renderHeadline(headlineIndex, true);
    }, 3800);
  }
  reducedHeadlineMotion.addEventListener("change", startHeadlineRotation);
  document.addEventListener("visibilitychange", startHeadlineRotation);
  renderHeadline(headlineIndex);
  startHeadlineRotation();
  const translations = [...document.querySelectorAll("[data-ar]")].map(
    (node) => [node, node.textContent, node.dataset.ar],
  );
  const languageButton = document.getElementById("language");
  const floatingWhatsApp = document.querySelector(".floating-cta");
  const openAiPrivacyLink = document.querySelector(".analytics-consent-policy a");
  const status = document.getElementById("form-status");
  let statusMessage = null;
  function updateFloatingWhatsApp() {
    if (!floatingWhatsApp) return;
    const message = language === "ar"
      ? "مرحباً 7Network، أنا مهتم بنظام CRM. هل يمكنكم مشاركة المزيد من التفاصيل؟"
      : "Hello 7Network, I’m interested in your CRM. Could you share more details?";
    floatingWhatsApp.href = `https://wa.me/97455160323?text=${encodeURIComponent(message)}`;
    floatingWhatsApp.setAttribute(
      "aria-label",
      language === "ar" ? "تواصل مع 7Network عبر واتساب" : "Chat with 7Network on WhatsApp",
    );
  }
  function applyLanguage() {
    root.lang = language;
    root.dir = language === "ar" ? "rtl" : "ltr";
    updateFloatingWhatsApp();
    if (openAiPrivacyLink)
      openAiPrivacyLink.href =
        "/website/meta-privacy.html" + (language === "ar" ? "?lang=ar" : "");
    translations.forEach(([node, en, ar]) => {
      node.textContent = language === "ar" ? ar : en;
    });
    document.getElementById("training-demo-video")?.setAttribute(
      "aria-label",
      language === "ar"
        ? "جولة مرئية في نظام 7Network Training Centre باللغة الإنجليزية"
        : "7Network Training Centre product walkthrough, in English",
    );
    renderHeadline(headlineIndex);
    document
      .querySelector("[data-close-enquiry]")
      ?.setAttribute("aria-label", language === "ar" ? "إغلاق النموذج" : "Close form");
    languageButton.textContent = language === "ar" ? "English" : "العربية";
    languageButton.lang = language === "ar" ? "en" : "ar";
    languageButton.setAttribute(
      "aria-label",
      language === "ar" ? "Switch to English" : "Switch to Arabic",
    );
    document.title =
      language === "ar"
        ? "7Network — منصة نمو الأعمال رقم 1"
        : "7Network — The #1 growth platform";
    renderPlans();
    if (statusMessage)
      status.textContent = statusMessage[language === "ar" ? 1 : 0];
  }
  let catalogue = null,
    planCurrency = "QAR";
  const planGrid = document.getElementById("plans-grid");
  function renderPlans() {
    if (!catalogue) return;
    planGrid.replaceChildren();
    planGrid.setAttribute("aria-busy", "false");
    planGrid.classList.remove("plan-error");
    const ar = language === "ar";
    const selected = window.SaleMaXPlans.select(catalogue);
    const monthly = selected.find(
      (p) => Number(p.plan_duration_in_days) === 30,
    );
    const yearly = selected.find(
      (p) => Number(p.plan_duration_in_days) === 365,
    );
    const saving = window.SaleMaXPlans.savings(monthly, yearly);
    const money = (value) =>
      new Intl.NumberFormat(ar ? "ar-QA" : "en-QA", {
        style: "currency",
        currency: planCurrency,
        maximumFractionDigits: 0,
      }).format(Number(value));
    if (!selected.length) {
      planGrid.classList.add("plan-error");
      planGrid.textContent = ar
        ? "تواصل معنا لمعرفة الخطط المتاحة."
        : "Contact us for available plans.";
      return;
    }
    for (const plan of selected) {
      const annual = Number(plan.plan_duration_in_days) === 365;
      const card = document.createElement("article");
      card.className = "plan-card" + (annual ? " plan-featured" : "");
      card.dataset.planId = String(plan.id);
      const element = (tag, text, cls) => {
        const node = document.createElement(tag);
        node.textContent = text;
        if (cls) node.className = cls;
        card.append(node);
        return node;
      };
      const icon = element("span", "7", "plan-icon");
      icon.setAttribute("aria-hidden", "true");
      element(
        "p",
        annual
          ? ar
            ? "أفضل قيمة"
            : "BEST VALUE"
          : ar
            ? "مرونة الدفع"
            : "FLEXIBLE START",
        "plan-kind",
      );
      element(
        "h3",
        annual
          ? ar
            ? "CRM سنوي"
            : "Yearly CRM"
          : ar
            ? "CRM شهري"
            : "Monthly CRM",
      );
      element(
        "p",
        ar
          ? "نفس أساس CRM. اختر فترة اشتراكك."
          : "The same CRM foundation. Your choice of billing period.",
        "plan-intro",
      );
      element("p", money(plan.price), "plan-price");
      element(
        "p",
        annual
          ? ar
            ? "دفعة واحدة لمدة 365 يوماً"
            : "One payment for 365 days"
          : ar
            ? "دفعة واحدة لمدة 30 يوماً"
            : "One payment for 30 days",
        "plan-duration",
      );
      if (annual && saving)
        element(
          "p",
          ar
            ? `وفّر ${money(saving.amount)} مقارنة بـ 12 فترة شهرية`
            : `Save ${money(saving.amount)} compared with 12 monthly periods`,
          "plan-saving",
        );
      else
        element(
          "p",
          ar
            ? "ابدأ بفترة اشتراك شهرية"
            : "Start with a monthly subscription period",
          "plan-flexibility",
        );
      element(
        "p",
        ar ? "الميزات المشمولة" : "INCLUDED FEATURES",
        "plan-features-label",
      );
      const featureList = element("ul", "", "plan-feature-list");
      for (const feature of window.SaleMaXPlans.features) {
        const item = document.createElement("li");
        item.textContent = feature[ar ? "ar" : "en"];
        featureList.append(item);
      }
      const checkout = element(
        "a",
        annual
          ? ar
            ? "اختر السنوي "
            : "Choose yearly "
          : ar
            ? "اختر الشهري "
            : "Choose monthly ",
        "button " + (annual ? "" : "button-dark"),
      );
      checkout.href = "/user/checkout?product=" + encodeURIComponent(plan.id);
      const link = element(
        "a",
        ar ? "ناقش إعداد CRM لنشاطك" : "Talk through your CRM setup",
        "text-link",
      );
      link.href = "#contact";
      link.addEventListener("click", () => {
        const content = document.getElementById("content");
        if (!content.value)
          content.value = ar
            ? `أرغب في مناقشة خطة ${plan.title} وتخصيص CRM لنشاطي.`
            : `I'd like to discuss ${plan.title} and a CRM setup for my industry.`;
        document.getElementById("solution").value = "custom";
      });
      planGrid.append(card);
    }
  }

  const isLocalPreview = ["localhost", "127.0.0.1"].includes(location.hostname);
  Promise.all([
    fetch("/api/admin/get_plans").then((r) => {
      if (!r.ok) throw new Error("Plan request failed");
      return r.json();
    }),
    fetch("/api/web/get_web_public")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ])
    .then(([plans, settings]) => {
      if (!plans.success || !Array.isArray(plans.data)) throw new Error();
      const currency = settings.data?.currency_code;
      if (typeof currency === "string" && /^[A-Z]{3}$/.test(currency))
        planCurrency = currency;
      catalogue = plans.data
        .filter(
          (plan) =>
            Number.isSafeInteger(Number(plan.id)) &&
            Number.isFinite(Number(plan.price)) &&
            Number(plan.price) >= 0 &&
            Number(plan.plan_duration_in_days) > 0,
        )
        .slice(0, 30);
      if (!window.SaleMaXPlans.select(catalogue).length && isLocalPreview) {
        catalogue = window.SaleMaXPlans.localPreviewPlans();
        planGrid.dataset.catalogueSource = "local-preview";
      }
      renderPlans();
    })
    .catch(() => {
      if (isLocalPreview) {
        catalogue = window.SaleMaXPlans.localPreviewPlans();
        planCurrency = "QAR";
        planGrid.dataset.catalogueSource = "local-preview";
        renderPlans();
        return;
      }
      planGrid.setAttribute("aria-busy", "false");
      planGrid.textContent =
        language === "ar"
          ? "تعذر تحميل الخطط الآن. تواصل معنا لمعرفة الأسعار الحالية."
          : "Plans are unavailable right now. Contact us for current pricing.";
      planGrid.classList.add("plan-error");
    });
  applyLanguage();
  window.addEventListener("load", () => {
    let promptState = null;
    try { promptState = JSON.parse(localStorage.getItem(demoPromptKey) || "null"); } catch (_) {}
    const age = Date.now() - Number(promptState?.at || 0);
    const suppressed =
      (promptState?.action === "dismissed" && age < 30 * 24 * 60 * 60 * 1000) ||
      (promptState?.action === "shown" && age < 24 * 60 * 60 * 1000) ||
      ((promptState?.action === "engaged" || promptState?.action === "submitted") && age < 365 * 24 * 60 * 60 * 1000);
    if (suppressed || document.hidden || enquiryDialog?.open) return;
    window.setTimeout(() => {
      if (document.hidden || enquiryDialog?.open) return;
      autoOpenedDemo = true;
      saveDemoPromptState("shown");
      enquiryDialog?.showModal();
      enquiryForm?.elements.name?.focus({ preventScroll: true });
    }, 6500);
  }, { once: true });
  languageButton.addEventListener("click", () => {
    language = language === "en" ? "ar" : "en";
    applyLanguage();
    const url = new URL(location.href);
    language === "ar"
      ? url.searchParams.set("lang", "ar")
      : url.searchParams.delete("lang");
    history.replaceState(null, "", url);
  });
  const menu = document.querySelector(".menu-toggle"),
    nav = document.getElementById("navigation");
  function closeMenu() {
    nav.classList.remove("open");
    menu.setAttribute("aria-expanded", "false");
  }
  menu.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menu.setAttribute("aria-expanded", String(open));
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("open")) {
      closeMenu();
      menu.focus();
    }
  });
  function activateTab(button, buttons, panelPrefix, key) {
    buttons.forEach((tab) => {
      const selected = tab === button;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(panelPrefix + tab.dataset[key]).hidden =
        !selected;
    });
  }
  function setupTabs(selector, prefix, key) {
    const buttons = [...document.querySelectorAll(selector)];
    buttons.forEach((button, index) => {
      button.addEventListener("click", () =>
        activateTab(button, buttons, prefix, key),
      );
      button.addEventListener("keydown", (event) => {
        const direction = root.dir === "rtl" ? -1 : 1;
        let next;
        if (event.key === "ArrowRight")
          next = (index + direction + buttons.length) % buttons.length;
        if (event.key === "ArrowLeft")
          next = (index - direction + buttons.length) % buttons.length;
        if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
        if (event.key === "ArrowUp")
          next = (index - 1 + buttons.length) % buttons.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = buttons.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        activateTab(buttons[next], buttons, prefix, key);
        buttons[next].focus();
      });
    });
  }
  setupTabs("[data-preview]", "preview-", "preview");
  setupTabs("[data-industry]", "industry-", "industry");
  document.querySelectorAll("[data-solution]").forEach((link) =>
    link.addEventListener("click", (event) => {
      event.preventDefault();
      saveDemoPromptState("engaged");
      document.getElementById("solution").value = link.dataset.solution;
      const industry = document.getElementById("industry");
      industry.value = link.dataset.solution === "training"
        ? "training"
        : link.dataset.solution === "custom" || link.dataset.solution === "other"
          ? "other"
          : "business";
      enquiryDialog?.showModal();
      enquiryForm?.elements.name?.focus();
    }),
  );
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  if ("IntersectionObserver" in window && !reduceMotion.matches) {
    root.classList.add("motion-ready");
    const reveal = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            reveal.unobserve(entry.target);
          }
        }),
      { threshold: 0.08 },
    );
    document
      .querySelectorAll(".reveal")
      .forEach((node) => reveal.observe(node));
    // Progressive enhancement: content stays readable even if the observer is interrupted.
    window.addEventListener("beforeprint", () =>
      document
        .querySelectorAll(".reveal")
        .forEach((node) => node.classList.add("is-visible")),
    );
  }
  const funnelCards = [...document.querySelectorAll(".funnel-card")];
  if (funnelCards.length) {
    const stackMode = matchMedia("(min-width: 901px), (max-width: 760px)");
    if (!reduceMotion.matches) root.classList.add("funnel-motion-ready");
    let scheduled = false;
    const updateFunnelStack = () => {
      scheduled = false;
      if (!stackMode.matches) {
        root.classList.remove("funnel-stack-ready", "funnel-motion-ready");
        funnelCards.forEach((card) => {
          card.classList.add("is-active");
          card.classList.remove("is-peeking", "is-stacked-away");
        });
        return;
      }
      root.classList.add("funnel-stack-ready");
      root.classList.toggle("funnel-motion-ready", !reduceMotion.matches);
      // Advance as a new card reaches the prior card's lower edge. This clears
      // old copy before the incoming card can cover it during the sticky climb.
      let activeIndex = 0;
      for (let index = 1; index < funnelCards.length; index += 1) {
        const current = funnelCards[index].getBoundingClientRect();
        const previous = funnelCards[index - 1].getBoundingClientRect();
        if (current.top < previous.bottom - 2) activeIndex = index;
      }
      funnelCards.forEach((card, index) => {
        card.classList.toggle("is-active", index === activeIndex);
        card.classList.toggle("is-peeking", index === activeIndex - 1);
        card.classList.toggle("is-stacked-away", index < activeIndex - 1);
      });
    };
    const requestFunnelUpdate = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(updateFunnelStack);
    };
    window.addEventListener("scroll", requestFunnelUpdate, { passive: true });
    window.addEventListener("resize", requestFunnelUpdate, { passive: true });
    stackMode.addEventListener?.("change", requestFunnelUpdate);
    reduceMotion.addEventListener?.("change", () => {
      root.classList.toggle("funnel-motion-ready", !reduceMotion.matches);
      requestFunnelUpdate();
    });
    window.addEventListener("beforeprint", () => {
      root.classList.remove("funnel-stack-ready", "funnel-motion-ready");
      funnelCards.forEach((card) => card.classList.remove("is-peeking", "is-stacked-away"));
    });
    updateFunnelStack();
  }
  const floating = document.querySelector(".floating-cta");
  if (floating) {
    // Keep the contact shortcut available through the contact section and footer.
    floating.classList.add("visible");
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        floating.classList.toggle("visible", !entry.isIntersecting);
      }).observe(document.querySelector(".hero"));
    }
  }
  document.getElementById("year").textContent = String(
    new Date().getFullYear(),
  );
  const form = enquiryForm,
    submit = form.querySelector("[type=submit]");
  let pending = false,
    submissionToken = crypto.randomUUID();
  let submittedPayload = null;
  function message(en, ar, type) {
    statusMessage = [en, ar];
    status.textContent = language === "ar" ? ar : en;
    status.className = type;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    const payload = {
      ...values,
      consent: form.elements.consent.checked,
      language,
    };
    const fingerprint = JSON.stringify(payload);
    // A transport retry keeps its token. Editing the request deliberately creates a new submission.
    if (submittedPayload && submittedPayload !== fingerprint)
      submissionToken = crypto.randomUUID();
    submittedPayload = fingerprint;
    pending = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    message("Sending your request…", "جارٍ إرسال طلبك…", "");
    try {
      const response = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, submissionToken }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        const code = result.code || "";
        if (response.status === 429)
          throw Object.assign(new Error(), { type: "rate" });
        if (code.startsWith("INVALID_") || code === "CONSENT_REQUIRED")
          throw Object.assign(new Error(), { type: "validation" });
        throw new Error("unavailable");
      }
      const conversionEventId = submissionToken;
      sendOpenAiLead(conversionEventId);
      saveDemoPromptState("submitted");
      autoOpenedDemo = false;
      form.reset();
      submissionToken = crypto.randomUUID();
      submittedPayload = null;
      message(
        "Thank you — your request is with the 7Network sales team. We’ll follow up using the details you provided. Reference: " +
          result.reference,
        "شكراً — وصل طلبك إلى فريق مبيعات 7Network. سنتواصل معك باستخدام البيانات المقدمة. المرجع: " +
          result.reference,
        "success",
      );
      status.focus({ preventScroll: true });
    } catch (error) {
      if (error.type === "rate")
        message(
          "You’ve sent several requests. Please try again in an hour.",
          "تم إرسال عدة طلبات. يرجى المحاولة بعد ساعة.",
          "error",
        );
      else if (error.type === "validation")
        message(
          "Please check your details, including your email and international phone number.",
          "يرجى التحقق من البيانات بما فيها البريد الإلكتروني والهاتف مع رمز الدولة.",
          "error",
        );
      else
        message(
          "We couldn’t confirm your request. Your details are still here — please try again. A retry won’t duplicate a received request.",
          "تعذر تأكيد طلبك. بياناتك محفوظة هنا، يرجى المحاولة مجدداً. لن تؤدي إعادة المحاولة إلى تكرار طلب تم استلامه.",
          "error",
        );
    } finally {
      pending = false;
      submit.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });
})();
