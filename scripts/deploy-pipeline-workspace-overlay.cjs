'use strict';
const fs=require('node:fs'),path=require('node:path');
const [target,source]=process.argv.slice(2);if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/lead-workspace-contract.js','routes/pipeline.js','client/public/workspace-api.js','client/public/pipeline/workspace-fields.js','client/public/pipeline/pipeline.js','client/public/pipeline/timezone-options.js','client/public/pipeline/reports.js','client/public/pipeline/lead-import.js','client/public/pipeline/opening-routing.js'];
const htmlPath=path.join(target,'client/public/pipeline/index.html');let html=fs.readFileSync(htmlPath,'utf8');
if(html.includes('/workspace-api.js?v=20261022-pipeline-shared-client1'))throw Error('PIPELINE_SHARED_CLIENT_OVERLAY_EXISTS');
const anchor=/<script[^>]+src="\/pipeline\/pipeline\.js(?:\?[^"<>]+)?"[^>]*><\/script>/g;
if((html.match(anchor)||[]).length!==1)throw Error('AMBIGUOUS_PIPELINE_LOADER');
const reportsAnchor=/<script[^>]+src="\/pipeline\/reports\.js(?:\?[^"<>]+)?"[^>]*><\/script>/g;
if((html.match(reportsAnchor)||[]).length!==1)throw Error('AMBIGUOUS_PIPELINE_REPORTS_LOADER');
const commonTag=/<script[^>]+src="\/workspace-api\.js(?:\?[^"<>]+)?"[^>]*><\/script>/;
const fieldsTag=/<script[^>]+src="\/pipeline\/workspace-fields\.js(?:\?[^"<>]+)?"[^>]*><\/script>/;
html=html.replace(anchor,match=>`${commonTag.test(html)?'':'<script src="/workspace-api.js?v=20261022-pipeline-shared-client1"></script>'}${fieldsTag.test(html)?'':'<script src="/pipeline/workspace-fields.js?v=20261020-category1"></script>'}${match}`)
  .replace(/(<script[^>]+src="\/workspace-api\.js)(?:\?[^"<>]*)?("[^>]*><\/script>)/g,'$1?v=20261022-pipeline-shared-client1$2')
  .replace(/(<script[^>]+src="\/pipeline\/workspace-fields\.js)(?:\?[^"<>]*)?("[^>]*><\/script>)/g,'$1?v=20261020-category1$2')
  .replace(/\/pipeline\/pipeline\.js(?:\?[^"\s<>]+)?/g,'/pipeline/pipeline.js?v=20261022-pipeline-shared-client1')
  .replace(/\/pipeline\/reports\.js(?:\?[^"\s<>]+)?/g,'/pipeline/reports.js?v=20261022-shared-client1')
  .replace(/\/pipeline\/timezone-options\.js(?:\?[^"\s<>]+)?/g,'/pipeline/timezone-options.js?v=20261022-shared-client1')
  .replace(/\/pipeline\/lead-import\.js(?:\?[^"\s<>]+)?/g,'/pipeline/lead-import.js?v=20261022-shared-client1')
  .replace(/\/pipeline\/opening-routing\.js(?:\?[^"\s<>]+)?/g,'/pipeline/opening-routing.js?v=20261022-shared-client1');
if(!/\/pipeline\/timezone-options\.js(?:\?|["\s>])/.test(html)){
  html=html.replace(reportsAnchor,'<script src="/pipeline/timezone-options.js?v=20261022-shared-client1"></script>$&');
}
if(!/\/pipeline\/opening-routing\.js(?:\?|["\s>])/.test(html)){
  if(!html.includes('</body>'))throw Error('PIPELINE_BODY_CLOSE_NOT_FOUND');
  html=html.replace('</body>','<script defer src="/pipeline/opening-routing.js?v=20261022-shared-client1"></script></body>');
}
fs.writeFileSync(htmlPath,html);
for(const rel of files){const dst=path.join(target,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(source,rel),dst);}
console.log(JSON.stringify({runtimeFiles:[...files,'client/public/pipeline/index.html'],migrations:[]}));
