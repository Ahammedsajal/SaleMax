"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { clean } = require("../modules/web/website-enquiries");
const base = {
  name: "Test Visitor",
  mobile: "+974 5555 0101",
  email: " WEBSITE@EXAMPLE.INVALID ",
  content: "Test business enquiry",
  company: "Synthetic business",
  solution: "crm",
  consent: true,
};
test("website normalizes contact details and bounds every stored field", () => {
  const data = clean(base);
  assert.equal(data.mobile, "+97455550101");
  assert.equal(data.email, "website@example.invalid");
  for (const patch of [
    { name: [] },
    { email: "wrong" },
    { mobile: "123" },
    { mobile: "call me at 12345678" },
    { company: "x".repeat(161) },
    { content: "x".repeat(2001) },
    { solution: "admin" },
    { consent: false },
    { submissionToken: "../secret" },
  ])
    assert.throws(() => clean({ ...base, ...patch }), { status: 400 });
});
test("legacy form payloads stay compatible without accepting a caller-selected tenant", () => {
  const data = clean({
    name: base.name,
    email: base.email,
    mobile: "55550101",
    content: base.content,
    tenantId: "foreign",
    ownerUid: "foreign",
  });
  assert.equal(data.solution, "other");
  assert.equal(data.company, "");
  assert.equal(data.tenantId, undefined);
  assert.equal(data.ownerUid, undefined);
});
test("HTTP boundary denies foreign origins and tenant domains before touching the database", async () => {
  const express = require("express");
  const app = express();
  require("../modules/web/public-website").mountPublicWebsite(app, {
    pool: {
      getConnection() {
        throw new Error("database must not be touched");
      },
    },
    key: Buffer.alloc(32),
    origin: "http://127.0.0.1",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/public/website/enquiries`;
  try {
    let result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "https://foreign.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(base),
    });
    assert.equal(result.status, 403);
    result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...base, consent: undefined }),
    });
    assert.equal(result.status, 400);
    result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ website: "spam" }),
    });
    assert.equal(result.status, 201);
    result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: "{",
    });
    assert.equal(result.status, 400);
    result = await fetch(url, {
      method: "POST",
      headers: {
        Origin: "http://127.0.0.1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "x".repeat(20000) }),
    });
    assert.equal(result.status, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
