(() => {
  "use strict";

  const tr = (en, ar) =>
    document.documentElement.lang?.toLowerCase().startsWith("ar") ? ar : en;
  const root = () => document.querySelector("#sx-crm-appearance .wrap");
  let loading = false;
  let csrf = "";

  async function api(path, method = "GET", body) {
    const headers = { Accept: "application/json" };
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["X-CSRF-Token"] = csrf;
    }
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false)
      throw Error(result.code || "REQUEST_FAILED");
    return result.data ?? result;
  }

  function setStatus(card, message, error = false) {
    const status = card.querySelector("[data-storefront-status]");
    if (status) {
      status.className = error ? "error" : "status";
      status.textContent = message;
    }
  }

  function addField(form, key, label, value, type = "text", max = 2000) {
    const wrapper = document.createElement("label");
    wrapper.textContent = label;
    const input = document.createElement(type === "textarea" ? "textarea" : "input");
    if (type === "textarea") input.rows = 4;
    else input.type = type;
    input.name = key;
    input.value = value || "";
    input.maxLength = max;
    wrapper.append(input);
    form.append(wrapper);
    return input;
  }

  function addButton(actions, label, handler, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (primary) button.className = "primary";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await handler();
      } catch (error) {
        const text =
          error.message === "STOREFRONT_DOMAIN_REQUIRED"
            ? tr(
                "Connect and verify a primary business domain before publishing.",
                "اربط نطاق المؤسسة الأساسي وتحقق منه قبل النشر.",
              )
            : error.message === "STALE_REVISION"
            ? tr(
                "This draft changed in another session. Reload before saving.",
                "تم تعديل المسودة في جلسة أخرى. أعد تحميل الصفحة قبل الحفظ.",
              )
            : tr(
                "The request could not be completed. Check your connection and try again.",
                "تعذر إكمال الطلب. تحقق من الاتصال وحاول مرة أخرى.",
              );
        setStatus(actions.closest(".card"), text, true);
      } finally {
        button.disabled = false;
      }
    });
    actions.append(button);
    return button;
  }

  function render(node, data, settings) {
    const card = document.createElement("section");
    card.className = "card";
    card.id = "sx-tenant-storefront";
    const title = document.createElement("h2");
    title.textContent = tr("Business storefront", "واجهة موقع المؤسسة");
    const intro = document.createElement("p");
    intro.textContent = tr(
      "Build a bilingual public page for this training center. The current business name and logo come from the existing business profile. Drafts stay private until you publish.",
      "أنشئ صفحة عامة ثنائية اللغة لمركز التدريب. يأتي اسم المؤسسة وشعارها من ملف النشاط الحالي. تبقى المسودات خاصة حتى تنشرها.",
    );
    const status = document.createElement("div");
    status.dataset.storefrontStatus = "";
    card.append(title, intro, status);

    const form = document.createElement("form");
    form.onsubmit = (event) => event.preventDefault();
    const content = data.draft || {};
    addField(form, "headline", tr("Page headline", "عنوان الصفحة"), content.headline, "text", 120);
    addField(form, "headlineAr", tr("Page headline (Arabic)", "عنوان الصفحة (بالعربية)"), content.headlineAr, "text", 120);
    addField(form, "tagline", tr("Short introduction", "عبارة تعريفية"), content.tagline, "text", 180);
    addField(form, "taglineAr", tr("Short introduction (Arabic)", "عبارة تعريفية (بالعربية)"), content.taglineAr, "text", 180);
    addField(form, "description", tr("About this training center", "نبذة عن مركز التدريب"), content.description, "textarea", 2000);
    addField(form, "descriptionAr", tr("About this training center (Arabic)", "نبذة عن مركز التدريب (بالعربية)"), content.descriptionAr, "textarea", 2000);
    addField(form, "about", tr("More information", "معلومات إضافية"), content.about, "textarea", 3000);
    addField(form, "aboutAr", tr("More information (Arabic)", "معلومات إضافية (بالعربية)"), content.aboutAr, "textarea", 3000);
    addField(form, "contactPhone", tr("Public phone", "هاتف التواصل العام"), content.contactPhone, "tel", 30);
    addField(form, "contactEmail", tr("Public email", "البريد الإلكتروني العام"), content.contactEmail, "email", 254);
    addField(form, "whatsappNumber", tr("Public WhatsApp number in international format", "رقم واتساب العام بالصيغة الدولية"), content.whatsappNumber, "tel", 20);
    addField(form, "primaryColor", tr("Primary color", "اللون الأساسي"), content.primaryColor || "#1768d4", "color", 7);
    addField(form, "accentColor", tr("Accent color", "اللون الثانوي"), content.accentColor || "#12c9f4", "color", 7);
    card.append(form);

    const preview = document.createElement("div");
    preview.className = "hint";
    preview.setAttribute("aria-live", "polite");
    const previewTitle = document.createElement("h3");
    const previewTagline = document.createElement("strong");
    const previewDescription = document.createElement("p");
    const previewAbout = document.createElement("p");
    preview.append(previewTitle, previewTagline, previewDescription, previewAbout);
    card.append(preview);
    const updatePreview = () => {
      const current = Object.fromEntries(new FormData(form).entries());
      const arabic = document.documentElement.lang?.toLowerCase().startsWith("ar");
      preview.dir = arabic ? "rtl" : "ltr";
      previewTitle.textContent =
        (arabic && current.headlineAr) ||
        current.headline ||
        settings.profile?.businessNameEn ||
        tr("Your business name", "اسم مؤسستك");
      previewTagline.textContent = (arabic && current.taglineAr) || current.tagline || "";
      previewDescription.textContent = (arabic && current.descriptionAr) || current.description || "";
      previewAbout.textContent = (arabic && current.aboutAr) || current.about || "";
    };
    form.addEventListener("input", updatePreview);
    updatePreview();

    const actions = document.createElement("div");
    actions.className = "actions";
    addButton(actions, tr("Preview draft", "معاينة المسودة"), async () => {
      updatePreview();
      setStatus(card, tr("This is a private preview of your draft.", "هذه معاينة خاصة لمسودتك."));
    });
    addButton(actions, tr("Save draft", "حفظ المسودة"), async () => {
      const draft = Object.fromEntries(new FormData(form).entries());
      const saved = await api("/api/crm/storefront", "PUT", {
        content: draft,
        expectedRevision: data.revision,
      });
      data.draft = saved.draft;
      data.revision = saved.revision;
      setStatus(card, tr("Draft saved. It is still private.", "تم حفظ المسودة. وما زالت خاصة."));
    }, true);
    const hasActivePrimaryDomain = (settings.domains || []).some(
      (domain) => domain.status === "active" && domain.isPrimary,
    );
    const publish = addButton(actions, tr("Publish website", "نشر الموقع"), async () => {
      await api("/api/crm/storefront/publish", "POST", {
        expectedRevision: data.revision,
      });
      data.publishedRevision = data.revision;
      setStatus(card, tr("The storefront is published on the verified primary domain.", "تم نشر واجهة المتجر على النطاق الأساسي الموثق."));
    }, true);
    publish.disabled = !hasActivePrimaryDomain;
    if (!hasActivePrimaryDomain) {
      const domainNote = document.createElement("p");
      domainNote.className = "hint";
      domainNote.textContent = tr(
        "Connect and verify a business domain in the existing CRM domain settings before publishing publicly. You can edit and preview this draft now.",
        "اربط نطاق المؤسسة وتحقق منه في إعدادات النطاق الحالية في CRM قبل نشر الصفحة للعامة. يمكنك تعديل المسودة ومعاينتها الآن.",
      );
      card.append(domainNote);
    }
    if (data.publishedRevision) {
      addButton(actions, tr("Restore previous published version", "استعادة النسخة المنشورة السابقة"), async () => {
        const result = await api("/api/crm/storefront/rollback", "POST", {});
        data.revision = result.revision;
        data.draft = result.content;
        for (const [key, value] of Object.entries(result.content || {})) {
          const input = form.elements.namedItem(key);
          if (input && typeof value === "string") input.value = value;
        }
        updatePreview();
        setStatus(card, tr("The previous published version was restored.", "تمت استعادة النسخة المنشورة السابقة."));
      });
    }
    card.append(actions);
    node.append(card);
  }

  async function mount() {
    const node = root();
    if (
      !node ||
      node.dataset.storefrontChecked === "true" ||
      loading ||
      location.pathname !== "/user" ||
      new URLSearchParams(location.search).get("page") !== "crm-appearance"
    ) return;
    loading = true;
    try {
      const me = await api("/api/user/business-auth/me");
      if (me?.context?.audience !== "tenant") return;
      csrf = me.csrfToken || "";
      const [settings, data] = await Promise.all([
        api("/api/crm/appearance"),
        api("/api/crm/storefront"),
      ]);
      node.dataset.storefrontChecked = "true";
      if (data.enabled === true) render(node, data, settings);
    } catch (error) {
      node.dataset.storefrontChecked = "true";
      if (error.message !== "PERMISSION_DENIED") {
        const notice = document.createElement("p");
        notice.className = "hint";
        notice.textContent = tr("Storefront settings are temporarily unavailable.", "إعدادات واجهة المتجر غير متاحة مؤقتاً.");
        node.append(notice);
      }
    } finally {
      loading = false;
    }
  }

  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("popstate", mount);
  mount();
})();
