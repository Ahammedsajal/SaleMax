const router = require("express").Router();
const { query } = require("../database/dbpromise.js");
const randomstring = require("randomstring");
const validateUser = require("../middlewares/user.js");
const { processWebhookAutomation } = require("../automation/automation.js");

// Get all webhooks for the user
router.get("/get_webhooks", validateUser, async (req, res) => {
  try {
    const webhooks = await query(
      `SELECT * FROM webhooks WHERE uid = ? ORDER BY created_at DESC`,
      [req.decode.uid],
    );

    res.json({ success: true, data: webhooks });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      msg: "Failed to fetch webhooks",
      error: err.message,
    });
  }
});

// Add a new webhook
router.post("/add_webhook", validateUser, async (req, res) => {
  try {
    const { name, description, method, secret, is_active } = req.body;

    if (!name || !method) {
      return res.json({ success: false, msg: "Name and method are required" });
    }

    // Generate a unique ID for the webhook
    const webhook_id = randomstring.generate(6);

    await query(
      `INSERT INTO webhooks (uid, name, description, method, secret, webhook_id, is_active) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.decode.uid,
        name,
        description || null,
        method,
        secret || null,
        webhook_id,
        is_active || 1,
      ],
    );

    res.json({ success: true, msg: "Webhook added successfully" });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      msg: "Failed to add webhook",
      error: err.message,
    });
  }
});

// Update a webhook
router.post("/update_webhook", validateUser, async (req, res) => {
  try {
    const { id, name, description, method, secret, is_active } = req.body;

    if (!id || !name || !method) {
      return res.json({
        success: false,
        msg: "ID, name, and method are required",
      });
    }

    // Check if webhook belongs to user
    const webhook = await query(
      `SELECT * FROM webhooks WHERE id = ? AND uid = ?`,
      [id, req.decode.uid],
    );

    if (webhook.length === 0) {
      return res.json({
        success: false,
        msg: "Webhook not found or not authorized",
      });
    }

    await query(
      `UPDATE webhooks 
       SET name = ?, description = ?, method = ?, secret = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ? AND uid = ?`,
      [
        name,
        description || null,
        method,
        secret || null,
        is_active,
        id,
        req.decode.uid,
      ],
    );

    res.json({
      success: true,
      msg: "Webhook updated successfully",
    });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      msg: "Failed to update webhook",
      error: err.message,
    });
  }
});

// Delete a webhook
router.post("/delete_webhook", validateUser, async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return res.json({ success: false, msg: "Webhook ID is required" });
    }

    // Check if webhook belongs to user
    const webhook = await query(
      `SELECT * FROM webhooks WHERE id = ? AND uid = ?`,
      [id, req.decode.uid],
    );

    if (webhook.length === 0) {
      return res.json({
        success: false,
        msg: "Webhook not found or not authorized",
      });
    }

    // Delete webhook
    await query(`DELETE FROM webhooks WHERE id = ? AND uid = ?`, [
      id,
      req.decode.uid,
    ]);

    // Also delete associated logs
    await query(`DELETE FROM webhook_logs WHERE webhook_id = ?`, [id]);

    res.json({
      success: true,
      msg: "Webhook deleted successfully",
    });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      msg: "Failed to delete webhook",
      error: err.message,
    });
  }
});

// Webhook endpoint to receive events
router.post("/webhook/:webhook_id", async (req, res) => {
  // console.log("Webhook received:", {
  //   body: JSON.stringify(req.body),
  //   params: req.params,
  //   headers: req.headers,
  // });

  try {
    const { webhook_id } = req.params;

    if (!webhook_id) {
      return res
        .status(400)
        .json({ success: false, msg: "Missing webhook ID parameter" });
    }

    // Find webhook by webhook_id
    const webhooks = await query(
      `SELECT * FROM webhooks WHERE webhook_id = ? AND is_active = 1`,
      [webhook_id],
    );

    if (webhooks.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "No active webhook found with this ID",
      });
    }

    const webhook = webhooks[0];

    // Get event type from headers or default to 'unknown'
    const eventType = req.headers["x-event-type"] || "unknown";

    // Verify webhook secret if provided
    if (webhook.secret) {
      const signature = req.headers["x-webhook-signature"];
      if (!signature || signature !== webhook.secret) {
        // Log the failed attempt but with FAILED status
        await query(
          `INSERT INTO webhook_logs (uid, webhook_id, method, event_type, payload, status, error) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            webhook.uid,
            webhook.webhook_id,
            req.method,
            eventType,
            JSON.stringify(req.body),
            "FAILED",
            "Invalid signature",
          ],
        );

        return res.status(401).json({
          success: false,
          msg: "Invalid webhook signature",
        });
      }
    }

    // Log the webhook event
    await query(
      `INSERT INTO webhook_logs (uid, webhook_id, method, event_type, payload, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        webhook.uid,
        webhook_id,
        req.method,
        eventType,
        JSON.stringify(req.body),
        "RECEIVED",
      ],
    );

    await processWebhookAutomation({ webhook, type: "POST", data: req.body });

    res
      .status(200)
      .json({ success: true, msg: "Webhook received successfully" });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({
      success: false,
      msg: "Failed to process webhook",
      error: err.message,
    });
  }
});

// Webhook endpoint to receive GET events
router.get("/webhook/:webhook_id", async (req, res) => {
  // console.log("Webhook GET received:", {
  //   query: req.query,
  //   params: req.params,
  //   headers: req.headers,
  // });

  try {
    const { webhook_id } = req.params;

    if (!webhook_id) {
      return res
        .status(400)
        .json({ success: false, msg: "Missing webhook ID parameter" });
    }

    // Find webhook by webhook_id
    const webhooks = await query(
      `SELECT * FROM webhooks WHERE webhook_id = ? AND is_active = 1`,
      [webhook_id],
    );

    if (webhooks.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "No active webhook found with this ID",
      });
    }

    const webhook = webhooks[0];

    // Get event type from headers or default to 'unknown'
    const eventType = req.headers["x-event-type"] || "unknown";

    // Log the webhook event - using query parameters as payload
    await query(
      `INSERT INTO webhook_logs (uid, webhook_id, method, event_type, payload, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        webhook.uid,
        webhook_id,
        req.method,
        eventType,
        JSON.stringify(req.query),
        "RECEIVED",
      ],
    );

    await processWebhookAutomation({ webhook, type: "GET", data: req.query });

    res
      .status(200)
      .json({ success: true, msg: "Webhook received successfully" });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(500).json({
      success: false,
      msg: "Failed to process webhook",
      error: err.message,
    });
  }
});

