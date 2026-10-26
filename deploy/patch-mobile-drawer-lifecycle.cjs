'use strict';
const fs=require('node:fs');const root=process.argv[2]||'/app/client/public';
const file=root+'/training-sidebar.js';let s=fs.readFileSync(file,'utf8');
function once(a,b){if(s.split(a).length!==2)throw Error('Expected one drawer lifecycle anchor: '+a);s=s.replace(a,b);}
once('      const collapsed = expanded === false || measuredDrawerWidth < 110;',`      // A temporary phone drawer closes; it never becomes a desktop icon rail.
      const mobileDrawer = window.innerWidth < 900;
      if (mobileDrawer) sidebarExpandedOverride.delete(drawer);
      const collapsed = !mobileDrawer && (expanded === false || measuredDrawerWidth < 110);`);
once("    const drawer = button.closest('.MuiDrawer-paper');\n    if (/\\bexpand\\b/i.test(action)) {",`    const drawer = button.closest('.MuiDrawer-paper');
    if (window.innerWidth < 900) {
      if (drawer) sidebarExpandedOverride.delete(drawer);
      drawer?.removeAttribute('data-sx-sidebar-collapsed');
      schedule();
      return;
    }
    if (/\\bexpand\\b/i.test(action)) {`);
fs.writeFileSync(file,s);
const shell=root+'/index.html';let html=fs.readFileSync(shell,'utf8');const refs=html.match(/training-sidebar\.js\?v=[^"'\s<>]+/g);if(refs?.length!==1)throw Error('Expected one sidebar ref');fs.writeFileSync(shell,html.replace(refs[0],'training-sidebar.js?v=20261026-mobile-lifecycle1'));
