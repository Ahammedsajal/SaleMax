'use strict';

function isBusinessShellPath(pathname) {
  return ['/user', '/user/', '/user/login', '/user/login/', '/agent', '/agent/', '/agent/login', '/agent/login/'].includes(pathname || '');
}

function injectChatGPTWorkspace(html) {
  const assets = [
    '<link rel="stylesheet" href="/chatgpt-mcp-workspace.css?v=20261102-mcp3">',
    '<script defer src="/chatgpt-mcp-login-return.js?v=20261102-mcp2"></script>',
    '<script defer src="/chatgpt-mcp-workspace.js?v=20261102-mcp3"></script>',
  ].join('');
  if (html.includes('/chatgpt-mcp-workspace.js?v=20261102-mcp3')) return html;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${assets}</head>`) : `${assets}${html}`;
}

module.exports = { isBusinessShellPath, injectChatGPTWorkspace };
