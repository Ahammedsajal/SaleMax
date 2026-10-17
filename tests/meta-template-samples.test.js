const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sampleHook = fs.readFileSync(path.join(root, "client/public/meta-template-samples.js"), "utf8");
const shellModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, "modules/web/meta-template-samples-shell.js"), "utf8"), {
  module: shellModule, exports: shellModule.exports,
});
const { isMetaTemplateBuilderRequest, injectMetaTemplateSamplesScript } = shellModule.exports;

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.dataset = {};
    this.value = "";
    this._text = "";
    this.className = "";
    this.hidden = false;
  }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get innerText() { return this.textContent; }
  set innerText(value) { this.textContent = value; }
  get parentElement() { return this._parent || null; }
  append(...children) { for (const child of children) { child._parent = this; this.children.push(child); } }
  insertBefore(child, before) {
    const index = this.children.indexOf(before);
    if (index < 0) return this.append(child);
    child._parent = this;
    this.children.splice(index, 0, child);
  }
  replaceWith(replacement) {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    replacement._parent = parent;
    parent.children[index] = replacement;
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] || null; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this._parent = null;
  }
  focus() { this.focused = true; }
  querySelectorAll(selector) {
    const descendants = [];
    const visit = (element) => {
      for (const child of element.children) { descendants.push(child); visit(child); }
    };
    visit(this);
    if (selector === "input") return descendants.filter((element) => element.tagName === "input");
    if (selector === "button") return descendants.filter((element) => element.tagName === "button");
    if (selector === "* ") return descendants;
    if (selector === "[data-variable]") return descendants.filter((element) => element.dataset.variable !== undefined);
    if (selector === "[data-sample-error]") return descendants.filter((element) => element.dataset.sampleError === "true");
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return selector === "button" && this.tagName === "button" ? this : null; }
}

function createContext() {
  const document = {
    listeners: {},
    createElement: (tag) => new Element(tag),
    addEventListener(name, callback) { this.listeners[name] = callback; },
    querySelector(selector) { return selector === "main" ? main : null; },
    querySelectorAll(selector) { return selector === "body *" ? main.querySelectorAll("* ") : []; },
    getElementById(id) { return [main, ...main.querySelectorAll("* ")].find((element) => element.id === id) || null; },
  };
  const main = new Element("main");
  document.documentElement = new Element("html");
  const stepLabel = new Element("span");
  stepLabel.textContent = "Review & Submit";
  stepLabel.className = "Mui-active";
  const preview = new Element("p");
  preview.textContent = "Message: {{1}} and {{2}}";
  const buttonRow = new Element("div");
  const submit = new Element("button");
  submit.textContent = "Submit";
  buttonRow.append(submit);
  main.append(stepLabel, preview, buttonRow);
  class FakeXMLHttpRequest {
    open(method, url) { this.method = method; this.url = url; }
    send(body) { this.sent = body; }
    abort() { this.aborted = true; }
  }
  class FakeMutationObserver { observe() {} }
  vm.runInNewContext(sampleHook, {
    XMLHttpRequest: FakeXMLHttpRequest, document, MutationObserver: FakeMutationObserver,
    Map, WeakMap, String, JSON, Array, queueMicrotask, console,
  });
  return { document, main, elements: [main, ...main.querySelectorAll("* ")], FakeXMLHttpRequest };
}

test("injects the hook only for the existing Create Meta Template route", () => {
  assert.equal(isMetaTemplateBuilderRequest({ path: "/user", query: { page: "create-meta-template" } }), true);
  assert.equal(isMetaTemplateBuilderRequest({ path: "/user", query: { page: "send-campaign" } }), false);
  const html = "<html><head></head><body></body></html>";
  const enhanced = injectMetaTemplateSamplesScript(html);
  assert.match(enhanced, /meta-template-samples\.js/);
  assert.equal(injectMetaTemplateSamplesScript(enhanced), enhanced);
});

test("renders the variable inputs inline in active Step 3 and includes values for main and carousel BODY components", () => {
  const context = createContext();
  const panel = context.document.getElementById("salemax-meta-template-samples");
  assert.ok(panel, "Step 3 contains the sample panel before submission");
  assert.equal(panel.parentElement, context.main);
  const inputs = panel.querySelectorAll("input");
  assert.equal(inputs.length, 2);
  inputs[0].value = "course name";
  inputs[0].listeners.input();
  inputs[1].value = "next week";
  inputs[1].listeners.input();

  const request = new context.FakeXMLHttpRequest();
  request.open("POST", "/api/user/add_meta_templet");
  request.send(JSON.stringify({
    components: [
      { type: "BODY", text: "Explore {{1}} starting {{2}}" },
      { type: "CAROUSEL", cards: [
        { components: [{ type: "BODY", text: "Join {{1}} from {{2}}" }] },
      ] },
    ],
  }));
  const payload = JSON.parse(request.sent);
  assert.deepEqual(payload.components[0].example.body_text, [["course name", "next week"]]);
  assert.deepEqual(payload.components[1].cards[0].components[0].example.body_text, [["course name", "next week"]]);
});

test("blocks submission before the app handler when a Step 3 sample is missing", () => {
  const context = createContext();
  const click = context.document.listeners.click;
  const button = context.main.querySelector("button");
  const event = {
    target: button,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
  click(event);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(context.document.getElementById("salemax-meta-template-samples").querySelector("[data-sample-error]").hidden, false);
});

test("passes variable-free templates through unchanged", () => {
  const context = createContext();
  const request = new context.FakeXMLHttpRequest();
  request.open("POST", "/api/user/add_meta_templet");
  const body = JSON.stringify({ components: [{ type: "BODY", text: "No variables here" }] });
  request.send(body);
  assert.equal(request.sent, body);
});
