'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const shell=require('../modules/web/meta-template-samples-shell');
const contract=require('../client/public/template-placeholder-contract');
test('existing template and campaign routes receive maintained hooks',()=>{for(const page of ['create-meta-template','send-campaign'])assert.equal(shell.isMetaTemplateBuilderRequest({path:'/user',query:{page}}),true);assert.equal(shell.isMetaTemplateBuilderRequest({path:'/admin',query:{page:'send-campaign'}}),false);const html='<head><script defer src="/static/js/main.js"></script></head>',result=shell.injectMetaTemplateSamplesScript(html);assert.match(result,/template-placeholder-contract/);assert.ok(result.indexOf('template-placeholder-contract')<result.indexOf('/static/js/main.js'));assert.match(result,/campaign-placeholder-mapping/);assert.equal(shell.injectMetaTemplateSamplesScript(result),result);});
test('body sample structure is nested and positional, card indices stay independent',()=>{const components=[{type:'BODY',text:'Hello {{1}}',example:{body_text:[['Alex']]}},{type:'CAROUSEL',cards:[{components:[{type:'BODY',text:'Course {{1}}',example:{body_text:[['Engineering']]}}]}]}];contract.validateSamples(components);assert.deepEqual(contract.targets(components).map(t=>t.component.example.body_text),[[['Alex']],[['Engineering']]]);});
test('variable-free template creation requires no samples',()=>assert.doesNotThrow(()=>contract.validateSamples([{type:'BODY',text:'Hello'}])));

test('dashboard and login entry load hooks before sidebar navigation; old versions are replaced once',()=>{
 for(const path of ['/user','/user/','/user/login','/user/login/']) assert.equal(shell.isMetaTemplateBuilderRequest({path,query:{}}),true);
 assert.equal(shell.isMetaTemplateBuilderRequest({path:'/api/user'}),false);
 const legacy='<head><script defer src="/static/js/main.js"></script><script defer src="/campaign-placeholder-mapping.js?v=old"></script><script defer src="/template-placeholder-contract.js?v=old"></script><script defer src="/meta-template-samples.js?v=old"></script><link rel="stylesheet" href="/template-placeholders.css?v=old"></head>';
 const html=shell.injectMetaTemplateSamplesScript(legacy);
 for(const name of ['campaign-placeholder-mapping.js','template-placeholder-contract.js','meta-template-samples.js','template-placeholders.css']) assert.equal(html.split(name).length-1,1);
 assert.ok(html.indexOf('campaign-placeholder-mapping')<html.indexOf('/static/js/main.js'));
 assert.equal(shell.injectMetaTemplateSamplesScript(html),html);
 assert.doesNotMatch(html,/v=old/);
});
