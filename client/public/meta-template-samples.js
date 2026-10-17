/*
 * Progressive enhancement for the existing Meta template wizard.
 * The wizard's React source is not in this repository. This maintained hook
 * prompts for sample values at final submission when the existing submit
 * payload contains numeric body placeholders. Existing values prefill the
 * prompt; users can review or correct them before Meta receives the request.
 */
(() => {
  "use strict";

  const endpoint = "/api/user/add_meta_templet";
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const requestMeta = new WeakMap();
  let activeDialog = null;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    requestMeta.set(this, {
      method: String(method || "GET").toUpperCase(),
      url: String(url || ""),
    });
    return nativeOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const meta = requestMeta.get(this);
    if (
      !meta ||
      meta.method !== "POST" ||
      !meta.url.includes(endpoint) ||
      this.__salemaxTemplateSamplesRetry
    ) {
      return nativeSend.call(this, body);
    }

    let payload;
    try {
      payload = typeof body === "string" ? JSON.parse(body) : null;
    } catch (_) {
      payload = null;
    }
    if (!payload || !Array.isArray(payload.components)) {
      return nativeSend.call(this, body);
    }

    const targets = collectBodyTargets(payload.components);
    if (!targets.length) return nativeSend.call(this, body);

    showSampleDialog(targets, (samples) => {
      for (const target of targets) {
        const values = target.variables.map((variable) =>
          String(samples.get(`${target.key}:${variable}`) || "").trim(),
        );
        target.component.example = {
          ...(target.component.example || {}),
          body_text: [values],
        };
      }
      this.__salemaxTemplateSamplesRetry = true;
      nativeSend.call(this, JSON.stringify(payload));
    }, () => {
      this.abort();
    });
  };

  function collectBodyTargets(components) {
    const targets = [];
    const addBody = (component, key, label) => {
      if (component.type !== "BODY" || typeof component.text !== "string") return;
      const variables = [...component.text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
        .map((match) => match[1]);
      // Preserve first-appearance order so existing standard-template examples
      // retain the same positional mapping as the builder's Variables step.
      const ordered = [...new Set(variables)];
      if (ordered.length) targets.push({ component, key, label, variables: ordered });
    };

    for (let index = 0; index < components.length; index += 1) {
      const component = components[index];
      if (!component || typeof component !== "object") continue;
      if (component.type === "BODY") addBody(component, `body:${index}`, "Message body");
      if (component.type === "CAROUSEL" && Array.isArray(component.cards)) {
        component.cards.forEach((card, cardIndex) => {
          (card?.components || []).forEach((child, childIndex) =>
            addBody(child, `card:${cardIndex}:${childIndex}`, `Card ${cardIndex + 1}`),
          );
        });
      }
    }
    return targets;
  }

  function showSampleDialog(targets, onContinue, onCancel) {
    if (activeDialog) activeDialog.remove();
    const isArabic = /[\u0600-\u06ff]/.test(document.querySelector("main")?.innerText || "");
    const copy = isArabic
      ? {
          title: "أمثلة المتغيرات",
          intro: "أضف مثالاً لكل متغير حتى تتمكن Meta من مراجعة القالب. لن تُرسل الأمثلة للعملاء.",
          label: (group, variable) => `${group} · {{${variable}}}`,
          placeholder: "مثال توضيحي",
          cancel: "إلغاء",
          submit: "متابعة وإرسال للمراجعة",
          required: "أدخل مثالاً لكل متغير للمتابعة.",
        }
      : {
          title: "Variable samples",
          intro: "Add a sample for every variable so Meta can review this template. Samples are not sent to customers.",
          label: (group, variable) => `${group} · {{${variable}}}`,
          placeholder: "Enter sample content",
          cancel: "Cancel",
          submit: "Continue to Meta",
          required: "Enter a sample for every variable to continue.",
        };

    const backdrop = document.createElement("div");
    backdrop.setAttribute("role", "presentation");
    Object.assign(backdrop.style, {
      position: "fixed", inset: "0", zIndex: "2147483000", background: "rgba(17,24,39,.58)",
      display: "grid", placeItems: "center", padding: "20px", boxSizing: "border-box",
    });

    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "salemax-template-sample-title");
    Object.assign(dialog.style, {
      width: "min(680px, 100%)", maxHeight: "min(82vh, 760px)", overflow: "auto",
      background: "#fff", color: "#263238", borderRadius: "14px", padding: "24px",
      boxShadow: "0 18px 60px rgba(0,0,0,.28)", font: "14px/1.5 Roboto, Arial, sans-serif",
      boxSizing: "border-box",
    });

    const title = document.createElement("h2");
    title.id = "salemax-template-sample-title";
    title.textContent = copy.title;
    Object.assign(title.style, { margin: "0 0 8px", fontSize: "20px" });
    const intro = document.createElement("p");
    intro.textContent = copy.intro;
    Object.assign(intro.style, { margin: "0 0 18px", color: "#586574" });
    const form = document.createElement("form");
    const error = document.createElement("p");
    error.setAttribute("role", "alert");
    Object.assign(error.style, { display: "none", color: "#b42318", margin: "12px 0 0" });
    const fields = new Map();

    for (const target of targets) {
      const existing = target.component.example?.body_text?.[0] || [];
      for (let variableIndex = 0; variableIndex < target.variables.length; variableIndex += 1) {
        const variable = target.variables[variableIndex];
        const fieldKey = `${target.key}:${variable}`;
        const label = document.createElement("label");
        label.textContent = copy.label(target.label, variable);
        Object.assign(label.style, { display: "block", fontWeight: "600", margin: "14px 0 5px" });
        const input = document.createElement("input");
        input.type = "text";
        input.required = true;
        input.autocomplete = "off";
        input.placeholder = copy.placeholder;
        input.value = String(existing[variableIndex] || "");
        input.setAttribute("aria-label", label.textContent);
        Object.assign(input.style, {
          width: "100%", minHeight: "42px", border: "1px solid #c8d0d8", borderRadius: "8px",
          padding: "9px 11px", font: "inherit", boxSizing: "border-box",
        });
        label.htmlFor = `salemax-sample-${fields.size}`;
        input.id = label.htmlFor;
        fields.set(fieldKey, input);
        form.append(label, input);
      }
    }

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" });
    const cancel = makeButton(copy.cancel, false);
    const submit = makeButton(copy.submit, true);
    actions.append(cancel, submit);
    form.append(error, actions);
    dialog.append(title, intro, form);
    backdrop.append(dialog);
    activeDialog = backdrop;
    document.body.append(backdrop);

    cancel.addEventListener("click", () => {
      backdrop.remove();
      activeDialog = null;
      onCancel();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const empty = [...fields.values()].find((input) => !input.value.trim());
      if (empty) {
        error.textContent = copy.required;
        error.style.display = "block";
        empty.focus();
        return;
      }
      const samples = new Map([...fields].map(([key, input]) => [key, input.value]));
      backdrop.remove();
      activeDialog = null;
      onContinue(samples);
    });
    fields.values().next().value?.focus();
  }

  function makeButton(text, primary) {
    const button = document.createElement("button");
    button.type = primary ? "submit" : "button";
    button.textContent = text;
    Object.assign(button.style, {
      minHeight: "40px", borderRadius: "8px", padding: "8px 14px", font: "inherit",
      cursor: "pointer", border: primary ? "1px solid #a8003b" : "1px solid #c8d0d8",
      color: primary ? "#fff" : "#374151", background: primary ? "#a8003b" : "#fff",
    });
    return button;
  }
})();
