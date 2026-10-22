'use strict';

function kind(ctx){
 const category=ctx?.category;
 if(!category||category.key!==ctx.tenant?.categoryKey||category.version!==ctx.tenant?.categoryVersion)return null;
 const value=category.catalogue,capability=value==='products'?'products.catalog':value==='courses'?'training.courses':null;
 return capability&&category.capabilities?.includes(capability)?value:null;
}

module.exports={kind,isProducts:ctx=>kind(ctx)==='products'};
