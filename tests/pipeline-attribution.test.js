'use strict';

const assert=require('node:assert/strict');
const test=require('node:test');
const leadPipeline=require('../helper/pipeline/leadPipeline');

test('lead attribution history keeps the oldest and newest tracked form touches',()=>{
  const latest={id:'new',referenceCode:'NEW001',submittedAt:'2026-10-08T11:00:00Z',attribution:{utmSource:'social',utmCampaign:'winter'}};
  const olderUntracked={id:'middle',attribution:null};
  const first={id:'old',referenceCode:'OLD001',submittedAt:'2026-10-01T11:00:00Z',attribution:{utmSource:'newsletter',utmCampaign:'launch'}};
  assert.deepEqual(leadPipeline.summarizeCampaignAttribution([latest,olderUntracked,first]),{
    trackedTouchCount:2,
    firstTouch:{submissionId:'old',referenceCode:'OLD001',submittedAt:'2026-10-01T11:00:00Z',attribution:first.attribution},
    latestTouch:{submissionId:'new',referenceCode:'NEW001',submittedAt:'2026-10-08T11:00:00Z',attribution:latest.attribution},
  });
});

test('lead attribution history reports an empty state when no submission has tracked attribution',()=>{
  assert.deepEqual(leadPipeline.summarizeCampaignAttribution([{}, {attribution:null}, {attribution:[]}]),{
    trackedTouchCount:0,firstTouch:null,latestTouch:null,
  });
});

test('the existing Lead Pipeline renders bilingual first/latest attribution with a narrow-screen layout',()=>{
  const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
  const pipeline=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.js'),'utf8');
  const css=fs.readFileSync(path.join(root,'client/public/pipeline/pipeline.css'),'utf8');
  const html=fs.readFileSync(path.join(root,'client/public/pipeline/index.html'),'utf8');
  assert.match(pipeline,/renderAttributionHistory\(lead\.attributionHistory\)/);
  assert.match(pipeline,/First recorded touch/);assert.match(pipeline,/Latest recorded touch/);
  assert.match(pipeline,/أول مصدر مسجل/);assert.match(pipeline,/أحدث مصدر مسجل/);
  assert.match(css,/\.campaign-attribution-history/);assert.match(css,/@media\(max-width:600px\)\{\.attribution-touch-grid\{grid-template-columns:1fr/);
  assert.match(html,/pipeline\.js\?v=22/);assert.match(html,/pipeline\.css\?v=10/);
});
