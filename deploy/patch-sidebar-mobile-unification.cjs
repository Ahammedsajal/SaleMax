'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || '/app';
const sidebarPath = path.join(root, 'client/public/training-sidebar.js');
const indexPath = path.join(root, 'client/public/index.html');
const version = '20261026-sidebar-mobile-unified1';
let sidebar = fs.readFileSync(sidebarPath, 'utf8');

function replaceOnce(source, before, after, name) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error('EXPECTED_ONE_' + name + '_ANCHOR_GOT_' + count);
  return source.replace(before, after);
}

const styleAnchor = '    [data-sx-sidebar-collapsed] [data-sx-sidebar-list] .sx-sidebar-fallback-label{display:none!important}';
const styles = [
  '    [data-sx-sidebar-list] .MuiListItemButton-root[data-sx-sidebar-label-normalized]::after{content:none!important;display:none!important}',
  '    .sx-sidebar-search{box-sizing:border-box;width:100%;padding:8px 12px 10px;margin:0 0 8px;border-bottom:1px solid #edf0f3}',
  '    .MuiDrawer-paper input.sx-sidebar-search-input{box-sizing:border-box;width:100%;min-width:0;max-width:100%;height:44px;min-height:44px;padding:0 12px;border:1px solid #e1e6ed;border-radius:12px;background:#f5f7fa;color:#182537;font:400 13px Roboto,Arial,sans-serif}',
  '    .MuiDrawer-paper input.sx-sidebar-search-input::placeholder{color:#98a2b3;opacity:1}'
].join('\n');
sidebar = replaceOnce(sidebar, styleAnchor, styleAnchor + '\n' + styles, 'SIDEBAR_STYLE');

const helperAnchor = '  function trainingIcon(row, name) {';
const helper = [
  '  function hasVisibleSidebarText(root) {',
  '    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);',
  '    let text;',
  '    while ((text = walker.nextNode())) {',
  '      if (!text.nodeValue?.trim()) continue;',
  '      const parent = text.parentElement;',
  '      if (!parent || parent.closest(\'[aria-hidden="true"],svg,.MuiListItemIcon-root,[data-sx-native-label-hidden],script,style\')) continue;',
  '      let visible = true;',
  '      for (let element = parent; element; element = element.parentElement) {',
  '        const computed = getComputedStyle(element);',
  '        if (computed.display === \'none\' || computed.visibility === \'hidden\' || computed.opacity === \'0\') { visible = false; break; }',
  '        if (element === root) break;',
  '      }',
  '      if (!visible) continue;',
  '      const range = document.createRange();',
  '      range.selectNodeContents(text);',
  '      if (range.getClientRects().length) return true;',
  '    }',
  '    return false;',
  '  }',
  '  function ensureSidebarSearch(drawer, list) {',
  '    let input = drawer.querySelector(\'input[name="salemax-navigation-query"],input[type="search"]\') || drawer.querySelector(\'input\');',
  '    if (!input) {',
  '      const row = document.createElement(\'div\');',
  '      row.className = \'sx-sidebar-search\';',
  '      input = document.createElement(\'input\');',
  '      input.type = \'search\';',
  '      row.append(input);',
  '      list.before(row);',
  '    }',
  '    input.type = \'search\';',
  '    input.name = \'salemax-navigation-query\';',
  '    input.classList.add(\'sx-sidebar-search-input\');',
  '    input.setAttribute(\'data-sx-sidebar-search-input\', \'1\');',
  '    input.setAttribute(\'aria-label\', tr(\'Search menu\', \'ابحث في القائمة\'));',
  '    if (!input.placeholder) input.placeholder = tr(\'Search menu...\', \'ابحث في القائمة...\');',
  '    return input;',
  '  }'
].join('\n');
sidebar = replaceOnce(sidebar, helperAnchor, helper + '\n' + helperAnchor, 'SIDEBAR_HELPER');

const searchAnchor = [
  '      const searchInput = drawer.querySelector(\'input\');',
  '      if (searchInput) {',
  '        if (searchInput.type !== \'search\') searchInput.type = \'search\';',
  '        if (searchInput.autocomplete !== \'new-password\') searchInput.setAttribute(\'autocomplete\', \'new-password\');',
  '        if (searchInput.name !== \'salemax-navigation-query\') searchInput.setAttribute(\'name\', \'salemax-navigation-query\');',
  '        searchInput.toggleAttribute(\'data-sx-search-empty\', !searchInput.value);',
  '      }'
].join('\n');
const searchReplacement = [
  '      const searchInput = ensureSidebarSearch(drawer, list);',
  '      if (searchInput.autocomplete !== \'new-password\') searchInput.setAttribute(\'autocomplete\', \'new-password\');',
  '      searchInput.toggleAttribute(\'data-sx-search-empty\', !searchInput.value);'
].join('\n');
sidebar = replaceOnce(sidebar, searchAnchor, searchReplacement, 'SIDEBAR_SEARCH');

const fallbackAnchor = [
  '            const nativeText=row.querySelector(\'.sx-tenant-navigation-label, .MuiListItemText-primary\');',
  '            const nativeStyle=nativeText?getComputedStyle(nativeText):null;',
  '            const hasVisibleText=!!nativeText?.textContent?.trim()&&nativeStyle?.display!==\'none\'&&nativeStyle?.visibility!==\'hidden\'&&nativeText.getClientRects().length>0;',
  '            let fallback=navButton.querySelector(\':scope > .sx-sidebar-fallback-label\');',
  '            if(!hasVisibleText&&tooltip){'
].join('\n');
const fallbackReplacement = [
  '            const hasVisibleText=hasVisibleSidebarText(navButton);',
  '            navButton.setAttribute(\'data-sx-sidebar-label-normalized\',\'\');',
  '            let fallback=navButton.querySelector(\':scope > .sx-sidebar-fallback-label\');',
  '            if(!hasVisibleText&&tooltip){'
].join('\n');
sidebar = replaceOnce(sidebar, fallbackAnchor, fallbackReplacement, 'SIDEBAR_LABEL');

const html = fs.readFileSync(indexPath, 'utf8');
const matches = [...html.matchAll(/training-sidebar\.js\?v=[^"'\s]+/g)];
if (matches.length !== 1) throw new Error('EXPECTED_ONE_TRAINING_SIDEBAR_CACHE_REFERENCE_GOT_' + matches.length);
fs.writeFileSync(sidebarPath, sidebar);
fs.writeFileSync(indexPath, html.replace(matches[0][0], 'training-sidebar.js?v=' + version));
