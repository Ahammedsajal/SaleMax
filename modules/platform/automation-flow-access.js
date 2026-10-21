'use strict';

const {createLegacyModuleAccess}=require('./legacy-module-access');

function createAutomationFlowAccess({pool,resolveContext,decide}={}){
  return createLegacyModuleAccess({
    pool,
    capability:'automation.flows',
    permission:'automation.manage',
    resolveContext,
    decide,
    agentFallbacks:[{capability:'messaging.inbox',permission:'conversations.reply'}],
    errorCode:'AUTOMATION_FLOW_ACCESS_UNAVAILABLE',
    contextProperty:'automationFlowContext',
  });
}

module.exports={createAutomationFlowAccess};
