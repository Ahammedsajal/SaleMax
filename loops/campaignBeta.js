const { query } = require("../database/dbpromise");
const { sendTemplateMessage } = require("../functions/function");
const campaignPool = require("../database/config").promise();
const canSendCampaignByModule = require("../modules/platform/campaign-module-access").createCampaignModuleAccess({
  pool: campaignPool,
});
const { acquireCampaignWorkerLock } = require("../modules/platform/campaign-worker-lock");

// Simple processing flags
const processingCampaigns = new Set();
let pausedCampaignCursor = 0;

// Configuration
const CONFIG = {
  batchSize: 20, // Messages per batch
  checkInterval: 30000, // Check every 3 seconds
  messageDelay: 300, // 300ms between messages
  maxRetries: 3,
  retryDelay: 5000,
};

/**
 * Initialize the campaign processing system
 */
async function initCampaign() {
  // console.log("Campaign processing system initialized");

  // Handle legacy campaigns on startup
  await handleLegacyCampaigns();

  const interval = setInterval(async () => {
    try {
      await processPendingCampaigns();
    } catch (error) {
      console.error("Error in campaign processing loop:", error);
    }
  }, CONFIG.checkInterval);

  // Initial run after 1 second
  setTimeout(() => processPendingCampaigns(), 1000);

  return interval;
}

/**
 * Handle legacy campaigns - mark them as COMPLETED if no logs
 */
async function handleLegacyCampaigns() {
  try {
    // console.log("Checking for legacy campaigns...");

    // Find campaigns that are PENDING/IN_PROGRESS but have no logs
    const legacyCampaigns = await query(
      `SELECT c.campaign_id, c.uid, c.title
       FROM beta_campaign c
       LEFT JOIN beta_campaign_logs l ON c.campaign_id = l.campaign_id AND c.uid = l.uid
       WHERE c.status IN ('PENDING', 'IN_PROGRESS')
       AND c.uid IS NOT NULL AND l.campaign_id IS NULL`,
      [],
    );

    if (legacyCampaigns.length > 0) {
      // console.log(
      //   `Found ${legacyCampaigns.length} legacy campaigns without logs`
      // );

      // Mark them as COMPLETED
      for (const campaign of legacyCampaigns) {
        await query(
          `UPDATE beta_campaign 
           SET status = 'COMPLETED' 
          WHERE campaign_id = ? AND uid = ?`,
          [campaign.campaign_id, campaign.uid],
        );

        // console.log(
        //   `Marked legacy campaign as COMPLETED: ${campaign.campaign_id} - ${campaign.title}`
        // );
      }

      // console.log(
      //   `✅ Marked ${legacyCampaigns.length} legacy campaigns as COMPLETED`
      // );
    } else {
      // console.log("No legacy campaigns found");
    }
  } catch (error) {
    console.error("Error handling legacy campaigns:", error);
  }
}

/**
 * Process pending campaigns
 */
async function processPendingCampaigns() {
  try {
    await resumeEligiblePausedCampaigns();
    // Get campaigns that need processing
    const campaigns = await query(
      `SELECT * FROM beta_campaign 
       WHERE (status = 'PENDING' OR status = 'IN_PROGRESS')
       AND (schedule IS NULL OR schedule <= NOW())
       ORDER BY createdAt ASC
       LIMIT 5`,
      [],
    );

    if (!campaigns || campaigns.length === 0) {
      return;
    }

    // Process each campaign
    for (const campaign of campaigns) {
      const processingKey = `${campaign.uid}:${campaign.campaign_id}`;
      if (processingCampaigns.has(processingKey)) {
        continue; // Skip if already processing
      }

      processingCampaigns.add(processingKey);

      try {
        await processSingleCampaign(campaign);
      } catch (error) {
        console.error(
          `Error processing campaign ${campaign.campaign_id}:`,
          error,
        );
      } finally {
        processingCampaigns.delete(processingKey);
      }
    }
  } catch (error) {
    console.error("Error in processPendingCampaigns:", error);
  }
}

