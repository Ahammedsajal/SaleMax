'use strict';

const crypto = require('node:crypto');

function ownerHash(ownerUid) {
  return crypto.createHash('sha256').update(String(ownerUid), 'utf8').digest('hex');
}

function asLegacyAgentTask(task) {
  const completed = task.status === 'completed' || task.status === 'canceled';
  const completion = task.status === 'in_progress' ? 50 : task.status === 'blocked' ? 25 : completed ? 100 : 0;
  const priority = task.priority === 'urgent' || task.priority === 'high' ? 'high' : task.priority === 'low' ? 'low' : 'medium';
  const completedAt = task.completed_at ? Math.floor(new Date(task.completed_at).getTime() / 1000) : null;
  return {
    id: `sx:${task.id}`,
    title: task.title,
    description: task.description || '',
    status: completed ? 'COMPLETED' : 'PENDING',
    priority,
    due_date: task.due_at || null,
    completion_percentage: completion,
    agent_comments: '',
    completed_at: completedAt,
    assigned_by: task.assigned_by_name ? { name: task.assigned_by_name } : null,
  };
}

async function listAgentTasks(query, { ownerUid, agentUid, agentId }) {
  const [legacyTasks, sharedTasks] = await Promise.all([
    query('SELECT * FROM agent_task WHERE uid = ?', [agentUid]),
    query(`SELECT t.id,t.title,t.description,t.status,t.priority,t.due_at,t.completed_at,
        COALESCE(NULLIF(u.name,''),NULLIF(i.display_name,'')) AS assigned_by_name
      FROM sx_tasks t
      JOIN sx_task_participants p ON p.tenant_id=t.tenant_id AND p.task_id=t.id
        AND p.actor_type='agent' AND p.actor_id=? AND p.removed_at IS NULL
      LEFT JOIN user u ON t.created_by_type='user' AND u.uid=t.created_by_id
      LEFT JOIN sx_identities i ON t.created_by_type='identity' AND i.id=t.created_by_id
      WHERE t.uid_hash=? AND t.deleted_at IS NULL
      ORDER BY (t.due_at IS NULL),t.due_at,t.updated_at DESC LIMIT 200`,
    [String(agentId), ownerHash(ownerUid)]),
  ]);
  return [...sharedTasks.map(asLegacyAgentTask), ...legacyTasks];
}

module.exports = { ownerHash, asLegacyAgentTask, listAgentTasks };
