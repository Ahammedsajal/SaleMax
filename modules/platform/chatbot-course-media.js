'use strict';
const fs = require('node:fs/promises');
const courseMedia = require('./training-course-media');
const { recipientAllowed } = require('./chatbot-audience');

// Resolve every attachment through the tenant/course media store immediately
// before sending. Customer text never supplies a file path or remote URL.
async function sendCourseMedia({ pool, ctx, profile, uid, chatId, sessionId, message, origin, media, send = null, paused = null, getFile = courseMedia.getFile }) {
  if (origin !== 'qr' || !Array.isArray(media) || !media.length) return [];
  const pauseCheck = paused || require('./chatbot-conversation-control').shouldPause;
  const sentIds = [];
  for (const item of media.slice(0, 2)) {
    if (!recipientAllowed(profile.config, message.senderMobile) || await pauseCheck(uid, chatId, 'whatsapp_qr', sessionId)) break;
    const db = await pool.getConnection();
    let file;
    try {
      const [[course]] = await db.query("SELECT id FROM sx_training_courses WHERE tenant_id=? AND id=? AND status='active'", [ctx.tenant.id, item.courseId]);
      if (!course) continue;
      file = await getFile(db, ctx.tenant.id, item.courseId, item.id);
    } finally { db.release(); }
    if (!['image','document'].includes(file.kind) || (file.kind === 'document' && file.mimeType !== 'application/pdf') || file.sizeBytes > (file.kind === 'image' ? 5242880 : 20971520)) continue;
    const bytes = await fs.readFile(file.path);
    if (bytes.length !== file.sizeBytes) throw Object.assign(new Error('COURSE_MEDIA_SIZE_MISMATCH'), { code: 'COURSE_MEDIA_SIZE_MISMATCH' });
    // Recheck after disk I/O so an operator pause prevents the next attachment.
    if (!recipientAllowed(profile.config, message.senderMobile) || await pauseCheck(uid, chatId, 'whatsapp_qr', sessionId)) break;
    const content = { [file.kind]: bytes, mimetype: file.mimeType, fileName: file.originalName, caption: file.originalName };
    let id;
    if (send) id = await send({ content, sessionId, recipient: message.senderMobile });
    else {
      const { getSession, formatPhone } = require('../../helper/addon/qr');
      const session = getSession(sessionId);
      if (!session) throw Object.assign(new Error('COURSE_MEDIA_CHANNEL_UNAVAILABLE'), { code: 'COURSE_MEDIA_CHANNEL_UNAVAILABLE' });
      const response = await session.sendMessage(formatPhone(message.senderMobile), content);
      id = response?.key?.id;
    }
    if (!id) throw Object.assign(new Error('COURSE_MEDIA_SEND_FAILED'), { code: 'COURSE_MEDIA_SEND_FAILED' });
    // The existing QR fromMe handler persists media and its downloadable URL.
    sentIds.push(id);
  }
  return sentIds;
}

module.exports = { sendCourseMedia };