// Get webhook logs for a user
router.get("/get_webhook_logs", validateUser, async (req, res) => {
  try {
    const logs = await query(
      `SELECT l.*, w.name as webhook_name 
       FROM webhook_logs l
       JOIN webhooks w ON l.webhook_id = w.webhook_id
       WHERE l.uid = ?
       ORDER BY l.created_at DESC
       LIMIT 100`,
      [req.decode.uid],
    );

    res.json({ success: true, data: logs });
  } catch (err) {
    console.error(err);
    res.json({
      success: false,
      msg: "Failed to fetch webhook logs",
      error: err.message,
    });
  }
});

// Delete webhook logs
router.post("/delete_webhook_logs", validateUser, async (req, res) => {
  try {
    const { logIds } = req.body;

    if (!logIds || !Array.isArray(logIds) || logIds.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "No log IDs provided for deletion",
      });
    }

    // Verify that all logs belong to the user
    const placeholders = logIds.map(() => "?").join(",");
    const logs = await query(
      `SELECT id FROM webhook_logs WHERE id IN (${placeholders}) AND uid = ?`,
      [...logIds, req.decode.uid],
    );

    if (logs.length !== logIds.length) {
      return res.status(403).json({
        success: false,
        msg: "Not authorized to delete some of these logs",
      });
    }

    // Delete the logs
    await query(
      `DELETE FROM webhook_logs WHERE id IN (${placeholders}) AND uid = ?`,
      [...logIds, req.decode.uid],
    );

    res.status(200).json({
      success: true,
      msg: `Successfully deleted ${logs.length} log(s)`,
    });
  } catch (err) {
    console.error("Error deleting webhook logs:", err);
    res.status(500).json({
      success: false,
      msg: "Failed to delete logs",
      error: err.message,
    });
  }
});

module.exports = router;