async function resumeEligiblePausedCampaigns(){
  let paused=await query(`SELECT * FROM beta_campaign
    WHERE status='PAUSED' AND (schedule IS NULL OR schedule<=NOW()) AND id>?
    ORDER BY id ASC LIMIT 20`,[pausedCampaignCursor]);
  if(!paused?.length&&pausedCampaignCursor){
    pausedCampaignCursor=0;
    paused=await query(`SELECT * FROM beta_campaign
      WHERE status='PAUSED' AND (schedule IS NULL OR schedule<=NOW()) AND id>?
      ORDER BY id ASC LIMIT 20`,[pausedCampaignCursor]);
  }
  if(!paused?.length)return;
  pausedCampaignCursor=Number(paused.at(-1).id)||pausedCampaignCursor;
  for(const campaign of paused){
    const access=await canSendCampaignByModule(campaign.uid);
    if(access?.allowed){
      await query(`UPDATE beta_campaign SET status='PENDING' WHERE campaign_id=? AND uid=? AND status='PAUSED'`,[campaign.campaign_id,campaign.uid]);
    }
  }
}

/**
 * Send a CAROUSEL template message via Meta API
 */
async function sendCarouselTemplateMessage(
  apiVersion,
  phoneNumberId,
  accessToken,
  templateName,
  language,
  recipientPhone,
  globalBodyVariables = [],
  cards = [],
) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const components = [];

  // Global body above the carousel (optional)
  if (globalBodyVariables.length > 0) {
    components.push({
      type: "body",
      parameters: globalBodyVariables.map((v) => ({
        type: "text",
        text: String(v || ""),
      })),
    });
  }

  // Build all cards first, then push them as ONE carousel component
  const builtCards = cards.map((card, index) => {
    const cardComponents = [];

    if (card.imageUrl) {
      cardComponents.push({
        type: "header",
        parameters: [{ type: "image", image: { link: card.imageUrl } }],
      });
    }

    if (card.bodyVariables?.length > 0) {
      cardComponents.push({
        type: "body",
        parameters: card.bodyVariables.map((v) => ({
          type: "text",
          text: String(v || ""),
        })),
      });
    }

    if (card.buttonVariables?.length > 0) {
      card.buttonVariables.forEach((bv, bi) => {
        cardComponents.push({
          type: "button",
          sub_type: "url",
          index: String(bv.index ?? bi),
          parameters: [{ type: "text", text: String(bv.value || bv || "") }],
        });
      });
    }

    return { card_index: index, components: cardComponents };
  });

  // All cards go into ONE single carousel component
  if (builtCards.length > 0) {
    components.push({
      type: "carousel",
      cards: builtCards,
    });
  }

  const payload = {
    messaging_product: "whatsapp",
    to: recipientPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error("Error sending carousel template:", error);
    throw error;
  }
}

/**
 * Send a CATALOG template message via Meta API
 */
async function sendCatalogTemplateMessage(
  apiVersion,
  phoneNumberId,
  accessToken,
  templateName,
  language,
  recipientPhone,
  bodyVariables = [],
  thumbnailProductRetailerId = null, // SKU / Content ID from Commerce Manager
) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const components = [];

  // Body variables
  if (bodyVariables.length > 0) {
    components.push({
      type: "body",
      parameters: bodyVariables.map((v) => ({
        type: "text",
        text: String(v || ""),
      })),
    });
  }

  // ✅ Catalog button — thumbnail goes HERE as product retailer ID, not a header
  components.push({
    type: "button",
    sub_type: "CATALOG",
    index: 0,
    parameters: [
      {
        type: "action",
        action: thumbnailProductRetailerId
          ? { thumbnail_product_retailer_id: thumbnailProductRetailerId }
          : {}, // empty = Meta uses first catalog product image automatically
      },
    ],
  });

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipientPhone,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      components,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return await response.json();
  } catch (error) {
    console.error("Error sending catalog template:", error);
    throw error;
  }
}

/**
 * Process a single campaign
 */
async function processSingleCampaign(campaign, options = {}) {
  if (typeof campaign?.uid !== 'string' || !campaign.uid || !campaign.campaign_id) {
    console.warn('Campaign skipped because its owner could not be verified.','OWNER_NOT_FOUND');
    return;
  }
  const lock = await acquireCampaignWorkerLock(campaignPool, campaign.uid, String(campaign.campaign_id));
  if (!lock) return;
  try {
    await lock.assertHeld();
    return await processSingleCampaignWithLock(campaign, { ...options, assertLockHeld: lock.assertHeld });
  } finally {
    await lock.release();
  }
}

