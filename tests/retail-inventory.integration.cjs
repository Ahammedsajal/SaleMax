'use strict';

// Run only with a fresh, disposable sx_retail_inventory_test_<hex> database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const mysql=require('mysql2/promise');
const inventory=require('../modules/platform/retail-inventory');
const categories=require('../modules/platform/categories');
const {discover,applyMigrations}=require('../database/migration-runner');

if(process.env.RETAIL_INVENTORY_SYNTHETIC_ONLY!=='true')throw Error('RETAIL_INVENTORY_SYNTHETIC_ONLY_REQUIRED');
const config=JSON.parse(fs.readFileSync(process.env.RETAIL_INVENTORY_TEST_CONFIG,'utf8'));
const schemaMatch=/^sx_retail_inventory_test_([a-f0-9]{12})$/.exec(config.database);
if(!schemaMatch||config.user!==`rti_${schemaMatch[1]}`||!['127.0.0.1','localhost'].includes(config.host))throw Error('DISPOSABLE_RETAIL_SCHEMA_REQUIRED');
const pool=mysql.createPool({...config,connectionLimit:8,multipleStatements:false,dateStrings:true});
const tenantA=crypto.randomUUID(),tenantB=crypto.randomUUID(),identityA=crypto.randomUUID(),identityB=crypto.randomUUID(),memberA=crypto.randomUUID(),memberB=crypto.randomUUID(),productA=crypto.randomUUID(),productB=crypto.randomUUID();
const locationId=crypto.randomUUID();
const context=(tenantId,identityId,membershipId,role='owner')=>({audience:'tenant',identity:{id:identityId},tenant:{id:tenantId,status:'active',categoryKey:'retail_shop',categoryVersion:1},membership:{id:membershipId,tenantId,role,status:'active'},category:categories.retailShop,subscription:{status:'active',categoryKey:'retail_shop',categoryVersion:1,capabilities:categories.retailShop.capabilities}});
const use=async fn=>{const db=await pool.getConnection();try{return await fn(db);}finally{db.release();}};

