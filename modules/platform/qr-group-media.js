'use strict';
const path = require('node:path');
function inspect(file) {
  const fail = () => { throw Object.assign(Error('GROUP_MEDIA_UNSUPPORTED'), { code: 'GROUP_MEDIA_UNSUPPORTED', status: 400 }); };
  if (!file || Array.isArray(file) || file.truncated || !Buffer.isBuffer(file.data) || !file.data.length || file.data.length > 16 * 1024 * 1024) fail();
  const data = file.data, ext = path.extname(String(file.name || '')).toLowerCase();
  let kind, mime, suffix;
  if (data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) [kind, mime, suffix] = ['image', 'image/jpeg', 'jpg'];
  else if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) [kind, mime, suffix] = ['image', 'image/png', 'png'];
  else if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') [kind, mime, suffix] = ['image', 'image/webp', 'webp'];
  else if (data.toString('ascii', 4, 8) === 'ftyp') [kind, mime, suffix] = ext === '.m4a' ? ['audio', 'audio/mp4', 'm4a'] : ['video', 'video/mp4', 'mp4'];
  else if (data.toString('ascii', 0, 4) === 'OggS') [kind, mime, suffix] = ['audio', 'audio/ogg', 'ogg'];
  else if (data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) [kind, mime, suffix] = ['audio', 'audio/mpeg', 'mp3'];
  else if (data.toString('ascii', 0, 5) === '%PDF-') [kind, mime, suffix] = ['document', 'application/pdf', 'pdf'];
  else if (data.toString('ascii', 0, 2) === 'PK' && ['.docx', '.xlsx', '.pptx', '.zip'].includes(ext)) {
    const types = { '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.zip': 'application/zip' };
    [kind, mime, suffix] = ['document', types[ext], ext.slice(1)];
  } else if (['.txt', '.csv'].includes(ext) && !data.includes(0)) [kind, mime, suffix] = ['document', 'text/plain', 'txt'];
  else fail();
  return { kind, mime, suffix, filename: path.basename(String(file.name || 'Attachment')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240) || 'Attachment' };
}
module.exports = { inspect };
