'use strict';

const express = require('express');
const { decision } = require('./policy');
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const validQuantity = value => Number.isInteger(value) && value >= 0 && value <= 1000000000;

module.exports = function createInventoryRouter({pool, authenticate}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  }, authenticate, express.json({limit: '4kb'}));

  function action(permission, handler) {
    return async (req, res, next) => {
      const context = req.businessContext;
      if (!context || !decision(context, {capability: 'retail.inventory', permission, key: 'business-inventory'}).allowed) {
        return res.status(403).json({success: false, code: 'PERMISSION_DENIED'});
      }
      try {
        await handler(req, res, context.tenant.id);
      } catch (error) {
        next(error);
      }
    };
  }

  router.get('/', action('inventory.read', async (req, res, tenant) => {
    const offset = Number(req.query.offset || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000000) return res.sendStatus(400);
    const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    const [items] = await pool.query(
      `SELECT p.id, p.code, p.name_en AS nameEn, p.name_ar AS nameAr,
         COALESCE(m.quantity, 0) AS quantity, CAST(COALESCE(m.id, 0) AS CHAR) AS revision
       FROM sx_product_catalog p
       LEFT JOIN sx_business_stock_movements m ON m.id = (
         SELECT id FROM sx_business_stock_movements WHERE tenant_id=p.tenant_id AND product_id=p.id ORDER BY id DESC LIMIT 1
       )
       WHERE p.tenant_id=? AND p.deleted_at IS NULL AND p.status<>'retired'
       AND (LOCATE(?,p.code)>0 OR LOCATE(?,p.name_en)>0 OR LOCATE(?,p.name_ar)>0)
       ORDER BY p.code,p.id LIMIT 51 OFFSET ?`, [tenant, search, search, search, offset]);
    res.json({success: true, data: {items: items.slice(0, 50), hasMore: items.length > 50}});
  }));

  router.get('/:id/history', action('inventory.read', async (req, res, tenant) => {
    if (!uuid.test(req.params.id)) return res.sendStatus(404);
    const [items] = await pool.query(
      `SELECT previous_quantity AS previousQuantity, quantity, reason, created_at AS createdAt
       FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? ORDER BY id DESC LIMIT 50`,
      [tenant, req.params.id]);
    res.json({success: true, data: items});
  }));

  router.post('/:id/count', action('inventory.manage', async (req, res, tenant) => {
    const {requestId, expectedRevision, quantity, reason} = req.body || {};
    if (!uuid.test(req.params.id) || typeof requestId !== 'string' || !uuid.test(requestId) ||
        !validQuantity(quantity) || typeof expectedRevision !== 'string' || !/^\d{1,20}$/.test(expectedRevision) || typeof reason !== 'string' ||
        !reason.trim() || reason.trim().length > 200) return res.sendStatus(400);

    const db = await pool.getConnection();
    try {
      await db.beginTransaction();
      const [[product]] = await db.query(
        "SELECT id FROM sx_product_catalog WHERE tenant_id=? AND id=? AND deleted_at IS NULL AND status<>'retired' FOR UPDATE",
        [tenant, req.params.id]);
      if (!product) {
        await db.rollback();
        return res.sendStatus(404);
      }
      const key = [tenant, product.id];
      const [[prior]] = await db.query(
        'SELECT quantity, previous_revision AS previousRevision, reason FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? AND request_id=?',
        [...key, requestId]);
      if (prior) {
        await db.rollback();
        if (prior.quantity !== quantity || prior.previousRevision !== expectedRevision || prior.reason !== reason.trim()) return res.sendStatus(409);
        return res.json({success: true, data: prior});
      }
      const [[latest]] = await db.query(
        'SELECT quantity, CAST(id AS CHAR) AS revision FROM sx_business_stock_movements WHERE tenant_id=? AND product_id=? ORDER BY id DESC LIMIT 1', key);
      if ((latest?.revision ?? '0') !== expectedRevision) {
        await db.rollback();
        return res.status(409).json({success: false, code: 'STOCK_CHANGED'});
      }
      await db.query(
        'INSERT INTO sx_business_stock_movements (tenant_id,product_id,request_id,actor_id,previous_revision,previous_quantity,quantity,reason) VALUES (?,?,?,?,?,?,?,?)',
        [...key, requestId, req.businessContext.identity.id, expectedRevision, latest?.quantity ?? 0, quantity, reason.trim()]);
      await db.commit();
      res.json({success: true, data: {quantity}});
    } catch (error) {
      await db.rollback();
      throw error;
    } finally {
      db.release();
    }
  }));
  return router;
};
