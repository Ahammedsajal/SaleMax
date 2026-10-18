"use strict";

const META_TEMPLATE_SAMPLES_SCRIPT =
  '<link rel="stylesheet" href="/template-placeholders.css?v=20261018-2"><script defer src="/template-placeholder-contract.js?v=20261018-2"></script><script defer src="/meta-template-samples.js?v=20261018-2"></script><script defer src="/campaign-placeholder-mapping.js?v=20261018-2"></script>';

function isMetaTemplateBuilderRequest(request) {
  return request?.path === "/user" && ["create-meta-template", "send-campaign"].includes(request?.query?.page);
}

function injectMetaTemplateSamplesScript(html) {
  if (typeof html !== "string" || html.includes(META_TEMPLATE_SAMPLES_SCRIPT)) return html;
  return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${META_TEMPLATE_SAMPLES_SCRIPT}`);
}

module.exports = { isMetaTemplateBuilderRequest, injectMetaTemplateSamplesScript };
