'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'client/public/pipeline/index.html'), 'utf8');
const reports = fs.readFileSync(path.join(root, 'client/public/pipeline/reports.js'), 'utf8');
const pipeline = fs.readFileSync(path.join(root, 'client/public/pipeline/pipeline.js'), 'utf8');

test('reports is integrated as a bilingual view in the existing pipeline screen', () => {
  assert.match(html, /id="reportsMode"/);
  assert.match(html, /id="reports" class="reports hidden"/);
  assert.match(html, /src="\/pipeline\/reports\.js\?v=1"/);
  assert.match(reports, /\/api\/pipeline\/reports\/activity/);
  assert.match(reports, /ownerScope:'All workspace activity'/);
  assert.match(reports, /agentScope:'Only leads currently assigned to you'/);
  assert.match(reports, /ownerScope:'نشاط مساحة العمل بالكامل'/);
  assert.match(reports, /agentScope:'العملاء المسندون إليك حاليًا فقط'/);
  assert.match(reports, /name="period"/);
  assert.match(reports, /name="at" type="date"/);
  assert.match(reports, /reportPrevious/);
  assert.match(reports, /reportNext/);
  assert.match(reports, /report-lead-link/);
  assert.match(pipeline, /window\.salemaxPipelineOpenLead=openLead/);
});
