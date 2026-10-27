'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const app=path.resolve(process.argv[2]||'/app');
const source=path.resolve(process.argv[3]||'/tmp/real-estate-build-context');
function copy(from,to){const dest=path.join(app,to);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(path.join(source,from),dest,{recursive:true});}
for(const file of [
  'modules/platform/real-estate-properties.js','modules/platform/real-estate-properties-router.js',
  'modules/platform/real-estate-inventory.js','modules/platform/real-estate-inventory-rules.js',
  'modules/platform/real-estate-unit-media.js','client/public/property-listings',
  'modules/platform/real-estate-authority.js','database/migrations/20270111_real_estate_authority.sql','database/migrations/20270112_real_estate_agreement_parent.sql',
  'deploy/patch-real-estate-overlay.cjs','database/migrations/20261222_real_estate_properties.sql',
  'database/migrations/20270110_real_estate_units_and_listings.sql',
  'tests/real-estate-properties.test.js','tests/real-estate-properties-router.test.js',
  'tests/real-estate-inventory-rules.test.js','tests/real-estate-inventory.test.js',
  'tests/real-estate-unit-media.test.js','tests/real-estate-authority.test.js',
])copy(file,file);
execFileSync(process.execPath,[path.join(app,'deploy/patch-real-estate-overlay.cjs'),app],{stdio:'inherit'});
for(const file of ['modules/platform/real-estate-properties.js','modules/platform/real-estate-properties-router.js','modules/platform/real-estate-inventory.js','modules/platform/real-estate-inventory-rules.js','modules/platform/real-estate-unit-media.js','modules/platform/real-estate-authority.js'])execFileSync(process.execPath,['--check',path.join(app,file)]);
const migrations=require(path.join(app,'database/migration-runner')).discover(path.join(app,'database/migrations')).filter(m=>m.file.includes('real_estate'));
for(const expected of ['20261222_real_estate_properties.sql','20270110_real_estate_units_and_listings.sql','20270111_real_estate_authority.sql','20270112_real_estate_agreement_parent.sql'])if(!migrations.some(m=>m.file===expected))throw Error(`MIGRATION_NOT_DISCOVERED:${expected}`);
for(const migration of migrations)console.log(`${migration.file} ${migration.statements.length} statements`);
execFileSync(process.execPath,['--test',...['real-estate-properties.test.js','real-estate-properties-router.test.js','real-estate-inventory-rules.test.js','real-estate-inventory.test.js','real-estate-unit-media.test.js','real-estate-authority.test.js'].map(file=>path.join(app,'tests',file))],{stdio:'inherit'});
for(const file of ['real-estate-properties.test.js','real-estate-properties-router.test.js','real-estate-inventory-rules.test.js','real-estate-inventory.test.js','real-estate-unit-media.test.js','real-estate-authority.test.js'])fs.rmSync(path.join(app,'tests',file),{force:true});
fs.rmSync(path.join(app,'deploy/patch-real-estate-overlay.cjs'),{force:true});
fs.rmSync(source,{recursive:true,force:true});
const media=path.join(app,'private/property-media/.tmp');fs.mkdirSync(media,{recursive:true});
execFileSync('chown',['-R','node:node',path.dirname(media)]);