async function processSingleCampaignWithLock(campaign,{canSendCampaign=canSendCampaignByModule,messageDelay=CONFIG.messageDelay,assertLockHeld=async()=>{}}={}) {
  await assertLockHeld();
  const initialAccess=await canSendCampaign(campaign.uid);
  if(initialAccess!==true&&initialAccess?.allowed!==true){
    console.warn('Campaign paused by current tenant access policy.',initialAccess?.code||'FEATURE_UNAVAILABLE');
    await pauseCampaign(campaign.campaign_id, campaign.uid, assertLockHeld);
    return;
  }

  // Update status to IN_PROGRESS if PENDING
  if (campaign.status === "PENDING") {
    await assertLockHeld();
    await query(
      "UPDATE beta_campaign SET status = 'IN_PROGRESS' WHERE campaign_id = ? AND uid = ?",
      [campaign.campaign_id, campaign.uid],
    );
  }

  // Get pending logs for this campaign
  const pendingLogs = await query(
    `SELECT * FROM beta_campaign_logs 
     WHERE campaign_id = ? AND uid = ?
     AND status = 'PENDING'
     ORDER BY id ASC
     LIMIT ?`,
    [campaign.campaign_id, campaign.uid, CONFIG.batchSize],
  );

  if (!pendingLogs || pendingLogs.length === 0) {
    await checkAndMarkCampaignComplete(campaign, assertLockHeld);
    return;
  }

  // Get meta API credentials
  const metaCredentials = await query(
    "SELECT * FROM meta_api WHERE uid = ? LIMIT 1",
    [campaign.uid],
  );

  if (!metaCredentials || metaCredentials.length === 0) {
    await assertLockHeld();
    await query(
      `UPDATE beta_campaign_logs 
       SET status = 'FAILED', error_message = 'Meta API credentials not found'
       WHERE campaign_id = ? AND uid = ? AND status = 'PENDING'`,
      [campaign.campaign_id, campaign.uid],
    );
    await updateCampaignCounts(campaign.campaign_id, campaign.uid, assertLockHeld);
    await checkAndMarkCampaignComplete(campaign, assertLockHeld);
    return;
  }

  // ── Parse campaign variables ──────────────────────────────
  let bodyVariables = [];
  let headerVariable = null;
  let buttonVariables = [];

  try {
    bodyVariables = campaign.body_variables
      ? JSON.parse(campaign.body_variables)
      : [];
    headerVariable = campaign.header_variable
      ? JSON.parse(campaign.header_variable)
      : null;
    buttonVariables = campaign.button_variables
      ? JSON.parse(campaign.button_variables)
      : [];
  } catch (e) {
    console.error(`Error parsing campaign variables: ${e.message}`);
  }

  // ── Detect template type from packed headerVariable ───────
  // STANDARD : headerVariable = { type:"STANDARD", url, filename, mediaType }
  //            OR null (no header)
  //            OR legacy string (old campaigns before this update)
  // CAROUSEL : headerVariable = { type:"CAROUSEL", cards:[...] }
  // CATALOG  : headerVariable = { type:"CATALOG",  thumbnail: url|null }
  const templateType =
    headerVariable?.type === "CAROUSEL"
      ? "CAROUSEL"
      : headerVariable?.type === "CATALOG"
        ? "CATALOG"
        : "STANDARD";

  const credentials = metaCredentials[0];
  const successfulIds = [];
  const failedUpdates = [];

  for (const log of pendingLogs) {
    const currentAccess=await canSendCampaign(campaign.uid);
    if(currentAccess!==true&&currentAccess?.allowed!==true){
      console.warn('Campaign paused by current tenant access policy.',currentAccess?.code||'FEATURE_UNAVAILABLE');
      await persistCampaignResults(campaign.campaign_id,campaign.uid,successfulIds,failedUpdates,assertLockHeld);
      await updateCampaignCounts(campaign.campaign_id, campaign.uid, assertLockHeld);
      await pauseCampaign(campaign.campaign_id, campaign.uid, assertLockHeld);
      return;
    }
    try {
      // Get contact details for variable replacement
      const contact = await getContactForLog(log, campaign);
      await assertLockHeld();

      let result;

      // ── CAROUSEL send ─────────────────────────────────────
      if (templateType === "CAROUSEL") {
        const cards = (headerVariable.cards || []).map((card) => ({
          imageUrl: card.imageUrl,
          bodyVariables: replaceContactVariables(
            card.bodyVariables || [],
            contact,
          ),
          buttonVariables: require('../client/public/template-placeholder-contract').resolveButtons(card.buttonVariables, contact),
        }));

        result = await sendCarouselTemplateMessage(
          "v18.0",
          credentials.business_phone_number_id,
          credentials.access_token,
          campaign.template_name,
          campaign.template_language,
          log.contact_mobile,
          replaceContactVariables(bodyVariables, contact), // global body above cards
          cards,
        );

        // ── CATALOG send ──────────────────────────────────────
      } else if (templateType === "CATALOG") {
        const processedBodyVars = replaceContactVariables(
          bodyVariables,
          contact,
        );

        result = await sendCatalogTemplateMessage(
          "v18.0",
          credentials.business_phone_number_id,
          credentials.access_token,
          campaign.template_name,
          campaign.template_language,
          log.contact_mobile,
          processedBodyVars,
          headerVariable.thumbnail || null,
        );

        // ── STANDARD send (your original logic, unchanged) ────
      } else {
        // STANDARD — headerVariable.type is now correctly "image"/"video"/"document"
        const processedBodyVars = replaceContactVariables(
          bodyVariables,
          contact,
        );
        const processedHeaderVar = replaceContactVariable(
          headerVariable,
          contact,
        );
        const processedButtonVars = replaceContactVariables(
          buttonVariables,
          contact,
        );

        result = await sendTemplateMessage(
          "v18.0",
          credentials.business_phone_number_id,
          credentials.access_token,
          campaign.template_name,
          campaign.template_language,
          log.contact_mobile,
          processedBodyVars,
          processedHeaderVar, // ← now { type:"image", url:"...", filename:"..." } ✅
          processedButtonVars,
        );
      }

      // ── Handle result (same for all types) ───────────────
      if (result && result.messages && result.messages.length > 0) {
        successfulIds.push({ id: log.id, messageId: result.messages[0].id });
      } else {
        const errorMsg = result?.error?.message || "No message ID returned";
        failedUpdates.push({ id: log.id, error: errorMsg });
      }

      await new Promise((resolve) => setTimeout(resolve, messageDelay));
    } catch (error) {
      console.error(`Error sending to ${log.contact_mobile}:`, error.message);
      failedUpdates.push({ id: log.id, error: error.message });
    }
  }

  await persistCampaignResults(campaign.campaign_id,campaign.uid,successfulIds,failedUpdates,assertLockHeld);

  await updateCampaignCounts(campaign.campaign_id, campaign.uid, assertLockHeld);
  await checkAndMarkCampaignComplete(campaign, assertLockHeld);
}

