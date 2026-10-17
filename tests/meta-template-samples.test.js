const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sampleHook = fs.readFileSync(
  path.join(root, "client/public/meta-template-samples.js"),
  "utf8",
);
const shellModule = { exports: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(root, "modules/web/meta-template-samples-shell.js"), "utf8"),
  { module: shellModule, exports: shellModule.exports },
);
const {
  isMetaTemplateBuilderRequest,
  injectMetaTemplateSamplesScript,
} = shellModule.exports;

function createHookContext(mainText = "") {
  const elements = [];

  class Element {
    constructor(tagName) {
      this.tagName = tagName;
      this.style = {};
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.value = "";
      this.textContent = "";
      elements.push(this);
    }

    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    remove() { this.removed = true; }
    focus() { this.focused = true; }
  }

  const document = {
    body: new Element("body"),
    createElement: (tagName) => new Element(tagName),
    querySelector: () => ({ innerText: mainText }),
  };

  class FakeXMLHttpRequest {
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    send(body) { this.sent = body; }
    abort() { this.aborted = true; }
  }

  vm.runInNewContext(sampleHook, {
    XMLHttpRequest: FakeXMLHttpRequest,
    document,
    Map,
    WeakMap,
    String,
    JSON,
    Array,
    console,
  });

  return { elements, FakeXMLHttpRequest };
}

function submitSamples(context, request) {
  const form = context.elements.find((element) => element.tagName === "form");
  form.listeners.submit({ preventDefault() {} });
  return request.sent && JSON.parse(request.sent);
}

test("injects the hook only for the existing Create Meta Template route", () => {
  assert.equal(
    isMetaTemplateBuilderRequest({ path: "/user", query: { page: "create-meta-template" } }),
    true,
  );
  assert.equal(
    isMetaTemplateBuilderRequest({ path: "/user", query: { page: "send-campaign" } }),
    false,
  );

  const html = "<html><head></head><body></body></html>";
  const enhanced = injectMetaTemplateSamplesScript(html);
  assert.match(enhanced, /meta-template-samples\.js/);
  assert.equal(injectMetaTemplateSamplesScript(enhanced), enhanced);
});

test("collects final samples for the main body and each carousel card", () => {
  const context = createHookContext();
  const request = new context.FakeXMLHttpRequest();
  request.open("POST", "/api/user/add_meta_templet");
  request.send(JSON.stringify({
    components: [
      { type: "BODY", text: "Explore {{1}} for {{2}}" },
      {
        type: "CAROUSEL",
        cards: [
          { components: [{ type: "BODY", text: "Course {{1}} at {{2}}" }] },
          { components: [{ type: "BODY", text: "Program {{1}}" }] },
        ],
      },
    ],
  }));

  assert.equal(request.sent, undefined, "submission waits for sample entry");
  const inputs = context.elements.filter((element) => element.tagName === "input");
  assert.equal(inputs.length, 5);
  inputs.forEach((input, index) => { input.value = `sample_${index + 1}`; });

  const payload = submitSamples(context, request);
  assert.deepEqual(payload.components[0].example.body_text, [["sample_1", "sample_2"]]);
  assert.deepEqual(
    payload.components[1].cards[0].components[0].example.body_text,
    [["sample_3", "sample_4"]],
  );
  assert.deepEqual(
    payload.components[1].cards[1].components[0].example.body_text,
    [["sample_5"]],
  );
});

test("prefills existing standard samples, preserves their order, and allows review", () => {
  const context = createHookContext();
  const request = new context.FakeXMLHttpRequest();
  request.open("POST", "/api/user/add_meta_templet");
  request.send(JSON.stringify({
    components: [{
      type: "BODY",
      text: "{{2}} then {{1}}",
      example: { body_text: [["two", "one"]] },
    }],
  }));

  const inputs = context.elements.filter((element) => element.tagName === "input");
  assert.deepEqual(inputs.map((input) => input.value), ["two", "one"]);
  const payload = submitSamples(context, request);
  assert.deepEqual(payload.components[0].example.body_text, [["two", "one"]]);
});

test("passes variable-free requests through without adding a prompt", () => {
  const context = createHookContext();
  const request = new context.FakeXMLHttpRequest();
  const body = JSON.stringify({ components: [{ type: "BODY", text: "No variables here" }] });
  request.open("POST", "/api/user/add_meta_templet");
  request.send(body);

  assert.equal(request.sent, body);
  assert.equal(context.elements.some((element) => element.tagName === "form"), false);
});
