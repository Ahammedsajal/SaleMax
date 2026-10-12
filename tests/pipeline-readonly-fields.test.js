'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const root=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.js'),'utf8');
const css=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.css'),'utf8');

test('lead source is rendered as a styled, labelled read-only value',()=>{
  assert.match(ui,/<output aria-label="Source">\$\{escape\(sourceName\(lead\)\)\}<\/output>/);
  assert.doesNotMatch(ui,/<input value="\$\{escape\(sourceName\(lead\)\)\}" disabled>/);
  assert.match(css,/\.field input,\.field select,\.field textarea,\.field output\{/);
  assert.match(css,/\.field output\{display:flex;align-items:center/);
});
