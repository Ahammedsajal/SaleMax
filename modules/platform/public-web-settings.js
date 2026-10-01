'use strict';

const PRIVATE_PUBLIC_SETTINGS=new Set(['fb_login_app_sec']);

function publicWebSettings(row){
  if(!row||typeof row!=='object'||Array.isArray(row))return row??null;
  const safe={...row};
  for(const field of PRIVATE_PUBLIC_SETTINGS)delete safe[field];
  return safe;
}

module.exports={publicWebSettings};
