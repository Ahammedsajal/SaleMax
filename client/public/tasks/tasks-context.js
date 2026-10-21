(() => {
  'use strict';

  const language = (localStorage.getItem('language') || '').toLowerCase();
  const arabic = language === 'ar' || language.startsWith('ar-') || language.includes('arab');
  const token = localStorage.getItem('wacrm_user');
  let taskTypeLabels = new Map();

  function refreshRenderedTaskTypeLabels() {
    const list = document.getElementById('taskList');
    if (list) for (const element of list.querySelectorAll('.task > div > .meta > span:not(.badge)')) {
      const key = element.textContent.trim();
      const label = taskTypeLabels.get(key);
      if (label && element.textContent !== label) element.textContent = label;
    }
    const detailLabel = document.querySelector('#detail .detail-head small');
    if (detailLabel) {
      const match = detailLabel.textContent.match(/^([a-z][a-z0-9_-]{1,63})( · .*)$/);
      const label = match && taskTypeLabels.get(match[1]);
      if (match && label) detailLabel.textContent = `${label}${match[2]}`;
    }
  }

  const taskLabelObserver = new MutationObserver(refreshRenderedTaskTypeLabels);
  for (const selector of ['#taskList', '#detail']) {
    const target = document.querySelector(selector);
    if (target) taskLabelObserver.observe(target, { childList: true, subtree: true, characterData: true });
  }
  function applyWorkspaceCategory(category) {
    const title = category?.title;
    let en = '7NETWORK · TEAM TASKS';
    let ar = '7Network · مهام الفريق';
    if (category?.key === '7network_sales') {
      en = '7NETWORK SALES';
      ar = '7Network · المبيعات';
    } else if (typeof title?.en === 'string' && typeof title?.ar === 'string') {
      en = `7NETWORK · ${title.en.toLocaleUpperCase('en-US')}`;
      ar = `7Network · ${title.ar}`;
    }
    for (const selector of ['main.app > header small', '#taskDialog header small']) {
      const element = document.querySelector(selector);
      if (!element) continue;
      element.dataset.en = en;
      element.dataset.ar = ar;
      element.textContent = arabic ? ar : en;
    }
  }

  function applyTaskTypes(data) {
    const select = document.querySelector('#taskForm [name="taskType"]');
    const dialog = document.getElementById('taskDialog');
    const taskTypes = data?.taskTypes;
    if (!select || !Array.isArray(taskTypes) || dialog?.open) return false;
    const types = taskTypes.filter(item => item && typeof item.key === 'string'
      && /^[a-z][a-z0-9_-]{1,63}$/.test(item.key)
      && typeof item.label?.en === 'string' && typeof item.label?.ar === 'string');
    if (!types.length) return false;
    taskTypeLabels = new Map(types.map(item => [item.key, arabic ? item.label.ar : item.label.en]));
    const previous = select.value;
    select.replaceChildren(...types.map(item => {
      const option = document.createElement('option');
      option.value = item.key;
      option.dataset.en = item.label.en;
      option.dataset.ar = item.label.ar;
      option.textContent = arabic ? item.label.ar : item.label.en;
      return option;
    }));
    if (types.some(item => item.key === previous)) select.value = previous;
    applyWorkspaceCategory(data.workspaceCategory);
    refreshRenderedTaskTypeLabels();
    return true;
  }

  function loadTaskTypes() {
    fetch('/api/pipeline/tasks?scope=mine&status=all&limit=1', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      cache: 'no-store',
    }).then(response => response.ok ? response.json() : null)
      .then(result => {
        const data = result?.data;
        if (applyTaskTypes(data)) return;
        const dialog = document.getElementById('taskDialog');
        if (dialog && Array.isArray(data?.taskTypes)) dialog.addEventListener('close', () => applyTaskTypes(data), { once: true });
      }).catch(() => {});
  }

  loadTaskTypes();
})();
