'use strict';
// The legacy global business context also mounts on Agent pages. Give it a
// read-only Agent bootstrap response without logging out the business account.
module.exports = function agentSessionContext(validateAgent, query) {
  return async function context(req, res) {
    if (!req.get('Authorization')) return res.json({ success: false, data: null });
    const guarded = Object.create(res);
    guarded.json = body => body?.logout || body?.success === false
      ? res.json({ success: false, data: null, code: 'AGENT_SIGN_IN_REQUIRED' })
      : res.json(body);
    guarded.status = () => guarded;
    return validateAgent(req, guarded, async () => {
      try {
        const rows = await query('SELECT id,uid,name,email,mobile,owner_uid,is_active FROM agents WHERE uid=? AND is_active=1', [req.decode.uid]);
        return res.json({ success: rows.length === 1, data: rows[0] || null });
      } catch { return res.json({ success: false, data: null, code: 'AGENT_CONTEXT_UNAVAILABLE' }); }
    });
  };
};
