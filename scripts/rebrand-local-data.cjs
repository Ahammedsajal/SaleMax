const fs=require('fs');
const path=require('path');
require('dotenv').config({quiet:true});
const mysql=require('mysql2/promise');
function brand(s){return s.replace(/gccbot\.com/gi,'salemax.qa').replace(/\b(?:GCCBOT|GCC BOT|GBOT|WhatsCRM|AI Influencer|GC-Connect)\b/gi,'SaleMaX');}
(async()=>{
  if(process.env.LOCAL_ONLY_MODE!=='true'||process.env.DBHOST!=='127.0.0.1'||process.env.DBPORT!=='3307')throw Error('Rebranding is restricted to the local training database.');
  const c=await mysql.createConnection({host:process.env.DBHOST,port:3307,user:process.env.DBUSER,password:process.env.DBPASS,database:process.env.DBNAME});
  const backup={};const edits=[];
  try{
    await c.beginTransaction();
    for(const [table,fields] of Object.entries({web_public:['app_name','logo','meta_description','custom_home'],faq:['question','answer'],page:['title','content'],testimonial:['title','description']})){
      const [rows]=await c.query('SELECT id,'+fields.map(f=>'`'+f+'`').join(',')+' FROM `'+table+'`');backup[table]=rows;
      for(const row of rows){const next={};for(const field of fields){if(typeof row[field]==='string'&&brand(row[field])!==row[field])next[field]=brand(row[field]);}
        if(table==='web_public'){next.app_name='SaleMaX';next.logo='salemax-logo.png';next.meta_description='SaleMaX brings business messaging, AI chatbots, campaigns, and customer conversations into one workspace.';}
        if(Object.keys(next).length){await c.query('UPDATE `'+table+'` SET '+Object.keys(next).map(k=>'`'+k+'`=?').join(',')+' WHERE id=?',[...Object.values(next),row.id]);edits.push({table,id:row.id,fields:Object.keys(next)});}
      }
    }
    const dest=path.resolve(__dirname,'../private-backups/rebrand-20260930/local-brand-content.json');fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest))fs.writeFileSync(dest,JSON.stringify(backup,null,2));
    await c.commit();console.log(JSON.stringify({updated:edits},null,2));
  }catch(e){await c.rollback();throw e;}finally{await c.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