(async()=>{
  try{
    await use(async db=>{
      await db.query('CREATE TABLE sx_tenants(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,category_key VARCHAR(80),category_version INT,status VARCHAR(20)) ENGINE=InnoDB');
      await db.query('CREATE TABLE sx_identities(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,display_name VARCHAR(120) NOT NULL) ENGINE=InnoDB');
      await db.query("CREATE TABLE sx_memberships(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,role VARCHAR(20),status VARCHAR(20),UNIQUE KEY uq_sx_membership_identity(tenant_id,identity_id),UNIQUE KEY uq_sx_membership_tenant_id(tenant_id,id),UNIQUE KEY uq_sx_membership_context(tenant_id,id,identity_id),FOREIGN KEY(tenant_id) REFERENCES sx_tenants(id),FOREIGN KEY(identity_id) REFERENCES sx_identities(id)) ENGINE=InnoDB");
      await db.query("CREATE TABLE sx_product_catalog(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,code VARCHAR(40) NOT NULL,name_en VARCHAR(200) NOT NULL,name_ar VARCHAR(200) NOT NULL,status ENUM('draft','active','retired') NOT NULL DEFAULT 'draft',PRIMARY KEY(id),UNIQUE KEY uq_test_product_tenant_id(tenant_id,id),UNIQUE KEY uq_test_product_code(tenant_id,code),FOREIGN KEY(tenant_id) REFERENCES sx_tenants(id)) ENGINE=InnoDB");
      await db.query("CREATE TABLE sx_audit_events(id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,tenant_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_identity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,actor_kind VARCHAR(20) NOT NULL,action VARCHAR(120) NOT NULL,resource_type VARCHAR(80) NOT NULL,resource_id VARCHAR(100) NOT NULL,changes JSON NOT NULL,correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB");
      const migrations=discover(path.join(__dirname,'../database/migrations'));
      await applyMigrations(db,migrations,{only:'20261227_retail_inventory.sql'});
      await applyMigrations(db,migrations,{only:'20261228_retail_catalogue_search.sql'});
      await db.query("INSERT INTO sx_tenants(id,category_key,category_version,status) VALUES (?, 'retail_shop',1,'active'),(?, 'retail_shop',1,'active')",[tenantA,tenantB]);
      await db.query('INSERT INTO sx_identities(id,display_name) VALUES (?,?),(?,?)',[identityA,'Retail A',identityB,'Retail B']);
      await db.query("INSERT INTO sx_memberships(id,tenant_id,identity_id,role,status) VALUES (?,?,?,'owner','active'),(?,?,?,'owner','active')",[memberA,tenantA,identityA,memberB,tenantB,identityB]);
      await db.query("INSERT INTO sx_product_catalog(id,tenant_id,code,name_en,name_ar,status) VALUES (?,?, 'A-1','Tea','شاي','active'),(?,?, 'B-1','Coffee','قهوة','active')",[productA,tenantA,productB,tenantB]);
    });

    const a=context(tenantA,identityA,memberA),b=context(tenantB,identityB,memberB);
    await use(async db=>inventory.createLocation(db,a,{code:'MAIN',nameEn:'Main Store',nameAr:'المتجر الرئيسي'}));
    const [[loc]]=await use(db=>db.query('SELECT id FROM sx_retail_locations WHERE tenant_id=? AND code=?',[tenantA,'MAIN']));
    const startStock=async(db,ctx,productId,delta,revision,reason='opening_balance',requestKey=crypto.randomUUID())=>inventory.adjust(db,ctx,{locationId:loc.id,productId,quantityDelta:delta,reason,note:'Synthetic stock test',requestKey,expectedRevision:revision});

    const [stockA,stockB]=await Promise.all([
      use(db=>inventory.listStock(db,a,{locationId:loc.id})),
      use(async db=>{await inventory.createLocation(db,b,{code:'MAIN',nameEn:'Main Store',nameAr:'المتجر الرئيسي'});return inventory.listLocations(db,b);}),
    ]);
    assert.equal(stockA.total,1);assert.equal(stockA.items[0].productId,productA);assert.equal(stockA.items[0].quantityOnHand,'0.000');assert.equal(stockB.length,1);
    await assert.rejects(use(db=>startStock(db,a,productB,'1.000',0)),{code:'PRODUCT_NOT_FOUND'});

    const requestKey=crypto.randomUUID(),first=await use(db=>startStock(db,a,productA,'10.500',0,'opening_balance',requestKey));
    assert.equal(first.balance.quantityOnHand,'10.500');
    const repeated=await use(db=>startStock(db,a,productA,'10.500',0,'opening_balance',requestKey));assert.equal(repeated.replayed,true);
    await assert.rejects(use(db=>startStock(db,a,productA,'10.000',0,'opening_balance',requestKey)),{code:'IDEMPOTENCY_CONFLICT'});
    await assert.rejects(use(db=>startStock(db,a,productA,'-11.000',1,'correction')),{code:'INSUFFICIENT_STOCK'});

    const concurrent=await Promise.allSettled([
      use(db=>startStock(db,a,productA,'1.000',1,'correction')),
      use(db=>startStock(db,a,productA,'2.000',1,'correction')),
    ]);
    assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(concurrent.filter(result=>result.status==='rejected'&&result.reason.code==='STALE_INVENTORY_REVISION').length,1);

    const before=await use(async db=>{const [[row]]=await db.query('SELECT COUNT(*) AS total FROM sx_retail_locations WHERE tenant_id=?',[tenantA]);return Number(row.total);});
    const failAudit=async(sql,args)=>sql.includes('INSERT INTO sx_audit_events')?Promise.reject(Error('SYNTHETIC_AUDIT_FAILURE')):connection.query(sql,args);
    const connection=await pool.getConnection();const db={beginTransaction:()=>connection.beginTransaction(),commit:()=>connection.commit(),rollback:()=>connection.rollback(),release:()=>connection.release(),query:(sql,args)=>failAudit(sql,args)};
    await assert.rejects(inventory.createLocation(db,a,{code:'TEMP',nameEn:'Temporary',nameAr:'مؤقت'}),/SYNTHETIC_AUDIT_FAILURE/);
    const after=await use(async db=>{const [[row]]=await db.query('SELECT COUNT(*) AS total FROM sx_retail_locations WHERE tenant_id=?',[tenantA]);return Number(row.total);});
    assert.equal(after,before,'location creation must roll back with its audit event');

    const history=await use(db=>inventory.listMovements(db,a,{locationId:loc.id,productId:productA}));
    assert.ok(history.items.length>=2);assert.ok(history.items.every(row=>typeof row.createdAt==='string'));
    const [[foreignMovement]]=await use(db=>db.query('SELECT COUNT(*) AS total FROM sx_retail_stock_movements WHERE tenant_id=?',[tenantB]));
    assert.equal(Number(foreignMovement.total),0);
    await use(async db=>{
      const batch=[];for(let i=1;i<=5000;i++){const id=crypto.randomUUID(),code=`SKU-${String(i).padStart(5,'0')}`,name=i===4999?'SKU-04999 Catalog item 04999':`Catalog item ${String(i).padStart(5,'0')}`;batch.push([id,tenantA,code,name,`صنف ${String(i).padStart(5,'0')}`,'active']);}
      for(let start=0;start<batch.length;start+=250){const values=batch.slice(start,start+250),placeholders=values.map(()=>'(?,?,?,?,?,?)').join(',');await db.query(`INSERT INTO sx_product_catalog(id,tenant_id,code,name_en,name_ar,status) VALUES ${placeholders}`,values.flat());}
      await db.query('ANALYZE TABLE sx_product_catalog');
      for(const term of ['SKU-04999','صنف 04999']){
        const result=await inventory.listStock(db,a,{locationId:loc.id,search:term});
        assert.equal(result.total,1,`search ${term} should find the exact product once even when code and name both match`);
        assert.equal(result.items[0].productId,batch[4998][0]);
      }
      const [nameSearch]=await db.query("SELECT id FROM sx_product_catalog WHERE tenant_id=? AND status='active' AND name_en LIKE ? ESCAPE '!' LIMIT 30",[tenantA,'SKU-04999%']);
      assert.equal(nameSearch.length,1);
      assert.equal(nameSearch[0].id,batch[4998][0]);
      const plans=[];
      for(const [column,prefix] of [['code','SKU-04999%'],['name_en','Catalog item 04999%'],['name_ar','صنف 04999%']]){
        const [plan]=await db.query(`EXPLAIN SELECT id FROM sx_product_catalog WHERE tenant_id=? AND status='active' AND ${column} LIKE ? ESCAPE '!' LIMIT 30`,[tenantA,prefix]);
        plans.push(...plan);
      }
      const planText=plans.map(row=>String(row.EXPLAIN||row.query_plan||JSON.stringify(row))).join('\n');
      assert.match(planText,/idx_sx_product_tenant_status_name_en/);
      assert.match(planText,/idx_sx_product_tenant_status_name_ar/);
      assert.match(planText,/idx_sx_product_tenant_status_code|uq_test_product_code/);
      const [searchIndexes]=await db.query("SELECT COUNT(DISTINCT index_name) AS total FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='sx_product_catalog' AND index_name IN ('idx_sx_product_tenant_status_code','idx_sx_product_tenant_status_name_en','idx_sx_product_tenant_status_name_ar')");
      assert.equal(Number(searchIndexes[0].total),3);
    });
    console.log(JSON.stringify({passed:true,checks:['migration applies to disposable MySQL/MariaDB schema','tenant-owned locations and product joins','foreign-tenant product rejected','zero DECIMAL balance read','idempotent retry and payload conflict','no negative stock','concurrent revisions admit one winner','atomic location and audit rollback','tenant-scoped movement history','English/Arabic/code prefix search deduplicates tenant products and uses tenant-leading indexes with 5000 synthetic products'],syntheticOnly:true,customerDataTouched:false,externalWrites:false}));
  }finally{await pool.end();}
})().catch(error=>{console.error(JSON.stringify({code:error.code||error.name,message:error.message}));process.exitCode=1;});
