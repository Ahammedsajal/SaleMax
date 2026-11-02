(() => {
  'use strict';
  const copy = {
    en: { eyebrow:'Secure account connection', title:'Connect ChatGPT to 7Network', intro:'Choose what ChatGPT can access for this account. You can disconnect it from your 7Network integrations page at any time.', signIn:'Sign in with your existing 7Network account to continue.', ownerLogin:'Business account sign in', agentLogin:'Agent sign in', switchAccount:'Choose which signed-in account to connect:', accessTitle:'Requested access', scopeLegend:'Select permissions for this ChatGPT connection', allow:'Allow and continue', deny:'Cancel', footer:'Your account permissions still apply to every request. ChatGPT cannot send messages to customers through this pilot.', checking:'Checking the requested access…', expired:'This authorization request expired. Return to ChatGPT and connect again.', signInRequired:'Sign in to the 7Network account you want to connect.', loading:'Preparing the secure connection…', failed:'Could not load this request. Return to ChatGPT and try again.', saving:'Saving your choice…', invalidScopes:'Select at least one available permission.', account:'Signed in as {name} ({role}).', pipeline:'Read pipeline leads and follow-ups', pipelineHelp:'Search permitted leads and see due follow-up dates. Phone numbers and message history are not shared.', tasksRead:'Read follow-up tasks', tasksReadHelp:'See task titles, status, due dates and lead context permitted to this account.', tasksManage:'Create and update follow-up tasks', tasksManageHelp:'Create tasks assigned to this account and change task status. Existing 7Network task notifications may notify the assigned account. ChatGPT cannot message customers.', offline:'Keep this connection active', offlineHelp:'Allow refresh tokens so ChatGPT can stay connected. You can revoke the connection at any time.', allowError:'Could not complete authorization. Check the account session and retry.' },
    ar: { eyebrow:'ربط آمن للحساب', title:'ربط ChatGPT بـ 7Network', intro:'اختر ما يمكن لـ ChatGPT الوصول إليه لهذا الحساب. يمكنك قطع الاتصال في أي وقت من صفحة التكاملات في 7Network.', signIn:'سجّل الدخول إلى حساب 7Network الحالي للمتابعة.', ownerLogin:'تسجيل دخول حساب النشاط التجاري', agentLogin:'تسجيل دخول الوكيل', switchAccount:'اختر الحساب المسجل الذي تريد ربطه:', accessTitle:'الصلاحيات المطلوبة', scopeLegend:'اختر الصلاحيات لهذا الاتصال بـ ChatGPT', allow:'السماح والمتابعة', deny:'إلغاء', footer:'تظل صلاحيات حسابك مطبقة على كل طلب. لا يستطيع ChatGPT إرسال رسائل للعملاء ضمن هذه النسخة التجريبية.', checking:'جارٍ التحقق من الصلاحيات المطلوبة…', expired:'انتهت صلاحية طلب التفويض. ارجع إلى ChatGPT وأعد الاتصال.', signInRequired:'سجّل الدخول إلى حساب 7Network الذي تريد ربطه.', loading:'جارٍ إعداد الاتصال الآمن…', failed:'تعذر تحميل هذا الطلب. ارجع إلى ChatGPT وحاول مرة أخرى.', invalidScopes:'اختر صلاحية واحدة متاحة على الأقل.', account:'تم تسجيل الدخول باسم {name} ({role}).', pipeline:'قراءة العملاء المحتملين والمتابعات', pipelineHelp:'البحث ضمن العملاء المسموحين والاطلاع على مواعيد المتابعة. لا تتم مشاركة أرقام الهواتف أو سجل الرسائل.', tasksRead:'قراءة مهام المتابعة', tasksReadHelp:'عرض عناوين المهام وحالتها ومواعيدها وسياق العملاء المسموح لهذا الحساب.', tasksManage:'إنشاء مهام المتابعة وتحديثها', tasksManageHelp:'إنشاء مهام مسندة إلى هذا الحساب وتغيير حالتها. قد تؤدي قواعد الإشعارات الحالية في 7Network إلى إخطار الحساب المسند إليه. لا يستطيع ChatGPT مراسلة العملاء.', offline:'إبقاء الاتصال نشطاً', offlineHelp:'السماح برموز التحديث حتى يبقى ChatGPT متصلاً. يمكنك إلغاء الاتصال في أي وقت.', allowError:'تعذر إكمال التفويض. تحقق من جلسة الحساب وحاول مرة أخرى.' },
  };
  const labels = { 'pipeline.read':['pipeline','pipelineHelp'], 'tasks.read':['tasksRead','tasksReadHelp'], 'tasks.manage':['tasksManage','tasksManageHelp'], offline_access:['offline','offlineHelp'] };
  const roles = { owner:['Business owner','مالك النشاط التجاري'], manager:['Manager','مدير'], team_leader:['Team leader','قائد فريق'], agent:['Agent','وكيل'], accountant:['Accountant','محاسب'] };
  const params = new URLSearchParams(location.search);
  const transactionId = params.get('tx') || '';
  const requestedActor = params.get('actor') === 'agent' ? 'agent' : params.get('actor') === 'user' ? 'user' : null;
  let selectedActor = requestedActor;
  const $ = selector => document.querySelector(selector);
  const notice = $('#notice');
  let language = 'en';
  let accessContext = null;
  let busy = false;

  try { language = /^(ar(?:[-_]|$)|arabic)/i.test(localStorage.getItem('language') || document.documentElement.lang || '') ? 'ar' : 'en'; } catch (_) {}
  const tr = key => copy[language][key] || copy.en[key] || key;
  const setNotice = (key, kind = '') => { notice.textContent = tr(key); notice.dataset.kind = kind; };
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-copy]').forEach(node => { node.textContent = tr(node.dataset.copy); });

  function actorKind() {
    if (selectedActor) return selectedActor;
    try {
      if (localStorage.getItem('wacrm_user')) return 'user';
      if (localStorage.getItem('wacrm_agent')) return 'agent';
    } catch (_) {}
    return 'user';
  }
  function returnTo(kind) {
    const url = new URL('/mcp/oauth/authorize', location.origin);
    url.searchParams.set('tx', transactionId);
    url.searchParams.set('actor', kind);
    return `${url.pathname}${url.search}`;
  }
  function showSignIn() {
    $('#sign-in').hidden = false;
    $('#consent').hidden = true;
    $('#owner-login').href = `/user/login?mcp_actor=user&mcp_force_login=1&mcp_return=${encodeURIComponent(returnTo('user'))}`;
    $('#agent-login').href = `/agent/login?mcp_actor=agent&mcp_force_login=1&mcp_return=${encodeURIComponent(returnTo('agent'))}`;
    setNotice('signInRequired');
  }
  function showAccountSwitcher() {
    if (requestedActor) return;
    try { $('#account-switch').hidden = !(localStorage.getItem('wacrm_user') && localStorage.getItem('wacrm_agent')); }
    catch (_) { $('#account-switch').hidden = true; }
  }
  function validTransaction() { return /^[A-Za-z0-9_-]{40,64}$/.test(transactionId); }
  function loadWorkspaceApi(kind) {
    return new Promise((resolve, reject) => {
      if (window.SaleMaxWorkspace) {
        window.SaleMaxActor = kind === 'agent' ? 'agent' : 'user';
        window.SaleMaxWorkspace.paths.chatgpt = '/api/workspace/chatgpt';
        return resolve(window.SaleMaxWorkspace);
      }
      window.SaleMaxActor = kind === 'agent' ? 'agent' : 'user';
      const script = document.createElement('script');
      script.src = '/workspace-api.js?v=20261028-team-cookie-auth1';
      script.onload = () => {
        if (!window.SaleMaxWorkspace) return reject(new Error('WORKSPACE_API_UNAVAILABLE'));
        window.SaleMaxWorkspace.paths.chatgpt = '/api/workspace/chatgpt';
        resolve(window.SaleMaxWorkspace);
      };
      script.onerror = () => reject(new Error('WORKSPACE_API_UNAVAILABLE'));
      document.head.append(script);
    });
  }
  function scopeNode(scope, defaultChecked) {
    const [title, help] = labels[scope] || [scope, scope];
    const label = document.createElement('label');
    label.className = 'scope-option';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = 'scope'; input.value = scope; input.checked = Boolean(defaultChecked);
    const text = document.createElement('span');
    const strong = document.createElement('strong'); strong.textContent = tr(title);
    const small = document.createElement('small'); small.textContent = tr(help);
    text.append(strong, small); label.append(input, text); return label;
  }
  async function initialize() {
    if (!validTransaction()) { setNotice('expired', 'error'); return; }
    showAccountSwitcher();
    $('#consent').hidden = true;
    $('#account').hidden = true;
    $('#switch-user').disabled = true; $('#switch-agent').disabled = true;
    const actor = actorKind();
    setNotice('checking');
    try {
      const api = await loadWorkspaceApi(actor);
      const response = await api.request('chatgpt', `/oauth-transaction?transaction_id=${encodeURIComponent(transactionId)}`);
      accessContext = response.data;
      $('#account').hidden = false;
      $('#account').textContent = tr('account').replace('{name}', accessContext.account?.name || '').replace('{role}', roles[accessContext.account?.role]?.[language === 'ar' ? 1 : 0] || accessContext.account?.role || '');
      const requested = accessContext.availableScopes || [];
      const suggested = new Set(accessContext.suggestedScopes || []);
      const fields = $('#scopes');
      fields.querySelectorAll('.scope-option').forEach(node => node.remove());
      requested.filter(scope => labels[scope]).forEach(scope => fields.append(scopeNode(scope, suggested.has(scope))));
      $('#sign-in').hidden = true;
      $('#consent').hidden = false;
      $('#allow').disabled = requested.length === 0;
      setNotice(requested.length ? '' : 'failed', requested.length ? '' : 'error');
      if (!requested.length) $('#allow').disabled = true;
      $('#switch-user').disabled = false; $('#switch-agent').disabled = false;
    } catch (error) {
      $('#switch-user').disabled = false; $('#switch-agent').disabled = false;
      if (error?.message === 'AUTH_REQUIRED' || error?.message === 'BUSINESS_ACCESS_INACTIVE' || error?.message === 'BUSINESS_ACCESS_CHANGED') showSignIn();
      else setNotice('failed', 'error');
    }
  }
  async function continueAuthorization(approve) {
    if (busy) return;
    busy = true;
    $('#allow').disabled = true; $('#deny').disabled = true;
    try {
      const api = window.SaleMaxWorkspace;
      if (!approve) {
        const result = await api.request('chatgpt', '/oauth-deny', { method: 'POST', body: { transaction_id: transactionId } });
        return goToCallback(result.data.redirectUrl);
      }
      const scopes = [...document.querySelectorAll('input[name="scope"]:checked')].map(input => input.value);
      if (!scopes.length) { setNotice('invalidScopes', 'error'); return; }
      setNotice('saving');
      const result = await api.request('chatgpt', '/oauth-authorize', { method: 'POST', body: { transaction_id: transactionId, scopes } });
      return goToCallback(result.data.redirectUrl);
    } catch (_) {
      setNotice(approve ? 'allowError' : 'failed', 'error');
      busy = false; $('#allow').disabled = false; $('#deny').disabled = false;
    }
  }
  function goToCallback(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com'].includes(url.hostname) || !/^\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)) throw new Error();
      location.assign(url.toString());
    } catch (_) { setNotice('failed', 'error'); busy = false; $('#allow').disabled = false; $('#deny').disabled = false; }
  }
  $('#allow').addEventListener('click', () => continueAuthorization(true));
  $('#deny').addEventListener('click', () => continueAuthorization(false));
  $('#switch-user').addEventListener('click', () => { selectedActor = 'user'; initialize(); });
  $('#switch-agent').addEventListener('click', () => { selectedActor = 'agent'; initialize(); });
  initialize();
})();
