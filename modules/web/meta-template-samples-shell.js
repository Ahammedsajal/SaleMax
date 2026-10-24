"use strict";

const META_TEMPLATE_SAMPLES_SCRIPT =
  '<link rel="stylesheet" href="/template-placeholders.css?v=20261018-3"><script defer src="/template-placeholder-contract.js?v=20261018-3"></script><script defer src="/meta-template-samples.js?v=20261018-3"></script>';

function isMetaTemplateBuilderRequest(request) {
  // Hooks must start before React even when the user enters via Dashboard or Login.
  // Sidebar navigation does not reload the document. The hooks remain inert elsewhere.
  return ["/user", "/user/", "/user/login", "/user/login/"].includes(request?.path);
}

function injectMetaTemplateSamplesScript(html) {
  if (typeof html !== "string") return html;
  const campaignScript = html.match(
    /<script[^>]+src="(\/campaign-placeholder-mapping\.js\?v=[^"]+)"[^>]*><\/script>/,
  )?.[1] || "/campaign-placeholder-mapping.js?v=20261018-3";
  html = html.replace(/<script[^>]+src="\/(?:meta-template-samples|template-placeholder-contract|campaign-placeholder-mapping)\.js[^"<]*"[^>]*><\/script>/g, "");
  html = html.replace(/<link[^>]+href="\/template-placeholders\.css[^"<]*"[^>]*>/g, "");
  return html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${META_TEMPLATE_SAMPLES_SCRIPT}<script defer src="${campaignScript}"></script>`);
}

module.exports = { isMetaTemplateBuilderRequest, injectMetaTemplateSamplesScript };
