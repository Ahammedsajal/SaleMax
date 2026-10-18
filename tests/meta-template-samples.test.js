'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const shell=require('../modules/web/meta-template-samples-shell');
const contract=require('../client/public/template-placeholder-contract');
test('existing template and campaign routes receive maintained hooks',()=>{for(const page of ['create-meta-template','send-campaign'])assert.equal(shell.isMetaTemplateBuilderRequest({path:'/user',query:{page}}),true);assert.equal(shell.isMetaTemplateBuilderRequest({path:'/admin',query:{page:'send-campaign'}}),false);const html='<head></head>',result=shell.injectMetaTemplateSamplesScript(html);assert.match(result,/template-placeholder-contract/);assert.match(result,/campaign-placeholder-mapping/);assert.equal(shell.injectMetaTemplateSamplesScript(result),result);});
test('body sample structure is nested and positional, card indices stay independent',()=>{const components=[{type:'BODY',text:'Hello {{1}}',example:{body_text:[['Alex']]}},{type:'CAROUSEL',cards:[{components:[{type:'BODY',text:'Course {{1}}',example:{body_text:[['Engineering']]}}]}]}];contract.validateSamples(components);assert.deepEqual(contract.targets(components).map(t=>t.component.example.body_text),[[['Alex']],[['Engineering']]]);});
test('variable-free template creation requires no samples',()=>assert.doesNotThrow(()=>contract.validateSamples([{type:'BODY',text:'Hello'}])));
