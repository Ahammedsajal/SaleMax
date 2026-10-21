'use strict';
const fs=require('node:fs'),path=require('node:path');const [target,source]=process.argv.slice(2);
if(!target||!source||path.resolve(target)===path.resolve(source))throw Error('DISTINCT_TARGET_AND_SOURCE_REQUIRED');
const files=['modules/platform/categories.js','modules/platform/category-registry.js','modules/platform/product-catalog.js','modules/platform/feature-contract.js','modules/platform/course-quick-replies.js','modules/platform/course-quick-reply-router.js','modules/platform/training-course-router.js','modules/platform/training-courses.js'];
for(const rel of files){const dst=path.join(target,rel);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(source,rel),dst);}
console.log(JSON.stringify({runtimeFiles:files,migrations:[]}));
