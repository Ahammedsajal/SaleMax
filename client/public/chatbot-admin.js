(() => {
  'use strict';
  if (window.__sxChatbotAdmin) return;
  window.__sxChatbotAdmin = true;

  const root = '/api/user/chatbots';
  const engines = ['guided', 'hybrid', 'ai'];
  // Curated chat-capable models supported by the current provider adapters.
  // Prices are USD per 1M text tokens and should be refreshed when providers change rates.
  const providerModels = Object.freeze({
    openai: [
      { id: 'gpt-6-luna', en: 'GPT-6 Luna · Recommended · $0.10 input / $0.50 output', ar: 'GPT-6 Luna · موصى به · 0.10$ إدخال / 0.50$ إخراج' },
      { id: 'gpt-6.1-sol', en: 'GPT-6.1 Sol · Balanced · $2.00 / $10.00', ar: 'GPT-6.1 Sol · متوازن · 2.00$ / 10.00$' },
      { id: 'gpt-6-astra', en: 'GPT-6 Astra · Highest capability · $10.00 / $50.00', ar: 'GPT-6 Astra · أعلى قدرات · 10.00$ / 50.00$' },
    ],
    gemini: [
      { id: 'gemini-3.1-flash-lite', en: 'Gemini 3.1 Flash-Lite · Recommended · $0.25 input / $1.50 output', ar: 'Gemini 3.1 Flash-Lite · موصى به · 0.25$ إدخال / 1.50$ إخراج' },
      { id: 'gemini-3.8-flash', en: 'Gemini 3.8 Flash · Balanced · $0.75 / $4.50 through Dec 31, 2026', ar: 'Gemini 3.8 Flash · متوازن · 0.75$ / 4.50$ حتى 31 ديسمبر 2026' },
      { id: 'gemini-3.5-flash', en: 'Gemini 3.5 Flash · Higher capability · $1.50 / $9.00', ar: 'Gemini 3.5 Flash · قدرات أعلى · 1.50$ / 9.00$' },
    ],
    deepseek: [
      { id: 'deepseek-flash', en: 'DeepSeek Flash · Recommended · $0.15–$0.30 input / $0.60–$1.20 output', ar: 'DeepSeek Flash · موصى به · 0.15–0.30$ إدخال / 0.60–1.20$ إخراج' },
      { id: 'deepseek-v4-pro', en: 'DeepSeek V4 Pro · Higher capability · $0.66–$1.32 / $1.98–$3.96', ar: 'DeepSeek V4 Pro · قدرات أعلى · 0.66–1.32$ / 1.98–3.96$' },
    ],
  });
  const state = { tab: 'legacy', bots: [], channels: [], flows: [], categoryKey: 'training_center', categoryTitle: null, categoryVersion: 1, guidedContentDefaults: null, guidedContentSchema: null, provider: { configured: false, revision: 0 }, csrf: null, mounted: false, assignmentPage: true };
  const ar = () => (localStorage.getItem('language') || '').toLowerCase().startsWith('ar') || document.documentElement.dir === 'rtl';
  const tr = (en, arabic) => ar() ? arabic : en;
  function modelChoices(provider, selected) {
    const choices = providerModels[provider] || providerModels.openai;
    const legacy = selected && !choices.some(item => item.id === selected) ? `<option value="${esc(selected)}" selected>${esc(tr(`Saved model: ${selected}`, `النموذج المحفوظ: ${selected}`))}</option>` : '';
    const selectedId = selected ? (choices.some(item => item.id === selected) ? selected : null) : choices[0].id;
    return legacy + choices.map(item => `<option value="${esc(item.id)}" ${item.id === selectedId ? 'selected' : ''}>${esc(item[ar() ? 'ar' : 'en'])}</option>`).join('');
  }
  function presetChoices(values, selected, recommended) {
    const selectedValue = String(selected ?? recommended);
    const legacy = values.includes(selectedValue) ? '' : `<option value="${esc(selectedValue)}" selected>${esc(tr(`Saved setting: ${selectedValue}`, `الإعداد المحفوظ: ${selectedValue}`))}</option>`;
    return legacy + values.map(value => `<option value="${value}" ${selectedValue === value ? 'selected' : ''}>${esc(value === recommended ? `${value} · ${tr('Recommended','موصى به')}` : value)}</option>`).join('');
  }
  function syncChatbotTheme() {
    const rootElement = document.documentElement;
    const candidates = [localStorage.getItem('theme_mode'), rootElement.getAttribute('data-mui-color-scheme'), document.body?.getAttribute('data-mui-color-scheme'), rootElement.getAttribute('data-theme')];
    const explicitMode = candidates.map(value => String(value || '').toLowerCase()).find(value => value === 'dark' || value === 'light');
    const themeControl = [...document.querySelectorAll('button')].some(button => /^(?:light mode|الوضع الفاتح)$/i.test(`${button.title || ''} ${button.getAttribute('aria-label') || ''}`.trim()));
    const theme = explicitMode || (themeControl ? 'dark' : 'light');
    if (rootElement.getAttribute('data-sx-chatbot-theme') !== theme) rootElement.setAttribute('data-sx-chatbot-theme', theme);
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => localStorage.getItem('wacrm_user');
  async function api(path, method = 'GET', body) {
    const headers = {};
    if (token()) headers.Authorization = `Bearer ${token()}`;
    else {
      if (!state.csrf) {
        const auth = await fetch('/api/user/business-auth/me', { credentials: 'same-origin', cache: 'no-store' });
        const session = await auth.json();
        if (!auth.ok || session.context?.audience !== 'tenant') throw new Error('AUTH_REQUIRED');
        state.csrf = session.csrfToken;
      }
      if (body) headers['X-CSRF-Token'] = state.csrf;
    }
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(root + path, { method, credentials: 'same-origin', cache: 'no-store', headers, body: body ? JSON.stringify(body) : undefined });
    let result;
    try { result = await response.json(); } catch { throw new Error('SERVER_ERROR'); }
    if (!response.ok || result.success === false) throw new Error(result.code || 'REQUEST_FAILED');
    return result.data;
  }
  function pageKey() { return new URLSearchParams(location.search).get('page') || ''; }
  function isFlowPage() {
    if (location.pathname.replace(/\/$/, '') !== '/user') return false;
    const page = pageKey().toLowerCase();
    return ['automation-flows', 'automation_flows', 'automation', 'chat-flow'].includes(page) ||
      (document.querySelector('.react-flow') && /automation flows|تدفقات الأتمتة/i.test(document.body.innerText || ''));
  }
  function isAssignmentPage() {
    return location.pathname.replace(/\/$/, '') === '/user' && ['wa-chatbot','wa_chatbot'].includes(pageKey().toLowerCase());
  }
  let nativeAddButtonRef = null;
  let nativeProfileListRequest = null;
  function mountNativeProfileList() {
    if (!isAssignmentPage()) return;
    const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(node => node.textContent.trim() === 'WA Chatbot');
    if (!heading) return;
    const header = heading.parentElement?.parentElement?.parentElement;
    if (!header) return;
    let section = document.getElementById('sx-native-chatbot-profiles');
    if (!section) {
      section = document.createElement('section');
      section.id = 'sx-native-chatbot-profiles';
      section.setAttribute('aria-label', tr('Chatbot profiles','ملفات روبوتات المحادثة'));
      header.insertAdjacentElement('afterend', section);
    }
    if (section.dataset.loaded === '1' || nativeProfileListRequest) return;
    nativeProfileListRequest = Promise.all([api(''), api('/channels')]).then(([result, connected]) => {
      const bots = result?.items || [];
      const channelNames = new Map((connected || []).map(channel => [`${channel.kind}|${channel.reference}`, channel.label || channelLabel(channel)]));
      if (!section.isConnected) { nativeProfileListRequest = null; window.setTimeout(mountNativeProfileList, 0); return; }
      nativeProfileListRequest = null;
      if (!bots.length) { section.remove(); return; }
      const numberFor = bot => (bot.channels || []).map(channel => channel.kind === 'whatsapp_meta' ? tr('Meta WhatsApp','واتساب ميتا') : channelNames.get(`${channel.kind}|${channel.reference}`) || tr('Number label unavailable','اسم الرقم غير متاح')).join(', ') || tr('Not assigned','غير معيّن');
      section.innerHTML = `<div style="margin-top:20px;border:1px solid #e4e7ec;border-radius:12px;background:#fff;overflow:hidden"><div style="padding:16px 18px;border-bottom:1px solid #eaecf0;font-size:16px;font-weight:600;color:#182230">${esc(tr('Chatbots','روبوتات المحادثة'))}</div><div style="display:grid">${bots.map((bot,index) => `<article style="display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 18px;${index?'border-top:1px solid #eaecf0;':''}"><div style="min-width:0"><div style="font-weight:600;color:#182230">${esc(bot.name)}</div><div style="margin-top:5px;color:#667085;font-size:13px">${esc(numberFor(bot))}</div></div><div style="display:flex;align-items:center;gap:10px;flex-shrink:0"><span style="padding:5px 10px;border-radius:999px;background:${bot.status==='live'?'#ecfdf3':'#f2f4f7'};color:${bot.status==='live'?'#027a48':'#475467'};font-size:12px">${esc(engineLabel(bot.engine))} · ${esc(statusLabel(bot.status))}</span><button type="button" data-sx-manage-profile="${esc(bot.id)}" style="border:1px solid #d0d5dd;border-radius:8px;padding:8px 12px;background:#fff;color:#344054;font-weight:600;cursor:pointer">${esc(tr('Assign','تعيين'))}</button></div></article>`).join('')}</div></div>`;
      const emptyHeading = [...document.querySelectorAll('h6')].find(node => node.textContent.trim() === 'No Chatbots Yet');
      if (emptyHeading?.parentElement) emptyHeading.parentElement.style.display = 'none';
      section.dataset.loaded = '1';
      section.querySelectorAll('[data-sx-manage-profile]').forEach(button => button.addEventListener('click', () => {
        const bot = bots.find(item => item.id === button.dataset.sxManageProfile);
        if (bot) { state.nativeSelectedBotId = bot.id; openNativeAssignmentDialog(); }
      }));
      nativeProfileListRequest = null;
    }).catch(error => {
      nativeProfileListRequest = null;
      if (section.isConnected) section.innerHTML = `<div role="alert" style="margin-top:16px;color:#b42318">${esc(errorLabel(error.message))}</div>`;
    });
  }
  function mountNativeAssignmentButton() {
    const addButton = [...document.querySelectorAll('button')].find(button => visible(button) && /^(?:Add Chatbot|إضافة روبوت محادثة)$/i.test(button.textContent.trim()));
    if (!addButton || addButton.dataset.sxBotPickerHooked) return;
    nativeAddButtonRef = addButton;
    addButton.dataset.sxBotPickerHooked = '1';
    addButton.addEventListener('click', event => {
      if (addButton.dataset.sxOpenLegacyOnce === '1') { delete addButton.dataset.sxOpenLegacyOnce; return; }
      event.preventDefault(); event.stopImmediatePropagation(); openNativeAssignmentDialog();
    }, true);
  }
  async function openNativeAssignmentDialog() {
    addStyle();
    const dialog = document.createElement('div'); dialog.id = 'sx-chatbot-dialog';
    dialog.innerHTML = `<section class="sx-dialog" role="dialog" aria-modal="true" aria-labelledby="sx-native-assignment-title" style="width:min(600px,100%);padding:0;border-radius:20px;overflow:visible"><header style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:#fff7fa;border-bottom:1px solid #eaecf0;border-radius:20px 20px 0 0"><div style="display:flex;align-items:center;gap:12px"><span style="display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:#b0004b;color:#fff;box-shadow:0 4px 9px #b0004b33"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M9 4h6M12 4v4M8 13h.01M16 13h.01M9 17h6"/></svg></span><h2 id="sx-native-assignment-title" style="margin:0;font-size:16px;font-weight:600">${esc(tr('Add Chatbot','إضافة روبوت محادثة'))}</h2></div><button type="button" data-close aria-label="${esc(tr('Close','إغلاق'))}" style="border:0;border-radius:50%;width:32px;height:32px;background:#f2f4f7;color:#667085;font-size:20px;cursor:pointer">×</button></header><div style="padding:14px 18px 18px"><div style="display:grid;gap:14px"><label class="sx-full" style="display:grid;gap:6px;color:#667085;font-size:14px;font-weight:400">${esc(tr('Title','العنوان'))}<input data-title readonly placeholder="${esc(tr('Enter webhook title...','أدخل عنوان webhook...'))}" style="height:38px;padding:9px 11px;border:1px solid #d0d5dd;border-radius:8px;font:14px Roboto,Arial,sans-serif;color:#182230;background:#fff"></label><label class="sx-full" style="display:grid;gap:6px;color:#667085;font-size:14px;font-weight:400">${esc(tr('Select Origin','اختر المصدر'))}<span style="position:relative;display:flex;align-items:center"><span data-origin-icon style="position:absolute;left:12px;z-index:1;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#b0004b;color:#fff;font-size:12px;font-weight:700">f</span><select data-origin style="height:38px;padding:8px 36px;border:1px solid #d0d5dd;border-radius:8px;background:#fff;font:14px Roboto,Arial,sans-serif;color:#182230"><option value="">${esc(tr('Loading connected numbers…','جارٍ تحميل الأرقام المتصلة…'))}</option></select></span></label><label class="sx-full" style="display:grid;gap:6px;color:#667085;font-size:14px;font-weight:400">${esc(tr('Select Automation Flow','اختر تدفق الأتمتة'))}<span data-picker style="position:relative;display:block"><input data-search type="text" autocomplete="off" placeholder="${esc(tr('Search flows...','ابحث عن التدفقات...'))}" aria-haspopup="listbox" aria-expanded="false" aria-controls="sx-chatbot-profile-options" style="height:38px;padding:9px 34px 9px 12px;border:1px solid #b0004b;border-radius:8px;outline:none;font:14px Roboto,Arial,sans-serif;color:#182230;background:#fff"><span aria-hidden="true" style="position:absolute;right:14px;top:13px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:5px solid #888"></span><div id="sx-chatbot-profile-options" data-options role="listbox" hidden style="position:absolute;z-index:2;top:calc(100% + 3px);left:0;right:0;max-height:180px;overflow:auto;background:#fff;border:1px solid #eaecf0;border-radius:9px;box-shadow:0 4px 9px #1018280d;padding:4px 0"></div></span></label></div><div data-assignment-note hidden style="color:#667085;font-size:12px;margin-top:9px"></div><div class="sx-error" role="alert" style="color:#b42318;font-size:13px;margin-top:8px"></div><div class="sx-footer" style="display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #eaecf0;padding-top:16px;margin-top:10px"><button type="button" class="sx-secondary" data-close style="border:1px solid #b0004b;border-radius:8px;background:#fff;color:#b0004b;padding:9px 13px;font-size:12px">${esc(tr('Cancel','إلغاء'))}</button><button type="button" class="sx-primary" data-save style="border:0;border-radius:8px;background:#b0004b;color:#fff;padding:9px 15px;font-size:12px">${esc(tr('Save Changes','حفظ التغييرات'))}</button></div></div></section>`;
    document.body.append(dialog);
    const closeDialog = () => dialog.remove();
    dialog.querySelectorAll('[data-close]').forEach(button => { button.onclick = closeDialog; });
    const originSelect = dialog.querySelector('[data-origin]');
    const searchInput = dialog.querySelector('[data-search]');
    const options = dialog.querySelector('[data-options]');
    const titleInput = dialog.querySelector('[data-title]');
    const assignmentNote = dialog.querySelector('[data-assignment-note]');
    const originIcon = dialog.querySelector('[data-origin-icon]');
    const saveButton = dialog.querySelector('[data-save]');
    let bots = [], channels = [];
    let selectedBotId = state.nativeSelectedBotId || '';
    const closeOptions = () => { options.hidden = true; searchInput.setAttribute('aria-expanded','false'); };
    const renderBotOptions = (open = false) => {
      const query = searchInput.value.trim().toLocaleLowerCase();
      const matches = bots.filter(bot => `${bot.name} ${engineLabel(bot.engine)} ${statusLabel(bot.status)}`.toLocaleLowerCase().includes(query));
      options.innerHTML = matches.length ? matches.map(bot => `<button type="button" role="option" aria-selected="${selectedBotId===bot.id}" data-bot-option="${esc(bot.id)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;text-align:start;border:0;background:${selectedBotId===bot.id?'#fff5f8':'#fff'};padding:11px 14px;color:#182230;font:14px Roboto,Arial,sans-serif;cursor:pointer"><span>${esc(bot.name)}</span><span style="color:#667085;font-size:12px;white-space:nowrap">${esc(engineLabel(bot.engine))} · ${esc(statusLabel(bot.status))}</span></button>`).join('') : `<div class="sx-muted" style="padding:13px 15px;color:#667085;font-size:14px">${esc(bots.length ? tr('No bots match this search','لا توجد روبوتات تطابق البحث') : tr('No bots found','لم يتم العثور على روبوتات'))}</div>`;
      if (open) { options.hidden = false; searchInput.setAttribute('aria-expanded','true'); }
      options.querySelectorAll('[data-bot-option]').forEach(option => option.addEventListener('click', () => {
        selectedBotId = option.dataset.botOption;
        const bot = bots.find(item => item.id === selectedBotId);
        searchInput.value = bot?.name || ''; titleInput.value = bot?.name || ''; closeOptions(); renderAssignmentState(true);
      }));
    };
    const renderAssignmentState = (preferExistingAssignment = false) => {
      const bot = bots.find(item => item.id === selectedBotId);
      titleInput.value = bot?.name || '';
      const assigned = new Set((bot?.channels || []).map(item => `${item.kind}|${item.reference}`));
      const usedByOther = new Set(bot ? bots.filter(item => item.id !== bot.id).flatMap(item => (item.channels || []).map(channel => `${channel.kind}|${channel.reference}`)) : []);
      const selectedChannel = originSelect.value;
      originSelect.innerHTML = `<option value="">${esc(tr('Select a connected number','اختر رقمًا متصلاً'))}</option>` + channels.map(channel => {
        const key = `${channel.kind}|${channel.reference}`;
        const blocked = usedByOther.has(key);
        const label = channel.kind === 'whatsapp_meta' ? tr('Meta','ميتا') : (channel.label || channelLabel(channel));
        return `<option value="${esc(key)}" ${assigned.has(key)?'selected':''} ${blocked?'disabled':''}>${esc(label)}${blocked?` · ${esc(tr('Assigned to another bot','مُعيّن لروبوت آخر'))}`:''}</option>`;
      }).join('');
      const existingAssignment = bot?.channels.find(channel => [...originSelect.options].some(option => option.value === `${channel.kind}|${channel.reference}` && !option.disabled));
      if (preferExistingAssignment && existingAssignment) originSelect.value = `${existingAssignment.kind}|${existingAssignment.reference}`;
      else if (selectedChannel && [...originSelect.options].some(option => option.value === selectedChannel && !option.disabled)) originSelect.value = selectedChannel;
      else if (existingAssignment) {
        originSelect.value = `${existingAssignment.kind}|${existingAssignment.reference}`;
      }
      originIcon.textContent = originSelect.value.startsWith('whatsapp_meta|') ? 'f' : '◉';
      assignmentNote.hidden = !bot;
      const alreadyAssigned = !!bot && assigned.has(originSelect.value);
      assignmentNote.textContent = bot?.status === 'live' && !alreadyAssigned
        ? tr('This bot is active. Pause it before changing its number assignment.','هذا الروبوت نشط. أوقفه قبل تغيير تعيين الرقم.')
        : (alreadyAssigned ? tr('This bot is already assigned to this number.','هذا الروبوت مُعيّن بالفعل لهذا الرقم.') : (bot ? `${engineLabel(bot.engine)} · ${statusLabel(bot.status)}` : ''));
      saveButton.disabled = !bot || !originSelect.value || (bot.status === 'live' && !alreadyAssigned) || originSelect.selectedOptions[0]?.disabled === true;
      saveButton.style.background = saveButton.disabled ? '#e4e7ec' : '#b0004b';
      saveButton.style.color = saveButton.disabled ? '#98a2b3' : '#fff';
    };
    searchInput.addEventListener('focus', () => renderBotOptions(true));
    searchInput.addEventListener('click', () => renderBotOptions(true));
    searchInput.addEventListener('input', () => renderBotOptions(true));
    dialog.addEventListener('click', event => { if (!dialog.querySelector('[data-picker]').contains(event.target)) closeOptions(); });
    originSelect.addEventListener('change', renderAssignmentState);
    try {
      const [result, connected] = await Promise.all([api(''), api('/channels')]);
      bots = result.items || []; channels = connected || [];
      state.nativeSelectedBotId = '';
      renderBotOptions(true);
      originSelect.innerHTML = `<option value="">${esc(tr('Select a connected number','اختر رقمًا متصلاً'))}</option>` + channels.map(channel => `<option value="${esc(channel.kind)}|${esc(channel.reference)}">${esc(channel.label || channelLabel(channel))}</option>`).join('');
      const firstOrigin = channels.find(channel => channel.kind === 'whatsapp_meta') || channels[0];
      if (firstOrigin) originSelect.value = `${firstOrigin.kind}|${firstOrigin.reference}`;
      if (!channels.length) { originSelect.disabled = true; }
      if (selectedBotId && bots.some(bot => bot.id === selectedBotId)) { searchInput.value = bots.find(bot => bot.id === selectedBotId).name; renderAssignmentState(true); }
      else renderAssignmentState();
    } catch (error) {
      dialog.querySelector('.sx-error').textContent = errorLabel(error.message);
      searchInput.disabled = true; originSelect.disabled = true; saveButton.disabled = true;
    }
    saveButton.onclick = async event => {
      const button = event.currentTarget; button.disabled = true;
      const errorBox = dialog.querySelector('.sx-error'); errorBox.textContent = '';
      const bot = bots.find(item => item.id === selectedBotId);
      if (!bot) { errorBox.textContent = tr('Create a bot in Automation Flows first.','أنشئ روبوتًا في تدفقات الأتمتة أولاً.'); button.disabled = false; return; }
      if (bot.status === 'live') {
        const alreadyAssigned = (bot.channels || []).some(channel => channel.kind === originSelect.value.split('|')[0] && channel.reference === originSelect.value.split('|').slice(1).join('|'));
        if (alreadyAssigned) { closeDialog(); return; }
        errorBox.textContent = errorLabel('LIVE_BOT_MUST_BE_PAUSED'); button.disabled = false; return;
      }
      if (!originSelect.value) { errorBox.textContent = tr('Select a connected number.','اختر رقمًا متصلاً.'); button.disabled = false; return; }
      const [kind, ...parts] = originSelect.value.split('|');
      const reference = parts.join('|');
      const channelsForBot = (bot.channels || []).filter(item => item.kind !== kind).map(item => ({ kind:item.kind, reference:item.reference }));
      channelsForBot.push({ kind, reference });
      try {
        await api(`/${bot.id}/channels`, 'PUT', { expectedRevision:Number(bot.revision), channels:channelsForBot });
        nativeProfileListRequest = null;
        const oldList = document.getElementById('sx-native-chatbot-profiles');
        if (oldList) { oldList.dataset.loaded = ''; oldList.innerHTML = ''; }
        mountNativeProfileList();
        closeDialog();
      } catch (error) { errorBox.textContent = errorLabel(error.message); button.disabled = false; }
    };
  }
  function isInboxPage() {
    if (location.pathname.replace(/\/$/, '') !== '/user') return false;
    return ['inbox', 'chat', 'conversations'].includes(pageKey().toLowerCase()) ||
      (!!document.querySelector('[data-chat-id],[data-chat_id],[data-conversation-id]') && /inbox|صندوق الوارد/i.test(document.body.innerText || ''));
  }
  function visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; }
  function bounds() {
    const drawer = [...document.querySelectorAll('.MuiDrawer-paper')].find(visible);
    const topbar = [...document.querySelectorAll('.MuiBox-root')].filter(el => {
      const r = el.getBoundingClientRect(); return visible(el) && r.y <= 5 && r.height >= 30 && r.height < 100 && r.width > innerWidth * .5;
    }).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0];
    return { left: Math.max(0, drawer?.getBoundingClientRect().right || 260), right: 0, top: Math.max(0, topbar?.getBoundingClientRect().bottom || 68) };
  }
  function addStyle() {
    if (document.getElementById('sx-chatbot-admin-style')) return;
    const style = document.createElement('style'); style.id = 'sx-chatbot-admin-style';
    style.textContent = `
      #sx-chatbot-tabs{position:fixed;z-index:1200;display:flex;align-items:center;gap:4px;padding:6px;background:#fff;border:1px solid #e4e7ec;border-radius:999px;box-shadow:0 3px 14px #10182818;width:min(790px,calc(100vw - 300px));}
      #sx-chatbot-tabs button{flex:1;min-width:0;border:0;background:transparent;border-radius:999px;padding:11px 14px;color:#273142;font:600 14px Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap}
      #sx-chatbot-tabs button[aria-selected=true]{background:#fff0f5;color:#a8003b}
      #sx-chatbot-tabs .sx-legacy-tag{margin-left:5px;padding:3px 8px;border-radius:20px;background:#eef0f4;color:#667085;font-size:11px}
      #sx-chatbot-panel{position:fixed;z-index:1150;overflow:auto;background:#f7f8fa;color:#182230;padding:24px 30px 40px;font:14px/1.45 Roboto,Arial,sans-serif;box-sizing:border-box}
      #sx-chatbot-panel *{box-sizing:border-box} #sx-chatbot-panel h1{font-size:26px;margin:0 0 5px;color:#101828} #sx-chatbot-panel .sx-muted{color:#667085}
      #sx-chatbot-panel .sx-card{background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:18px;margin-top:18px;box-shadow:0 1px 2px #1018280a}
      #sx-chatbot-panel .sx-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;flex-wrap:wrap}
      #sx-chatbot-panel .sx-primary{border:0;border-radius:9px;padding:11px 17px;background:#a8003b;color:white;font-weight:700;cursor:pointer}
      #sx-chatbot-panel .sx-secondary,#sx-chatbot-panel .sx-row-button{border:1px solid #d0d5dd;background:white;color:#344054;border-radius:8px;padding:8px 11px;cursor:pointer;font-weight:600}
      #sx-chatbot-panel .sx-row-button.sx-live{border-color:#a6f4c5;color:#067647;background:#ecfdf3} #sx-chatbot-panel .sx-row-button.sx-danger{color:#b42318}
      #sx-chatbot-panel .sx-table-wrap{overflow:auto;border:1px solid #eaecf0;border-radius:10px} #sx-chatbot-panel table{width:100%;border-collapse:collapse;min-width:850px}
      #sx-chatbot-panel th,#sx-chatbot-panel td{text-align:left;padding:13px 12px;border-bottom:1px solid #eaecf0;vertical-align:middle} #sx-chatbot-panel th{background:#f9fafb;color:#667085;font-size:12px}
      #sx-chatbot-panel tr:last-child td{border-bottom:0} #sx-chatbot-panel .sx-bot-name{font-weight:700;color:#182230} #sx-chatbot-panel .sx-bot-desc{max-width:260px;color:#667085;font-size:12px}
      #sx-chatbot-panel .sx-badge{display:inline-flex;padding:5px 9px;border-radius:20px;background:#fce7ef;color:#a8003b;font-size:12px;font-weight:700;white-space:nowrap}
      #sx-chatbot-panel .sx-status{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:5px 10px;background:#ecfdf3;color:#067647;font-size:12px;font-weight:700} #sx-chatbot-panel .sx-status:before{content:'';width:8px;height:8px;border-radius:50%;background:#12b76a}
      #sx-chatbot-panel .sx-status[data-status=draft],#sx-chatbot-panel .sx-status[data-status=testing]{background:#f2f4f7;color:#475467} #sx-chatbot-panel .sx-status[data-status=draft]:before,#sx-chatbot-panel .sx-status[data-status=testing]:before{background:#98a2b3}
      #sx-chatbot-panel .sx-alert{padding:12px 14px;border-radius:9px;background:#eff8ff;color:#175cd3;border:1px solid #b2ddff;margin-top:16px}
      #sx-chatbot-dialog{position:fixed;z-index:2147483000;inset:0;background:#10182880;display:grid;place-items:center;padding:18px}
      #sx-chatbot-dialog .sx-dialog{width:min(760px,100%);max-height:92vh;overflow:auto;background:#fff;color:#182230;border-radius:16px;padding:24px;box-shadow:0 20px 70px #10182840}
      #sx-chatbot-dialog h2{margin:0 0 6px;font-size:22px;color:#101828} #sx-chatbot-dialog .sx-muted{color:#667085} #sx-chatbot-dialog .sx-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;margin-top:18px}
      #sx-chatbot-dialog label{display:grid;gap:6px;color:#344054;font-weight:600} #sx-chatbot-dialog label.sx-full{grid-column:1/-1}
      #sx-chatbot-dialog input,#sx-chatbot-dialog select,#sx-chatbot-dialog textarea{width:100%;border:1px solid #d0d5dd;border-radius:8px;padding:10px 11px;font:14px Roboto,Arial,sans-serif;color:#182230;background:#fff}
      #sx-chatbot-dialog textarea{min-height:78px;resize:vertical} #sx-chatbot-dialog .sx-checks{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
      #sx-chatbot-dialog .sx-checks label{display:flex;align-items:center;gap:7px;border:1px solid #eaecf0;border-radius:8px;padding:8px;font-weight:500}
      #sx-chatbot-dialog .sx-preview{grid-column:1/-1;border:1px solid #e4e7ec;border-radius:10px;background:#f9fafb;padding:14px} #sx-chatbot-dialog .sx-preview-title{font-weight:700;color:#182230} #sx-chatbot-dialog .sx-preview-note{margin:5px 0 10px;font-size:12px;color:#667085}
      #sx-chatbot-dialog .sx-preview-result{margin-top:10px;padding:10px;border-radius:8px;background:white;border:1px solid #eaecf0;white-space:pre-wrap;min-height:22px}
      #sx-chatbot-dialog .sx-guided-preview{grid-column:1/-1;border:1px solid #d0d5dd;border-radius:11px;background:#f9fafb;padding:14px} #sx-chatbot-dialog .sx-guided-preview-title{font-weight:700;color:#182230} #sx-chatbot-dialog .sx-guided-preview-note{margin:4px 0 10px;color:#667085;font-size:12px} #sx-chatbot-dialog .sx-guided-transcript{display:flex;flex-direction:column;gap:8px;min-height:130px;max-height:260px;overflow:auto;padding:12px;border:1px solid #eaecf0;border-radius:9px;background:#fff} #sx-chatbot-dialog .sx-guided-bubble{max-width:85%;padding:9px 11px;border-radius:12px;background:#f2f4f7;white-space:pre-wrap;overflow-wrap:anywhere;font-weight:400} #sx-chatbot-dialog .sx-guided-bubble[data-role=user]{align-self:flex-end;background:#fce7ef;color:#7a1238} #sx-chatbot-dialog .sx-guided-bubble[data-role=bot]{align-self:flex-start} #sx-chatbot-dialog .sx-guided-preview-controls{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;margin-top:9px} #sx-chatbot-dialog .sx-guided-preview-status{min-height:18px;margin-top:6px;font-size:12px;color:#667085}
      #sx-chatbot-dialog .sx-guide-content{grid-column:1/-1;border:1px solid #f0d1dc;border-radius:11px;background:#fff9fb;padding:14px}
      #sx-chatbot-dialog .sx-guide-heading{font-weight:700;color:#a8003b} #sx-chatbot-dialog .sx-guide-help{margin:4px 0 12px;color:#667085;font-size:12px}
      #sx-chatbot-dialog .sx-guide-catalogue-link{display:inline-flex;align-items:center;gap:6px;margin:0 0 8px;color:#a8003b;font-weight:700;text-decoration:none}
      #sx-chatbot-dialog .sx-guide-catalogue-link:hover{text-decoration:underline}
      #sx-chatbot-dialog .sx-guide-group{border:1px solid #eaecf0;border-radius:9px;background:#fff;padding:10px 12px;margin:9px 0}
      #sx-chatbot-dialog .sx-guide-group legend{padding:0 5px;color:#344054;font-weight:700}
      #sx-chatbot-dialog .sx-guide-fields{display:grid;gap:11px}
      #sx-chatbot-dialog .sx-guide-field-title{display:block;margin:3px 0 6px;color:#344054;font-weight:600}
      #sx-chatbot-dialog .sx-language-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
      #sx-chatbot-dialog .sx-language-pair label{font-size:12px;color:#667085}
      #sx-chatbot-dialog .sx-language-pair textarea{min-height:58px;font-size:13px;font-weight:400}
      #sx-chatbot-dialog .sx-guide-toggle{display:flex;align-items:flex-start;gap:8px;font-weight:500!important}
      #sx-chatbot-dialog .sx-guide-toggle input{width:auto;margin:2px 0 0;accent-color:#a8003b}
      #sx-chatbot-dialog [data-guide-content][hidden]{display:none}
      #sx-chatbot-dialog .sx-footer{display:flex;justify-content:flex-end;gap:9px;margin-top:20px} #sx-chatbot-dialog .sx-primary{border:0;border-radius:9px;padding:11px 17px;background:#a8003b;color:#fff;font-weight:700;cursor:pointer} #sx-chatbot-dialog .sx-secondary{border:1px solid #d0d5dd;background:#fff;color:#344054;border-radius:8px;padding:10px 14px;cursor:pointer;font-weight:600} #sx-chatbot-dialog .sx-error{color:#b42318;margin-top:10px;white-space:pre-wrap}
      #sx-active-chatbot-control{position:relative;z-index:2;display:flex;align-items:center;flex:0 1 auto;min-width:0;max-width:min(34vw,440px);margin-inline-start:auto;padding:4px 6px;gap:7px;border:1px solid #edbfd0;border-radius:9px;background:#fff;color:#344054;font:500 12px/1.25 Roboto,Arial,sans-serif;box-shadow:none;box-sizing:border-box}
      #sx-active-chatbot-control [data-sx-chatbot-mobile-toggle]{display:none}
      #sx-active-chatbot-control [data-sx-chatbot-control-body]{display:flex;align-items:center;min-width:0;gap:7px}
      #sx-active-chatbot-control [data-sx-chatbot-mobile-heading]{display:none}
      #sx-active-chatbot-control [data-sx-chatbot-control-body] label{display:flex;align-items:center;gap:6px;min-width:0;font-weight:500;white-space:nowrap}
      #sx-active-chatbot-control [data-sx-chatbot-control-body] select{width:min(220px,18vw);min-width:120px;max-width:220px;border:1px solid #d0d5dd;border-radius:7px;padding:5px 7px;background:#fff;color:#344054;font:500 12px Roboto,Arial,sans-serif}
      #sx-active-chatbot-control [data-sx-chatbot-state]{min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#667085;font-size:11px}
      #sx-active-chatbot-control [data-sx-chatbot-toggle]{flex:0 0 auto;border:1px solid #edbfd0;background:#fff2f6;color:#a8003b;border-radius:7px;padding:5px 8px;font:600 11px Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap}
      #sx-active-chatbot-control [data-sx-chatbot-toggle]:disabled{opacity:.6;cursor:wait}
      @media(max-width:767px){
        #sx-active-chatbot-control{position:relative;z-index:1300;max-width:none;min-width:0;margin:0;padding:0;border:0;background:transparent}
        #sx-active-chatbot-control.sx-mobile-open{display:flex;flex-direction:column;align-items:stretch;width:auto;margin:8px 12px;padding:10px;border:1px solid #edbfd0;border-radius:12px;background:#fff;box-shadow:0 3px 14px #10182818}
        #sx-active-chatbot-control [data-sx-chatbot-mobile-toggle]{display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:34px;padding:0 9px;border:1px solid #edbfd0;border-radius:9px;background:#fff2f6;color:#a8003b;font:600 12px Roboto,Arial,sans-serif;cursor:pointer;white-space:nowrap}
        #sx-active-chatbot-control [data-sx-chatbot-control-body]{position:absolute;top:calc(100% + 8px);inset-inline-end:0;display:flex;flex-wrap:wrap;width:min(340px,calc(100vw - 24px));padding:12px;gap:9px;border:1px solid #edbfd0;border-radius:12px;background:#fff;box-shadow:0 8px 28px #10182826}
        #sx-active-chatbot-control.sx-mobile-open [data-sx-chatbot-control-body]{position:static;width:auto;max-width:none;padding:9px 0 0;gap:9px;border:0;border-radius:0;background:transparent;box-shadow:none}
        #sx-active-chatbot-control:not(.sx-mobile-open) [data-sx-chatbot-control-body]{display:none}
        #sx-active-chatbot-control [data-sx-chatbot-control-body] label{flex:1 1 100%;justify-content:space-between;white-space:normal}
        #sx-active-chatbot-control [data-sx-chatbot-mobile-heading]{display:block;flex:1 1 100%;font-size:13px;font-weight:700;color:#344054}
        #sx-active-chatbot-control [data-sx-chatbot-control-body] select{width:auto;min-width:0;max-width:70%;flex:1}
        #sx-active-chatbot-control [data-sx-chatbot-state]{flex:1 1 100%;max-width:none;white-space:normal}
      }
      html[data-sx-chatbot-theme="dark"] #sx-active-chatbot-control,html[data-sx-chatbot-theme="dark"] #sx-active-chatbot-control [data-sx-chatbot-control-body]{background:#191c24;border-color:#4b3040;color:#e4e7ec}
      html[data-sx-chatbot-theme="dark"] #sx-active-chatbot-control [data-sx-chatbot-mobile-toggle],html[data-sx-chatbot-theme="dark"] #sx-active-chatbot-control [data-sx-chatbot-toggle]{background:#3b1728;border-color:#70415a;color:#ffb5ce}
      html[data-sx-chatbot-theme="dark"] #sx-active-chatbot-control [data-sx-chatbot-control-body] select{background:#20232c;border-color:#444955;color:#e4e7ec}
      html[data-sx-chatbot-theme="dark"] #sx-active-chatbot-control [data-sx-chatbot-state]{color:#aab1bd}
      html[data-sx-chatbot-theme="dark"] #sx-active-chatbot-control [data-sx-chatbot-mobile-heading]{color:#e4e7ec}
      [data-sx-chatbot-control]{border:1px solid #edbfd0;background:#fff2f6;color:#a8003b;border-radius:7px;padding:6px 9px;font:600 12px Roboto,Arial,sans-serif;cursor:pointer}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-tabs{background:#191b22;border-color:#343741;box-shadow:0 3px 14px #0008}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-tabs button{color:#e4e7ec}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-tabs button[aria-selected=true]{background:#3b1728;color:#ffb5ce}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-tabs .sx-legacy-tag{background:#343741;color:#d0d5dd}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel{background:#111319;color:#f2f4f7}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel h1,html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-bot-name{color:#f2f4f7}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-muted,html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-bot-desc{color:#aab1bd}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-card{background:#191c24;border-color:#343741;box-shadow:0 1px 2px #0004}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-secondary,html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-row-button{background:#20232c;border-color:#444955;color:#e4e7ec}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-row-button.sx-live{background:#123126;border-color:#216e4b;color:#75d9a4}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-row-button.sx-danger{color:#ff9daf}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-table-wrap{border-color:#343741}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel th,html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel td{border-color:#343741}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel th{background:#20232c;color:#aab1bd}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-badge{background:#3b1728;color:#ffb5ce}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-status{background:#123126;color:#75d9a4}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-status[data-status=draft],html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-status[data-status=testing]{background:#343741;color:#d0d5dd}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-status[data-status=draft]:before,html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-status[data-status=testing]:before{background:#98a2b3}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-panel .sx-alert{background:#142439;border-color:#244c72;color:#9bc8ff}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-dialog{background:#191c24;color:#f2f4f7}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog h2,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-preview-title,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guided-preview-title{color:#f2f4f7}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-muted,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-preview-note,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guided-preview-note,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guide-help,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-language-pair label{color:#aab1bd}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog label{color:#e4e7ec}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog input,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog select,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog textarea{background:#20232c;border-color:#444955;color:#f2f4f7;color-scheme:dark}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog input::placeholder,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog textarea::placeholder{color:#98a2b3}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-checks label{border-color:#343741}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-preview,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guided-preview{background:#20232c;border-color:#444955}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-preview-result,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guided-transcript{background:#15171d;border-color:#343741;color:#f2f4f7}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guided-bubble{background:#2a2e38;color:#f2f4f7}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guided-bubble[data-role=user]{background:#3b1728;color:#ffd6e2}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guide-content{background:#251923;border-color:#593047}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guide-heading,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guide-catalogue-link{color:#ffb5ce}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guide-group{background:#20232c;border-color:#343741}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guide-group legend,html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-guide-field-title{color:#e4e7ec}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-secondary{background:#20232c;border-color:#444955;color:#e4e7ec}
      html[data-sx-chatbot-theme="dark"] #sx-chatbot-dialog .sx-error{color:#ff9daf}
      html[data-sx-chatbot-theme="dark"] [data-sx-chatbot-control]{background:#3b1728;border-color:#593047;color:#ffb5ce}
      @media(max-width:760px){#sx-chatbot-tabs{width:calc(100vw - 20px);left:10px!important;overflow:auto}#sx-chatbot-tabs button{font-size:12px;padding:10px 9px}#sx-chatbot-panel{padding:18px 14px 30px}#sx-chatbot-dialog .sx-form-grid{grid-template-columns:1fr}#sx-chatbot-dialog label.sx-full{grid-column:auto}#sx-chatbot-dialog .sx-guide-content{grid-column:auto}#sx-chatbot-dialog .sx-language-pair{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }
  function closeViews() { document.getElementById('sx-chatbot-tabs')?.remove(); document.getElementById('sx-chatbot-panel')?.remove(); }
  function renderAssignments() {
    syncChatbotTheme(); addStyle();
    const pos = bounds(); let panel = document.getElementById('sx-chatbot-panel');
    if (!panel) { panel = document.createElement('main'); panel.id = 'sx-chatbot-panel'; document.body.append(panel); }
    panel.style.left = `${pos.left}px`; panel.style.right = `${pos.right}px`; panel.style.top = `${pos.top}px`;
    panel.style.width = `${Math.max(0, innerWidth-pos.left-pos.right)}px`; panel.style.height = `${Math.max(0, innerHeight-pos.top)}px`;
    if (['loading','ready','error'].includes(panel.dataset.assignmentPage)) return;
    panel.dataset.assignmentPage = 'loading'; panel.innerHTML = `<div class="sx-muted">${esc(tr('Loading bots…','جارٍ تحميل الروبوتات…'))}</div>`;
    Promise.all([api(''), api('/channels')]).then(([bots, channels]) => {
      state.bots = bots.items || []; state.categoryKey = bots.category || 'training_center'; state.categoryTitle = bots.categoryTitle || null; state.categoryVersion = Number(bots.categoryVersion) || 1; state.guidedContentDefaults = bots.guidedContentDefaults || null; state.guidedContentSchema = bots.guidedContentSchema || null; state.channels = channels || [];
      if (!panel.isConnected || !isAssignmentPage()) return;
      const rows = state.bots.map(bot => {
        const assigned = bot.channels || [];
        const numbers = assigned.length ? assigned.map(channel => `<div>${esc(channel.kind==='whatsapp_meta'?'Meta WhatsApp':'QR WhatsApp')} · ${esc(channelLabel(state.channels.find(item=>item.kind===channel.kind&&item.reference===channel.reference)||channel))}</div>`).join('') : `<span class="sx-muted">${esc(tr('Not assigned','غير مرتبط'))}</span>`;
        return `<tr><td><div class="sx-bot-name">${esc(bot.name)}</div><div class="sx-bot-desc">${esc(botDescription(bot))}</div></td><td><span class="sx-badge">${esc(engineLabel(bot.engine))}</span></td><td><span class="sx-status" data-status="${esc(bot.status)}">${esc(statusLabel(bot.status))}</span></td><td>${numbers}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap">${bot.status==='live'?`<button class="sx-row-button" data-assignment-status="${esc(bot.id)}">${esc(tr('Pause bot','إيقاف الروبوت'))}</button>`:''}<button class="sx-row-button" data-manage-assignment="${esc(bot.id)}" ${bot.status==='live'?'disabled title="Pause this bot before changing its assignment"':''}>${esc(tr(bot.status==='live'?'Reassign after pause':'Manage assignment',bot.status==='live'?'أعد التعيين بعد الإيقاف':'إدارة التعيين'))}</button></div></td></tr>`;
      }).join('');
      panel.innerHTML = `<header><h1>${esc(tr('Chatbot','روبوت المحادثة'))}</h1><div class="sx-muted">${esc(tr('Manage all Guided, Hybrid AI and AI bots. Configure them in Automation Flows, then assign connected numbers here.','إدارة جميع الروبوتات الموجّهة والهجينة والذكية. اضبطها في تدفقات الأتمتة ثم عيّن الأرقام المتصلة هنا.'))}</div></header><section class="sx-card"><div class="sx-toolbar"><strong>${esc(tr('All bots','كل الروبوتات'))}</strong><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="sx-secondary" id="sx-configure-bots">${esc(tr('Configure bots','إعداد الروبوتات'))}</button><button type="button" class="sx-secondary" id="sx-open-legacy-chatbot">${esc(tr('Legacy WA Chatbot','روبوت واتساب القديم'))}</button></div></div><div class="sx-table-wrap"><table><thead><tr><th>${esc(tr('Bot name','اسم الروبوت'))}</th><th>${esc(tr('Type','النوع'))}</th><th>${esc(tr('Status','الحالة'))}</th><th>${esc(tr('Assigned number(s)','الأرقام المعينة'))}</th><th>${esc(tr('Assignment','التعيين'))}</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="sx-muted">${esc(tr('No Guided, Hybrid or AI bots yet. Create one in Automation Flows.','لا توجد روبوتات بعد. أنشئ واحدًا في تدفقات الأتمتة.'))}</td></tr>`}</tbody></table></div><div class="sx-alert"><strong>${esc(tr('Legacy Automation Flows stay unchanged','تبقى تدفقات الأتمتة القديمة كما هي'))}</strong><div>${esc(tr('Bot numbers are assigned on this page. Pause an active bot before changing its assignment. The original WA Chatbot setup remains available from the button above.','يتم تعيين أرقام الروبوتات من هذه الصفحة. أوقف الروبوت النشط قبل تغيير تعيينه. يظل إعداد واتساب القديم متاحًا من الزر أعلاه.'))}</div></div></section>`;
      panel.dataset.assignmentPage = 'ready';
      panel.querySelector('#sx-configure-bots')?.addEventListener('click', () => { location.href = '/user?page=automation-flows'; });
      panel.querySelector('#sx-open-legacy-chatbot')?.addEventListener('click', () => { location.href = '/user?page=chatbot'; });
      panel.querySelectorAll('[data-assignment-status]').forEach(button => button.addEventListener('click', async () => {
        const bot = state.bots.find(item => item.id === button.dataset.assignmentStatus); if (!bot) return; button.disabled = true;
        try { await api(`/${bot.id}/status`, 'PUT', { status: 'paused', expectedRevision: Number(bot.revision) }); panel.dataset.assignmentPage = ''; renderAssignments(); }
        catch (error) { alert(errorLabel(error.message)); button.disabled = false; }
      }));
      panel.querySelectorAll('[data-manage-assignment]').forEach(button => button.addEventListener('click', () => openAssignmentEditor(state.bots.find(bot => bot.id === button.dataset.manageAssignment))));
    }).catch(error => { if (panel.isConnected) { panel.dataset.assignmentPage = 'error'; panel.innerHTML = `<h1>${esc(tr('Chatbot','روبوت المحادثة'))}</h1><div role="alert" class="sx-alert">${esc(errorLabel(error.message))}</div><button class="sx-secondary" id="sx-chatbot-retry">${esc(tr('Retry','إعادة المحاولة'))}</button>`; panel.querySelector('#sx-chatbot-retry')?.addEventListener('click', () => { panel.dataset.assignmentPage = ''; renderAssignments(); }); } });
  }
  function openAssignmentEditor(bot) {
    if (!bot || bot.status === 'live') return;
    const assigned = (bot.channels || []).map(channel => `${channel.kind}|${channel.reference}`);
    const options = state.channels.map(channel => `<label><input type="checkbox" name="assignment-channel" value="${esc(channel.kind)}|${esc(channel.reference)}" ${assigned.includes(`${channel.kind}|${channel.reference}`)?'checked':''}>${esc(channel.kind==='whatsapp_meta'?'Meta WhatsApp':'QR WhatsApp')} · ${esc(channelLabel(channel))}</label>`).join('') || `<span class="sx-muted">${esc(tr('No connected numbers. Connect a number in WhatsApp setup first.','لا توجد أرقام متصلة. اربط رقمًا من إعداد واتساب أولاً.'))}</span>`;
    const dialog = document.createElement('div'); dialog.id = 'sx-chatbot-dialog';
    dialog.innerHTML = `<section class="sx-dialog" role="dialog" aria-modal="true"><h2>${esc(tr('Assign connected numbers','تعيين الأرقام المتصلة'))}</h2><div class="sx-muted">${esc(bot.name)} · ${esc(engineLabel(bot.engine))}</div><div class="sx-checks" style="margin-top:18px">${options}</div><div class="sx-error" role="alert"></div><div class="sx-footer"><button type="button" class="sx-secondary" data-close>${esc(tr('Cancel','إلغاء'))}</button><button type="button" class="sx-primary" data-save-assignment>${esc(tr('Save assignment','حفظ التعيين'))}</button></div></section>`;
    document.body.append(dialog); dialog.querySelector('[data-close]').onclick = () => dialog.remove();
    dialog.querySelector('[data-save-assignment]').onclick = async event => {
      const button = event.currentTarget; button.disabled = true; const error = dialog.querySelector('.sx-error'); error.textContent = '';
      const channels = [...dialog.querySelectorAll('input[name=assignment-channel]:checked')].map(input => { const [kind,...reference] = input.value.split('|'); return { kind, reference: reference.join('|') }; });
      try { await api(`/${bot.id}/channels`, 'PUT', { expectedRevision: Number(bot.revision), channels }); dialog.remove(); const panel = document.getElementById('sx-chatbot-panel'); if (panel) panel.dataset.assignmentPage = ''; renderAssignments(); }
      catch (err) { error.textContent = errorLabel(err.message); button.disabled = false; }
    };
  }
  function mountTabs() {
    syncChatbotTheme();
    // Keep the existing WA Chatbot page and Add Chatbot layout, and populate
    // its picker with the shared bot profiles.
    if (isAssignmentPage()) { state.mounted = false; closeViews(); addStyle(); mountNativeAssignmentButton(); mountNativeProfileList(); return false; }
    if (!isFlowPage()) { state.mounted = false; closeViews(); document.getElementById('sx-native-chatbot-profiles')?.remove(); nativeProfileListRequest = null; return false; }
    addStyle();
    const pos = bounds(); let tabs = document.getElementById('sx-chatbot-tabs');
    if (!tabs) { tabs = document.createElement('nav'); tabs.id = 'sx-chatbot-tabs'; document.body.append(tabs); }
    tabs.style.left = `${pos.left + 24}px`; tabs.style.top = `${pos.top + 14}px`;
    const definitions = [
      ['legacy', tr('Automation Flows','تدفقات الأتمتة'), `<span class="sx-legacy-tag">${tr('Legacy','قديم')}</span>`],
      ['guided', tr('Guided Chatbot','روبوت موجّه'), ''], ['hybrid', tr('Hybrid AI','ذكاء هجين'), ''], ['ai', tr('AI Chatbot','روبوت ذكاء اصطناعي'), '']
    ];
    const labels = [...tabs.querySelectorAll('button')].map(button => button.dataset.label);
    if (labels.join('|') !== definitions.map(item => item[1]).join('|')) {
      tabs.innerHTML = definitions.map(([id, label, tag]) => `<button type="button" data-tab="${id}" data-label="${esc(label)}">${esc(label)}${tag}</button>`).join('');
      tabs.querySelectorAll('button').forEach(button => button.onclick = () => { state.tab = button.dataset.tab; render(); });
    }
    tabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-selected', String(state.tab === button.dataset.tab)));
    state.mounted = true;
    if (state.tab === 'legacy') { document.getElementById('sx-chatbot-panel')?.remove(); return true; }
    return true;
  }
  function engineLabel(engine) { return ({ guided: tr('Guided Chatbot','روبوت موجّه'), hybrid: tr('Hybrid AI','ذكاء هجين'), ai: tr('AI Chatbot','روبوت ذكاء اصطناعي') })[engine] || engine; }
  function categoryLabel(key = state.categoryKey) {
    const localized = state.categoryTitle?.[ar() ? 'ar' : 'en'];
    if (typeof localized === 'string' && localized.trim()) return localized.trim();
    if (key === 'training_center') return tr('Training Center','مركز التدريب');
    return String(key || 'business').replace(/_/g,' ').replace(/\b\w/g, char => char.toUpperCase());
  }
  function botDescription(bot) {
    if (state.categoryKey === 'training_center') return bot.config?.workflow === 'course_enquiry'
      ? tr('Course enquiries and admissions','استفسارات الدورات والقبول')
      : tr('Training enquiries and course information','استفسارات التدريب ومعلومات الدورات');
    return tr(`Category-aware ${categoryLabel().toLowerCase()} assistant`,'مساعد لفئة النشاط المحددة');
  }
  function statusLabel(status) { return ({ live: tr('Active','نشط'), paused: tr('Paused','متوقف'), testing: tr('Testing','اختبار'), draft: tr('Draft','مسودة') })[status] || status; }
  function channelLabel(channel) {
    return channel?.label || tr('Number label unavailable','اسم الرقم غير متاح');
  }
  function previewReasonLabel(code) { return ({ LOW_CONFIDENCE:tr('AI confidence is below the handoff threshold','ثقة الذكاء الاصطناعي أقل من حد التحويل'), AI_PROVIDER_NOT_CONFIGURED:tr('AI provider is not configured','لم يتم إعداد مزود الذكاء الاصطناعي'), AI_PROVIDER_TIMEOUT:tr('AI provider timed out','انتهت مهلة مزود الذكاء الاصطناعي'), AI_PROVIDER_REQUEST_FAILED:tr('AI provider request failed','فشل طلب مزود الذكاء الاصطناعي'), DAILY_TOKEN_LIMIT:tr('Daily AI usage limit reached','تم بلوغ حد الاستخدام اليومي للذكاء الاصطناعي'), CONTEXT_LIMIT:tr('AI context is too large','سياق الذكاء الاصطناعي كبير جدًا'), GUIDED_FLOW_REQUIRED:tr('Choose a guided flow before testing Hybrid AI','اختر تدفقًا موجّهًا قبل اختبار الذكاء الهجين'), GUIDED_FLOW_UNAVAILABLE:tr('The selected guided flow is unavailable','التدفق الموجّه المحدد غير متاح'), AI_DATA_PROCESSING_ACK_REQUIRED:tr('Confirm the AI privacy notice first','أكد إشعار خصوصية الذكاء الاصطناعي أولاً'), AI_FALLBACK_DISABLED:tr('AI fallback is disabled for this bot','الرد الاحتياطي بالذكاء الاصطناعي متوقف لهذا الروبوت') })[code] || tr('Staff review is recommended','يوصى بمراجعة الموظف'); }
  function errorLabel(code) { return ({ AUTH_REQUIRED:tr('Please sign in again.','يرجى تسجيل الدخول مجددًا.'), PERMISSION_DENIED:tr('Your account cannot manage chatbots.','لا يملك حسابك صلاحية إدارة الروبوتات.'), FEATURE_UNAVAILABLE:tr('Chatbots are not included in this account plan.','الروبوتات غير متاحة ضمن خطة هذا الحساب.'), CHATBOT_UNAVAILABLE:tr('The chatbot service is temporarily unavailable. Try again shortly.','خدمة الروبوت غير متاحة مؤقتًا. حاول مرة أخرى بعد قليل.'), INVALID_GUIDED_CONTENT:tr('One of the guided messages is too long or has an invalid value. Review the message fields.','إحدى رسائل التوجيه طويلة جداً أو تحتوي قيمة غير صالحة. راجع حقول الرسائل.'), CATEGORY_GUIDED_CONTENT_UNAVAILABLE:tr('Guided content editing is not available for this category version.','تحرير محتوى التوجيه غير متاح لإصدار فئة النشاط هذا.'), AI_PROVIDER_NOT_CONFIGURED:tr('Configure an AI provider and key before activating this bot.','أعد إعداد مزود الذكاء الاصطناعي ومفتاحه قبل تفعيل الروبوت.'), AI_DATA_PROCESSING_ACK_REQUIRED:tr('Confirm the AI privacy notice before activating this bot.','أكد إشعار خصوصية الذكاء الاصطناعي قبل تفعيل الروبوت.'), BOT_CHANNEL_REQUIRED:tr('Assign at least one connected number before activating.','اربط رقمًا متصلًا واحدًا على الأقل قبل التفعيل.'), CONNECTED_CHANNEL_NOT_FOUND:tr('That number is no longer connected. Refresh the channel list.','لم يعد هذا الرقم متصلًا. حدّث قائمة القنوات.'), GUIDED_FLOW_REQUIRED:tr('Choose an active supported Automation Flow.','اختر تدفق أتمتة نشطًا ومدعومًا.'), GUIDED_FLOW_UNAVAILABLE:tr('The selected flow is unavailable or uses unsupported actions.','التدفق المختار غير متاح أو يستخدم إجراءات غير مدعومة.'), LIVE_BOT_MUST_BE_PAUSED:tr('Pause active bots before changing their numbers, AI privacy confirmation, or provider settings.','أوقف الروبوتات النشطة قبل تغيير أرقامها أو تأكيد خصوصية الذكاء الاصطناعي أو إعدادات المزود.'), STALE_REVISION:tr('This bot changed in another session. Reload and try again.','تغير هذا الروبوت في جلسة أخرى. أعد التحميل وحاول مجددًا.'), PROVIDER_KEY_REQUIRED:tr('Enter a new provider key when switching providers.','أدخل مفتاح مزود جديدًا عند التبديل بين المزودين.'), AI_PROVIDER_REQUEST_FAILED:tr('The AI provider rejected the request. Check the model and provider settings.','رفض مزود الذكاء الاصطناعي الطلب. تحقق من النموذج والإعدادات.') })[code] || tr('The request could not be completed. Try again or contact an administrator.','تعذر إكمال الطلب. حاول مرة أخرى أو تواصل مع المسؤول.'); }
  function panelMarkup(engine) {
    const bots = state.bots.filter(bot => bot.engine === engine);
    return `<header><h1>${esc(tr('Chatbot & Automation','الروبوتات والأتمتة'))}</h1><div class="sx-muted">${esc(tr('Create category-aware bots here. Assign each connected number from the Chatbot page.','أنشئ روبوتات حسب فئة النشاط هنا. عيّن كل رقم متصل من صفحة روبوت المحادثة.'))}</div></header>
      <section class="sx-card"><div class="sx-toolbar"><div><strong>${esc(engineLabel(engine))}</strong><div class="sx-muted">${esc(tr(`${categoryLabel()} · category-aware setup`,`${categoryLabel()} · إعداد حسب فئة النشاط`))} · v${Number(state.categoryVersion)||1}</div></div><div style="display:flex;gap:8px"><button class="sx-secondary" id="sx-open-assignments">${esc(tr('Manage assignments','إدارة التعيينات'))}</button><button class="sx-primary" id="sx-chatbot-create">＋ ${esc(tr('Create Bot','إنشاء روبوت'))}</button></div></div>
      <div class="sx-table-wrap"><table><thead><tr><th>${esc(tr('Bot Name','اسم الروبوت'))}</th><th>${esc(tr('Type','النوع'))}</th><th>${esc(tr('Status','الحالة'))}</th><th>${esc(tr('Actions','الإجراءات'))}</th></tr></thead><tbody>${bots.length ? bots.map(bot => `<tr><td><div class="sx-bot-name">${esc(bot.name)}</div><div class="sx-bot-desc">${esc(botDescription(bot))}</div></td><td><span class="sx-badge">${esc(engineLabel(bot.engine))}</span></td><td><span class="sx-status" data-status="${esc(bot.status)}">${esc(statusLabel(bot.status))}</span></td><td><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="sx-row-button" data-edit="${esc(bot.id)}">${esc(tr('Edit','تعديل'))}</button>${bot.status==='live'?`<button class="sx-row-button" data-status-action="${esc(bot.id)}" data-next="paused">${esc(tr('Pause','إيقاف'))}</button>`:`<button class="sx-row-button sx-live" data-status-action="${esc(bot.id)}" data-next="live">${esc(tr('Activate','تفعيل'))}</button>`}<button class="sx-row-button sx-danger" data-delete="${esc(bot.id)}" ${bot.status==='live'?'disabled title="Pause this bot before deleting"':''}>${esc(tr('Delete','حذف'))}</button></div></td></tr>`).join('') : `<tr><td colspan="4" class="sx-muted">${esc(tr('No bots yet. Create a bot to get started.','لا توجد روبوتات بعد. أنشئ روبوتًا للبدء.'))}</td></tr>`}</tbody></table></div>
      <div class="sx-alert"><strong>${esc(tr('Legacy automations remain unchanged','ستبقى الأتمتة القديمة كما هي'))}</strong><div>${esc(tr('Your existing flow stays preserved in the first tab. A live bot takes priority over legacy automation on its assigned number. Pausing the whole bot lets legacy automation run again; pause one chat in Inbox to hand only that chat to staff.','يظل التدفق الحالي محفوظًا في علامة التبويب الأولى. تكون أولوية الروبوت النشط على الأتمتة القديمة للرقم المخصص له. عند إيقاف الروبوت بالكامل، تعمل الأتمتة القديمة مجددًا؛ أوقف محادثة واحدة من صندوق الوارد لتحويلها إلى الموظفين فقط.'))}</div></div></section>`;
  }
  async function refresh() {
    const [bots, channels, flows, provider] = await Promise.all([api(''), api('/channels'), api('/flows'), api('/settings/provider')]);
    state.bots = bots.items || []; state.categoryKey = bots.category || 'training_center'; state.categoryTitle = bots.categoryTitle || null; state.categoryVersion = Number(bots.categoryVersion) || 1; state.guidedContentDefaults = bots.guidedContentDefaults || null; state.guidedContentSchema = bots.guidedContentSchema || null; state.channels = channels || []; state.flows = flows || []; state.provider = provider || { configured: false, revision: 0 };
  }
  function render() {
    if (!mountTabs()) return;
    if (state.tab === 'legacy') return;
    let panel = document.getElementById('sx-chatbot-panel');
    if (!panel) { panel = document.createElement('main'); panel.id = 'sx-chatbot-panel'; document.body.append(panel); }
    const pos = bounds(); panel.style.left = `${pos.left}px`; panel.style.top = `${pos.top + 72}px`; panel.style.width = `${Math.max(0, innerWidth-pos.left)}px`; panel.style.height = `${Math.max(0, innerHeight-pos.top-72)}px`;
    panel.innerHTML = `<div class="sx-muted" id="sx-chatbot-loading">${esc(tr('Loading bots…','جارٍ تحميل الروبوتات…'))}</div>`;
    refresh().then(() => {
      if (!panel.isConnected || state.tab === 'legacy') return;
      panel.innerHTML = panelMarkup(state.tab); bindPanel(panel, state.tab);
      }).catch(error => { if (panel.isConnected) panel.innerHTML = `<h1>${esc(tr('Chatbot & Automation','الروبوتات والأتمتة'))}</h1><div role="alert" class="sx-alert">${esc(errorLabel(error.message))}</div><button class="sx-secondary" id="sx-chatbot-retry">${esc(tr('Retry','إعادة المحاولة'))}</button>`; panel.querySelector('#sx-chatbot-retry')?.addEventListener('click', render); });
  }
  function bindPanel(panel, engine) {
    panel.querySelector('#sx-open-assignments')?.addEventListener('click', () => { location.href = '/user?page=wa-chatbot'; });
    panel.querySelector('#sx-chatbot-create')?.addEventListener('click', () => openEditor(engine));
    panel.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => openEditor(engine, state.bots.find(bot => bot.id === button.dataset.edit))));
    panel.querySelectorAll('[data-status-action]').forEach(button => button.addEventListener('click', async () => {
      const bot = state.bots.find(item => item.id === button.dataset.statusAction); if (!bot) return;
      button.disabled = true;
      try { await api(`/${bot.id}/status`, 'PUT', { status: button.dataset.next, expectedRevision: Number(bot.revision) }); render(); }
      catch (error) { alert(errorLabel(error.message)); button.disabled = false; }
    }));
  panel.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm(tr('Delete this paused or draft bot?','هل تريد حذف هذا الروبوت المتوقف أو المسودة؟'))) return;
      try { await api(`/${button.dataset.delete}`, 'DELETE', {}); render(); } catch (error) { alert(errorLabel(error.message)); }
    }));
  }
  function getContentValue(source, path) { return path.split('.').reduce((value, key) => value?.[key], source); }
  function setContentValue(source, path, value) {
    const keys = path.split('.'); let target = source;
    for (const key of keys.slice(0, -1)) { if (!target[key] || typeof target[key] !== 'object') target[key] = {}; target = target[key]; }
    target[keys[keys.length - 1]] = value;
  }
  function mergeContentDefaults(defaults, value) {
    if (defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
      const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, mergeContentDefaults(fallback, source[key])]));
    }
    return typeof value === typeof defaults ? value : defaults;
  }
  function guidedContentMarkup(config, selected) {
    const schema = state.guidedContentSchema;
    if (!schema?.groups?.length || !state.guidedContentDefaults) return '';
    const content = mergeContentDefaults(state.guidedContentDefaults, config.guidedContent);
    const labelText = label => label?.[ar() ? 'ar' : 'en'] || label?.en || label?.ar || '';
    const fields = schema.groups.map((group, groupIndex) => `<details class="sx-guide-group" ${groupIndex === 0 ? 'open' : ''}><summary>${esc(labelText(group.title))}</summary><div class="sx-guide-fields">${(group.fields || []).map(field => {
      const label = esc(labelText(field.label));
      const value = getContentValue(content, field.path);
      if (field.type === 'localized-text') return `<div class="sx-guide-field"><span class="sx-guide-field-title">${label}</span><div class="sx-language-pair"><label>English<textarea name="guidedContent:${esc(field.path)}:en" maxlength="${Number(field.maxLength)||600}" lang="en">${esc(value?.en || '')}</textarea></label><label dir="rtl" lang="ar">العربية<textarea name="guidedContent:${esc(field.path)}:ar" maxlength="${Number(field.maxLength)||600}" lang="ar" dir="rtl">${esc(value?.ar || '')}</textarea></label></div></div>`;
      if (field.type === 'boolean') return `<label class="sx-guide-toggle"><input type="checkbox" name="guidedContent:${esc(field.path)}" ${value === true ? 'checked' : ''}><span>${label}</span></label>`;
      if (field.type === 'integer') return `<label class="sx-guide-field"><span class="sx-guide-field-title">${label}</span><input type="number" name="guidedContent:${esc(field.path)}" min="${Number(field.min)||1}" max="${Number(field.max)||9}" step="1" value="${Number(value)||1}"></label>`;
      return '';
    }).join('')}</div></details>`).join('');
    return `<section class="sx-guide-content" data-guide-content ${selected ? '' : 'hidden'}><div class="sx-guide-heading">${esc(tr('Training center guided conversation','المحادثة الموجّهة لمركز التدريب'))}</div><div class="sx-guide-help">${esc(tr('Edit the greeting, menu, course-list, enquiry, course-detail and handoff messages in English and Arabic. The greeting appears on the first reply, including when a student starts with a specific question. Course names, descriptions, fees, batch dates and seats stay accurate from your published Courses catalogue.','عدّل رسائل الترحيب والقائمة وقائمة الدورات والاستفسار وتفاصيل الدورة والتحويل للموظف بالعربية والإنجليزية. تظهر رسالة الترحيب في أول رد حتى عندما يبدأ الطالب بسؤال محدد. تُؤخذ أسماء الدورات والأوصاف والرسوم ومواعيد المجموعات والمقاعد من كتالوج الدورات المنشور.'))}</div><a class="sx-guide-catalogue-link" href="/user?page=courses" target="_blank" rel="noopener noreferrer">${esc(tr('Manage published courses','إدارة الدورات المنشورة'))} ↗</a>${fields}</section>`;
  }
  function collectGuidedContent(formData) {
    const content = mergeContentDefaults(state.guidedContentDefaults, {});
    for (const group of state.guidedContentSchema?.groups || []) for (const field of group.fields || []) {
      if (field.type === 'localized-text') {
        setContentValue(content, `${field.path}.en`, String(formData.get(`guidedContent:${field.path}:en`) || '').trim());
        setContentValue(content, `${field.path}.ar`, String(formData.get(`guidedContent:${field.path}:ar`) || '').trim());
      } else if (field.type === 'boolean') {
        setContentValue(content, field.path, formData.get(`guidedContent:${field.path}`) === 'on');
      } else if (field.type === 'integer') {
        const value = Number(formData.get(`guidedContent:${field.path}`));
        setContentValue(content, field.path, Number.isSafeInteger(value) ? value : Number(getContentValue(state.guidedContentDefaults, field.path)));
      }
    }
    return content;
  }
  function openEditor(engine, existing) {
    const bot = existing || { name: '', engine, status: 'draft', revision: 1, channels: [], config: {} };
    const config = bot.config || {};
    const liveEdit = existing?.status === 'live';
    const locked = liveEdit ? 'disabled' : '';
    const domainGuideValue = `__${state.categoryKey}_default_v${Number(state.categoryVersion)||1}__`;
    const hasBuiltInGuide = Boolean(state.guidedContentDefaults && state.guidedContentSchema);
    const selectedDomainGuide = hasBuiltInGuide && (config.guidedMode === 'domain_default' || !config.flowId);
    const defaultFlowOption = hasBuiltInGuide
      ? `<option value="${domainGuideValue}" ${selectedDomainGuide?'selected':''}>${esc(tr(`Built-in ${categoryLabel()} guide (recommended)`,`الدليل المدمج لـ${categoryLabel()}`))}</option>`
      : `<option value="">${esc(tr('Select an active flow','اختر تدفقاً نشطاً'))}</option>`;
    const flowChoices = defaultFlowOption + state.flows.map(flow=>`<option value="${esc(flow.id)}" ${config.flowId===flow.id?'selected':''}>${esc(flow.name)}</option>`).join('');
    const flowField = engine !== 'ai' ? `<label class="sx-full">${esc(tr('Guided conversation setup','إعداد المحادثة الموجّهة'))}<select name="flowId">${flowChoices}</select><small class="sx-muted">${esc(hasBuiltInGuide ? tr('The built-in guide uses this category’s published facts and the editable messages below.','يستخدم الدليل المدمج البيانات المنشورة لهذه الفئة والرسائل القابلة للتعديل أدناه.') : tr('Choose an active Automation Flow for guided turns.','اختر تدفق أتمتة نشطاً للمحادثات الموجّهة.'))}</small></label>` : '';
    const guideSettings = engine !== 'ai' && hasBuiltInGuide ? guidedContentMarkup(config, selectedDomainGuide) : '';
    const audienceNotice = Array.isArray(config.allowedRecipientPhones) ? `<div class="sx-full sx-muted">${esc(tr('Bot disabled by default. Enabled only for: ', 'الروبوت متوقف افتراضياً. مفعّل فقط للأرقام: '))}${esc(config.allowedRecipientPhones.map(phone => '+' + phone).join(', ') || tr('No numbers', 'لا توجد أرقام'))}</div>` : '';
    const instructions = audienceNotice + (engine === 'guided' ? '' : `<label class="sx-full">${esc(tr('Business instructions','تعليمات النشاط'))}<textarea name="instructions" maxlength="4000" placeholder="${esc(tr('Describe tone and approved answers. Do not include payment or enrollment commitments.','صف الأسلوب والإجابات المعتمدة دون وعود بالدفع أو التسجيل.'))}">${esc(config.instructions||'')}</textarea></label>`);
    const faq = engine === 'guided' ? '' : `<label class="sx-full">${esc(tr('Approved FAQs (English and Arabic)','الأسئلة المعتمدة بالعربية والإنجليزية'))}<textarea name="faq" maxlength="7000" placeholder="${esc(tr('One FAQ per line: English question | English answer | Arabic question | Arabic answer','سؤال واحد في كل سطر: السؤال الإنجليزي | الإجابة الإنجليزية | السؤال العربي | الإجابة العربية'))}">${esc((config.knowledgeEntries||[]).map(x=>[x.questionEn,x.answerEn,x.questionAr,x.answerAr].join(' | ')).join('\n'))}</textarea></label>`;
    const providerFields = engine === 'guided' ? '' : `<div class="sx-full"><strong>${esc(tr('AI provider','مزود الذكاء الاصطناعي'))}</strong><div class="sx-muted">${esc(liveEdit ? tr('Provider credentials and usage limits are locked while this bot is active. Pause it to change them.','بيانات المزود وحدود الاستخدام مقفلة أثناء نشاط الروبوت. أوقفه لتغييرها.') : state.provider.configured ? tr(`Configured: ${state.provider.provider} · ${state.provider.model}. Leave the key empty to keep the saved key.`,`تم الإعداد: ${state.provider.provider} · ${state.provider.model}. اترك المفتاح فارغًا للاحتفاظ بالمفتاح الحالي.`) : tr('An API key is required before an AI bot can be activated.','يلزم مفتاح API قبل تفعيل روبوت الذكاء الاصطناعي.'))}</div></div><label>${esc(tr('Provider','المزود'))}<select name="provider" ${locked}><option value="openai" ${state.provider.provider==='openai'?'selected':''}>OpenAI</option><option value="gemini" ${state.provider.provider==='gemini'?'selected':''}>Gemini</option><option value="deepseek" ${state.provider.provider==='deepseek'?'selected':''}>DeepSeek</option></select></label><label>${esc(tr('AI model','نموذج الذكاء الاصطناعي'))}<select name="model" ${locked}>${modelChoices(state.provider.provider || 'openai', state.provider.model || '')}</select><small class="sx-muted">${esc(tr('Prices are estimates in USD per 1 million text tokens. Check the provider account’s data-use terms before sending customer messages; rates and availability can change.','الأسعار تقديرية بالدولار لكل مليون رمز نصي. راجع شروط استخدام بيانات حساب المزود قبل إرسال رسائل العملاء؛ قد تتغير الأسعار وتوفّر النماذج.'))}</small></label><label class="sx-full">${esc(tr('Provider API key','مفتاح API للمزود'))}<input name="apiKey" type="password" maxlength="2048" autocomplete="new-password" placeholder="${esc(tr('Enter a key to add or rotate it','أدخل مفتاحًا لإضافته أو تغييره'))}" ${locked}></label><label>${esc(tr('Daily token limit','حد الرموز اليومي'))}<select name="dailyTokenLimit" ${locked}>${presetChoices(['10000','25000','50000','100000','250000','500000','1000000'], String(state.provider.dailyTokenLimit ?? '50000'), '50000')}</select></label>`;
    const thresholdField = engine === 'guided' ? '' : `<label>${esc(tr('Confidence threshold','حد الثقة'))}<select name="confidenceThreshold">${presetChoices(['0.50','0.60','0.70','0.72','0.80','0.90','0.95'], String(config.confidenceThreshold ?? '0.72'), '0.72')}</select></label>`;
    const preview = existing && engine !== 'guided' && !(engine === 'hybrid' && config.aiFallback === false) ? `<section class="sx-preview"><div class="sx-preview-title">${esc(tr('Test this bot','اختبر هذا الروبوت'))}</div><div class="sx-preview-note">${esc(tr('Your test message is sent to the configured AI provider, never to WhatsApp, and counts toward the daily AI limit. Preview uses saved settings. Save changes and reopen this bot before testing.','ستُرسل رسالة الاختبار إلى مزود الذكاء الاصطناعي المُعد، ولن تُرسل عبر واتساب، وستُحتسب ضمن الحد اليومي. يستخدم الاختبار الإعدادات المحفوظة؛ احفظ التغييرات وأعد فتح الروبوت أولاً.'))}</div><label>${esc(tr('Test customer message','رسالة العميل للاختبار'))}<textarea id="sx-chatbot-preview-message" maxlength="2000" placeholder="${esc(tr('Ask a course or FAQ question…','اسأل عن دورة أو سؤال شائع…'))}"></textarea></label><button type="button" class="sx-secondary" id="sx-chatbot-preview" ${state.provider.configured ? '' : 'disabled'}>${esc(tr('Preview reply','معاينة الرد'))}</button><div class="sx-preview-result" id="sx-chatbot-preview-result" aria-live="polite"></div></section>` : '';
    const liveEditNotice = liveEdit ? `<div class="sx-alert sx-full">${esc(tr('This bot stays active. Saved changes take effect on the next incoming message. Preview first; its connected number and AI provider settings stay unchanged.','سيظل هذا الروبوت نشطًا. تسري التغييرات المحفوظة على الرسالة الواردة التالية. عاين التغييرات أولاً؛ سيبقى الرقم المتصل وإعدادات مزود الذكاء الاصطناعي كما هي.'))}</div>` : '';
    const guidedPreview = engine !== 'ai' && hasBuiltInGuide ? `<section class="sx-guided-preview" data-guided-preview ${selectedDomainGuide ? '' : 'hidden'}><div class="sx-guided-preview-title">${esc(tr('Preview the guided conversation','معاينة المحادثة الموجّهة'))}</div><div class="sx-guided-preview-note">${esc(tr('Uses the current unsaved messages and published course data. It does not save the bot, call an AI provider, or send a WhatsApp message.','تستخدم الرسائل الحالية غير المحفوظة وبيانات الدورات المنشورة. لا تحفظ الروبوت ولا تتصل بمزود ذكاء اصطناعي ولا ترسل رسالة واتساب.'))}</div><div class="sx-guided-transcript" data-guided-transcript aria-live="polite"></div><div class="sx-guided-preview-controls"><input data-guided-message maxlength="2000" placeholder="${esc(tr('Type hello, courses, or a menu choice','اكتب مرحباً أو الدورات أو اختر من القائمة'))}"><button type="button" class="sx-secondary" data-guided-send>${esc(tr('Send preview','إرسال للمعاينة'))}</button><button type="button" class="sx-secondary" data-guided-reset>${esc(tr('Reset','إعادة'))}</button></div><div class="sx-guided-preview-status" data-guided-status role="status"></div></section>` : '';
    const dialog = document.createElement('div'); dialog.id='sx-chatbot-dialog';
    dialog.innerHTML = `<section class="sx-dialog" role="dialog" aria-modal="true" aria-labelledby="sx-chatbot-editor-title"><h2 id="sx-chatbot-editor-title">${esc(existing?tr('Edit bot','تعديل الروبوت'):tr('Create bot','إنشاء روبوت'))}</h2><div class="sx-muted">${esc(tr(`${categoryLabel()} bot · assign its number from the Chatbot page`,`${categoryLabel()} · عيّن رقم الروبوت من صفحة Chatbot`))}</div><form><div class="sx-form-grid">${liveEditNotice}<label class="sx-full">${esc(tr('Bot name','اسم الروبوت'))}<input name="name" required maxlength="120" value="${esc(bot.name)}"></label>${flowField}${guideSettings}${instructions}${faq}${providerFields}${thresholdField}${engine==='hybrid'?`<label>${esc(tr('AI fallback','الرد بالذكاء الاصطناعي عند الحاجة'))}<select name="aiFallback"><option value="true" ${config.aiFallback!==false?'selected':''}>${esc(tr('Enabled','مفعّل'))}</option><option value="false" ${config.aiFallback===false?'selected':''}>${esc(tr('Disabled','متوقف'))}</option></select></label>`:''}${engine!=='guided'?`<label class="sx-full"><span><input type="checkbox" name="aiDataProcessingConfirmed" ${config.aiDataProcessingConfirmed===true?'checked':''} ${locked}> ${esc(tr('I have configured a suitable customer privacy notice for AI processing of conversation messages.','أؤكد إعداد إشعار خصوصية مناسب لمعالجة رسائل المحادثات بالذكاء الاصطناعي.'))}</span>${liveEdit?`<small class="sx-muted">${esc(tr('Pause this bot before changing its AI privacy confirmation.','أوقف هذا الروبوت قبل تغيير تأكيد خصوصية الذكاء الاصطناعي.'))}</small>`:''}</label>`:''}</div>${guidedPreview}${preview}<div class="sx-error" role="alert"></div><div class="sx-footer"><button type="button" class="sx-secondary" data-close>${esc(tr('Cancel','إلغاء'))}</button><button type="submit" class="sx-primary">${esc(tr('Save bot','حفظ الروبوت'))}</button></div></form></section>`;
    dialog.addEventListener('click', event => { if (event.target === dialog || event.target.closest('[data-close]')) dialog.remove(); });
    const formElement = dialog.querySelector('form');
    const providerSelect = formElement.querySelector('select[name="provider"]');
    const modelSelect = formElement.querySelector('select[name="model"]');
    providerSelect?.addEventListener('change', () => {
      const prior = modelSelect.value;
      modelSelect.innerHTML = modelChoices(providerSelect.value, '');
      modelSelect.value = providerModels[providerSelect.value]?.[0]?.id || '';
      if (!modelSelect.value) modelSelect.value = prior;
    });
    const flowSelect = formElement.querySelector('select[name="flowId"]');
    const guideSection = formElement.querySelector('[data-guide-content]');
    const guidedPreviewPanel = formElement.querySelector('[data-guided-preview]');
    flowSelect?.addEventListener('change', () => {
      const usesDomainGuide = flowSelect.value === domainGuideValue;
      if (guideSection) guideSection.hidden = !usesDomainGuide;
      if (guidedPreviewPanel) guidedPreviewPanel.hidden = !usesDomainGuide;
    });
    if (guidedPreviewPanel) {
      let previewState = null;
      const transcript = guidedPreviewPanel.querySelector('[data-guided-transcript]');
      const input = guidedPreviewPanel.querySelector('[data-guided-message]');
      const status = guidedPreviewPanel.querySelector('[data-guided-status]');
      const send = guidedPreviewPanel.querySelector('[data-guided-send]');
      status.textContent = tr('Start with hello, then try courses and a course number.','ابدأ بمرحباً، ثم جرّب الدورات ورقم دورة.');
      const addBubble = (role, text) => {
        const bubble = document.createElement('div');
        bubble.className = 'sx-guided-bubble'; bubble.dataset.role = role; bubble.textContent = text;
        transcript.append(bubble); transcript.scrollTop = transcript.scrollHeight;
      };
      const sendPreview = async () => {
        if (send.disabled) return;
        const message = input.value.trim();
        if (!message) { status.textContent = tr('Enter a sample customer message.','أدخل رسالة نموذجية من العميل.'); return; }
        send.disabled = true; status.textContent = tr('Loading published course information…','جارٍ تحميل معلومات الدورات المنشورة…');
        addBubble('user', message);
        try {
          const result = await api('/guided-preview', 'POST', { message, state: previewState, guidedContent: collectGuidedContent(new FormData(formElement)) });
          addBubble('bot', result.reply);
          previewState = result.state;
          status.textContent = result.handoff ? tr('This preview would pause the bot and hand the chat to staff.','ستوقف هذه المعاينة الروبوت وتحيل المحادثة إلى الموظفين.') : '';
          input.value = '';
        } catch (error) {
          status.textContent = errorLabel(error.message);
        } finally { send.disabled = false; input.focus(); }
      };
      send.addEventListener('click', sendPreview);
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); sendPreview(); } });
      guidedPreviewPanel.querySelector('[data-guided-reset]').addEventListener('click', () => {
        previewState = null; transcript.replaceChildren(); input.value = ''; status.textContent = tr('Preview reset. Send hello to begin again.','تمت إعادة المعاينة. أرسل مرحباً للبدء من جديد.'); input.focus();
      });
    }
    const previewButton = dialog.querySelector('#sx-chatbot-preview');
    if (previewButton && existing) {
      formElement.dataset.configDirty = 'false';
      formElement.addEventListener('input', event => {
        if (event.target.id === 'sx-chatbot-preview-message') return;
        formElement.dataset.configDirty = 'true';
        previewButton.disabled = true;
        dialog.querySelector('#sx-chatbot-preview-result').textContent = tr('Save changes and reopen this bot to preview the updated settings.','احفظ التغييرات وأعد فتح الروبوت لمعاينة الإعدادات الجديدة.');
      });
      formElement.addEventListener('change', event => {
        if (event.target.id === 'sx-chatbot-preview-message') return;
        formElement.dataset.configDirty = 'true';
        previewButton.disabled = true;
        dialog.querySelector('#sx-chatbot-preview-result').textContent = tr('Save changes and reopen this bot to preview the updated settings.','احفظ التغييرات وأعد فتح الروبوت لمعاينة الإعدادات الجديدة.');
      });
      previewButton.addEventListener('click', async () => {
        const message = dialog.querySelector('#sx-chatbot-preview-message')?.value?.trim();
        const result = dialog.querySelector('#sx-chatbot-preview-result');
        if (formElement.dataset.configDirty === 'true') {
          result.textContent = tr('Save changes and reopen this bot before testing.','احفظ التغييرات وأعد فتح الروبوت قبل الاختبار.');
          return;
        }
        if (!message) { result.textContent = tr('Enter a test question first.','أدخل سؤالاً للاختبار أولاً.'); return; }
        previewButton.disabled = true;
        result.textContent = tr('Generating a test reply…','جارٍ إنشاء رد تجريبي…');
        try {
          const previewResult = await api(`/${bot.id}/preview`, 'POST', { message, expectedRevision: Number(bot.revision) });
          result.textContent = previewResult.canAnswer
            ? `${tr('AI preview','معاينة الذكاء الاصطناعي')} · ${Math.round(Number(previewResult.confidence) * 100)}%\n${previewResult.reply}`
            : `${tr('This message would be handed to staff.','ستُحال هذه الرسالة إلى الموظفين.')}${previewResult.reason ? ` · ${previewReasonLabel(previewResult.reason)}` : ''}`;
        } catch (error) { result.textContent = errorLabel(error.message); }
        finally { previewButton.disabled = formElement.dataset.configDirty === 'true'; }
      });
    }
    formElement.addEventListener('submit', async event => {
      event.preventDefault(); const form=event.currentTarget, data=new FormData(form), submit=form.querySelector('[type=submit]'), error=form.querySelector('.sx-error'); submit.disabled=true; error.textContent='';
      const flowChoice=String(data.get('flowId')||'');
      const usesDomainGuide=hasBuiltInGuide && flowChoice===domainGuideValue;
      const flowId=usesDomainGuide?null:(flowChoice||null);
      const entries=String(data.get('faq')||'').split('\n').map(line=>line.split('|').map(part=>part.trim())).filter(parts=>parts.some(Boolean)).map(parts=>({questionEn:parts[0]||'',answerEn:parts[1]||'',questionAr:parts[2]||'',answerAr:parts[3]||''}));
      const body={name:String(data.get('name')||'').trim(),engine,config:{...config,flowId,guidedMode:usesDomainGuide?'domain_default':(flowId?'automation_flow':null),instructions:String(data.get('instructions')||''),workflow:'course_admissions',aiFallback:data.get('aiFallback')!=='false',confidenceThreshold:Number(data.get('confidenceThreshold')||config.confidenceThreshold||0.72),aiDataProcessingConfirmed:liveEdit?config.aiDataProcessingConfirmed===true:data.get('aiDataProcessingConfirmed')==='on',knowledgeEntries:entries}};
      if (usesDomainGuide) body.config.guidedContent=collectGuidedContent(data);
      try {
        let saved;
        if (existing) saved=await api(`/${bot.id}`,'PUT',{...body,expectedRevision:Number(bot.revision)});
        else saved=await api('', 'POST', body);
        let id=existing?.id||saved.id, revision=Number(saved.revision||1);
        const usesAi = engine === 'ai' || (engine === 'hybrid' && body.config.aiFallback !== false);
        if (usesAi && !liveEdit) {
          const key=String(data.get('apiKey')||'');
          const providerBody={provider:String(data.get('provider')),model:String(data.get('model')||''),dailyTokenLimit:Number(data.get('dailyTokenLimit')||50000),expectedRevision:Number(state.provider.revision||0)};
          if (key) providerBody.apiKey=key;
          if (key || (state.provider.configured && (state.provider.provider!==providerBody.provider || state.provider.model!==providerBody.model || Number(state.provider.dailyTokenLimit)!==providerBody.dailyTokenLimit))) {
            state.provider=await api('/settings/provider','PUT',providerBody);
          }
        }
        dialog.remove(); await refresh(); render();
      } catch (err) {
        // Profile, provider and channel writes are individually transactional.
        // Refresh after any later-stage failure so retrying cannot submit a stale
        // revision or accidentally create a second draft after partial success.
        dialog.remove();
        try { await refresh(); render(); } catch (_) { alert(errorLabel(err.message)); }
        alert(errorLabel(err.message));
      }
    });
    document.body.append(dialog); dialog.querySelector('input[name=name]')?.focus();
  }
  function conversationId(node) {
    const el=node?.closest?.('[data-chat-id],[data-chat_id],[data-conversation-id]');
    return el?.dataset.chatId || el?.dataset.chat_id || el?.dataset.conversationId || new URLSearchParams(location.search).get('chatId') || '';
  }
  const chatStates = new Map();
  let inboxBotControlsDenied = false;
  const manuallySelectedChatChannels = new Map();
  let inboxBotChannelOptionsPromise = null;
  async function inboxBotChannelOptions() {
    if (!inboxBotChannelOptionsPromise) {
      inboxBotChannelOptionsPromise = Promise.all([api(''), api('/channels')]).then(([bots, channels]) => {
        const assigned = new Map();
        for (const bot of bots.items || []) {
          if (bot.status !== 'live') continue;
          for (const channel of bot.channels || []) assigned.set(`${channel.kind}|${channel.reference}`, bot.name || '');
        }
        return (channels || []).filter(channel => assigned.has(`${channel.kind}|${channel.reference}`)).map(channel => ({
          kind: channel.kind,
          reference: channel.reference,
          label: `${channel.kind === 'whatsapp_meta' ? tr('Meta WhatsApp','واتساب ميتا') : tr('QR WhatsApp','واتساب QR')} · ${channelLabel(channel)}${assigned.get(`${channel.kind}|${channel.reference}`) ? ` · ${assigned.get(`${channel.kind}|${channel.reference}`)}` : ''}`,
        }));
      }).catch(error => { inboxBotChannelOptionsPromise = null; throw error; });
    }
    return inboxBotChannelOptionsPromise;
  }
  function channelScope(source = {}) {
    const params = new URLSearchParams(location.search);
    let kind = source.channelKind ?? source.channel_kind ?? source.channel ?? source.origin ?? params.get('channelKind') ?? params.get('channel_kind') ?? params.get('origin') ?? '';
    kind = String(kind).toLowerCase();
    if (kind === 'qr' || kind.includes('qr') || kind === 'instance') kind = 'whatsapp_qr';
    else if (kind === 'meta' || kind.includes('meta') || kind === 'cloud') kind = 'whatsapp_meta';
    else kind = '';
    const ref = source.channelRef ?? source.channel_ref ?? source.channelExternalId ?? source.channel_external_id ?? source.sessionId ?? source.session_id ?? source.uniqueId ?? source.unique_id ?? source.instanceId ?? source.instance_id ?? source.businessPhoneNumberId ?? source.business_phone_number_id ?? params.get('channelRef') ?? params.get('channel_ref') ?? params.get('sessionId') ?? params.get('uniqueId') ?? params.get('business_phone_number_id') ?? '';
    return kind && typeof ref === 'string' && ref.length > 0 && ref.length <= 160 ? { channelKind:kind, channelRef:ref } : null;
  }
  let lastActiveConversation = null;
  function rememberActiveConversation(value) {
    if (value?.id) lastActiveConversation = { id:String(value.id), scope:value.scope || null };
    return lastActiveConversation;
  }
  function activeConversation() {
    const selected = [...document.querySelectorAll('[data-chat-id],[data-chat_id],[data-conversation-id]')]
      .filter(el => {
        const current = el.getAttribute('aria-current');
        return visible(el) && (el.getAttribute('aria-selected') === 'true' || (current && current !== 'false') || el.getAttribute('data-selected') === 'true' || el.classList.contains('Mui-selected') || el.classList.contains('selected'));
      })
      .find(el => { const id=conversationId(el); return id && id.length <= 999; });
    if (selected) {
      const id = conversationId(selected);
      return rememberActiveConversation({ id, scope:channelScope(selected.dataset || {}) || manuallySelectedChatChannels.get(id) || null });
    }
    const fromUrl = new URLSearchParams(location.search).get('chatId');
    if (fromUrl) return rememberActiveConversation({ id:fromUrl, scope:channelScope() || manuallySelectedChatChannels.get(fromUrl) || null });
    try {
      const current = JSON.parse(localStorage.getItem('currentChat') || 'null');
      const id = current?.chat_id ?? current?.id ?? current?.chatId ?? current?.conversationId;
      if ((typeof id === 'string' || Number.isSafeInteger(id)) && String(id).length <= 999) {
        const key = String(id);
        return rememberActiveConversation({ id:key, scope:channelScope(current || {}) || manuallySelectedChatChannels.get(key) || null });
      }
    } catch {}
    const infoButton = [...document.querySelectorAll('button[aria-label],button[title]')].find(button => /show info|معلومات/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`) && visible(button));
    if (lastActiveConversation && infoButton) {
      return rememberActiveConversation({ ...lastActiveConversation, scope:channelScope() || lastActiveConversation.scope || manuallySelectedChatChannels.get(lastActiveConversation.id) || null });
    }
    return null;
  }
  function renderActiveChatControl(conversation) {
    let control = document.getElementById('sx-active-chatbot-control');
    if (!conversation?.id || inboxBotControlsDenied) { control?.remove(); return; }
    const { id, scope } = conversation;
    if (!control) {
      control = document.createElement('div'); control.id = 'sx-active-chatbot-control';
      control.setAttribute('role', 'group'); control.setAttribute('aria-label', tr('Bot control for this chat', 'التحكم بالروبوت لهذه المحادثة'));
      control.innerHTML = `<button type="button" data-sx-chatbot-mobile-toggle aria-controls="sx-active-chatbot-control-content" aria-expanded="false">${esc(tr('Bot','الروبوت'))}</button><div id="sx-active-chatbot-control-content" data-sx-chatbot-control-body></div>`;
      control.querySelector('[data-sx-chatbot-mobile-toggle]').addEventListener('click', event => {
        const open = control.classList.toggle('sx-mobile-open');
        event.currentTarget.setAttribute('aria-expanded', String(open));
        const infoButton = [...document.querySelectorAll('button[aria-label],button[title]')].find(button => /show info|معلومات/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`));
        const actions = infoButton?.parentElement;
        const header = actions?.parentElement;
        if (window.matchMedia('(max-width: 767px)').matches && header?.parentElement) {
          if (open) header.parentElement.insertBefore(control, header.nextElementSibling);
          else if (actions) actions.insertBefore(control, infoButton);
        }
      });
    }
    if (control.dataset.conversationId && control.dataset.conversationId !== id) {
      control.classList.remove('sx-mobile-open');
      control.querySelector('[data-sx-chatbot-mobile-toggle]')?.setAttribute('aria-expanded', 'false');
    }
    const infoButton = [...document.querySelectorAll('button[aria-label],button[title]')].find(button => /show info|معلومات/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`));
    const actions = infoButton?.parentElement;
    const header = actions?.parentElement;
    if (!header || !actions) { control.style.display = 'none'; return; }
    control.style.display = '';
    const narrow = window.matchMedia('(max-width: 767px)').matches;
    if (narrow) {
      control.classList.add('sx-mobile-layout');
      if (control.classList.contains('sx-mobile-open') && header.parentElement) {
        if (control.parentElement !== header.parentElement || control.previousElementSibling !== header) header.parentElement.insertBefore(control, header.nextElementSibling);
      } else if (control.parentElement !== actions) actions.insertBefore(control, infoButton);
    } else {
      control.classList.remove('sx-mobile-layout', 'sx-mobile-open');
      control.querySelector('[data-sx-chatbot-mobile-toggle]')?.setAttribute('aria-expanded', 'false');
      if (control.parentElement !== header || control.nextElementSibling !== actions) header.insertBefore(control, actions);
    }
    const body = control.querySelector('[data-sx-chatbot-control-body]');
    const scopeKey = scope ? `${scope.channelKind}|${scope.channelRef}` : '';
    if (control.dataset.conversationId === id && control.dataset.channelScope === scopeKey && control.dataset.loading !== 'true') return;
    control.dataset.conversationId = id; control.dataset.channelScope = scopeKey; control.dataset.loading = 'true';
    if (!scope) {
      body.innerHTML = `<strong data-sx-chatbot-mobile-heading>${esc(tr('Chat info','معلومات المحادثة'))}</strong><label><span>${esc(tr('Bot number','رقم الروبوت'))}</span><select data-sx-chatbot-channel aria-label="${esc(tr('WhatsApp number for this chat','رقم واتساب لهذه المحادثة'))}"><option value="">${esc(tr('Loading connected bot numbers…','جارٍ تحميل أرقام الروبوتات المتصلة…'))}</option></select></label><span data-sx-chatbot-state aria-live="polite">${esc(tr('Choose the number this conversation uses.','اختر الرقم المستخدم في هذه المحادثة.'))}</span>`;
      control.dataset.loading = 'false';
      const select = control.querySelector('[data-sx-chatbot-channel]');
      select.addEventListener('change', () => {
        const [channelKind, ...parts] = String(select.value || '').split('|');
        const channelRef = parts.join('|');
        if (['whatsapp_meta','whatsapp_qr'].includes(channelKind) && channelRef) {
          const selectedScope = { channelKind, channelRef };
          manuallySelectedChatChannels.set(id, selectedScope);
          renderActiveChatControl({ id, scope: selectedScope });
        }
      });
      inboxBotChannelOptions().then(options => {
        if (!control.isConnected || control.dataset.conversationId !== id || control.dataset.channelScope !== '') return;
        select.innerHTML = `<option value="">${esc(options.length ? tr('Choose a connected bot number','اختر رقم روبوت متصلًا') : tr('No active bot numbers found','لا توجد أرقام روبوت نشطة'))}</option>` + options.map(option => `<option value="${esc(`${option.kind}|${option.reference}`)}">${esc(option.label)}</option>`).join('');
        select.disabled = options.length === 0;
        control.querySelector('[data-sx-chatbot-state]').textContent = options.length
          ? tr('Choose the number this conversation uses.','اختر الرقم المستخدم في هذه المحادثة.')
          : tr('Assign and activate a bot on a connected number first.','اربط روبوتًا وفعّله على رقم متصل أولاً.');
      }).catch(error => {
        if (!control.isConnected || control.dataset.conversationId !== id) return;
        if (error.message === 'TENANT_PERMISSION_DENIED') {
          inboxBotControlsDenied = true;
          control.remove();
          return;
        }
        select.innerHTML = `<option value="">${esc(errorLabel(error.message))}</option>`;
        select.disabled = true;
        control.querySelector('[data-sx-chatbot-state]').textContent = tr('Could not load bot numbers. Refresh and try again.','تعذر تحميل أرقام الروبوتات. حدّث الصفحة وحاول مجددًا.');
      });
      return;
    }
    const endpoint = `/conversations/${encodeURIComponent(id)}/bot-control?channelKind=${encodeURIComponent(scope.channelKind)}&channelRef=${encodeURIComponent(scope.channelRef)}`;
    body.innerHTML = `<strong data-sx-chatbot-mobile-heading>${esc(tr('Chat info','معلومات المحادثة'))}</strong><span data-sx-chatbot-state aria-live="polite">${esc(tr('Checking…','جارٍ التحقق…'))}</span><button type="button" data-sx-chatbot-toggle>${esc(tr('Checking…','جارٍ التحقق…'))}</button>`;
    const button = control.querySelector('[data-sx-chatbot-toggle]');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const current = await api(endpoint);
        const next = current.mode === 'paused' ? 'inherit' : 'paused';
        await api(`/conversations/${encodeURIComponent(id)}/bot-control`, 'PUT', { ...scope, mode: next, expectedRevision: Number(current.revision || 0), reason: next === 'paused' ? 'Paused from Inbox' : null });
        chatStates.delete(`${scopeKey}|${id}`); await loadActiveChatControl(id, scope);
      } catch (error) { alert(errorLabel(error.message)); button.disabled = false; }
    });
    loadActiveChatControl(id, scope);
  }
  const chatControlRequests = new Set();
  async function loadActiveChatControl(id, scope) {
    if (!scope) return;
    const control = document.getElementById('sx-active-chatbot-control');
    const scopeKey = `${scope.channelKind}|${scope.channelRef}`;
    const requestKey = `${scopeKey}|${id}`;
    if (!control || control.dataset.conversationId !== id || control.dataset.channelScope !== scopeKey || chatControlRequests.has(requestKey)) return;
    chatControlRequests.add(requestKey);
    try {
      const value = await api(`/conversations/${encodeURIComponent(id)}/bot-control?channelKind=${encodeURIComponent(scope.channelKind)}&channelRef=${encodeURIComponent(scope.channelRef)}`);
      if (!control.isConnected || control.dataset.conversationId !== id || control.dataset.channelScope !== scopeKey) return;
      chatStates.set(requestKey, value); control.dataset.loading = 'false';
      const button = control.querySelector('[data-sx-chatbot-toggle]'); if (!button) return;
      const state = control.querySelector('[data-sx-chatbot-state]');
      const handoffLabels = { LOW_CONFIDENCE:tr('AI could not answer confidently','تعذر على الذكاء الاصطناعي الإجابة بثقة'), AI_PROVIDER_NOT_CONFIGURED:tr('AI provider needs configuration','يحتاج مزود الذكاء الاصطناعي إلى إعداد'), AI_PROVIDER_TIMEOUT:tr('AI provider timed out','انتهت مهلة مزود الذكاء الاصطناعي'), AI_PROVIDER_REQUEST_FAILED:tr('AI provider error','خطأ في مزود الذكاء الاصطناعي'), AI_PROVIDER_INVALID_OUTPUT:tr('AI response needs staff review','تحتاج إجابة الذكاء الاصطناعي إلى مراجعة الموظف'), DAILY_TOKEN_LIMIT:tr('Daily AI limit reached','تم بلوغ حد الذكاء الاصطناعي اليومي'), CONTEXT_LIMIT:tr('Conversation needs staff review','تحتاج المحادثة إلى مراجعة الموظف'), CHANNEL_SEND_FAILED:tr('Reply could not be sent','تعذر إرسال الرد'), UNSUPPORTED_MESSAGE_TYPE:tr('Message type needs staff review','يحتاج نوع الرسالة إلى مراجعة الموظف'), GUIDED_FLOW_UNAVAILABLE:tr('Guided flow is unavailable','التدفق الموجّه غير متاح'), 'inbound-message-id-unavailable':tr('Message needs review','الرسالة تحتاج إلى مراجعة'), 'runtime-error':tr('Bot needs staff review','يحتاج الروبوت إلى مراجعة الموظف'), 'human-review':tr('Staff follow-up needed','تحتاج المحادثة إلى متابعة الموظف') };
      button.disabled = false; button.dataset.mode = value.mode;
      button.textContent = value.mode === 'paused' ? tr('Resume bot','استئناف الروبوت') : tr('Pause bot','إيقاف الروبوت');
      button.title = value.mode === 'paused' ? tr('Bot replies are paused for this chat','تم إيقاف ردود الروبوت لهذه المحادثة') : tr('Bot replies are enabled for this chat','ردود الروبوت مفعلة لهذه المحادثة');
      if (state) state.textContent = value.mode === 'paused' && value.updatedBy === 'System'
        ? `${tr('Staff follow-up','متابعة الموظف')}${value.reason ? ` · ${handoffLabels[value.reason] || tr('Please review this chat','يرجى مراجعة هذه المحادثة')}` : ''}`
        : value.mode === 'paused' ? tr('Paused for this chat','متوقف لهذه المحادثة') : tr('Bot replies enabled','ردود الروبوت مفعلة');
    } catch (error) {
      control.remove();
      if (error.message === 'TENANT_PERMISSION_DENIED') inboxBotControlsDenied = true;
      if (error.message === 'CONVERSATION_NOT_FOUND' && manuallySelectedChatChannels.has(id)) {
        manuallySelectedChatChannels.delete(id);
        renderActiveChatControl({ id, scope:null });
      } else if (error.message !== 'CONVERSATION_NOT_FOUND') console.warn('Chatbot chat control unavailable:', error.message);
    }
    finally { chatControlRequests.delete(requestKey); }
  }
  async function syncChatControls() {
    if (!isInboxPage()) return;
    addStyle();
    renderActiveChatControl(activeConversation());
  }
  let scheduled=false;
  function update() { if (scheduled) return; scheduled=true; requestAnimationFrame(()=>{scheduled=false;const active=mountTabs();if(active&&state.tab!=='legacy'&&!document.getElementById('sx-chatbot-panel'))render();syncChatControls();}); }
  new MutationObserver(update).observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('resize',update); window.addEventListener('popstate',update); window.addEventListener('storage',update); update();
  window.setInterval(() => { if (isInboxPage()) { const conversation = activeConversation(); if (conversation?.id && conversation.scope) loadActiveChatControl(conversation.id, conversation.scope); } }, 30000);
})();
