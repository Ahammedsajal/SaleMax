'use strict';
// Reuse the maintained catalogue transactions with separate Sales storage.
// Table names are fixed by the server, never supplied by a request.
const tables = Object.freeze({sx_training_courses:'sx_product_catalog',sx_training_offers:'sx_product_offers',sx_training_course_media:'sx_product_media',sx_training_batches:'sx_product_batches',sx_course_reply_jobs:'sx_product_reply_jobs'});
const cache=new WeakMap();
function database(db){
  if(cache.has(db))return cache.get(db);
  const adapter=new Proxy(db,{get(target,key){
    if(key==='query'||key==='execute')return (sql,...args)=>target[key](sql.replace(/\b(?:sx_training_courses|sx_training_offers|sx_training_course_media|sx_training_batches|sx_course_reply_jobs)\b/g,name=>tables[name]),...args);
    if(key==='getConnection')return async()=>database(await target.getConnection());
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  cache.set(db,adapter);cache.set(adapter,adapter);return adapter;
}
function kind(ctx){
 const category=ctx?.category;
 if(!category||category.key!==ctx.tenant?.categoryKey||category.version!==ctx.tenant?.categoryVersion)return null;
 const value=category.catalogue,capability=value==='products'?'products.catalog':value==='courses'?'training.courses':null;
 return capability&&category.capabilities?.includes(capability)?value:null;
}
// Compatibility name retained for maintained services; selects products, not a brand.
const sales=ctx=>kind(ctx)==='products';
const forContext=(db,ctx)=>sales(ctx)?database(db):db;
module.exports={database,forContext,sales,kind,tables};
