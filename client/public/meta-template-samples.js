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
  const sourceSamples = new Map();
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
    if (!findActionRow()?.contains(button)) return;
    const label = normalize(button.innerText || button.textContent || "");
    if (!/(submit|save|create|send|meta)/i.test(label)) return;
    if (!hasMissingVisibleSamples()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showInlineError("Add a sample for every variable before submitting this template to Meta.");
  }, true);

  document.addEventListener("submit", (event) => {
    if (!isReviewStepActive() || !hasMissingVisibleSamples()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showInlineError("Add a sample for every variable before submitting this template to Meta.");
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
    const reviewActive = isReviewStepActive();
    let panel = document.getElementById(panelId);
    if (!reviewActive) {
      if (panel) panel.remove();
      return;
    }
    const actionRow = findActionRow();
    if (!actionRow?.parentElement) return;
    const main = actionRow.parentElement;
    // Read only the wizard content. Our own labels must not keep removed
    // variables alive, and the sidebar is not part of the template.
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest(`#${panelId}`)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let text = "";
    while (walker.nextNode()) text += `${walker.currentNode.textContent} `;
    const variables = variableNumbers(text);
    if (!variables.length) {
      if (panel) panel.remove();
      return;
    }
    seedExistingExamples(main);
    if (panel && panel.parentElement) {
      syncFields(panel, variables);
      panel = document.getElementById(panelId);
      if (panel.nextElementSibling !== actionRow) main.insertBefore(panel, actionRow);
      return;
    }
    panel = createPanel(variables, isArabic());
    main.insertBefore(panel, actionRow);
  }

  function findActionRow() {
    const buttons = [...document.querySelectorAll("button")];
    const submit = buttons.findLast((button) => /^(save changes|submit(?: template)?|create template|إرسال|حفظ التغييرات)$/i.test(normalize(button.textContent)));
    for (let row = submit?.parentElement; row && row !== document.body; row = row.parentElement) {
      if ([...row.querySelectorAll("button")].some((button) => /^(back|رجوع|السابق)$/i.test(normalize(button.textContent)))) return row;
    }
    return null;
  }

  function isReviewStepActive() {
    if (new URLSearchParams(location.search).get("page") !== "create-meta-template") return false;
    const candidates = Array.from(document.querySelectorAll("body *")).filter((element) =>
      element.children.length < 3 && /^(review & submit|المراجعة والإرسال)$/.test(normalize(element.textContent || "")));
    return candidates.some((element) => {
      let current = element;
      for (let depth = 0; current && depth < 6; depth += 1, current = current.parentElement) {
        const classes = String(current.className?.baseVal || current.className || "");
        if (/(Mui-active|active|step-active)/i.test(classes) || current.getAttribute?.("aria-current") === "step" || current.getAttribute?.("aria-selected") === "true") return true;
      }
      return false;
    });
  }

  function seedExistingExamples(root) {
    const heading = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")]
      .find((element) => /^(variables|المتغيرات)$/.test(normalize(element.textContent)));
    const summary = heading?.parentElement?.parentElement;
    if (!summary || summary.id === panelId) return;
    let found = false;
    for (const label of summary.querySelectorAll("p")) {
      const match = label.textContent.trim().match(/^\{\{(\d+)\}\}$/);
      const sample = label.nextElementSibling?.textContent?.trim();
      if (!match || !sample) continue;
      const variable = match[1];
      if (!values.has(variable) || sourceSamples.get(variable) !== sample) values.set(variable, sample);
      sourceSamples.set(variable, sample);
      found = true;
    }
    // Reuse the standard wizard's examples in one editable section.
    if (found && summary.dataset.sxVariableSummary !== "true") summary.dataset.sxVariableSummary = "true";
  }

  function createPanel(variables, arabic) {
    const panel = document.createElement("section");
    panel.id = panelId;
    panel.setAttribute("aria-labelledby", `${panelId}-title`);
    Object.assign(panel.style, {
      margin: "16px 24px 24px", padding: "20px", border: "1px solid #e2e6ec", borderRadius: "10px",
      background: "#f8fafc", color: "#263238", font: "14px/1.5 Roboto, Arial, sans-serif",
      boxSizing: "border-box", minWidth: "0", textAlign: "start",
    });
    const style = document.createElement("style");
    style.textContent = `[data-sx-variable-summary=true]{display:none!important}#${panelId} .sx-sample-row{display:grid;grid-template-columns:76px minmax(0,1fr);gap:12px;align-items:center;margin-top:12px}#${panelId} .sx-sample-label{display:flex;align-items:center;justify-content:center;min-height:44px;border:1px solid #e2e6ec;background:#fff;border-radius:7px;font:500 14px/1.4 Roboto,Arial,sans-serif;direction:ltr}#${panelId} input:focus{outline:2px solid #a8003b;outline-offset:2px}#${panelId} input[aria-invalid=true]{border-color:#b42318}@media(max-width:600px){#${panelId}{margin:16px 16px 16px!important;padding:16px!important}#${panelId} .sx-sample-row{grid-template-columns:60px minmax(0,1fr);gap:8px}}`;
    panel.append(style);
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
      row.className = "sx-sample-row";
      const label = document.createElement("label");
      label.className = "sx-sample-label";
      label.textContent = `{{${variable}}}`;
      label.htmlFor = `${panelId}-input-${variable}`;
      const input = document.createElement("input");
      input.id = label.htmlFor;
      input.type = "text";
      input.autocomplete = "off";
      input.required = true;
      input.placeholder = arabic ? `أدخل مثالاً للمتغير {{${variable}}}` : `Enter sample for {{${variable}}}`;
      input.value = values.get(variable) || "";
      input.setAttribute("aria-label", arabic ? `مثال للمتغير {{${variable}}}` : `Sample for {{${variable}}}`);
      Object.assign(input.style, { minHeight: "44px", minWidth: "0", width: "100%", border: "1px solid #c8d0d8", borderRadius: "7px", padding: "10px 12px", font: "inherit", boxSizing: "border-box", background: "#fff", color: "#263238" });
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
    if (current.join(",") === variables.join(",")) {
      for (const input of panel.querySelectorAll("input")) {
        const variable = input.closest("[data-variable]").dataset.variable;
        const value = values.get(variable) || "";
        if (input.value !== value) input.value = value;
      }
      return;
    }
    const replacement = createPanel(variables, isArabic());
    panel.replaceWith(replacement);
  }

  function hasMissingVisibleSamples() {
    const panel = document.getElementById(panelId);
    if (!panel) return false;
    return [...panel.querySelectorAll("[data-variable]")].some((row) => {
      const input = row.querySelector("input");
      return !input?.value.trim();
    });
  }

  function showInlineError(message) {
    const panel = document.getElementById(panelId);
    const error = panel?.querySelector("[data-sample-error]");
    if (error) { error.textContent = message; error.hidden = false; }
    const inputs = [...(panel?.querySelectorAll("input") || [])];
    inputs.forEach((input) => input.setAttribute("aria-invalid", String(!input.value.trim())));
    inputs.find((input) => !input.value.trim())?.focus();
  }

  function clearInlineError(panel) {
    const error = panel.querySelector("[data-sample-error]");
    if (error) { error.textContent = ""; error.hidden = true; }
    panel.querySelectorAll("input").forEach((input) => input.removeAttribute("aria-invalid"));
  }

  function normalize(value) { return String(value).replace(/\s+/g, " ").trim().toLowerCase(); }
  function isArabic() { return document.documentElement.lang?.startsWith("ar") || document.documentElement.dir === "rtl"; }
  function variableNumbers(text) {
    return [...new Set([...String(text).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => match[1]))].sort((a, b) => Number(a) - Number(b));
  }

  function collectBodyTargets(components) {
    const targets = [];
    const addBody = (component) => {
      if (component?.type !== "BODY" || typeof component.text !== "string") return;
      const variables = variableNumbers(component.text);
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
