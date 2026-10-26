const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || '/app/client/public';
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const write = (name, value) => fs.writeFileSync(path.join(root, name), value);
const replaceOnce = (source, before, after, label) => {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected exactly one ${label} anchor`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
};

let dashboardCss = read('business-dashboard/dashboard.css');
const mobileCssMarker = '/* 20261026 mobile-fit: allow dashboard values and labels to wrap */';
const mobileCss = `${mobileCssMarker}
@media(max-width:600px){
  .dashboard,.dashboard *{min-width:0}
  .dashboard{width:100%;overflow-x:clip}
  .hero-actions{flex-wrap:wrap;justify-content:flex-start}
  .hero-actions .period{max-width:100%;white-space:normal}
  .metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
  .metric{overflow:visible;padding:13px 12px}
  .metric-label,.metric-note{overflow-wrap:anywhere;line-height:1.4}
  .metric-value{font-size:clamp(18px,5.2vw,22px);line-height:1.2;letter-spacing:-.025em;white-space:normal;overflow-wrap:anywhere;word-break:normal}
  .sales-category .metric{padding:13px 12px}
  .sales-category .metric-value{font-size:clamp(17px,4.8vw,21px);white-space:normal;overflow-wrap:anywhere}
  .sales-category .sales-finance-row{grid-template-columns:1fr 1fr;align-items:start}
  .sales-category .sales-finance-row>strong{grid-column:1/-1}
  .sales-category .sales-finance-row b{white-space:normal;overflow-wrap:anywhere;line-height:1.35}
  .sales-category .sales-call-list small,.sales-category .sales-call-list p,
  .sales-category .sales-action-row strong,.sales-category .sales-action-row span,
  .bar-label{white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere}
  .sales-category .sales-action-row{align-items:flex-start;flex-wrap:wrap}
  .sales-category .sales-action-row strong{flex:1 1 100%}
  .text-link{white-space:normal;overflow-wrap:anywhere}
}
@media(max-width:360px){
  .dashboard{padding-inline:10px}
  .metrics,.sales-category .metrics{grid-template-columns:minmax(0,1fr)}
  .metric{min-height:0}
  .hero-actions{gap:8px}
}`;
if (!dashboardCss.includes(mobileCssMarker)) dashboardCss += `\n${mobileCss}\n`;
write('business-dashboard/dashboard.css', dashboardCss);

let dashboardHtml = read('business-dashboard/index.html');
if (!dashboardHtml.includes('dashboard.css?v=20261026-mobile-fit1')) {
  dashboardHtml = replaceOnce(dashboardHtml, 'dashboard.css?v=20261018-v2', 'dashboard.css?v=20261026-mobile-fit1', 'dashboard stylesheet cache reference');
}
write('business-dashboard/index.html', dashboardHtml);

let shellHtml = read('index.html');
if (!shellHtml.includes('training-sidebar.js?v=20261026-sidebar-mobile-unified1')) {
  shellHtml = replaceOnce(shellHtml, 'training-sidebar.js?v=20261026-chatbot-context-routing1', 'training-sidebar.js?v=20261026-sidebar-mobile-unified1', 'sidebar script cache reference');
}
write('index.html', shellHtml);

let sidebar = read('training-sidebar.js');
const sidebarMarker = '/* 20261026 sidebar-mobile-unified */';
if (!sidebar.includes(sidebarMarker)) {
  const styleAnchor = '    [data-sx-search-hidden],[data-sx-nav-section][hidden]{display:none!important}';
  const styleReplacement = `${styleAnchor}
    .sx-sidebar-search-wrap{box-sizing:border-box!important;display:block!important;padding:10px 12px!important;border-bottom:1px solid #e7eaf0!important;background:#fff!important}
    .sx-sidebar-search-wrap input{box-sizing:border-box!important;display:block!important;width:100%!important;min-width:0!important;height:40px!important;padding:0 12px!important;border:1px solid #e1e6ee!important;border-radius:10px!important;background:#f7f8fa!important;color:#182230!important;font:400 14px/1.4 Roboto,Arial,sans-serif!important;outline:none!important}
    .sx-sidebar-search-wrap input:focus{border-color:#1768d4!important;box-shadow:0 0 0 2px #1768d426!important}
    [data-sx-sidebar-list] .MuiListItemButton-root::after{content:none!important}`;
  sidebar = replaceOnce(sidebar, styleAnchor, styleReplacement, 'sidebar search style');

  const helperAnchor = '  function applyTenantNavigationLabel(row,key) {';
  const helpers = `  ${sidebarMarker}
  function ensureMobileSidebarSearch(drawer,list) {
    if (window.innerWidth > 700 || drawer.querySelector('input')) return;
    const wrap=document.createElement('div');wrap.className='sx-sidebar-search-wrap';wrap.dataset.sxSidebarSearch='1';
    const input=document.createElement('input');input.type='search';input.name='salemax-navigation-query';input.autocomplete='new-password';
    input.placeholder=tr('Search menu…','ابحث في القائمة…');input.setAttribute('aria-label',tr('Search menu','ابحث في القائمة'));input.setAttribute('data-sx-search-empty','');
    input.addEventListener('input',()=>input.toggleAttribute('data-sx-search-empty',!input.value));wrap.append(input);list.before(wrap);
  }
  function hasVisibleSidebarText(row) {
    const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){
      if(!node.nodeValue.trim()||node.parentElement?.closest('[aria-hidden="true"],.MuiListItemIcon-root,svg,script,style,.sx-sidebar-fallback-label'))continue;
      let hidden=false;for(let parent=node.parentElement;parent&&row.contains(parent);parent=parent.parentElement){const style=getComputedStyle(parent);if(style.display==='none'||style.visibility==='hidden'){hidden=true;break;}}
      if(hidden)continue;const range=document.createRange();range.selectNodeContents(node);const rects=range.getClientRects();if([...rects].some(rect=>rect.width>0&&rect.height>0))return true;
    }
    return false;
  }
`;
  sidebar = replaceOnce(sidebar, helperAnchor, `${helpers}${helperAnchor}`, 'sidebar helper insertion');

  const listAnchor = `      const list = drawer.querySelector('ul');\n      if (!list) return;\n      const searchInput = drawer.querySelector('input');`;
  const listReplacement = `      const list = drawer.querySelector('ul');\n      if (!list) return;\n      ensureMobileSidebarSearch(drawer,list);\n      const searchInput = drawer.querySelector('input');`;
  sidebar = replaceOnce(sidebar, listAnchor, listReplacement, 'sidebar search insertion');

  const visibleAnchor = `            const nativeText=row.querySelector('.sx-tenant-navigation-label, .MuiListItemText-primary');\n            const nativeStyle=nativeText?getComputedStyle(nativeText):null;\n            const hasVisibleText=!!nativeText?.textContent?.trim()&&nativeStyle?.display!=='none'&&nativeStyle?.visibility!=='hidden'&&nativeText.getClientRects().length>0;`;
  const visibleReplacement = `            const hasVisibleText=hasVisibleSidebarText(row);`;
  sidebar = replaceOnce(sidebar, visibleAnchor, visibleReplacement, 'sidebar visible-label detection');
  sidebar = sidebar.replace("window.__sxTrainingSidebar = true;", "window.__sxTrainingSidebar = true;");
}
write('training-sidebar.js', sidebar);
