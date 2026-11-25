'use strict';

const crypto = require('node:crypto');
const quantityMath = require('./retail-quantity');
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fail = (code, status = 400) => { throw Object.assign(Error(code), { code, status }); };

function tenantHmac(tenantId, value, env = process.env) {
  const key = require('./retail-connected-stores').encryptionKey(env);
  return crypto.createHmac('sha256', key).update(String(tenantId)).update('\0').update(String(value)).digest('hex');
}
function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().normalize('NFKC').toLowerCase() : '';
}
function customerDirectoryKey(tenantId, connectionId, externalId, customer, orderId = '') {
  const email = normalizeEmail(customer?.email);
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return tenantHmac(tenantId, `email\0${email}`);
  if (externalId) return tenantHmac(tenantId, `source-customer\0${connectionId}\0${externalId}`);
  return tenantHmac(tenantId, `guest-order\0${connectionId}\0${orderId}`);
}
function localOrderDirectoryKey(tenantId, email, orderId, env = process.env) {
  const normalized = normalizeEmail(email);
  if (normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return tenantHmac(tenantId, `email\0${normalized}`, env);
  return tenantHmac(tenantId, `native-order\0${orderId}`, env);
}
function emailLookupHash(tenantId, value) {
  const normalized = normalizeEmail(value);
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? tenantHmac(tenantId, `email\0${normalized}`) : null;
}
function searchTerms(value) {
  if (typeof value !== 'string' || value.length > 100) fail('INVALID_SEARCH');
  const raw = value.trim().normalize('NFKC').toLowerCase();
  if (!raw) return [];
  const terms = raw.split(/\s+/).filter(Boolean).slice(0, 6).map(term => ({
    value: term,
    digits: term.replace(/\D/g, ''),
  }));
  return terms;
}
function customerSearchTokens(customer) {
  const values = new Map();
  const add = (kind, value) => {
    if (!value) return;
    const normalized = String(value).normalize('NFKC').trim().toLowerCase();
    if (!normalized) return;
    values.set(`${kind}\0${normalized}`, { kind, value: normalized });
  };
  const prefixes = (value, min = 2, max = 32) => {
    const chars = [...value];
    for (let length = min; length <= Math.min(chars.length, max); length++) add('name', chars.slice(0, length).join(''));
  };
  const name = [customer?.firstName, customer?.lastName, customer?.name].filter(Boolean).join(' ');
  for (const token of name.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 20)) {
    add('name', token); prefixes(token);
  }
  const email = normalizeEmail(customer?.email);
  add('email', email);
  if (email) {
    for (const token of [email, ...email.split(/[@.]+/).filter(Boolean)].slice(0, 8)) {
      const chars = [...token];
      for (let length = 2; length <= Math.min(chars.length, 40); length++) add('email', chars.slice(0, length).join(''));
    }
  }
  const phone = String(customer?.phone || '').replace(/\D/g, '');
  if (phone.length >= 7 && phone.length <= 20) {
    for (let length = 4; length <= phone.length; length++) {
      values.set(`phone\0${phone.slice(0, length)}`, { kind: 'phone', value: phone.slice(0, length) });
      values.set(`phone\0${phone.slice(-length)}`, { kind: 'phone', value: phone.slice(-length) });
    }
  }
  return [...values.values()];
}
async function indexSource(db, { tenantId, connectionId = null, sourceKind, sourceId, directoryKey, customer }) {
  if (!UUID.test(tenantId || '') || !['customer', 'order', 'native_order'].includes(sourceKind) ||
      typeof sourceId !== 'string' || !sourceId || sourceId.length > 191) fail('INVALID_CUSTOMER_INDEX', 500);
  const indexId = connectionId ? crypto.createHash('sha256').update(String(connectionId)).update('\0').update(sourceId).digest('hex') : sourceId;
  await db.query('DELETE FROM sx_retail_customer_search_tokens WHERE tenant_id=? AND source_kind=? AND source_id=?',
    [tenantId, sourceKind, indexId]);
  if (!directoryKey || !customer) return;
  const values = customerSearchTokens(customer).slice(0, 100);
  for (const item of values) {
    const tokenHash = tenantHmac(tenantId, `${item.kind}\0${item.value}`);
    await db.query(`INSERT IGNORE INTO sx_retail_customer_search_tokens
      (tenant_id,connection_id,source_kind,source_id,customer_directory_key,token_kind,token_hash)
      VALUES (?,?,?,?,?,?,?)`, [tenantId, connectionId, sourceKind, indexId, directoryKey, item.kind, tokenHash]);
  }
}
function queryMatches(tenantId, terms) {
  if (!terms.length) return null;
  const rows = [];
  for (let index = 0; index < terms.length; index++) {
    const term = terms[index];
    for (const kind of ['name', 'email', 'phone']) {
      const value = kind === 'phone' ? term.digits : term.value;
      if (!value || (kind === 'phone' && value.length < 4)) continue;
      rows.push({ index, hash: tenantHmac(tenantId, `${kind}\0${value}`) });
    }
  }
  if (!rows.length) return { sql: 'SELECT NULL AS customerDirectoryKey WHERE 1=0', params: [] };
  const valuesSql = rows.map(() => 'SELECT ? AS term_index,? AS token_hash').join(' UNION ALL ');
  return {
    sql: `SELECT t.customer_directory_key AS customerDirectoryKey FROM (${valuesSql}) requested
      JOIN sx_retail_customer_search_tokens t ON t.tenant_id=? AND t.token_hash=requested.token_hash
      GROUP BY t.customer_directory_key HAVING COUNT(DISTINCT requested.term_index)=?`,
    params: [...rows.flatMap(row => [row.index, row.hash]), tenantId, terms.length],
  };
}
async function listKeys(pool, tenantId, { page = 1, limit = 20, search = '' } = {}) {
  if (!UUID.test(tenantId || '') || !Number.isSafeInteger(page) || page < 1 || page > 100000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('INVALID_PAGING');
  const terms = searchTerms(search), matching = queryMatches(tenantId, terms), offset = (page - 1) * limit;
  if (matching) {
    const [[total]] = await pool.query(`SELECT COUNT(*) AS n FROM (${matching.sql}) matching`, matching.params);
    const [rows] = await pool.query(`SELECT customerDirectoryKey FROM (${matching.sql}) matching
      ORDER BY customerDirectoryKey LIMIT ? OFFSET ?`, [...matching.params, limit + 1, offset]);
    return { keys: rows.slice(0, limit).map(row => row.customerDirectoryKey), total: Number(total.n), page, limit, hasMore: rows.length > limit };
  }
  const [[total]] = await pool.query(`SELECT COUNT(DISTINCT customer_directory_key) AS n FROM sx_retail_customer_search_tokens WHERE tenant_id=?`, [tenantId]);
  const [rows] = await pool.query(`SELECT customer_directory_key AS customerDirectoryKey FROM sx_retail_customer_search_tokens
    WHERE tenant_id=? GROUP BY customer_directory_key ORDER BY MAX(token_hash),customer_directory_key LIMIT ? OFFSET ?`, [tenantId, limit + 1, offset]);
  return { keys: rows.slice(0, limit).map(row => row.customerDirectoryKey), total: Number(total.n), page, limit, hasMore: rows.length > limit };
}
function scaled(value) {
  const match = String(value ?? '0').match(/^(-?)(\d{1,20})(?:\.(\d{1,6}))?$/);
  if (!match) return 0n;
  const fraction = (match[3] || '').padEnd(6, '0');
  const amount = BigInt(match[2]) * 1000000n + BigInt(fraction || '0');
  return match[1] ? -amount : amount;
}
function fixed(value) {
  const negative = value < 0n, abs = negative ? -value : value;
  return `${negative ? '-' : ''}${abs / 1000000n}.${String(abs % 1000000n).padStart(6, '0')}`;
}
function addCurrency(groups, currency, value) {
  const amount = scaled(value);
  groups.set(currency, (groups.get(currency) || 0n) + amount);
}
function reportedNetPaid(order, transactions) {
  const gross = scaled(order.totalAmount);
  const success = new Set(['success', 'successful', 'completed', 'processed', 'reported_paid_by_store', 'recorded_by_store']);
  const paidKinds = new Set(['sale', 'capture', 'payment', 'charge']);
  const refundKinds = new Set(['refund', 'refunds']);
  let paid = 0n, refunded = 0n;
  for (const tx of transactions) {
    const kind = String(tx.kind || '').toLowerCase(), status = String(tx.status || '').toLowerCase();
    if (!success.has(status)) continue;
    if (refundKinds.has(kind)) refunded += scaled(tx.amount);
    else if (paidKinds.has(kind)) paid += scaled(tx.amount);
  }
  const financial = String(order.financialStatus || '').toLowerCase();
  if (paid === 0n && ['paid', 'paid_reported_by_store', 'reported_paid_by_store'].includes(financial)) paid = gross;
  const breakdownRefund = scaled(order.refundAmount || '0');
  if (breakdownRefund > refunded) refunded = breakdownRefund;
  if (refunded > gross) refunded = gross;
  const net = paid > refunded ? paid - refunded : 0n;
  const grossAfterRefund = gross > refunded ? gross - refunded : 0n;
  return fixed(net > grossAfterRefund ? grossAfterRefund : net);
}
function currencyDigits(currency) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
}
function minorToMajor(minor, currency) {
  const digits = currencyDigits(currency), amount = BigInt(String(minor || '0')), scale = 10n ** BigInt(digits);
  return `${amount / scale}.${String(amount % scale).padStart(digits, '0')}`;
}
async function loadProfiles(pool, tenantId, keys, { includeOrders = false, orderPage = 1, orderLimit = 25 } = {}) {
  if (!keys.length) return [];
  const [customerRows] = await pool.query(`SELECT c.connection_id AS connectionId,c.external_customer_id AS externalCustomerId,
      c.customer_directory_key AS customerDirectoryKey,
      c.customer_ciphertext AS ciphertext,c.customer_iv AS iv,c.customer_auth_tag AS authTag,c.source_updated_at AS updatedAt,
      s.provider,s.display_name AS storeName
    FROM sx_retail_external_customers c JOIN sx_retail_store_connections s
      ON s.tenant_id=c.tenant_id AND s.id=c.connection_id
    WHERE c.tenant_id=? AND c.customer_status='active' AND c.customer_directory_key IN (?)`, [tenantId, keys]);
  const [sourceStats] = await pool.query(`SELECT customer_directory_key AS customerDirectoryKey,COUNT(*) AS orderCount,MAX(source_created_at) AS lastOrderAt
    FROM sx_retail_external_orders WHERE tenant_id=? AND customer_directory_key IN (?) GROUP BY customer_directory_key`, [tenantId, keys]);
  const [nativeStats] = await pool.query(`SELECT customer_directory_key AS customerDirectoryKey,COUNT(*) AS orderCount,MAX(created_at) AS lastOrderAt
    FROM sx_retail_orders WHERE tenant_id=? AND external_source_connection_id IS NULL AND customer_directory_key IN (?) GROUP BY customer_directory_key`, [tenantId, keys]);
  const [sourceSpend] = await pool.query(`SELECT o.customer_directory_key AS customerDirectoryKey,o.currency,
      CAST(SUM(GREATEST(0,LEAST(
        GREATEST(0,o.total_amount-LEAST(o.total_amount,GREATEST(COALESCE(tx.refund_amount,0),COALESCE(o.refund_amount,0)))),
        (CASE WHEN COALESCE(tx.paid_amount,0)=0 AND o.financial_status IN ('paid','paid_reported_by_store','reported_paid_by_store')
          THEN o.total_amount ELSE COALESCE(tx.paid_amount,0) END)-GREATEST(COALESCE(tx.refund_amount,0),COALESCE(o.refund_amount,0))))) AS CHAR) AS amount
    FROM sx_retail_external_orders o LEFT JOIN (
      SELECT x.tenant_id,x.connection_id,x.external_order_id,
        SUM(CASE WHEN LOWER(x.transaction_status) IN ('success','successful','completed','processed','reported_paid_by_store','recorded_by_store')
          AND LOWER(x.transaction_kind) IN ('sale','capture','payment','charge') THEN x.amount ELSE 0 END) AS paid_amount,
        SUM(CASE WHEN LOWER(x.transaction_status) IN ('success','successful','completed','processed','reported_paid_by_store','recorded_by_store')
          AND LOWER(x.transaction_kind) IN ('refund','refunds') THEN x.amount ELSE 0 END) AS refund_amount
      FROM sx_retail_external_transactions x JOIN sx_retail_external_orders src
        ON src.tenant_id=x.tenant_id AND src.connection_id=x.connection_id AND src.external_order_id=x.external_order_id
      WHERE x.tenant_id=? AND src.customer_directory_key IN (?) GROUP BY x.tenant_id,x.connection_id,x.external_order_id
    ) tx ON tx.tenant_id=o.tenant_id AND tx.connection_id=o.connection_id AND tx.external_order_id=o.external_order_id
    WHERE o.tenant_id=? AND o.customer_directory_key IN (?) GROUP BY o.customer_directory_key,o.currency`,
    [tenantId, keys, tenantId, keys]);
  const [nativeSpend] = await pool.query(`SELECT o.customer_directory_key AS customerDirectoryKey,o.currency,
      CAST(SUM(r.amount_minor) AS CHAR) AS amountMinor
    FROM sx_retail_cash_receipts r JOIN sx_retail_orders o ON o.tenant_id=r.tenant_id AND o.id=r.order_id
    WHERE o.tenant_id=? AND o.external_source_connection_id IS NULL AND o.customer_directory_key IN (?)
    GROUP BY o.customer_directory_key,o.currency`, [tenantId, keys]);
  const connector = require('./retail-connected-stores');
  const profiles = new Map(keys.map(key => [key, {
    id: key, name: '', email: null, phone: null, address: null, marketingConsent: null, sourceRecords: [], orders: [],
    amountSpent: [], recordedPayments: [], orderCount: 0, lastOrderAt: null,
  }]));
  const touch = (key, customer, updatedAt, source) => {
    const profile = profiles.get(key); if (!profile || !customer) return;
    if (!profile.name && (customer.firstName || customer.lastName || customer.name)) profile.name =
      [customer.firstName, customer.lastName].filter(Boolean).join(' ') || String(customer.name || '');
    profile.email ||= customer.email || null; profile.phone ||= customer.phone || null;
    if (!profile.address && customer.address) profile.address = typeof customer.address === 'string' ? { address1: customer.address } : customer.address;
    if (!profile.marketingConsent && customer.marketingConsent) profile.marketingConsent = customer.marketingConsent;
    if (source && !profile.sourceRecords.some(row => row.connectionId === source.connectionId && row.externalCustomerId === source.externalCustomerId)) {
      profile.sourceRecords.push(source);
    }
    if (updatedAt && (!profile.updatedAt || new Date(updatedAt) > new Date(profile.updatedAt))) profile.updatedAt = updatedAt;
  };
  for (const row of customerRows) {
    const customer = connector.openJson(row, tenantId, row.connectionId, `customer:${row.externalCustomerId}`);
    touch(row.customerDirectoryKey, customer, row.updatedAt, {
      connectionId: row.connectionId, provider: row.provider, storeName: row.storeName,
      externalCustomerId: row.externalCustomerId,
    });
    const key = row.customerDirectoryKey;
    const profile = profiles.get(key);
    if (profile) profile.sourceRecords.push({ connectionId: row.connectionId, provider: row.provider, storeName: row.storeName, externalCustomerId: row.externalCustomerId });
  }
  const sourceCount = new Map(sourceStats.map(row => [row.customerDirectoryKey, Number(row.orderCount)]));
  const nativeCount = new Map(nativeStats.map(row => [row.customerDirectoryKey, Number(row.orderCount)]));
  const latestPeople = await Promise.all([
    pool.query(`SELECT customerDirectoryKey,buyerName,buyerEmail,buyerPhone,deliveryAddress,createdAt FROM (
        SELECT o.customer_directory_key AS customerDirectoryKey,o.buyer_name AS buyerName,o.buyer_email AS buyerEmail,
          o.buyer_phone AS buyerPhone,o.delivery_address AS deliveryAddress,o.created_at AS createdAt,
          ROW_NUMBER() OVER (PARTITION BY o.customer_directory_key ORDER BY o.created_at DESC,o.id DESC) AS rowNumber
        FROM sx_retail_orders o WHERE o.tenant_id=? AND o.external_source_connection_id IS NULL AND o.customer_directory_key IN (?)) ranked
      WHERE rowNumber=1`, [tenantId, keys]),
    pool.query(`SELECT customerDirectoryKey,connectionId,externalOrderId,ciphertext,iv,authTag,orderCiphertext,orderIv,orderAuthTag,updatedAt FROM (
        SELECT o.customer_directory_key AS customerDirectoryKey,o.connection_id AS connectionId,o.external_order_id AS externalOrderId,
          o.customer_ciphertext AS ciphertext,o.customer_iv AS iv,
          o.customer_auth_tag AS authTag,o.order_ciphertext AS orderCiphertext,o.order_iv AS orderIv,
          o.order_auth_tag AS orderAuthTag,o.source_updated_at AS updatedAt,
          ROW_NUMBER() OVER (PARTITION BY o.customer_directory_key ORDER BY o.source_updated_at DESC,o.external_order_id DESC) AS rowNumber
        FROM sx_retail_external_orders o WHERE o.tenant_id=? AND o.customer_directory_key IN (?) AND o.customer_ciphertext IS NOT NULL) ranked
      WHERE rowNumber=1`, [tenantId, keys]),
  ]);
  for (const row of latestPeople[0][0]) touch(row.customerDirectoryKey,
    { name: row.buyerName, email: row.buyerEmail, phone: row.buyerPhone, address: row.deliveryAddress }, row.createdAt, null);
  for (const row of latestPeople[1][0]) {
    const customer = connector.openJson(row, tenantId, row.connectionId, `order-customer:${row.externalOrderId}`);
    const snapshot = connector.openJson({ ciphertext: row.orderCiphertext, iv: row.orderIv, authTag: row.orderAuthTag }, tenantId,
      row.connectionId, `order:${row.externalOrderId}`);
    touch(row.customerDirectoryKey, { ...customer, address: customer.address || snapshot.shippingAddress }, row.updatedAt, null);
  }
  for (const row of sourceSpend) profiles.get(row.customerDirectoryKey)?.amountSpent.push({
    currency: row.currency, amount: String(row.amount), evidence: 'source_reported_unverified',
  });
  for (const row of nativeSpend) profiles.get(row.customerDirectoryKey)?.recordedPayments.push({
    currency: row.currency, amount: minorToMajor(row.amountMinor, row.currency), evidence: '7network_recorded_cash_receipts',
  });
  for (const row of sourceStats) {
    const profile = profiles.get(row.customerDirectoryKey); if (!profile) continue;
    profile.orderCount += Number(row.orderCount);
    if (row.lastOrderAt && (!profile.lastOrderAt || new Date(row.lastOrderAt) > new Date(profile.lastOrderAt))) profile.lastOrderAt = row.lastOrderAt;
  }
  for (const row of nativeStats) {
    const profile = profiles.get(row.customerDirectoryKey); if (!profile) continue;
    profile.orderCount += Number(row.orderCount);
    if (row.lastOrderAt && (!profile.lastOrderAt || new Date(row.lastOrderAt) > new Date(profile.lastOrderAt))) profile.lastOrderAt = row.lastOrderAt;
  }
  let orderPagination = null;
  if (includeOrders) {
    const limit = Math.max(1, Math.min(50, orderLimit)), page = Math.max(1, orderPage), offset = (page - 1) * limit;
    const [found] = await pool.query(`SELECT * FROM (
        SELECT 'source' AS orderKind,o.external_order_id AS id,o.connection_id AS connectionId,o.order_number AS orderNumber,
          o.order_status AS sourceStatus,o.financial_status AS financialStatus,o.currency,CAST(o.total_amount AS CHAR) AS totalAmount,
          CAST(o.refund_amount AS CHAR) AS refundAmount,COALESCE(o.source_created_at,o.imported_at) AS orderDate,
          s.provider,s.display_name AS storeName,o.order_ciphertext AS ciphertext,o.order_iv AS iv,o.order_auth_tag AS authTag,
          o.customer_ciphertext AS customerCiphertext,o.customer_iv AS customerIv,o.customer_auth_tag AS customerAuthTag,
          NULL AS localStatus,NULL AS deliveryState,NULL AS cashReceivedAt,NULL AS orderLines,NULL AS deliveryAddress,
          NULL AS buyerName,NULL AS buyerEmail,NULL AS buyerPhone
        FROM sx_retail_external_orders o JOIN sx_retail_store_connections s
          ON s.tenant_id=o.tenant_id AND s.id=o.connection_id WHERE o.tenant_id=? AND o.customer_directory_key=?
        UNION ALL
        SELECT 'local' AS orderKind,o.id AS id,NULL AS connectionId,o.id AS orderNumber,NULL AS sourceStatus,NULL AS financialStatus,
          o.currency,CAST(o.total_minor AS CHAR) AS totalAmount,NULL AS refundAmount,o.created_at AS orderDate,
          NULL AS provider,NULL AS storeName,NULL AS ciphertext,NULL AS iv,NULL AS authTag,NULL AS customerCiphertext,
          NULL AS customerIv,NULL AS customerAuthTag,o.status AS localStatus,o.delivery_state AS deliveryState,
          o.cash_received_at AS cashReceivedAt,o.order_lines AS orderLines,o.delivery_address AS deliveryAddress,o.buyer_name AS buyerName,o.buyer_email AS buyerEmail,
          o.buyer_phone AS buyerPhone
        FROM sx_retail_orders o WHERE o.tenant_id=? AND o.customer_directory_key=? AND o.external_source_connection_id IS NULL
      ) customerOrders ORDER BY orderDate DESC,id DESC LIMIT ? OFFSET ?`,
    [tenantId, keys[0], tenantId, keys[0], limit + 1, offset]);
    const hasMore = found.length > limit, pageRows = found.slice(0, limit);
    const sourceIds = pageRows.filter(row => row.orderKind === 'source').map(row => ({ connectionId: row.connectionId, externalOrderId: row.id }));
    const transactions = sourceIds.length ? (await pool.query(`SELECT connection_id AS connectionId,external_order_id AS externalOrderId,
        transaction_kind AS kind,transaction_status AS status,currency,CAST(amount AS CHAR) AS amount,gateway,
        processed_at AS processedAt FROM sx_retail_external_transactions WHERE tenant_id=? AND
        (${sourceIds.map(() => '(connection_id=? AND external_order_id=?)').join(' OR ')})
        ORDER BY processed_at DESC,external_transaction_id`, [tenantId, ...sourceIds.flatMap(row => [row.connectionId, row.externalOrderId])]))[0] : [];
    const txMap = new Map();
    for (const tx of transactions) { const key = `${tx.connectionId}\0${tx.externalOrderId}`; if (!txMap.has(key)) txMap.set(key, []); txMap.get(key).push(tx); }
    const localIds = pageRows.filter(row => row.orderKind === 'local').map(row => row.id);
    const receipts = localIds.length ? (await pool.query(`SELECT order_id AS orderId,amount_minor AS amountMinor,received_at AS receivedAt,
        collector_membership_id AS collectorMembershipId,recorded_by_identity_id AS recordedByIdentityId,settled_at AS settledAt
      FROM sx_retail_cash_receipts WHERE tenant_id=? AND order_id IN (?) ORDER BY received_at,id`, [tenantId, localIds]))[0] : [];
    const receiptsByOrder = new Map();
    for (const receipt of receipts) { if (!receiptsByOrder.has(receipt.orderId)) receiptsByOrder.set(receipt.orderId, []); receiptsByOrder.get(receipt.orderId).push(receipt); }
    for (const row of pageRows) {
      const profile = profiles.get(keys[0]); if (!profile) continue;
      if (row.orderKind === 'local') {
        const lines = typeof row.orderLines === 'string' ? JSON.parse(row.orderLines) : row.orderLines || [];
        const payments = (receiptsByOrder.get(row.id) || []).map(receipt => ({
          kind: 'cash_receipt', status: 'recorded', currency: row.currency,
          amount: minorToMajor(receipt.amountMinor, row.currency), processedAt: receipt.receivedAt,
          collectorMembershipId: receipt.collectorMembershipId, recordedByIdentityId: receipt.recordedByIdentityId,
          settledAt: receipt.settledAt,
        }));
        touch(keys[0], { name: row.buyerName, email: row.buyerEmail, phone: row.buyerPhone }, row.orderDate, null);
        profile.orders.push({ id: row.id, orderNumber: row.orderNumber, date: row.orderDate, currency: row.currency || 'QAR',
          total: minorToMajor(row.totalAmount, row.currency || 'QAR'), localStatus: row.localStatus, deliveryState: row.deliveryState,
          deliveryAddress: row.deliveryAddress || null,
          cashReceivedIn7Network: Boolean(row.cashReceivedAt), paymentEvidence: payments.length ? '7network_recorded' : 'no_payment_record',
          payments, lines: lines.slice(0, 100).map(line => {
            const lineMinor = line.priceMinor == null ? null : quantityMath.minorTotal(Number(line.priceMinor),line.quantity);
            return { name: line.nameEn || line.name || '', sku: line.sku || '', quantity: String(line.quantity ?? '0'),
              unitPrice: line.priceMinor == null ? null : minorToMajor(line.priceMinor,row.currency||'QAR'),
              total: lineMinor == null ? null : minorToMajor(lineMinor,row.currency||'QAR'), currency: row.currency || 'QAR' };
          }) });
        continue;
      }
      const customer = row.customerCiphertext ? connector.openJson({ ciphertext: row.customerCiphertext, iv: row.customerIv,
        authTag: row.customerAuthTag }, tenantId, row.connectionId, `order-customer:${row.id}`) : null;
      const snapshot = connector.openJson(row, tenantId, row.connectionId, `order:${row.id}`);
      touch(keys[0], customer, row.orderDate, null);
      const orderTransactions = txMap.get(`${row.connectionId}\0${row.id}`) || [];
      profile.orders.push({ id: row.id, sourceOrderId: row.id, orderNumber: row.orderNumber, provider: row.provider,
        storeName: row.storeName, status: row.sourceStatus, financialStatus: row.financialStatus, currency: row.currency,
        shippingAddress: snapshot.shippingAddress || null,
        total: row.totalAmount, reportedNetPaid: reportedNetPaid({ totalAmount: row.totalAmount, refundAmount: row.refundAmount,
          financialStatus: row.financialStatus }, orderTransactions), paymentEvidence: 'source_reported_unverified', date: row.orderDate,
        lines: (snapshot?.lineItems || []).slice(0, 100).map(line => ({ name: line.title, sku: line.sku,
          quantity: String(line.quantity ?? '0'), total: line.total ?? null, currency: row.currency })),
        transactions: orderTransactions.map(tx => ({ kind: tx.kind, status: tx.status, currency: tx.currency,
          amount: String(tx.amount), gateway: tx.gateway, processedAt: tx.processedAt })),
      });
    }
    orderPagination = { page, limit, hasMore, total: profiles.get(keys[0])?.orderCount || 0 };
  }
  for (const profile of profiles.values()) {
    profile.amountSpent.sort((a, b) => a.currency.localeCompare(b.currency));
    profile.recordedPayments.sort((a, b) => a.currency.localeCompare(b.currency));
    profile.sourceRecords = [...new Map(profile.sourceRecords.map(source => [`${source.connectionId}\0${source.externalCustomerId}`, source])).values()];
    profile.orders.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    if (!profile.name) profile.name = profile.email || profile.phone || 'Store customer';
    if (!includeOrders) { delete profile.orders; delete profile.sourceRecords; }
    else profile.orderPagination = orderPagination;
  }
  return [...profiles.values()];
}
async function list(pool, tenantId, input = {}) {
  const page = await listKeys(pool, tenantId, { page: input.page ?? 1, limit: input.limit ?? 20, search: input.search ?? '' });
  const items = await loadProfiles(pool, tenantId, page.keys);
  return { ...page, items };
}
async function detail(pool, tenantId, key, input = {}) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) fail('CUSTOMER_NOT_FOUND', 404);
  const page = input.page ?? 1, limit = input.limit ?? 25;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('INVALID_PAGING');
  const profiles = await loadProfiles(pool, tenantId, [key], { includeOrders: true, orderPage: page, orderLimit: limit });
  if (!profiles[0]?.sourceRecords?.length && !profiles[0]?.orders?.length) fail('CUSTOMER_NOT_FOUND', 404);
  return profiles[0];
}

module.exports = {
  normalizeEmail, tenantHmac, customerDirectoryKey, localOrderDirectoryKey, emailLookupHash,
  customerSearchTokens, indexSource, listKeys, list, detail, reportedNetPaid,
};
