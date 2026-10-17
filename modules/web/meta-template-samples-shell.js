"use strict";

const META_TEMPLATE_SAMPLES_SCRIPT =
  '<script defer src="/meta-template-samples.js?v=20261017-carousel-examples1"></script>';

function isMetaTemplateBuilderRequest(request) {
  return request?.path === "/user" && request?.query?.page === "create-meta-template";
}

function injectMetaTemplateSamplesScript(html) {
  if (typeof html !== "string" || html.includes(META_TEMPLATE_SAMPLES_SCRIPT)) {
    return html;
  }
  return html.replace("</head>", `${META_TEMPLATE_SAMPLES_SCRIPT}</head>`);
}

module.exports = {
  isMetaTemplateBuilderRequest,
  injectMetaTemplateSamplesScript,
};
