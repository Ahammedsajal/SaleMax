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
  'modules/platform/real-estate-authority.js','modules/platform/real-estate-contact-documents.js','database/migrations/20270111_real_estate_authority.sql','database/migrations/20270112_real_estate_agreement_parent.sql','database/migrations/20270113_real_estate_contact_documents.sql','database/migrations/20270114_real_estate_content_approval.sql',
  'modules/platform/real-estate-agents.js','modules/platform/real-estate-coagents.js','modules/platform/real-estate-tenant-requirements.js',
  'modules/platform/legacy-pipeline-actor.js','modules/platform/policy.js','modules/platform/sales-organization.js','modules/platform/team-invitations.js','modules/platform/mount-existing-upgrade.js',
  'helper/pipeline/leadPipeline.js','routes/pipeline.js',
  'client/public/pipeline/index.html','client/public/pipeline/pipeline.js','client/public/pipeline/real-estate-requirements.css','client/public/pipeline/real-estate-requirements.js','client/public/team-invitations.js','client/public/real-estate-agent',
  'database/migrations/20270115_real_estate_tenant_requirements.sql','database/migrations/20270116_real_estate_agent_profiles.sql','database/migrations/20270117_real_estate_listing_coagents.sql','database/migrations/20270118_real_estate_optional_reporting.sql','database/migrations/20270119_real_estate_public_profile_limits.sql',
  'deploy/patch-real-estate-overlay.cjs','deploy/patch-real-estate-agent-shell.cjs','database/migrations/20261222_real_estate_properties.sql',
  'database/migrations/20270110_real_estate_units_and_listings.sql',
  'tests/real-estate-properties.test.js','tests/real-estate-properties-router.test.js',
  'tests/real-estate-inventory-rules.test.js','tests/real-estate-inventory.test.js',
  'tests/real-estate-unit-media.test.js','tests/real-estate-authority.test.js','tests/real-estate-contact-documents.test.js',
])copy(file,file);
execFileSync(process.execPath,[path.join(app,'deploy/patch-real-estate-overlay.cjs'),app],{stdio:'inherit'});
for(const file of ['modules/platform/real-estate-properties.js','modules/platform/real-estate-properties-router.js','modules/platform/real-estate-inventory.js','modules/platform/real-estate-inventory-rules.js','modules/platform/real-estate-unit-media.js','modules/platform/real-estate-authority.js','modules/platform/real-estate-contact-documents.js'])execFileSync(process.execPath,['--check',path.join(app,file)]);
const migrations=require(path.join(app,'database/migration-runner')).discover(path.join(app,'database/migrations')).filter(m=>m.file.includes('real_estate'));
for(const expected of ['20261222_real_estate_properties.sql','20270110_real_estate_units_and_listings.sql','20270111_real_estate_authority.sql','20270112_real_estate_agreement_parent.sql','20270113_real_estate_contact_documents.sql','20270114_real_estate_content_approval.sql','20270115_real_estate_tenant_requirements.sql','20270116_real_estate_agent_profiles.sql','20270117_real_estate_listing_coagents.sql','20270118_real_estate_optional_reporting.sql','20270119_real_estate_public_profile_limits.sql'])if(!migrations.some(m=>m.file===expected))throw Error(`MIGRATION_NOT_DISCOVERED:${expected}`);
for(const migration of migrations)console.log(`${migration.file} ${migration.statements.length} statements`);
for(const file of ['modules/platform/real-estate-agents.js','modules/platform/real-estate-coagents.js','modules/platform/real-estate-tenant-requirements.js','modules/platform/legacy-pipeline-actor.js','modules/platform/policy.js','modules/platform/sales-organization.js','modules/platform/team-invitations.js','modules/platform/mount-existing-upgrade.js','modules/platform/real-estate-properties.js','modules/platform/real-estate-properties-router.js','modules/platform/real-estate-inventory.js','modules/platform/real-estate-authority.js','modules/platform/real-estate-contact-documents.js','helper/pipeline/leadPipeline.js','routes/pipeline.js','client/public/team-invitations.js','client/public/pipeline/pipeline.js','client/public/pipeline/real-estate-requirements.js','client/public/real-estate-agent/profile.js'])execFileSync(process.execPath,['--check',path.join(app,file)]);
const testFiles=['real-estate-properties.test.js','real-estate-properties-router.test.js','real-estate-inventory-rules.test.js','real-estate-inventory.test.js','real-estate-unit-media.test.js','real-estate-authority.test.js','real-estate-contact-documents.test.js','real-estate-pipeline-outcome.test.js','real-estate-sensitive-permissions.test.js','real-estate-agent-shell.test.cjs','legacy-pipeline-actor.test.js','sales-organization.test.js'];
for(const file of testFiles)copy(`tests/${file}`,`tests/${file}`);
execFileSync(process.execPath,['--test',...testFiles.map(file=>path.join(app,'tests',file))],{stdio:'inherit'});
for(const file of testFiles)fs.rmSync(path.join(app,'tests',file),{force:true});
fs.rmSync(path.join(app,'deploy/patch-real-estate-overlay.cjs'),{force:true});
fs.rmSync(source,{recursive:true,force:true});
const media=path.join(app,'private/property-media/.tmp');fs.mkdirSync(media,{recursive:true});
if(process.platform==='linux')execFileSync('chown',['-R','node:node',path.dirname(media)]);
