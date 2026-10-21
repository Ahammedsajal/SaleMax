#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const acorn=require('acorn');
const {routePermission}=require('../modules/platform/legacy-route-policy');

const root=path.resolve(__dirname,'..');
const authNames=new Set(['validateUser','validateAgent','validateAdmin','pipelineAuth','userGuard','agentGuard','authenticate','requireAuth','authMiddleware','canonicalGuard','sessionGuard','featureAccess','businessGuard']);
const routeMethods=new Set(['get','post','put','patch','delete','all']);
function isAuthName(name){return authNames.has(name)||/(?:auth|guard|protect|validator|session)/i.test(name)||/^validate(?:User|Agent|Admin|Member|Business)$/i.test(name)||/^require(?:User|Agent|Admin|Auth|Session)/i.test(name);}

function walk(node,visit){
  if(!node||typeof node!=='object')return;
  visit(node);
  for(const [key,value] of Object.entries(node)){
    if(key==='start'||key==='end')continue;
    if(Array.isArray(value))value.forEach(child=>walk(child,visit));
    else if(value&&typeof value==='object')walk(value,visit);
  }
}
function literal(node){return node?.type==='Literal'&&typeof node.value==='string'?node.value:null;}
function authNamesInMiddleware(node){
  if(!node)return [];
  if(node.type==='ArrayExpression')return node.elements.flatMap(authNamesInMiddleware);
  if(node.type==='Identifier')return isAuthName(node.name)?[node.name]:[];
  if(node.type==='MemberExpression'){
    const property=node.computed?literal(node.property):node.property?.name;
    const object=node.object?.type==='Identifier'?node.object.name:null;
    if((property&&isAuthName(property))||(object&&isAuthName(object)))return [sourceName(node)];
  }
  if(node.type==='CallExpression')return authNamesInMiddleware(node.callee);
  return [];
}
function sourceName(node){
  if(node.type==='Identifier')return node.name;
  if(node.type==='MemberExpression')return `${sourceName(node.object)}.${node.computed?literal(node.property)||'?':node.property.name}`;
  return '<middleware>';
}
function parse(source,file){
  try{return acorn.parse(source,{ecmaVersion:'latest',sourceType:'script',allowHashBang:true,locations:true});}
  catch(error){throw new Error(`Cannot parse ${file}:${error.loc?.line||'?'}: ${error.message}`);}
}
function mountSpecs(){
  const ast=parse(fs.readFileSync(path.join(root,'server.js'),'utf8'),'server.js'),result=[];
  walk(ast,node=>{
    if(node.type!=='CallExpression'||node.callee.type!=='MemberExpression'||node.callee.object.name!=='app'||node.callee.property.name!=='use')return;
    const routeRequire=node.arguments.find(arg=>arg.type==='CallExpression'&&arg.callee.name==='require'&&literal(arg.arguments[0])?.startsWith('./routes/'));
    if(!routeRequire)return;
    const prefixes=[];
    for(const arg of node.arguments){
      if(arg.type==='ArrayExpression')prefixes.push(...arg.elements.map(literal).filter(Boolean));
      else if(literal(arg))prefixes.push(literal(arg));
    }
    if(prefixes.length)result.push({file:`${literal(routeRequire.arguments[0]).slice(2)}.js`,prefixes});
  });
  return result;
}
function routeInventory(){
  const routes=[],dynamic=[];
  for(const mount of mountSpecs()){
    const filePath=path.join(root,mount.file);if(!fs.existsSync(filePath))continue;
    const ast=parse(fs.readFileSync(filePath,'utf8'),mount.file),globalUses=[];
    walk(ast,node=>{
      if(node.type!=='CallExpression'||node.callee.type!=='MemberExpression'||node.callee.object.name!=='router'||node.callee.property.name!=='use')return;
      let paths=null,args=node.arguments;
      if(literal(args[0])!==null){paths=[literal(args[0])];args=args.slice(1);}
      else if(args[0]?.type==='ArrayExpression'&&args[0].elements.every(item=>literal(item)!==null)){paths=args[0].elements.map(literal);args=args.slice(1);}
      const names=args.flatMap(authNamesInMiddleware);
      if(names.length)globalUses.push({start:node.start,paths,names:[...new Set(names)]});
    });
    walk(ast,node=>{
      if(node.type!=='CallExpression'||node.callee.type!=='MemberExpression'||node.callee.object.name!=='router')return;
      const method=node.callee.computed?literal(node.callee.property):node.callee.property.name;
      if(!routeMethods.has(method)){
        if(node.callee.computed||node.callee.property.type!=='Identifier'){
          dynamic.push({file:mount.file,method:'DYNAMIC',line:node.loc.start.line,reason:'computed router method'});
        }
        return;
      }
      const routePath=literal(node.arguments[0]);
      const middleware=node.arguments.slice(1);
      const applicableUses=globalUses.filter(use=>use.start<node.start&&(!use.paths||!routePath||use.paths.some(prefix=>routePath.startsWith(prefix))));
      const auth=[...applicableUses.flatMap(use=>use.names),...middleware.flatMap(authNamesInMiddleware)];
      if(!auth.length)return;
      if(!routePath){dynamic.push({file:mount.file,method:method.toUpperCase(),line:node.loc.start.line,reason:'non-literal route path'});return;}
      for(const prefix of mount.prefixes){
        const httpMethod=method.toUpperCase();
        routes.push({mount:prefix,path:routePath,method:httpMethod,file:mount.file,line:node.loc.start.line,auth:[...new Set(auth)],permission:routePermission({baseUrl:prefix,path:routePath,method:httpMethod})||null});
      }
    });
  }
  const unique=new Map();
  for(const route of routes){const key=`${route.mount} ${route.method} ${route.path}`;if(!unique.has(key))unique.set(key,route);}
  return {routes:[...unique.values()].sort((a,b)=>a.mount.localeCompare(b.mount)||a.path.localeCompare(b.path)||a.method.localeCompare(b.method)),dynamic};
}
function isPlatformAdminRoute(route){
  return ['/api/admin','/api/theme','/api/web'].includes(route.mount)&&route.auth.some(name=>/adminValidator|portfolioGuard/i.test(name));
}
function audit({allowMissingBaseline=false}={}){
  const inventory=routeInventory(),unmapped=inventory.routes.filter(route=>!route.permission&&!isPlatformAdminRoute(route));
  const baselinePath=path.join(__dirname,'legacy-route-policy-baseline.json');
  const counts={protectedRouteCount:inventory.routes.length,mappedCount:inventory.routes.filter(route=>route.permission).length,platformAdminCount:inventory.routes.filter(isPlatformAdminRoute).length};
  if(allowMissingBaseline&&!fs.existsSync(baselinePath))return {...counts,unmappedCount:unmapped.length,unmapped,newUnmapped:unmapped,resolved:[],dynamic:inventory.dynamic};
  const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8'));
  const key=route=>`${route.mount} ${route.method} ${route.path}`;
  const allowed=new Set(baseline.unmapped.map(key));
  const newUnmapped=unmapped.filter(route=>!allowed.has(key(route)));
  const resolved=baseline.unmapped.filter(route=>!unmapped.some(current=>key(current)===key(route)));
  return {...counts,unmappedCount:unmapped.length,unmapped,newUnmapped,resolved,dynamic:inventory.dynamic};
}

if(require.main===module){
  const inventoryOnly=process.argv.includes('--inventory');
  const result=audit({allowMissingBaseline:inventoryOnly});
  if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));
  else{
    console.log(`Protected static route bindings: ${result.protectedRouteCount}`);
    console.log(`Legacy permission mapped: ${result.mappedCount}`);
    console.log(`Platform-admin guarded: ${result.platformAdminCount}`);
    console.log(`Business/identity routes still needing mapping review: ${result.unmappedCount}`);
    console.log(`New unmapped routes: ${result.newUnmapped.length}`);
    console.log(`Dynamic route declarations: ${result.dynamic.length}`);
    for(const route of result.newUnmapped)console.log(`NEW ${route.mount} ${route.method} ${route.path} (${route.file}:${route.line})`);
    for(const route of result.dynamic)console.log(`DYNAMIC ${route.method} (${route.file}:${route.line})`);
  }
  if(!inventoryOnly&&(result.newUnmapped.length||result.dynamic.length))process.exitCode=1;
}
module.exports={audit,routeInventory,isPlatformAdminRoute};
