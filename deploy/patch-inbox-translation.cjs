'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || '/app';
function replaceExactly(file, before, after) {
  const absolute = path.join(root, file);
  const source = fs.readFileSync(absolute, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`INBOX_TRANSLATION_PATCH_MISMATCH:${file}:${count}`);
  fs.writeFileSync(absolute, source.replace(before, after));
}

replaceExactly(
  'modules/platform/mount-existing-upgrade.js',
  "  app.use(['/api/workspace/inbox/course-replies','/api/inbox/course-replies','/api/agent/course-replies'],courseReplies);",
  "  app.use(['/api/workspace/inbox/course-replies','/api/inbox/course-replies','/api/agent/course-replies'],courseReplies);\n  app.use('/api/workspace/inbox/translate',require('./inbox-translation-router').createInboxTranslationRouter({authenticate:featureSession.guard,origin}));",
);
replaceExactly(
  'client/public/workspace-api.js',
  "inbox:'/api/workspace/inbox',",
  "inbox:'/api/workspace/inbox',inboxTranslation:'/api/workspace/inbox/translate',",
);
replaceExactly(
  'client/public/index.html',
  '<script defer src="/inbox-follow-up.js?v=20261022-follow-up-dedupe1"></script>',
  '<script defer src="/inbox-follow-up.js?v=20261022-follow-up-dedupe1"></script><script defer src="/inbox-translation.js?v=20261026-free-translation1"></script>',
);
const indexPath = path.join(root, 'client/public/index.html');
const index = fs.readFileSync(indexPath, 'utf8');
const loaderPattern = /workspace-api\.js\?v=[^"'\s]+/g;
const loaders = index.match(loaderPattern) || [];
if (loaders.length !== 1) throw new Error(`INBOX_TRANSLATION_PATCH_MISMATCH:client/public/index.html:workspace-api:${loaders.length}`);
fs.writeFileSync(indexPath, index.replace(loaderPattern, 'workspace-api.js?v=20261026-inbox-translation1'));
