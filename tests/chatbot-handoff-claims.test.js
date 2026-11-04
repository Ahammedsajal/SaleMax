'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const claims = require('../modules/platform/chatbot-handoff-claims');

test('staff claim parser accepts clear English and Arabic availability replies and optional codes', () => {
  assert.deepEqual(claims.parseYes(' YES '), { code: null });
  assert.deepEqual(claims.parseYes('available'), { code: null });
  assert.deepEqual(claims.parseYes('Yes ABC123'), { code: 'ABC123' });
  assert.deepEqual(claims.parseYes('متاح'), { code: null });
  assert.deepEqual(claims.parseYes('نعم 12ab9f'), { code: '12AB9F' });
});

test('claim parser does not treat ordinary customer replies as a staff claim command', () => {
  for (const text of ['yes please tell me the price', 'yesterday', 'YES ABC12', 'no', 'hello']) {
    assert.equal(claims.parseYes(text), null, text);
  }
});

test('claim codes require six alphanumeric characters and cannot accept trailing instructions', () => {
  assert.equal(claims.parseYes('YES ABCDEF more'), null);
  assert.equal(claims.parseYes('YES 12345'), null);
  assert.equal(claims.parseYes('YES 123456 please'), null);
  assert.deepEqual(claims.parseYes('YES ZZ19Q2'), { code: 'ZZ19Q2' });
});

test('concurrent eligible YES replies assign an open conversation exactly once', async () => {
  const qr = require('../modules/platform/business-whatsapp');
  const assignment = require('../modules/platform/team-conversation-assignment');
  const oldStaff = qr.staff, oldEligible = assignment.eligibleStaff, oldAssign = assignment.assignConversation;
  const state = { status: 'open', assignments: 0, lockTail: Promise.resolve() };
  qr.staff = async () => [{ id: 'staff-identity', role: 'agent', phone: '97450000001' }];
  assignment.eligibleStaff = async () => [{ identityId: 'staff-identity' }];
  assignment.assignConversation = async () => { state.assignments++; };
  const pool = { getConnection: async () => {
    let releaseLock = null, holdsLock = false;
    return {
      beginTransaction: async () => {},
      commit: async () => { if (holdsLock) releaseLock(); },
      rollback: async () => { if (holdsLock) releaseLock(); },
      release: () => {},
      query: async sql => {
        if (sql.includes('FROM sx_chatbot_handoff_claims') && sql.includes("status='open'")) {
          const previous = state.lockTail;
          let unlock;
          state.lockTail = new Promise(resolve => { unlock = resolve; });
          await previous;
          releaseLock = unlock; holdsLock = true;
          return [state.status === 'open' ? [{ id: 'claim-id', claimCode: 'ABC123', conversationId: 'customer-chat', notificationEventKey: 'event-key' }] : []];
        }
        if (sql.includes('FROM beta_chats')) return [[{ senderMobile: '97455550000', senderName: 'Synthetic contact', origin: 'qr' }]];
        if (sql.includes("SET status='claimed'")) {
          if (state.status !== 'open') return [{ affectedRows: 0 }];
          state.status = 'claimed'; return [{ affectedRows: 1 }];
        }
        return [{ affectedRows: 1 }];
      },
    };
  } };
  const input = { ctx: { tenant: { id: 'tenant-id' } }, uid: 'owner-uid', message: { senderMobile: '97450000001' }, text: 'YES', channelKind: 'whatsapp_qr', channelRef: 'connected-qr', chatId: 'staff-chat' };
  try {
    const outcomes = await Promise.all([claims.handleStaffClaim(pool, input), claims.handleStaffClaim(pool, input)]);
    assert.equal(state.assignments, 1);
    assert.equal(outcomes.filter(result => result.outcome === 'claimed').length, 1);
    assert.equal(state.status, 'claimed');
  } finally { qr.staff = oldStaff; assignment.eligibleStaff = oldEligible; assignment.assignConversation = oldAssign; }
});
