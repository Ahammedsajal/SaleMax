'use strict';

function mergeSalesProspectFlowState({ state = {}, variables = {}, leadInfo = null, message = {}, now = Date.now() } = {}) {
  const value = (...keys) => {
    for (const key of keys) {
      const item = variables?.[key];
      if (item != null && item !== '' && item !== 'NA') return String(item).trim().slice(0, 180);
    }
    return '';
  };
  const contactName = value('contactName', 'contact_name') || state.contactName || message.senderName || '';
  const phonebookCenterName = leadInfo?.phonebookName || state.phonebookCenterName || '';
  const decisionMakerChoice = value('decisionMakerChoice', 'decision_maker_choice');
  const isDecisionMaker = /^yes$/i.test(decisionMakerChoice);
  const managerNumberChoice = value('managerNumberChoice', 'manager_number_choice');
  const sameWhatsappNumber = /^(yes|yes, same number)$/i.test(managerNumberChoice);
  const next = {
    ...state,
    contactName,
    whatsappNumber: message.senderMobile || state.whatsappNumber || '',
    phonebookCenterName,
    trainingCenterName: value('trainingCenterName', 'training_center_name', 'centerName') || state.trainingCenterName || phonebookCenterName,
    currentSystemStatus: value('currentSystemStatus', 'current_system_status') || state.currentSystemStatus || '',
    currentSystemName: value('currentSystemName', 'current_system_name') || state.currentSystemName || '',
    managerContactName: value('managerContactName', 'manager_contact_name') || state.managerContactName || (isDecisionMaker ? contactName : ''),
    managerContactNumber: value('managerContactNumber', 'manager_contact_number') || state.managerContactNumber || ((isDecisionMaker || sameWhatsappNumber) ? message.senderMobile || '' : ''),
    priceInterest: value('priceInterest', 'price_interest') || state.priceInterest || '',
    contactAfterPrice: value('contactAfterPrice', 'contact_after_price') || state.contactAfterPrice || '',
  };

  if (/^yes$/i.test(next.currentSystemStatus)) next.currentSystemStatus = 'yes';
  else if (/^no$/i.test(next.currentSystemStatus)) next.currentSystemStatus = 'no';
  else if (/^not sure$/i.test(next.currentSystemStatus)) next.currentSystemStatus = 'not_sure';

  const demoChoice = value('demoRequested', 'demo_requested');
  const demoRequested = /^(yes|true|1|yes, send it)$/i.test(demoChoice);
  if (demoRequested && !next.demoRequested) {
    next.demoRequested = true;
    next.step = 'demo_followup';
    next.demoReminderDueAt = new Date(now + 30 * 60 * 1000).toISOString();
  }
  if (/^(not now|no)$/i.test(demoChoice)) {
    next.demoRequested = false;
    next.demoDeclined = true;
    next.step = 'followup_options';
    next.demoReminderDueAt = null;
  }

  const watchedChoice = value('demoWatched', 'demo_watched');
  if (next.step === 'demo_followup' && watchedChoice) {
    next.demoWatched = /^(yes|yes, i watched|i watched)$/i.test(watchedChoice);
    next.demoReminderDueAt = null;
    next.demoReminderCancelledAt = new Date(now).toISOString();
    next.step = 'followup_options';
  }

  if (sameWhatsappNumber && !next.managerContactNumber) next.managerContactNumber = message.senderMobile || '';
  if (!next.currentSystemName && next.currentSystemStatus === 'no') next.currentSystemName = 'Not using a system';
  else if (!next.currentSystemName && next.currentSystemStatus === 'not_sure') next.currentSystemName = 'Not sure';
  if (/^know the price$/i.test(value('priceInterest', 'price_interest'))) next.pricePresented = true;

  return next;
}

function salesProspectFollowUpRequested(state = {}) {
  const priceInterest = String(state.priceInterest || '').trim().toLowerCase();
  const contactAfterPrice = String(state.contactAfterPrice || '').trim().toLowerCase();
  return contactAfterPrice === 'yes' || priceInterest === 'talk to our team' || priceInterest === 'talk to team';
}

module.exports = { mergeSalesProspectFlowState, salesProspectFollowUpRequested };
