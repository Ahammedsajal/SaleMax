'use strict';
const crypto = require('node:crypto');

// Called inside the conversation-control transaction. Tasks use the existing
// canonical team identities; no legacy agent account or external notification.
async function assignHandoffTask(db, { ctx, profile, uid, chatId, channelKind, channelRef, reason }) {
  const assignee = profile?.config?.handoffAssigneeIdentityId;
  if (!assignee) return null;
  const [[member]] = await db.query(`SELECT m.identity_id FROM sx_memberships m JOIN sx_identities i ON i.id=m.identity_id
    WHERE m.tenant_id=? AND m.identity_id=? AND m.status='active' AND i.status='active' LIMIT 1`, [ctx.tenant.id, assignee]);
  if (!member) return null;
  const description = `WhatsApp admissions handover\nConversation: ${chatId}\nChannel: ${channelKind}\nOpen Inbox and review this conversation. Automated replies are paused. Resume the bot only after staff follow-up.`;
  const [[existing]] = await db.query(`SELECT id FROM sx_tasks WHERE tenant_id=? AND task_type='chatbot_handoff'
    AND description=? AND status IN ('open','in_progress','blocked') AND deleted_at IS NULL LIMIT 1 FOR UPDATE`, [ctx.tenant.id, description]);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db.query(`INSERT INTO sx_tasks(id,tenant_id,uid_hash,title,description,task_type,priority,created_by_type,created_by_id)
    VALUES (?,?,?,?,?,'chatbot_handoff','high','identity',?)`, [id, ctx.tenant.id, crypto.createHash('sha256').update(uid).digest('hex'), 'WhatsApp admissions: staff follow-up', description, ctx.identity.id]);
  const people = [{ id: assignee, role: 'assignee' }];
  if (assignee !== ctx.identity.id) people.push({ id: ctx.identity.id, role: 'observer' });
  for (const person of people) await db.query(`INSERT INTO sx_task_participants(tenant_id,task_id,actor_type,actor_id,participant_role,added_by_type,added_by_id)
    VALUES (?,?,'identity',?,?,'identity',?)`, [ctx.tenant.id, id, person.id, person.role, ctx.identity.id]);
  await db.query(`INSERT INTO sx_task_events(tenant_id,task_id,revision,actor_type,actor_id,event_type,details_json)
    VALUES (?,?,1,'system',NULL,'created',?)`, [ctx.tenant.id, id, JSON.stringify({ origin: 'chatbot', chatId, channelKind, channelRef, reason })]);
  return id;
}

module.exports = { assignHandoffTask };
