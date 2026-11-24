'use strict';

// Published legacy contracts are immutable snapshots. A snapshot is a valid
// future offer only while it still matches the live legacy catalogue row.
// Older published versions stay in history, but must not appear as selectable
// plans after the shared catalogue price or terms change.
const {normalize}=require('./legacy-plan-editor');
const catalogue=require('./catalogue-bridge');

function parse(value){
  try{return typeof value==='string'?JSON.parse(value):value;}catch(_){return null;}
}
function canonicalSnapshot(value){
  const source=parse(value);
  if(!source||typeof source!=='object'||Array.isArray(source))return null;
  const normalized=normalize(source,true);
  if(Object.keys(normalized.errors).length)return null;
  return JSON.stringify(catalogue.snapshot({id:normalized.value.id,...normalized.value}));
}
function matchesCurrent(stored,current){
  const oldSnapshot=canonicalSnapshot(stored),currentSnapshot=canonicalSnapshot(current);
  return oldSnapshot!==null&&currentSnapshot!==null&&oldSnapshot===currentSnapshot;
}
async function currentPlans(db,legacyPlanIds){
  const ids=[...new Set(legacyPlanIds.map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))];
  if(!ids.length)return new Map();
  const [rows]=await db.query(`SELECT * FROM plan WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);
  return new Map(rows.map(row=>[Number(row.id),row]));
}
function currentPublishedOffers(rows,currentById,canonicalCategoryKey){
  const current=[];
  for(const row of rows){
    const planId=Number(row.legacyPlanId),catalogueRow=currentById.get(planId);
    if(!catalogueRow||!matchesCurrent(row.commercial,catalogueRow))continue;
    current.push({...row,legacyPlanId:planId});
  }
  // A legacy category alias and its canonical category can coexist. Prefer
  // the canonical contract; otherwise use the newest matching published one.
  const selected=new Map();
  for(const row of current){
    const prior=selected.get(row.legacyPlanId);
    const canonical=row.categoryKey===canonicalCategoryKey;
    const priorCanonical=prior?.categoryKey===canonicalCategoryKey;
    if(!prior||canonical&&!priorCanonical||canonical===priorCanonical&&Number(row.version)>Number(prior.version))selected.set(row.legacyPlanId,row);
  }
  return [...selected.values()];
}
module.exports={canonicalSnapshot,matchesCurrent,currentPlans,currentPublishedOffers};