async function pauseCampaign(campaignId,uid,assertLockHeld=async()=>{}){
  if(typeof uid!=='string'||!uid)return;
  await assertLockHeld();
  await query(`UPDATE beta_campaign SET status='PAUSED' WHERE campaign_id=? AND uid=? AND status IN ('PENDING','IN_PROGRESS')`,[campaignId,uid]);
}

async function persistCampaignResults(campaignId,uid,successfulIds,failedUpdates,assertLockHeld=async()=>{}){
  // Persist each completed provider result before an access-denied return so
  // the next worker pass cannot resend a message already accepted by Meta.
  if (successfulIds.length > 0) {
    for (const success of successfulIds) {
      await assertLockHeld();
      await query(
        `UPDATE beta_campaign_logs 
         SET status = 'SENT', meta_msg_id = ?, delivery_time = NOW()
         WHERE id = ? AND campaign_id = ? AND uid = ?`,
        [success.messageId, success.id, campaignId, uid],
      );
    }
  }

  if (failedUpdates.length > 0) {
    for (const failed of failedUpdates) {
      await assertLockHeld();
      await query(
        `UPDATE beta_campaign_logs 
         SET status = 'FAILED', error_message = ?
         WHERE id = ? AND campaign_id = ? AND uid = ?`,
        [failed.error, failed.id, campaignId, uid],
      );
    }
  }

}

/**
 * Get contact details for a log entry
 */
async function getContactForLog(log, campaign) {
  const contacts = await query(
    `SELECT * FROM contact 
     WHERE mobile = ? AND uid = ? AND phonebook_id = ?
     LIMIT 1`,
    [log.contact_mobile, campaign.uid, campaign.phonebook_id],
  );

  if (contacts && contacts.length > 0) {
    return contacts[0];
  }

  // Fallback to log data
  return {
    name: log.contact_name,
    mobile: log.contact_mobile,
    var1: "",
    var2: "",
    var3: "",
    var4: "",
    var5: "",
  };
}

/**
 * Update campaign counts based on current log statuses
 */
