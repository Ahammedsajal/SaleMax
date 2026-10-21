#!/usr/bin/env node
'use strict';

// Static inventory for the Express router factories mounted by
// mount-existing-upgrade.js. This intentionally records review boundaries; it
// does not claim that a middleware name proves tenant/category authorization.
const fs=require('node:fs');
const path=require('node:path');
const acorn=require('acorn');
const root=path.resolve(__dirname,'..');
const routerFile=path.join(root,'modules/platform/mount-existing-upgrade.js');
const methods=new Set(['get','post','put','patch','delete','all']);
const routerNames=/^(router|owner|admin|accept|publicRouter|featureAccess|agentIdentity)$/;

function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const [key,value] of Object.entries(node)){if(key==='start'||key==='end')continue;if(Array.isArray(value))value.forEach(child=>walk(child,visit));else if(value&&typeof value==='object')walk(value,visit);}}
function parse(source,file){try{return acorn.parse(source,{ecmaVersion:'latest',sourceType:'script',locations:true});}catch(error){throw new Error(`Cannot parse ${file}:${error.loc?.line||'?'}: ${error.message}`);}}
function lit(node){return node?.type==='Literal'&&typeof node.value==='string'?node.value:null;}
function member(node){if(node?.type==='Identifier')return node.name;if(node?.type==='MemberExpression')return `${member(node.object)}.${node.computed?lit(node.property)||'?':node.property.name}`;return '';}
function methodName(node){return node?.type==='MemberExpression'?(node.computed?lit(node.property):node.property?.name):null;}
function isRouterObject(node){return node?.type==='Identifier'&&routerNames.test(node.name);}
function factoryInfo(node,imports){
 if(node?.type!=='CallExpression')return null;
 if(node.callee.type==='Identifier')return imports.get(node.callee.name)||null;
 if(node.callee.type==='CallExpression'&&node.callee.callee.name==='require'){
  const req=lit(node.callee.arguments[0]);if(req?.startsWith('./'))return {file:path.resolve(root,'modules/platform',`${req.slice(2)}.js`),factory:'default'};
 }
 if(node.callee.type==='MemberExpression'&&node.callee.object.type==='CallExpression'&&node.callee.object.callee.name==='require'){
  const req=lit(node.callee.object.arguments[0]);if(req?.startsWith('./'))return {file:path.resolve(root,'modules/platform',`${req.slice(2)}.js`),factory:methodName(node.callee)};
 }
 return null;
}
function importFactories(ast){
 const map=new Map();walk(ast,node=>{if(node.type!=='VariableDeclarator'||node.id.type!=='ObjectPattern'||node.init?.type!=='CallExpression'||node.init.callee.name!=='require')return;const req=lit(node.init.arguments[0]);if(!req?.startsWith('./'))return;for(const property of node.id.properties){if(property.type==='Property'&&property.value.type==='Identifier')map.set(property.value.name,{file:path.resolve(root,'modules/platform',`${req.slice(2)}.js`),factory:property.key.name});}});return map;
}
function mountInventory(){
 const ast=parse(fs.readFileSync(routerFile,'utf8'),'modules/platform/mount-existing-upgrade.js'),factories=importFactories(ast),bindings=new Map(),mounts=[],dynamic=[];
 walk(ast,node=>{if(node.type!=='VariableDeclarator'||node.id.type!=='Identifier')return;const direct=factoryInfo(node.init,factories);if(direct){bindings.set(node.id.name,direct);return;}if(node.init?.type==='CallExpression'&&node.init.callee.type==='Identifier'&&factories.has(node.init.callee.name))bindings.set(node.id.name,factories.get(node.init.callee.name));});
 walk(ast,node=>{
  if(node.type!=='CallExpression'||member(node.callee)!=='app.use')return;
  const paths=[];
  for(const arg of node.arguments){if(lit(arg)!==null)paths.push(lit(arg));else if(arg.type==='ArrayExpression'&&arg.elements.every(x=>lit(x)!==null))paths.push(...arg.elements.map(lit));}
  let info=null;
  for(const arg of node.arguments){info=factoryInfo(arg,factories);if(info)break;if(arg.type==='Identifier'&&bindings.has(arg.name)){info=bindings.get(arg.name);break;}if(arg.type==='MemberExpression'&&bindings.has(member(arg.object))){info=bindings.get(member(arg.object));break;}}
  if(!info)return;
  if(!paths.length){dynamic.push({file:'modules/platform/mount-existing-upgrade.js',line:node.loc.start.line,reason:'factory mount has no static path'});return;}
  const output=node.arguments.find(arg=>arg.type==='MemberExpression'&&bindings.has(member(arg.object)));
  mounts.push({...info,routerName:output?.property?.name||null,prefixes:paths,line:node.loc.start.line});
 });
 return {mounts,dynamic};
}
function routerInventory(){
 const {mounts,dynamic}=mountInventory(),routes=[];
 for(const mount of mounts){
  if(!fs.existsSync(mount.file)){dynamic.push({file:path.relative(root,mount.file),line:mount.line,reason:'factory source not found'});continue;}
  const relative=path.relative(root,mount.file),ast=parse(fs.readFileSync(mount.file,'utf8'),relative);
  let scope=null;walk(ast,node=>{if(scope)return;if(node.type==='FunctionDeclaration'&&node.id?.name===mount.factory)scope=node;else if(node.type==='VariableDeclarator'&&node.id?.name===mount.factory)scope=node.init;});
  if(!scope&&mount.factory==='default')walk(ast,node=>{if(!scope&&node.type==='AssignmentExpression'&&member(node.left)==='module.exports'&&['FunctionExpression','ArrowFunctionExpression'].includes(node.right.type))scope=node.right;});
  if(!scope){dynamic.push({file:relative,line:mount.line,reason:`factory function not found: ${mount.factory}`});continue;}
  const globalUses=[];
  walk(scope,node=>{if(node.type!=='CallExpression'||!isRouterObject(node.callee?.object)||methodName(node.callee)!=='use')return;const names=[];for(const arg of node.arguments)walk(arg,child=>{if(child.type==='Identifier'&&/(?:auth|guard|session|feature|user|agent)/i.test(child.name))names.push(child.name);});if(names.length)globalUses.push({start:node.start,names});});
  walk(scope,node=>{
   if(node.type!=='CallExpression'||!isRouterObject(node.callee?.object))return;
   if(mount.routerName&&node.callee.object.name!==mount.routerName)return;
   const method=methodName(node.callee);if(!methods.has(method))return;
   const routeNode=node.arguments[0],routePath=lit(routeNode)??(routeNode?.type==='TemplateLiteral'&&routeNode.expressions.length===0?routeNode.quasis[0].value.cooked:null);if(routePath===null){dynamic.push({file:relative,line:node.loc.start.line,reason:'router method has non-literal route path'});return;}
   const routeGuards=[];for(const arg of node.arguments.slice(1))walk(arg,child=>{if(child.type==='Identifier'&&/(?:auth|guard|session|feature|user|agent)/i.test(child.name))routeGuards.push(child.name);});
   const guards=[...new Set([...globalUses.filter(use=>use.start<node.start).flatMap(use=>use.names),...routeGuards])];
   for(const prefix of mount.prefixes)routes.push({mount:prefix,method:method.toUpperCase(),path:routePath,module:path.basename(mount.file,'.js'),factory:mount.factory,file:relative,line:node.loc.start.line,guards,reviewStatus:'review_required'});
  });
 }
 const unique=new Map();for(const route of routes){const key=`${route.mount} ${route.method} ${route.path} ${route.module}`;if(!unique.has(key))unique.set(key,route);}
 return {mountCount:mounts.length,mounts,routes:[...unique.values()].sort((a,b)=>a.mount.localeCompare(b.mount)||a.path.localeCompare(b.path)||a.method.localeCompare(b.method)),dynamic};
}
if(require.main===module){const result=routerInventory();console.log(`Mounted upgraded router factories: ${result.mountCount}`);console.log(`Static route bindings (aliases counted): ${result.routes.length}`);console.log(`Unique modules: ${new Set(result.routes.map(route=>route.module)).size}`);console.log(`Routes requiring explicit ownership review: ${result.routes.filter(route=>!route.guards.length).length}`);console.log(`Dynamic/incomplete declarations: ${result.dynamic.length}`);for(const issue of result.dynamic)console.log(`DYNAMIC ${issue.file}:${issue.line} ${issue.reason}`);if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));}
module.exports={mountInventory,routerInventory};
