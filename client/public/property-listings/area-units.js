(() => {
  'use strict';
  const SQFT_PER_SQM=10.763910416709722;
  const unit=value=>value==='sqft'?'sqft':'sqm';
  const round=value=>Math.round(value*100)/100;
  const toSquareMetres=(value,areaUnit='sqm')=>{
    const amount=Number(value);
    if(!Number.isFinite(amount)||amount<=0)return null;
    return round(amount*(unit(areaUnit)==='sqft'?1/SQFT_PER_SQM:1));
  };
  const fromSquareMetres=(value,areaUnit='sqm')=>{
    const amount=Number(value);
    if(!Number.isFinite(amount)||amount<0)return null;
    return round(amount*(unit(areaUnit)==='sqft'?SQFT_PER_SQM:1));
  };
  const maxInputValue=(maximumSquareMetres,areaUnit='sqm')=>Number(maximumSquareMetres)*(unit(areaUnit)==='sqft'?SQFT_PER_SQM:1);
  const format=(value,areaUnit='sqm',language='en')=>{
    const amount=fromSquareMetres(value,areaUnit);
    return amount===null?'':new Intl.NumberFormat(/^ar(?:-|$)/i.test(language)?'ar-QA':'en-QA',{maximumFractionDigits:2}).format(amount);
  };
  const api={toSquareMetres,fromSquareMetres,maxInputValue,format,unit};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(typeof window!=='undefined')window.SevenNetworkPropertyAreaUnits=api;
})();
