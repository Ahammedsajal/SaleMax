(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.salemaxTimeZoneOptions=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const COMMON=[
    ['Asia/Qatar','Doha, Qatar'],
    ['Asia/Riyadh','Riyadh, Saudi Arabia'],
    ['Asia/Dubai','Dubai, United Arab Emirates'],
    ['Asia/Kuwait','Kuwait'],
    ['Asia/Bahrain','Manama, Bahrain'],
    ['Asia/Muscat','Muscat, Oman'],
    ['UTC','UTC']
  ];
  let cachedZones=null;
  function escapeHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll("'","&#39;");}
  function getTimeZones(){
    if(cachedZones)return [...cachedZones];
    let supported=[];
    try{if(typeof Intl.supportedValuesOf==='function')supported=Intl.supportedValuesOf('timeZone');}catch(_){}
    cachedZones=[...new Set([...COMMON.map(([zone])=>zone),...supported])].filter(zone=>typeof zone==='string'&&zone.length>0).sort((a,b)=>a.localeCompare(b));
    return [...cachedZones];
  }
  function option(zone,label,selected){return '<option value="'+escapeHtml(zone)+'"'+(zone===selected?' selected':'')+'>'+escapeHtml(label)+'</option>';}
  function options(selected,placeholder){
    const chosen=String(selected||''),zones=new Set(getTimeZones());
    if(chosen)zones.add(chosen);
    const commonIds=new Set(COMMON.map(([zone])=>zone));
    let html='<option value="" disabled'+(chosen?'':' selected')+'>'+escapeHtml(placeholder||'Choose a time zone')+'</option><optgroup label="Common destinations">';
    for(const [zone,label] of COMMON)if(zones.has(zone))html+=option(zone,label+' ('+zone+')',chosen);
    html+='</optgroup>';
    const groups=new Map();
    for(const zone of zones){
      if(commonIds.has(zone))continue;
      const [region,...place]=zone.split('/');
      const key=region||'Other';
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push([zone,place.join(' / ').replaceAll('_',' ')||zone]);
    }
    for(const region of [...groups.keys()].sort((a,b)=>a.localeCompare(b))){
      html+='<optgroup label="'+escapeHtml(region)+'">';
      for(const [zone,label] of groups.get(region).sort((a,b)=>a[0].localeCompare(b[0])))html+=option(zone,label+' ('+zone+')',chosen);
      html+='</optgroup>';
    }
    return html;
  }
  return {getTimeZones,options};
});