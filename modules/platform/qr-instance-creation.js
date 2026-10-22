'use strict';

const { query } = require('../../database/dbpromise');
const { getNumberOfDaysFromTimestamp } = require('../../functions/function');
const pool = require('../../database/config').promise();

function readPlan(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

async function countForActor(actor) {
  if (actor.isOwner) {
    const [rows] = await pool.query('SELECT COUNT(*) AS total FROM instance WHERE uid=?', [actor.ownerUid]);
    return Number(rows[0]?.total || 0);
  }
  const [rows] = await pool.query(`SELECT COUNT(DISTINCT i.id) AS total FROM instance i
    WHERE i.uid=? OR EXISTS (
      SELECT 1 FROM sx_qr_channel_shares s
      WHERE s.instance_id=i.id AND s.tenant_id=? AND s.membership_id=?
        AND s.granted_by_identity_id=? AND i.uid=?
    )`, [actor.actorUid, actor.tenantId, actor.membershipId, actor.identityId, actor.ownerUid]);
  return Number(rows[0]?.total || 0);
}

function limitResponse(res) {
  return res.json({ success: false, code: 'QR_INSTANCE_LIMIT_REACHED', msg: 'You can add one QR instance to your account.' });
}

async function checkQrCreator(req, res, next) {
  try {
    let session = req.featureSession;
    if (!session) {
      session = await require('./business-feature-session').resolve(pool, {
        actor: req.decode?.userData,
        agent: false,
        owner: req.owner || null,
      });
    }

    const actor = session.actor || req.decode?.userData;
    const owner = session.owner || actor;
    const ownerUid = session.ownerUid || owner?.uid;
    if (!actor || !owner || !ownerUid) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' });

    if (!owner.plan) return res.json({ success: false, msg: 'Please subscribe a plan to proceed this.' });
    if (getNumberOfDaysFromTimestamp(owner.plan_expire) < 1) {
      return res.json({ success: false, msg: 'Your plan was expired. Please buy a plan' });
    }
    const plan = readPlan(owner.plan);
    if (!plan) return res.status(503).json({ success: false, code: 'PLAN_DATA_UNAVAILABLE' });
    if (Number.parseInt(plan.qr_account, 10) < 1) {
      return res.json({ success: false, msg: 'Your plan does not allow you this feature' });
    }

    const context = session.context;
    const isOwner = !context || context.membership?.role === 'owner';
    req.qrCreator = {
      ownerUid,
      actorUid: actor.uid,
      isOwner,
      tenantId: context?.tenant?.id || null,
      membershipId: context?.membership?.id || null,
      identityId: context?.identity?.id || null,
    };
    req.plan = plan;

    if (context) {
      req.owner = owner;
      req.featureSession = session;
      req.decode.uid = ownerUid;
      req.decode.userData = actor;
    }

    if (await countForActor(req.qrCreator) >= 1) return limitResponse(res);
    next();
  } catch (error) {
    console.error('QR creator entitlement check failed:', error?.code || error?.message || 'unknown');
    res.status(503).json({ success: false, code: 'QR_CREATION_UNAVAILABLE' });
  }
}

async function createQrInstance(req, { title, uniqueId }) {
  const creator = req.qrCreator;
  if (!creator) throw Object.assign(new Error('QR_CREATOR_CONTEXT_REQUIRED'), { code: 'QR_CREATOR_CONTEXT_REQUIRED' });
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    // Serialize account QR creation so two simultaneous requests cannot each
    // pass the per-member limit before either inserts its channel.
    const [[owner]] = await db.query('SELECT uid FROM user WHERE uid=? FOR UPDATE', [creator.ownerUid]);
    if (!owner) throw Object.assign(new Error('BUSINESS_LINK_INVALID'), { code: 'BUSINESS_LINK_INVALID' });

    const sql = creator.isOwner
      ? 'SELECT COUNT(*) AS total FROM instance WHERE uid=?'
      : `SELECT COUNT(DISTINCT i.id) AS total FROM instance i
         WHERE i.uid=? OR EXISTS (
           SELECT 1 FROM sx_qr_channel_shares s
           WHERE s.instance_id=i.id AND s.tenant_id=? AND s.membership_id=?
             AND s.granted_by_identity_id=? AND i.uid=?
         )`;
    const args = creator.isOwner
      ? [creator.ownerUid]
      : [creator.actorUid, creator.tenantId, creator.membershipId, creator.identityId, creator.ownerUid];
    const [rows] = await db.query(sql, args);
    if (Number(rows[0]?.total || 0) >= 1) {
      await db.rollback();
      return { limitReached: true };
    }

    const [inserted] = await db.query(
      'INSERT INTO instance (uid, title, uniqueId, status) VALUES (?,?,?,?)',
      [creator.ownerUid, title, uniqueId, 'GENERATING'],
    );
    if (!creator.isOwner && creator.tenantId && creator.membershipId && creator.identityId) {
      await db.query(
        'INSERT INTO sx_qr_channel_shares(tenant_id,instance_id,membership_id,granted_by_identity_id) VALUES (?,?,?,?)',
        [creator.tenantId, inserted.insertId, creator.membershipId, creator.identityId],
      );
    }
    await db.commit();
    return { insertId: inserted.insertId };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}

module.exports = { checkQrCreator, createQrInstance };
