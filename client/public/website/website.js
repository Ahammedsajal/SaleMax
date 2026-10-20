(() => {
  "use strict";
  const root = document.documentElement;
  let language =
    new URLSearchParams(location.search).get("lang") === "ar" ? "ar" : "en";
  const translations = [...document.querySelectorAll("[data-ar]")].map(
    (node) => [node, node.textContent, node.dataset.ar],
  );
  const languageButton = document.getElementById("language");
  const status = document.getElementById("form-status");
  let statusMessage = null;
  function applyLanguage() {
    root.lang = language;
    root.dir = language === "ar" ? "rtl" : "ltr";
    translations.forEach(([node, en, ar]) => {
      node.textContent = language === "ar" ? ar : en;
    });
    languageButton.textContent = language === "ar" ? "English" : "العربية";
    languageButton.lang = language === "ar" ? "en" : "ar";
    languageButton.setAttribute(
      "aria-label",
      language === "ar" ? "Switch to English" : "Switch to Arabic",
    );
    document.title =
      language === "ar"
        ? "SaleMaX — أعمالك. مترابطة."
        : "SaleMaX — Your business. Connected.";
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
    const ar = language === "ar";
    for (const plan of catalogue) {
      const card = document.createElement("article");
      card.className = "plan-card";
      card.dataset.planId = String(plan.id);
      const element = (tag, value, className) => {
        const node = document.createElement(tag);
        node.textContent = value;
        if (className) node.className = className;
        card.append(node);
        return node;
      };
      element(
        "p",
        Number(plan.is_trial)
          ? ar
            ? "خطة تجريبية"
            : "Trial plan"
          : ar
            ? "خطة اشتراك"
            : "Subscription plan",
        "plan-kind",
      );
      element("h3", String(plan.title));
      element(
        "p",
        new Intl.NumberFormat(ar ? "ar-QA" : "en-QA", {
          style: "currency",
          currency: planCurrency,
          maximumFractionDigits: 2,
        }).format(Number(plan.price)),
        "plan-price",
      );
      element(
        "p",
        ar
          ? `لمدة ${plan.plan_duration_in_days} يوماً`
          : `For ${plan.plan_duration_in_days} days`,
        "plan-duration",
      );
      const list = element("ul", "");
      const features = [
        ar
          ? `${plan.contact_limit} جهة اتصال`
          : `${new Intl.NumberFormat("en").format(Number(plan.contact_limit))} contacts`,
        ar ? `${plan.qr_account} حسابات QR` : `${plan.qr_account} QR accounts`,
      ];
      if (Number(plan.allow_chatbot))
        features.push(ar ? "روبوت المحادثة" : "Chatbot");
      if (Number(plan.allow_note))
        features.push(ar ? "ملاحظات العملاء" : "Customer notes");
      if (Number(plan.allow_tag))
        features.push(ar ? "وسوم جهات الاتصال" : "Contact tags");
      if (Number(plan.allow_api))
        features.push(ar ? "وصول Cloud API" : "Cloud API access");
      features.forEach((text) => {
        const li = document.createElement("li");
        li.textContent = text;
        list.append(li);
      });
      const checkout = element(
        "a",
        Number(plan.is_trial)
          ? ar
            ? "ابدأ التجربة ↗"
            : "Start trial ↗"
          : ar
            ? "ابدأ الآن ↗"
            : "Get started ↗",
        "button button-dark",
      );
      checkout.href = "/user/checkout?product=" + encodeURIComponent(plan.id);
      const link = element(
        "a",
        ar ? "ناقش هذه الخطة ↗" : "Discuss this plan ↗",
        "text-link",
      );
      link.href = "#contact";
      link.addEventListener("click", () => {
        const content = document.getElementById("content");
        if (!content.value)
          content.value = ar
            ? `أرغب في مناقشة خطة ${plan.title} (رقم ${plan.id}).`
            : `I'd like to discuss ${plan.title} (plan #${plan.id}).`;
        document.getElementById("solution").value = "other";
      });
      planGrid.append(card);
    }
  }
  Promise.all([
    fetch("/api/admin/get_plans").then((r) => r.json()),
    fetch("/api/web/get_web_public").then((r) => r.json()),
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
      renderPlans();
    })
    .catch(() => {
      planGrid.textContent =
        language === "ar"
          ? "تعذر تحميل الخطط الآن. تواصل معنا لمعرفة الأسعار الحالية."
          : "Plans are unavailable right now. Contact us for current pricing.";
      planGrid.classList.add("plan-error");
    });
  applyLanguage();
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
    link.addEventListener("click", () => {
      document.getElementById("solution").value = link.dataset.solution;
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
  const floating = document.querySelector(".floating-cta");
  if ("IntersectionObserver" in window) {
    let heroVisible = true,
      contactVisible = false;
    new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target.classList.contains("hero"))
          heroVisible = entry.isIntersecting;
        else contactVisible = entry.isIntersecting;
      });
      floating.classList.toggle("visible", !heroVisible && !contactVisible);
    }).observe(document.querySelector(".hero"));
    new IntersectionObserver((entries) => {
      contactVisible = entries[0].isIntersecting;
      floating.classList.toggle("visible", !heroVisible && !contactVisible);
    }).observe(document.getElementById("contact"));
  }
  document.getElementById("year").textContent = String(
    new Date().getFullYear(),
  );
  const form = document.getElementById("enquiry-form"),
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
      form.reset();
      submissionToken = crypto.randomUUID();
      submittedPayload = null;
      message(
        "Thank you — your request is with the SaleMaX sales team. We’ll follow up using the details you provided. Reference: " +
          result.reference,
        "شكراً — وصل طلبك إلى فريق مبيعات SaleMaX. سنتواصل معك باستخدام البيانات المقدمة. المرجع: " +
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
