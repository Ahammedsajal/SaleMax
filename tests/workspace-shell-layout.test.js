'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../client/public/pipeline-entry.js'),'utf8');
function boot({pathname='/user',page='',width=1440,height=900,side='left',drawerWidth=260,temporary=false,offscreen=false}={}){
  const frames=new Map(),listeners={},rect=(left,top,w,h)=>({left,right:left+w,top,bottom:top+h,y:top,width:w,height:h});
  const drawer={classList:{contains:()=>false},querySelector:()=>null,getBoundingClientRect:()=>rect(offscreen?-drawerWidth:side==='right'?width-drawerWidth:0,0,drawerWidth,height),closest:selector=>selector==='.MuiModal-root'&&temporary?{}:null};
  const topbar={getBoundingClientRect:()=>rect(0,0,width,64),matches:()=>true,querySelectorAll:()=>[]};
  const document={documentElement:{},getElementById:id=>frames.get(id),querySelectorAll:selector=>selector==='.MuiDrawer-paper,[data-sx-agent-sidebar]'?(drawerWidth?[drawer]:[]):selector==='header.MuiAppBar-root, .MuiAppBar-root, .MuiBox-root'?[topbar]:[],
    createElement:()=>({style:{},addEventListener(name,fn){this[name]=fn;},contentDocument:{addEventListener(name,fn){listeners[name]=fn;}},getAttribute(name){return this[name];},remove(){frames.delete(this.id);}}),
    body:{append(frame){frames.set(frame.id,frame);},appendChild(frame){frames.set(frame.id,frame);}}};
  const location={pathname,search:page?'?page='+page:'',origin:'https://crm.salemax.qa',href:'https://crm.salemax.qa'+pathname};
  const events={};
  vm.runInNewContext(source,{window:{innerWidth:width,innerHeight:height,addEventListener:(name,fn)=>events[name]=fn},document,location,URL,URLSearchParams,localStorage:{getItem:()=>side==='right'?'ar-QA':'en'},getComputedStyle:()=>({visibility:'visible',display:'block'}),MutationObserver:class{observe(){}},requestAnimationFrame:fn=>fn()});
  return {frames,events,listeners,location};
}
test('Agent Chats, My Tasks, login and unrelated business screens never mount the business dashboard',()=>{
  for(const pathname of ['/agent','/agent/','/agent/login','/user/login','/admin'])for(const page of ['', 'chat','my-task'])assert.equal(boot({pathname,page}).frames.size,0,pathname+' '+page);
  for(const page of ['chat','phonebook','team-invitations','finance-settings','courses'])assert.equal(boot({page}).frames.size,0,page);
});
const routes=['dashboard','lead-pipeline','lead-reports','tasks','call-center','commission-policy','sales-workspace','sales-finance','sales-organization','sales-audit'];
test('every embedded workspace fits desktop, narrow, RTL, collapsed and temporary drawers',()=>{
  for(const page of routes)for(const width of [320,390,750,1440])for(const side of ['left','right'])for(const mode of ['docked','collapsed','temporary','offscreen']){
    const drawerWidth=mode==='collapsed'?0:Math.min(260,width*.6);
    const {frames}=boot({page,width,side,drawerWidth,temporary:mode==='temporary',offscreen:mode==='offscreen'});
    assert.equal(frames.size,1,page);
    const frame=[...frames.values()][0],reserved=mode==='docked'?drawerWidth:0;
    assert.equal(frame.style.width,(width-reserved)+'px',`${page} ${width} ${side} ${mode}`);
    assert.equal(frame.style.left,(side==='left'?reserved:0)+'px');
    assert.equal(frame.style.top,'64px');assert.equal(frame.style.height,'836px');
  }
});
test('route transitions remove stale workspaces instead of stacking overlays',()=>{
  const app=boot({page:'dashboard'});app.location.search='?page=tasks';app.events.popstate();
  assert.deepEqual([...app.frames.keys()],['salemax-tasks-workspace']);
  app.location.pathname='/agent';app.location.search='';app.events.popstate();assert.equal(app.frames.size,0);
});
test('workspace links to shell pages escape the iframe while external and explicit targets are preserved',()=>{
  const {listeners}=boot({page:'tasks'});
  const link=(href,attributes=[])=>({href,hasAttribute:name=>attributes.includes(name)});
  for(const destination of ['/user?page=chat','/user?page=tasks','/agent','/admin']){
    const anchor=link('https://crm.salemax.qa'+destination);listeners.click({target:{closest:()=>anchor}});assert.equal(anchor.target,'_top');
  }
  for(const anchor of [link('https://example.com/user'),link('https://crm.salemax.qa/user',['target']),link('https://crm.salemax.qa/user',['download']),link('https://crm.salemax.qa/pipeline/?lead=1')]){
    listeners.click({target:{closest:()=>anchor}});assert.equal(anchor.target,undefined);
  }
});
