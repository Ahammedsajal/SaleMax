(() => {
  'use strict';

  const copy = {
    en: {
      openLatestChat: 'Open latest chat', inboxChecking: 'Checking Inbox…', inboxUnavailable: 'Inbox status unavailable',
      unreadOne: '1 unread message', unreadMany: '{count} unread messages', inboxClear: 'No unread messages',
      nextTask: 'Next task', taskLoading: 'Loading the next task…', taskNone: 'No active task is linked to this lead.',
      taskDenied: 'Task details are not available for your role.', taskError: 'Could not load the next task.',
      assignedTo: 'Assigned to', noAssignee: 'Unassigned', openTasks: 'Open Tasks', noDueDate: 'No due date',
      dueOverdue: 'Overdue', dueToday: 'Due today', dueOn: 'Due', taskOpen: 'Open', taskInProgress: 'In progress', taskBlocked: 'Blocked', retry: 'Retry',
      progression: 'Sales progression', application: 'Application', saleReview: 'Sale review', enrollment: 'Enrollment', invoice: 'Invoice',
      applicationSubmitted: 'Submitted', noApplication: 'No linked application', waitingApplication: 'Waiting for application',
      reviewPending: 'In review', reviewApproved: 'Approved', reviewRejected: 'Rejected', reviewNotRequested: 'Not requested',
      enrollmentPending: 'Awaiting approval', enrollmentDone: 'Enrolled', invoicePending: 'Invoice pending', invoiceIssued: 'Issued', notStarted: 'Not started'
    },
    ar: {
      openLatestChat: 'فتح أحدث محادثة', inboxChecking: 'جارٍ التحقق من صندوق الوارد…', inboxUnavailable: 'حالة صندوق الوارد غير متاحة',
      unreadOne: 'رسالة واحدة غير مقروءة', unreadMany: '{count} رسائل غير مقروءة', inboxClear: 'لا توجد رسائل غير مقروءة',
      nextTask: 'المهمة التالية', taskLoading: 'جارٍ تحميل المهمة التالية…', taskNone: 'لا توجد مهمة نشطة مرتبطة بهذا العميل.',
      taskDenied: 'تفاصيل المهام غير متاحة لدورك.', taskError: 'تعذر تحميل المهمة التالية.',
      assignedTo: 'المسؤول', noAssignee: 'غير معيّن', openTasks: 'فتح المهام', noDueDate: 'بلا موعد استحقاق',
      dueOverdue: 'متأخرة', dueToday: 'مستحقة اليوم', dueOn: 'موعدها', taskOpen: 'مفتوحة', taskInProgress: 'قيد التنفيذ', taskBlocked: 'متوقفة', retry: 'إعادة المحاولة',
      progression: 'تقدم البيع', application: 'الطلب', saleReview: 'مراجعة البيع', enrollment: 'التسجيل', invoice: 'الفاتورة',
      applicationSubmitted: 'تم الإرسال', noApplication: 'لا يوجد طلب مرتبط', waitingApplication: 'بانتظار الطلب',
      reviewPending: 'قيد المراجعة', reviewApproved: 'تمت الموافقة', reviewRejected: 'مرفوضة', reviewNotRequested: 'لم تُطلب',
      enrollmentPending: 'بانتظار الموافقة', enrollmentDone: 'تم التسجيل', invoicePending: 'الفاتورة قيد الانتظار', invoiceIssued: 'صدرت', notStarted: 'لم تبدأ'
    }
  };
  const ar = () => /^(ar|arabic)/i.test(localStorage.getItem('language') || '');
  const word = key => (copy[ar() ? 'ar' : 'en'][key] || key);
  const fill = (value, vars = {}) => Object.entries(vars).reduce((text, [key, replacement]) => text.replace('{' + key + '}', String(replacement)), value);
  const el = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  function inboxHref(chatId) {
    const params = new URLSearchParams();
    if (localStorage.getItem('wacrm_agent')) params.set('actor', 'agent');
    params.set('page', 'inbox');
    params.set('chatId', String(chatId || ''));
    return '/user?' + params.toString();
  }
  const dateText = value => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(ar() ? 'ar-QA' : 'en-QA', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Qatar'
    }).format(date);
  };
  const dateKey = value => new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Qatar'
  }).format(value);

  function mount({ lead, categoryKey }) {
    if (!lead) return;
    const hero = document.querySelector('.lead-detail-hero');
    const back = hero?.querySelector('.x');
    if (hero && back) {
      const actions = el('div', 'lead-detail-top-actions');
      const conversation = lead.conversations?.[0];
      if (conversation?.chat_id) {
        const open = el('a', 'primary lead-open-chat', word('openLatestChat'));
        open.href = inboxHref(conversation.chat_id);
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.setAttribute('aria-disabled', 'true');
        open.tabIndex = -1;
        open.addEventListener('click', event => {
          if (open.getAttribute('aria-disabled') === 'true') {
            event.preventDefault();
            return;
          }
          localStorage.setItem('currentChat', JSON.stringify({
            id: conversation.chat_id,
            chat_id: conversation.chat_id,
            origin: conversation.origin,
            sender_mobile: lead.mobile,
            sender_name: lead.relationship_name || lead.contact_name || lead.title
          }));
        });
        actions.append(open);
        const unread = el('span', 'lead-inbox-unread', word('inboxChecking'));
        unread.setAttribute('role', 'status');
        unread.setAttribute('aria-live', 'polite');
        actions.append(unread);
        loadUnreadStatus(conversation.chat_id, unread, open);
      }
      back.remove();
      actions.append(back);
      hero.append(actions);
    }

    const applicationChain = document.querySelector('.application-chain');
    if (categoryKey === 'training_center' && applicationChain) {
      const progress = el('section', 'lead-journey-progress');
      progress.id = 'leadJourneyProgress';
      progress.setAttribute('aria-live', 'polite');
      progress.append(renderProgress(lead, []));
      applicationChain.before(progress);
    }

    const actionBar = document.querySelector('.lead-actions');
    if (actionBar) {
      const taskCard = el('section', 'lead-next-task');
      taskCard.id = 'leadNextTask';
      taskCard.setAttribute('aria-live', 'polite');
      taskCard.append(...renderTaskLoading());
      actionBar.after(taskCard);
      loadNextTask(lead.id, taskCard);
    }
  }

  function renderTaskLoading() {
    const header = el('div', 'lead-next-task-heading');
    header.append(el('h3', '', word('nextTask')));
    const body = el('p', 'lead-task-loading', word('taskLoading'));
    return [header, body];
  }

  function taskUrl(leadId) {
    return appHome() + '?page=tasks&lead=' + encodeURIComponent(leadId);
  }

  async function loadNextTask(leadId, container) {
    if (!window.SaleMaxWorkspace?.request) {
      renderTaskMessage(container, 'taskError', leadId, true);
      return;
    }
    try {
      const response = await window.SaleMaxWorkspace.request('tasks', '/lead/' + encodeURIComponent(leadId) + '/next');
      const task = response?.data?.task;
      if (!task) {
        renderTaskMessage(container, 'taskNone', leadId, false);
        return;
      }
      renderTask(container, task, leadId);
    } catch (error) {
      renderTaskMessage(container, error?.message === 'PERMISSION_DENIED' ? 'taskDenied' : 'taskError', leadId, error?.message !== 'PERMISSION_DENIED');
    }
  }

  function renderTaskMessage(container, key, leadId, retry) {
    container.replaceChildren();
    const header = el('div', 'lead-next-task-heading');
    header.append(el('h3', '', word('nextTask')));
    if (key !== 'taskNone') header.append(el('span', 'lead-task-state', word(key)));
    container.append(header, el('p', 'lead-task-message', word(key)));
    const actions = el('div', 'lead-task-actions');
    const open = el('a', 'soft', word('openTasks'));
    open.href = taskUrl(leadId);
    open.target = '_top';
    actions.append(open);
    if (retry) {
      const button = el('button', 'soft', word('retry'));
      button.type = 'button';
      button.addEventListener('click', () => loadNextTask(leadId, container));
      actions.append(button);
    }
    container.append(actions);
  }

  function renderTask(container, task, leadId) {
    container.replaceChildren();
    const heading = el('div', 'lead-next-task-heading');
    heading.append(el('h3', '', word('nextTask')));
    const statusKey = task.status === 'in_progress' ? 'taskInProgress' : task.status === 'blocked' ? 'taskBlocked' : 'taskOpen';
    heading.append(el('span', 'lead-task-state', word(statusKey)));
    const title = el('strong', 'lead-task-title', task.title || '');
    const owners = Array.isArray(task.assignees) ? task.assignees.map(person => person.label).filter(Boolean) : [];
    const ownerLine = el('p', 'lead-task-owner', word('assignedTo') + ': ' + (owners.length ? owners.join(' · ') : word('noAssignee')));
    const dueLine = el('p', 'lead-task-due');
    if (!task.dueAt) {
      dueLine.append(el('span', 'lead-task-due-state', word('noDueDate')));
    } else {
      const due = new Date(task.dueAt);
      const now = new Date();
      const state = due.getTime() < now.getTime() ? 'dueOverdue' : dateKey(due) === dateKey(now) ? 'dueToday' : 'dueOn';
      dueLine.append(el('span', 'lead-task-due-state' + (state === 'dueOverdue' ? ' is-overdue' : ''), word(state)));
      dueLine.append(document.createTextNode(' · ' + dateText(task.dueAt)));
    }
    const actions = el('div', 'lead-task-actions');
    const open = el('a', 'soft', word('openTasks'));
    open.href = taskUrl(leadId);
    open.target = '_top';
    actions.append(open);
    container.append(heading, title, ownerLine, dueLine, actions);
  }

  async function loadUnreadStatus(chatId, target, openLink) {
    try {
      if (!window.SaleMaxWorkspace?.request) throw new Error('INBOX_STATUS_UNAVAILABLE');
      const response = await window.SaleMaxWorkspace.request('inbox', '/lead-status?chatId=' + encodeURIComponent(chatId));
      const data = response?.data;
      if (!data?.available || !Number.isFinite(Number(data.unreadCount))) {
        target.textContent = word('inboxUnavailable');
        target.dataset.state = 'unavailable';
        openLink.hidden = true;
        return;
      }
      openLink.removeAttribute('aria-disabled');
      openLink.tabIndex = 0;
      const count = Math.max(0, Number(data.unreadCount));
      target.textContent = count === 0 ? word('inboxClear') : count === 1 ? word('unreadOne') : fill(word('unreadMany'), { count });
      target.dataset.state = count > 0 ? 'unread' : 'clear';
    } catch {
      target.textContent = word('inboxUnavailable');
      target.dataset.state = 'unavailable';
      openLink.hidden = true;
    }
  }

  function renderProgress(lead, reviews) {
    const applications = Array.isArray(lead.applications) ? lead.applications : [];
    const application = applications[0] || null;
    const linkedReview = application
      ? (reviews || []).find(review => String(review.application_submission_id || '') === String(application.id)) || null
      : (reviews || [])[0] || null;
    const reviewStatus = linkedReview?.status || application?.saleReviewStatus || '';
    const reviewApproved = reviewStatus === 'approved' || Boolean(linkedReview?.converted);
    const enrolled = Boolean(application?.enrollmentId || linkedReview?.converted);
    const invoiceNumber = application?.invoiceNumber || linkedReview?.invoiceNumber || '';
    const applicationState = application ? 'complete' : linkedReview ? 'skipped' : 'current';
    const saleState = reviewApproved ? 'complete' : reviewStatus === 'pending' ? 'current' : reviewStatus === 'rejected' ? 'blocked' : application ? 'current' : 'upcoming';
    const enrollmentState = enrolled ? 'complete' : reviewApproved ? 'current' : 'upcoming';
    const invoiceState = invoiceNumber ? 'complete' : enrolled ? 'current' : 'upcoming';
    const applicationDetail = application ? word('applicationSubmitted') + (application.referenceCode ? ' · ' + application.referenceCode : '') : linkedReview ? word('noApplication') : word('waitingApplication');
    const reviewDetail = reviewStatus === 'pending' ? word('reviewPending') : reviewStatus === 'approved' || linkedReview?.converted ? word('reviewApproved') : reviewStatus === 'rejected' ? word('reviewRejected') : word('reviewNotRequested');
    const enrollmentDetail = enrolled ? word('enrollmentDone') + (application?.enrollmentStatus ? ' · ' + application.enrollmentStatus : '') : reviewApproved ? word('enrollmentPending') : word('notStarted');
    const invoiceDetail = invoiceNumber ? word('invoiceIssued') + ' · ' + invoiceNumber : enrolled ? word('invoicePending') : word('notStarted');
    const items = [
      { title: word('application'), detail: applicationDetail, state: applicationState },
      { title: word('saleReview'), detail: reviewDetail, state: saleState },
      { title: word('enrollment'), detail: enrollmentDetail, state: enrollmentState },
      { title: word('invoice'), detail: invoiceDetail, state: invoiceState }
    ];
    const list = el('ol', 'lead-journey-steps');
    list.setAttribute('aria-label', word('progression'));
    let currentAssigned = false;
    items.forEach((item, index) => {
      const step = el('li', 'lead-journey-step');
      step.dataset.state = item.state;
      if (['current', 'blocked'].includes(item.state) && !currentAssigned) {
        step.setAttribute('aria-current', 'step');
        currentAssigned = true;
      }
      step.append(el('span', 'lead-journey-index', String(index + 1)));
      const content = el('span', 'lead-journey-copy');
      content.append(el('strong', '', item.title), el('small', '', item.detail));
      step.append(content);
      list.append(step);
    });
    const section = el('section', 'lead-journey-strip');
    section.append(el('h3', '', word('progression')), list);
    return section;
  }

  function updateProgress(lead, reviews) {
    const container = document.getElementById('leadJourneyProgress');
    if (!container) return;
    container.replaceChildren(renderProgress(lead, reviews));
  }

  window.SaleMaxLeadDetailWorkspace = Object.freeze({ mount, updateProgress, inboxHref });
})();
