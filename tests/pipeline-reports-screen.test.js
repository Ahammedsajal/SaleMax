'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'client/public/pipeline/index.html'), 'utf8');
const reports = fs.readFileSync(path.join(root, 'client/public/pipeline/reports.js'), 'utf8');
const pipeline = fs.readFileSync(path.join(root, 'client/public/pipeline/pipeline.js'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'client/public/pipeline-entry.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'client/public/training-sidebar.js'), 'utf8');

test('reports is integrated as a bilingual view in the existing pipeline screen', () => {
  assert.match(html, /id="reportsMode"/);
  assert.match(html, /id="reports" class="reports hidden"/);
  assert.match(html, /src="\/pipeline\/reports\.js\?v=\d+"/);
  assert.match(reports, /get\('view'\)==='reports'/);
  assert.match(entry, /page.*lead-reports/);
  assert.match(entry, /view=reports/);
  assert.match(sidebar, /Lead Reports/);
  assert.match(html, /id="followupsMode"/);
  assert.match(html, /id="followups" class="reports hidden"/);
  assert.match(reports, /\/api\/pipeline\/reports\/activity/);
  assert.match(reports, /ownerScope:'All workspace activity'/);
  assert.match(reports, /agentScope:'Only leads currently assigned to you'/);
  assert.match(reports, /agentReplies:'ردود الوكلاء عبر واتساب'/);
  assert.match(reports, /agentReply:'Agent WhatsApp reply'/);
  assert.match(reports, /activityType==='agent_message_sent'/);
  assert.match(reports, /ownerScope:'نشاط مساحة العمل بالكامل'/);
  assert.match(reports, /agentScope:'العملاء المسندون إليك حاليًا فقط'/);
  assert.match(reports, /name="period"/);
  assert.match(reports, /name="at" type="date"/);
  assert.match(reports, /cohortShare:'of new leads'/);
  assert.match(reports, /cohortShare:'من العملاء الجدد'/);
  assert.match(reports, /Math\.round\(Number\(value\|\|0\)\*100\/cohortSize\)/);
  assert.match(html, /pipeline\.css\?v=8/);
  assert.match(html, /reports\.js\?v=15/);
  assert.match(fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.css'),'utf8'),/journey-cohort \.journey-stage small/);
  assert.match(reports, /reportPrevious/);
  assert.match(reports, /reportNext/);
  assert.match(reports, /report-lead-link/);
  assert.match(reports, /exportPage:'Export this page \(CSV\)'/);
  assert.match(reports, /exportPage:'تصدير هذه الصفحة \(CSV\)'/);
  assert.match(reports, /follow-up queue|follow-ups/i);
  assert.match(reports, /متابعات/);
  assert.match(reports, /function exportCurrentPage\(report\)/);
  assert.ok(reports.includes("if(/^(?:[=+@]|-|\\t)/.test(text))"));
  assert.ok(reports.includes("join('\\r\\n')"));
  assert.match(pipeline, /window\.salemaxPipelineOpenLead=openLead/);
});

test('existing lead details submit localized outcomes and require a due time when selected', () => {
  assert.match(pipeline, /name="contactOutcome"/);
  assert.match(pipeline, /name="followUpRequired"/);
  assert.match(pipeline, /followUpDateRequired:'Choose a follow-up date and time for this outcome\.'/);
  assert.match(pipeline, /followUpDateRequired:'حدد تاريخ ووقت المتابعة لهذه النتيجة\.'/);
  assert.match(pipeline, /payload\.outcome=outcome;payload\.followUpRequired=followUpRequired/);
  assert.match(pipeline, /nextFollowUp\.reportValidity\(\)/);
});
