const express=require('express');
const path=require('node:path');
const {fixture,inspect}=require('../modules/platform/preview-fixtures');
const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");next();});
app.get('/api/preview/context',(req,res)=>{try{res.json(fixture(req.query.role||'owner',req.query.category||'training_center'));}catch(error){res.status(error.status||500).json({code:'INVALID_PREVIEW_SELECTION'});}});
app.get('/api/preview/inspect',(req,res)=>{try{res.json(inspect(req.query.role||'owner',req.query.category||'training_center',req.query.key));}catch(error){res.status(error.status||500).json({code:'INVALID_PREVIEW_SELECTION'});}});
app.use(express.static(path.resolve(__dirname,'../client/.preview-build')));
if(require.main===module){app.listen(Number(process.env.PREVIEW_PORT||3015),'127.0.0.1',()=>console.log('Synthetic role prototype: http://127.0.0.1:'+(process.env.PREVIEW_PORT||3015)));}
module.exports=app;
