'use strict';

function publicServices(content){
  const seen=new Set(),result=[];
  for(const section of Array.isArray(content?.sections)?content.sections:[]){
    if(section?.type!=='services'||!Array.isArray(section.items))continue;
    for(const item of section.items){
      const title=typeof item?.title==='string'?item.title.trim().slice(0,200):'';
      const titleAr=typeof item?.titleAr==='string'?item.titleAr.trim().slice(0,200):'';
      const value=title||titleAr;
      if(!value||seen.has(value))continue;
      seen.add(value);result.push({value,title,titleAr});
      if(result.length>=50)return result;
    }
  }
  return result;
}

function resolvePublicService(content,value){
  if(typeof value!=='string'||!value)return null;
  return publicServices(content).find(item=>item.value===value)||null;
}

module.exports={publicServices,resolvePublicService};