async function updateCampaignCounts(campaignId, uid, assertLockHeld=async()=>{}) {
  if(typeof uid!=='string'||!uid)return;
  try {
    await assertLockHeld();
    await query(
      `UPDATE beta_campaign SET
        sent_count = (SELECT COUNT(*) FROM beta_campaign_logs WHERE campaign_id = ? AND uid = ? AND status = 'SENT'),
        failed_count = (SELECT COUNT(*) FROM beta_campaign_logs WHERE campaign_id = ? AND uid = ? AND status = 'FAILED'),
        delivered_count = (SELECT COUNT(*) FROM beta_campaign_logs WHERE campaign_id = ? AND uid = ? AND delivery_status = 'delivered'),
        read_count = (SELECT COUNT(*) FROM beta_campaign_logs WHERE campaign_id = ? AND uid = ? AND delivery_status = 'read')
       WHERE campaign_id = ? AND uid = ?`,
      [campaignId, uid, campaignId, uid, campaignId, uid, campaignId, uid, campaignId, uid],
    );
  } catch (error) {
    console.error(`Error updating campaign counts for ${campaignId}:`, error);
  }
}

/**
 * Check if campaign is complete and mark it
 */
async function checkAndMarkCampaignComplete(campaign, assertLockHeld=async()=>{}) {
  if(typeof campaign?.uid!=='string'||!campaign.uid)return;
  await assertLockHeld();
  const [pendingCount] = await query(
    `SELECT COUNT(*) as count FROM beta_campaign_logs 
     WHERE campaign_id = ? AND uid = ? AND status = 'PENDING'`,
    [campaign.campaign_id, campaign.uid],
  );

  const [totalLogsCount] = await query(
    `SELECT COUNT(*) as count FROM beta_campaign_logs 
     WHERE campaign_id = ? AND uid = ?`,
    [campaign.campaign_id, campaign.uid],
  );

  // If no pending logs and we have some logs, mark as complete
  if (pendingCount.count === 0 && totalLogsCount.count > 0) {
    await assertLockHeld();
    await query(
      "UPDATE beta_campaign SET status = 'COMPLETED' WHERE campaign_id = ? AND uid = ?",
      [campaign.campaign_id, campaign.uid],
    );
    // console.log(`✅ Campaign ${campaign.campaign_id} marked as COMPLETED`);
  }
  // If no logs at all, mark as completed (legacy case)
  else if (totalLogsCount.count === 0) {
    await assertLockHeld();
    await query(
      "UPDATE beta_campaign SET status = 'COMPLETED' WHERE campaign_id = ? AND uid = ?",
      [campaign.campaign_id, campaign.uid],
    );
    // console.log(
    //   `✅ Campaign ${campaign.campaign_id} marked as COMPLETED (no logs - legacy)`
    // );
  }
}

/**
 * Replace contact variables in an array
 */
function replaceContactVariables(variables, contact) {
  if (!Array.isArray(variables)) return variables;
  return variables.map((variable) => replaceContactVariable(variable, contact));
}

/**
 * Replace contact variable in a single variable
 */
function replaceContactVariable(variable, contact) {
  return require('../client/public/template-placeholder-contract').replace(variable, contact);
}

/**
 * Handle webhook updates for message status
 */
async function updateMessageStatus(metaMsgId, status, errorMessage = null) {
  try {
    // Add small delay to ensure message is in database
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // console.log(`Updating message ${metaMsgId} status to ${status}`);

    // Find the log entry
    const logs = await query(
      "SELECT * FROM beta_campaign_logs WHERE meta_msg_id = ? LIMIT 1",
      [metaMsgId],
    );

    if (!logs || logs.length === 0) {
      // console.log(`No log found for message ID: ${metaMsgId}`);
      return;
    }

    const log = logs[0];

    // Don't downgrade status (read is higher than delivered)
    if (log.delivery_status === "read" && status === "delivered") {
      // console.log(
      //   `Message ${metaMsgId} already marked as read, not downgrading to delivered`
      // );
      return;
    }

    // Update delivery status
    await query(
      `UPDATE beta_campaign_logs 
       SET delivery_status = ?, delivery_time = NOW(), error_message = ?
       WHERE meta_msg_id = ? AND uid = ?`,
      [status, errorMessage, metaMsgId, log.uid],
    );

    // Update campaign counters
    await updateCampaignCounts(log.campaign_id, log.uid);

    // console.log(`✅ Updated message ${metaMsgId} status to ${status}`);
  } catch (error) {
    console.error(`Error updating message status for ${metaMsgId}:`, error);
  }
}

module.exports = {
  initCampaign,
  processPendingCampaigns,
  processSingleCampaign,
  resumeEligiblePausedCampaigns,
  updateMessageStatus,
  sendCarouselTemplateMessage,
  sendCatalogTemplateMessage,
};
