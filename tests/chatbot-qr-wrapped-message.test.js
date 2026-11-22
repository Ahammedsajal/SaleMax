'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
for (const target of ['../database/dbpromise', '../helper/addon/qr/control', '../modules/platform/qr-inbox-groups']) {
  const filename = require.resolve(target);
  require.cache[filename] = { id: filename, filename, loaded: true, exports: {} };
}
const { unwrapMessageContent } = require('../helper/addon/qr/processThings');

test('recognises text, audio and documents inside phone and disappearing message wrappers', () => {
  for (const content of [{ conversation: 'hello' }, { audioMessage: { ptt: true } },
    { documentMessage: { fileName: 'course.pdf' } }]) {
    assert.deepEqual(unwrapMessageContent({
      deviceSentMessage: { message: { ephemeralMessage: { message: content } } },
    }), content);
  }
});
