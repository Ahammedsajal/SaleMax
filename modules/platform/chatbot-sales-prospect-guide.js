'use strict';

const OFFER = Object.freeze({ amount: 2500, currency: 'QAR', period: 'year', included: ['1 admin user', '1 manager user', '7 agent users'] });
const clean = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
const normalize = value => clean(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const affirmative = value => /^(?:yes|yeah|yep|yes correct|yes same number|yes i watched|yes i saw it|i watched|correct|that s right|that is right|sure|okay|ok|نعم|صحيح|اي|أجل)$/u.test(normalize(value));
const negative = value => /^(?:no|nope|not really|not now|not yet|use another|later|لا|ليس الآن|مو الآن)$/u.test(normalize(value));
function button(id, title) { return { id, title }; }
function withState(prior, updates) { return { ...prior, ...updates, language: 'en', greeted: true }; }

function trainingCenterProspectReply({ message, state = null, phonebookName = '', contactName = '', demoUrl = 'https://7network.live/training-center-demo.mp4' }) {
  const input = clean(message);
  const normalized = normalize(input);
  const prior = state && typeof state === 'object' ? { ...state } : {};
  if (prior.step === 'demo_followup' && prior.demoReminderClaimedAt && !prior.demoReminderSentAt) prior.demoReminderCancelledAt = new Date().toISOString();
  const buttons = [];
  let reply = '';
  let next = { ...prior };

  if (!prior.step || prior.step === 'start') {
    const known = clean(phonebookName);
    next = withState(prior, { ...(known ? { step: 'center_confirm', phonebookCenterName: known } : { step: 'center_name' }), contactName: clean(contactName) });
    reply = known
      ? `Hi${clean(prior.contactName || '') ? ` ${clean(prior.contactName)}` : ''}! Our phonebook lists your center as “${known}”. Is that correct?`
      : 'Hi! Thanks for your interest in 7Network. What is your training center’s name?';
    if (known) buttons.push(button('center_confirm_yes', 'Yes, correct'), button('center_confirm_no', 'I’ll type it'));
    return { reply, state: next, buttons, handoff: false };
  }

  if (prior.step === 'center_confirm') {
    if (affirmative(normalized)) {
      next = withState(prior, { step: 'system_status', trainingCenterName: clean(prior.phonebookCenterName) });
    } else {
      next = withState(prior, { step: 'center_name', phonebookCenterName: '' });
      reply = 'Of course. What is the correct name of your training center?';
      return { reply, state: next, buttons, handoff: false };
    }
  } else if (prior.step === 'center_name') {
    if (input.length < 2) {
      return { reply: 'Please share the name of your training center so I can note it correctly.', state: prior, buttons, handoff: false };
    }
    next = withState(prior, { step: 'system_status', trainingCenterName: clean(input) });
  } else if (prior.step === 'system_status') {
    const status = affirmative(normalized) ? 'yes' : negative(normalized) ? 'no' : normalized.includes('not sure') ? 'not_sure' : null;
    if (!status) return { reply: 'Do you currently use a business management or CRM system?', state: prior, buttons: [button('system_yes', 'Yes'), button('system_no', 'No'), button('system_unsure', 'Not sure')], handoff: false };
    next = withState(prior, { step: status === 'yes' ? 'system_name' : 'manager_name', currentSystemStatus: status });
    if (status !== 'yes') next.currentSystemName = '';
  } else if (prior.step === 'system_name') {
    next = withState(prior, { step: 'manager_name', currentSystemName: clean(input) || 'Not provided' });
  } else if (prior.step === 'manager_name') {
    next = withState(prior, { step: 'manager_number_choice', managerContactName: clean(input) || 'Not provided' });
  } else if (prior.step === 'manager_number_choice') {
    if (affirmative(normalized)) {
      next = withState(prior, { step: 'demo_offer', managerContactNumber: clean(prior.whatsappNumber || ''), leadComplete: true, leadAlertQueued: true });
      reply = 'Thank you. I’ve noted the manager’s details. Would you like me to send you the short Training Center demo video?';
      buttons.push(button('demo_yes', 'Yes, send it'), button('demo_no', 'Not now'));
      return { reply, state: next, buttons, handoff: false, notifySales: prior.leadAlertQueued !== true };
    } else if (negative(normalized)) {
      next = withState(prior, { step: 'manager_number', managerContactNumber: '' });
      reply = 'No problem. Please share the manager’s preferred contact number, including the country code.';
      return { reply, state: next, buttons, handoff: false };
    } else {
      return { reply: 'Would you like us to contact the manager on this WhatsApp number?', state: prior, buttons: [button('manager_number_same', 'Yes, same number'), button('manager_number_other', 'Use another')], handoff: false };
    }
  } else if (prior.step === 'manager_number') {
    const phone = input.replace(/[^\d+]/g, '').slice(0, 20);
    if (!/^\+?[1-9]\d{7,14}$/.test(phone)) return { reply: 'Please enter a valid number with its country code, for example +974XXXXXXXX.', state: prior, buttons, handoff: false };
    next = withState(prior, { step: 'demo_offer', managerContactNumber: phone, leadComplete: true, leadAlertQueued: true });
    reply = 'Thank you. I’ve noted the manager’s details. Would you like me to send you the short Training Center demo video?';
    buttons.push(button('demo_yes', 'Yes, send it'), button('demo_no', 'Not now'));
    return { reply, state: next, buttons, handoff: false, notifySales: prior.leadAlertQueued !== true };
  } else if (prior.step === 'demo_offer') {
    if (/^(?:demo_yes|yes|yes send it|send it|show me)$/u.test(normalized)) {
      next = withState(prior, { step: 'demo_followup', demoRequested: true, demoSentAt: new Date().toISOString(), demoReminderDueAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() });
      return { reply: `Here is the 7Network Training Center demo: ${demoUrl}\n\nWould you like me to check back after you have watched it?`, state: next, buttons: [button('demo_seen_yes', 'I watched'), button('demo_seen_no', 'Not yet')], handoff: false, scheduleDemoReminder: true };
    }
    if (/^(?:demo_no|no|no not now|not now|later)$/u.test(normalized)) {
      next = withState(prior, { step: 'followup_options', demoRequested: false, demoDeclined: true, leadComplete: true });
      reply = 'No problem. I’ve shared your details with our team so they can follow up with you. Would you like to see the campaign offer?';
      buttons.push(button('know_price', 'Know the price'), button('talk_to_team', 'Talk to our team'));
      return { reply, state: next, buttons, handoff: false };
    }
    return { reply: 'Would you like me to send you the short Training Center demo video?', state: prior, buttons: [button('demo_yes', 'Yes, send it'), button('demo_no', 'Not now')], handoff: false };
  } else if (prior.step === 'demo_followup') {
    if (affirmative(normalized)) {
      next = withState(prior, { step: 'followup_options', demoWatched: true, demoReminderDueAt: null, leadComplete: true });
      reply = 'Thank you. I’ve passed your contact and training-center details to our team so they can discuss the setup with you. Would you like to see the campaign offer?';
      buttons.push(button('know_price', 'Know the price'), button('talk_to_team', 'Talk to our team'));
      return { reply, state: next, buttons, handoff: false };
    }
    if (negative(normalized)) {
      next = withState(prior, { step: 'followup_options', demoWatched: false, demoReminderDueAt: null, leadComplete: true });
      reply = 'No worries. I’ve passed your contact and training-center details to our team for a follow-up. Would you like to see the campaign offer?';
      buttons.push(button('know_price', 'Know the price'), button('talk_to_team', 'Talk to our team'));
      return { reply, state: next, buttons, handoff: false };
    }
    if (/(?:price|pricing|cost|offer)/u.test(normalized)) {
      next = withState(prior, { step: 'followup_options', demoReminderDueAt: null, pricePresented: true });
      return { reply: `Our current Training Center campaign offer is QAR ${OFFER.amount.toLocaleString('en-QA')} per year. It includes ${OFFER.included.join(', ')}. I’ve passed your details to our team to confirm the setup and next steps.`, state: next, buttons: [button('talk_to_team', 'Talk to our team')], handoff: false };
    }
    next = withState(prior, { demoReminderDueAt: null });
    reply = 'Did you get a chance to watch the demo?';
    buttons.push(button('demo_seen_yes', 'Yes, I watched'), button('demo_seen_no', 'Not yet'));
  } else if (prior.step === 'followup_options' || normalized === 'know price' || normalized === 'price') {
    if (normalized === 'talk to our team' || normalized === 'talk to team') {
      return { reply: 'Certainly. Our team will contact you using the manager details you shared.', state: withState(prior, { teamContactRequested: true }), buttons: [], handoff: true, handoffReason: 'sales-prospect-requested-human' };
    }
    reply = `Our current Training Center campaign offer is QAR ${OFFER.amount.toLocaleString('en-QA')} per year. It includes ${OFFER.included.join(', ')}. I’ve passed your details to our team to confirm the setup and next steps.`;
    return { reply, state: withState(prior, { step: 'followup_options', pricePresented: true, demoReminderDueAt: null }), buttons: [button('talk_to_team', 'Talk to our team')], handoff: false };
  }

  if (!reply) {
    if (next.step === 'system_status') {
      reply = 'Do you currently use a business management or CRM system?';
      buttons.push(button('system_yes', 'Yes'), button('system_no', 'No'), button('system_unsure', 'Not sure'));
    } else if (next.step === 'system_name') reply = 'Which system do you currently use?';
    else if (next.step === 'manager_name') reply = 'May I have the manager’s name so our team can address them politely?';
    else if (next.step === 'manager_number_choice') {
      reply = 'Would you like us to contact the manager on this WhatsApp number?';
      buttons.push(button('manager_number_same', 'Yes, same number'), button('manager_number_other', 'Use another'));
    } else if (next.step === 'demo_offer') {
      reply = 'Would you like me to send you the short Training Center demo video?';
      buttons.push(button('demo_yes', 'Yes, send it'), button('demo_no', 'Not now'));
    }
  }
  return { reply, state: next, buttons, handoff: false };
}

module.exports = { OFFER, trainingCenterProspectReply };
