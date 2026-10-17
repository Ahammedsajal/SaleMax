/*
 * Inline sample editor for the existing Meta template wizard. The original
 * React source is not present in this deployment, so this maintained hook
 * adds a progressive enhancement to Step 3 and decorates the existing API
 * request with Meta's BODY example structure.
 */
(() => {
  "use strict";

  const endpoint = "/api/user/add_meta_templet";
  const panelId = "salemax-meta-template-samples";
  const values = new Map();
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const requestMeta = new WeakMap();
  let observerQueued = false;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    requestMeta.set(this, { method: String(method || "GET").toUpperCase(), url: String(url || "") });
    return nativeOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const meta = requestMeta.get(this);
    if (!meta || meta.method !== "POST" || !meta.url.includes(endpoint) || this.__salemaxSamplesApplied) {
      return nativeSend.call(this, body);
    }
    let payload;
    try { payload = typeof body === "string" ? JSON.parse(body) : null; } catch (_) { payload = null; }
    if (!payload || !Array.isArray(payload.components)) return nativeSend.call(this, body);

    const targets = collectBodyTargets(payload.components);
    if (!targets.length) return nativeSend.call(this, body);
    const missing = targets.flatMap((target) => target.variables
      .filter((variable) => !String(values.get(variable) || "").trim())
      .map((variable) => `{{${variable}}}`));
    if (missing.length) {
      // Normally the Step 3 capture guard blocks this before React enters its
      // submitting state. This fallback handles a payload whose variables
      // were not visible in the review preview.
      showInlineError(`Add a sample for ${[...new Set(missing)].join(", ")} in Step 3, then submit again.`);
      this.abort();
      return;
    }
    for (const target of targets) {
      target.component.example = {
        ...(target.component.example || {}),
        body_text: [target.variables.map((variable) => String(values.get(variable)).trim())],
      };
    }
    this.__salemaxSamplesApplied = true;
    return nativeSend.call(this, JSON.stringify(payload));
  };

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button");
    if (!button || !isReviewStepActive()) return;
    const label = normalize(button.innerText || button.textContent || "");
    if (!/(submit|save|create|send|meta)/i.test(label)) return;
    if (!hasMissingVisibleSamples()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showInlineError("Add a sample for every variable below before submitting this template to Meta.");
  }, true);

  document.addEventListener("submit", (event) => {
    if (!isReviewStepActive() || !hasMissingVisibleSamples()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showInlineError("Add a sample for every variable below before submitting this template to Meta.");
  }, true);

  const observer = new MutationObserver(() => {
    if (observerQueued) return;
    observerQueued = true;
    queueMicrotask(() => {
      observerQueued = false;
      renderInlineSamples();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  renderInlineSamples();

  function renderInlineSamples() {
    const main = document.querySelector("main") || document.body;
    const reviewActive = isReviewStepActive();
    let panel = document.getElementById(panelId);
    if (!reviewActive) {
      if (panel) panel.remove();
      return;
    }
    const variables = [...new Set([...main.innerText.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => match[1]))];
    if (!variables.length) {
      if (panel) panel.remove();
      return;
    }
    if (panel && panel.parentElement) {
      syncFields(panel, variables);
      return;
    }
    panel = createPanel(variables, /[\u0600-\u06ff]/.test(main.innerText || ""));
    const submitButton = [...main.querySelectorAll("button")].find((button) => /(submit|save|create|send)/i.test(normalize(button.innerText || button.textContent || "")));
    const actionRow = submitButton?.parentElement;
    if (actionRow?.parentElement) actionRow.parentElement.insertBefore(panel, actionRow);
    else main.append(panel);
  }

  function isReviewStepActive() {
    const candidates = Array.from(document.querySelectorAll("body *")).filter((element) =>
      element.children.length < 3 && normalize(element.textContent || "") === "review & submit");
    return candidates.some((element) => {
      let current = element;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const classes = String(current.className?.baseVal || current.className || "");
        if (/(Mui-active|active|step-active)/i.test(classes) || current.getAttribute?.("aria-current") === "step" || current.getAttribute?.("aria-selected") === "true") return true;
      }
      return false;
    });
  }

  function createPanel(variables, arabic) {
    const panel = document.createElement("section");
    panel.id = panelId;
    panel.setAttribute("aria-labelledby", `${panelId}-title`);
    Object.assign(panel.style, {
      margin: "18px 0", padding: "18px", border: "1px solid #d8dee8", borderRadius: "12px",
      background: "#f8fafc", color: "#263238", font: "14px/1.5 Roboto, Arial, sans-serif",
    });
    const title = document.createElement("h3");
    title.id = `${panelId}-title`;
    title.textContent = arabic ? "أمثلة المتغيرات" : "Variable samples";
    Object.assign(title.style, { margin: "0 0 4px", fontSize: "17px" });
    const intro = document.createElement("p");
    intro.textContent = arabic
      ? "أضف مثالاً لكل متغير حتى تتمكن Meta من مراجعة القالب. لن تُرسل الأمثلة للعملاء."
      : "Add a sample for each variable so Meta can review the template. Samples are for review only and are not sent to customers.";
    Object.assign(intro.style, { margin: "0 0 12px", color: "#586574" });
    panel.append(title, intro);
    for (const variable of variables) {
      const row = document.createElement("div");
      row.dataset.variable = variable;
      Object.assign(row.style, { display: "grid", gridTemplateColumns: "100px minmax(0,1fr)", gap: "8px", alignItems: "center", marginTop: "8px" });
      const label = document.createElement("label");
      label.textContent = `{{${variable}}}`;
      label.htmlFor = `${panelId}-input-${variable}`;
      const input = document.createElement("input");
      input.id = label.htmlFor;
      input.type = "text";
      input.autocomplete = "off";
      input.required = true;
      input.placeholder = arabic ? "أدخل مثالاً" : "Enter sample content";
      input.value = values.get(variable) || "";
      input.setAttribute("aria-label", arabic ? `مثال للمتغير {{${variable}}}` : `Sample for {{${variable}}}`);
      Object.assign(input.style, { minHeight: "40px", width: "100%", border: "1px solid #c8d0d8", borderRadius: "8px", padding: "8px 10px", font: "inherit", boxSizing: "border-box" });
      input.addEventListener("input", () => { values.set(variable, input.value); clearInlineError(panel); });
      row.append(label, input);
      panel.append(row);
    }
    const error = document.createElement("p");
    error.dataset.sampleError = "true";
    error.setAttribute("role", "alert");
    error.hidden = true;
    Object.assign(error.style, { margin: "10px 0 0", color: "#b42318" });
    panel.append(error);
    return panel;
  }

  function syncFields(panel, variables) {
    const current = [...panel.querySelectorAll("[data-variable]")].map((row) => row.dataset.variable);
    if (current.join(",") === variables.join(",")) return;
    const replacement = createPanel(variables, /[\u0600-\u06ff]/.test(document.querySelector("main")?.innerText || ""));
    panel.replaceWith(replacement);
  }

  function hasMissingVisibleSamples() {
    const panel = document.getElementById(panelId);
    if (!panel) return true;
    return [...panel.querySelectorAll("[data-variable]")].some((row) => {
      const input = row.querySelector("input");
      return !input?.value.trim();
    });
  }

  function showInlineError(message) {
    const panel = document.getElementById(panelId);
    const error = panel?.querySelector("[data-sample-error]");
    if (error) { error.textContent = message; error.hidden = false; }
    panel?.querySelector("input")?.focus();
  }

  function clearInlineError(panel) {
    const error = panel.querySelector("[data-sample-error]");
    if (error) { error.textContent = ""; error.hidden = true; }
  }

  function normalize(value) { return String(value).replace(/\s+/g, " ").trim().toLowerCase(); }

  function collectBodyTargets(components) {
    const targets = [];
    const addBody = (component) => {
      if (component?.type !== "BODY" || typeof component.text !== "string") return;
      const variables = [...new Set([...component.text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => match[1]))];
      if (variables.length) targets.push({ component, variables });
    };
    for (const component of components) {
      if (!component || typeof component !== "object") continue;
      if (component.type === "BODY") addBody(component);
      if (component.type === "CAROUSEL" && Array.isArray(component.cards)) {
        for (const card of component.cards) for (const child of card?.components || []) addBody(child);
      }
    }
    return targets;
  }
})();
