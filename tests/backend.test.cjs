const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');
const path = require('path');
const root = path.resolve(__dirname, '..');
let passed = 0;
function ok(condition, name) { assert(condition, name); passed++; console.log('PASS', name); }
class Range {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, {sheet,row,col,rows,cols}); }
  getValues() { return this.sheet.values.slice(this.row-1,this.row-1+this.rows).map(r=>r.slice(this.col-1,this.col-1+this.cols)); }
  setValues(values) { values.forEach((row,ri)=>row.forEach((value,ci)=>{while(this.sheet.values.length<this.row+ri)this.sheet.values.push([]);this.sheet.values[this.row-1+ri][this.col-1+ci]=value;})); }
}
class Sheet {
  constructor(name) { this.name=name;this.values=[]; }
  appendRow(row) { this.values.push(row.slice()); }
  getDataRange() { return new Range(this,1,1,this.values.length,Math.max(...this.values.map(r=>r.length),1)); }
  getRange(row,col,rows=1,cols=1) { return new Range(this,row,col,rows,cols); }
  setFrozenRows() {}
}
class Spreadsheet {
  constructor() { this.sheets={}; }
  getSheetByName(name) { return this.sheets[name]||null; }
  insertSheet(name) { return this.sheets[name]=new Sheet(name); }
  copy() { return {getId:()=> 'copy-id'}; }
}
const spreadsheet = new Spreadsheet(), props = {ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'correct-horse-123',INSTITUTION_NAME:'Test Canteen'}, cache = {};
let uuidCounter=0;
const context = {
  console,
  SpreadsheetApp:{getActiveSpreadsheet:()=>spreadsheet,openById:()=>spreadsheet},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>Object.prototype.hasOwnProperty.call(props,k)?props[k]:null,deleteProperty:k=>delete props[k]})},
  CacheService:{getScriptCache:()=>({get:k=>Object.prototype.hasOwnProperty.call(cache,k)?cache[k]:null,put:(k,v)=>cache[k]=v,remove:k=>delete cache[k]})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{
    DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
    computeDigest:(_a,text)=>Array.from(crypto.createHash('sha256').update(text,'utf8').digest()).map(x=>x>127?x-256:x),
    getUuid:()=> 'uuid-'+(++uuidCounter),
    formatDate:(date)=>date.toISOString().slice(0,10),
    base64Decode:s=>Buffer.from(s,'base64'),base64Encode:b=>Buffer.from(b).toString('base64'),newBlob:(data,mime,name)=>({data,mime,name,getContentType:()=>mime,getBytes:()=>Array.from(data)})
  },
  Session:{getScriptTimeZone:()=> 'Asia/Kolkata'},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
  DriveApp:{getFolderById:()=>({createFile:blob=>({getId:()=> 'drive-photo-1',blob})}),getFileById:id=>({getBlob:()=>({getContentType:()=> 'image/jpeg',getBytes:()=>Array.from(Buffer.from('hello'))})})},UrlFetchApp:{},Date,JSON,Math,Object,Array,String,Number,Boolean,Error
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'seed-data.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'backend/Code.gs'),'utf8'),context);
const call = (fn,...args) => vm.runInContext(fn+'('+args.map(a=>JSON.stringify(a)).join(',')+')',context);
const today = new Date().toISOString().slice(0,10);
const admin = {username:'admin',name:'Canteen Admin',role:'Admin'};
const storekeeper = {username:'keeper',name:'Keeper',role:'Storekeeper'};
const viewer = {username:'viewer',name:'Viewer',role:'Viewer'};
const stock = id => call('stockView_').find(x=>x.id===id);
console.log('Megaverks Canteen backend regression suite');
ok(call('setupCanteen').includes('complete'),'setup creates schema and seed data');
ok(!props.ADMIN_PASSWORD,'setup removes temporary admin password');
ok(Object.keys(spreadsheet.sheets).length===9,'all nine database tabs exist');
ok(call('objects_','Items').length===context.CANTEEN_SEED.items.length,'all pre-loaded items inserted');
ok(call('login_',{username:'admin',password:'wrong'}).ok===false,'wrong password rejected');
const login = call('login_',{username:'admin',password:'correct-horse-123'});
ok(login.ok&&login.token,'correct login returns session token');
ok(call('auth_',login.token).role==='Admin','session token resolves role');
ok(call('login_',{username:'admin',password:'correct-horse-123'}).ok,'successful logins do not lock account');
const inward = {supplier:'ABC Traders',billNo:'B-100',billDate:today,source:'Test',lines:[{itemId:'TOOR_DAL',qty:2,unit:'bag',rate:3000,amount:6000,clientId:'IN-1'}]};
ok(call('saveInward_',inward,admin).ok,'inward purchase saves');
ok(stock('TOOR_DAL').balance===50,'bag to kg conversion updates ledger balance');
const originalRows=call('objects_','Inward').length;
ok(call('saveInward_',inward,admin).ok&&call('objects_','Inward').length===originalRows,'offline retry is idempotent');
ok(call('saveInward_',Object.assign({},inward,{lines:[{itemId:'TOOR_DAL',qty:1,unit:'kg',rate:120,amount:120,clientId:'IN-2'}]}),admin).duplicate,'duplicate supplier and bill warns');
let arithmeticRejected=false;
try{call('saveInward_',Object.assign({},inward,{billNo:'B-101',lines:[{itemId:'TOOR_DAL',qty:1,unit:'kg',rate:120,amount:100,clientId:'IN-3'}]}),admin);}catch(e){arithmeticRejected=String(e).includes('does not match');}
ok(arithmeticRejected,'quantity x rate mismatch rejected');
const issue = {date:today,meal:'L',receivedBy:'Ramesh',remarks:'Test lunch',lines:[{itemId:'TOOR_DAL',qty:5,clientId:'OUT-1'}]};
ok(call('saveIssue_',issue,storekeeper).ok,'daily meal issue saves');
ok(stock('TOOR_DAL').balance===45,'issue reduces stock balance');
const issueRows=call('objects_','Issue').length;
ok(call('saveIssue_',issue,storekeeper).ok&&call('objects_','Issue').length===issueRows,'issue retry does not duplicate stock out');
let overIssue=false;
try{call('saveIssue_',{date:today,meal:'D',receivedBy:'Ramesh',lines:[{itemId:'TOOR_DAL',qty:999,clientId:'OUT-2'}]},storekeeper);}catch(e){overIssue=String(e).includes('Insufficient stock');}
ok(overIssue,'negative stock blocked for storekeeper');
ok(call('saveIssue_',{date:today,meal:'D',receivedBy:'Ramesh',lines:[{itemId:'TOOR_DAL',qty:50,clientId:'OUT-3'}]},admin).ok,'admin override allowed');
ok(stock('TOOR_DAL').balance===-5,'admin override is visible in ledger');
ok(call('savePlates_',{date:today,meal:'L',platesServed:120,menuServed:'Rice-Sambar-Rasam'},storekeeper).ok,'same-day plate count saves');
let pastPlate=false;
try{call('savePlates_',{date:'2020-01-01',meal:'L',platesServed:100},storekeeper);}catch(e){pastPlate=String(e).includes('Admin');}
ok(pastPlate,'storekeeper cannot edit past plates');
ok(call('savePlates_',{date:today,meal:'L',platesServed:125,menuServed:'Rice-Sambar-Rasam'},storekeeper).ok&&call('objects_','Plates').filter(r=>r.Date===today&&r.Meal==='L').length===1,'plate edit updates one meal row');
ok(call('saveCount_',{reason:'Test count',lines:[{itemId:'RAVA',counted:12,clientId:'COUNT-1'}]},storekeeper).ok,'physical count saves adjustment');
ok(stock('RAVA').balance===12,'physical count sets balance through adjustment');
ok(call('reverseMovement_',{type:'IN',id:call('objects_','Inward')[0].InwardID,itemId:'TOOR_DAL',reason:'Test reversal'},admin).ok,'reversing correction saves');
ok(stock('TOOR_DAL').balance===-55,'reversal changes stock without deleting original');
ok(call('objects_','Inward').length===originalRows,'reversal preserves original inward row');
ok(call('saveItem_',{name:'Test grain',category:'Test',unit:'kg',purchaseUnit:'bag',conversion:10,minLevel:2,meals:['L'],active:true,aliases:['Test alias']},admin).ok,'admin can add item');
ok(stock('ITEM_uuid-'+uuidCounter)!==undefined||call('objects_','Items').some(r=>r.Name==='Test grain'),'new item appears in master');
ok(call('saveStaff_',{name:'Test Cook',role:'Cook',active:true},admin).ok,'admin can add staff');
ok(call('saveDish_',{name:'Test Meal',meals:['L'],active:true},admin).ok,'admin can add dish');
ok(call('saveUser_',{username:'viewer',name:'View Only',role:'Viewer',active:true,password:'viewer-pass-123'},admin).ok,'admin can create viewer');
const viewerLogin=call('login_',{username:'viewer',password:'viewer-pass-123'});
ok(viewerLogin.ok&&call('auth_',viewerLogin.token).role==='Viewer','new user password hash and role work');
let viewerBlocked=false;
try{call('route_','saveIssue',issue,viewer);}catch(e){viewerBlocked=String(e).includes('role');}
ok(viewerBlocked,'server blocks viewer write even with direct request');
ok(call('route_','getBootstrap',{},viewer).stock.length>0,'viewer can read stock');
ok(call('matchItem_','Arhar dal',call('objects_','Items').map(context.itemObject_)).item.id==='TOOR_DAL','bill alias matches Toor dal');
ok(call('matchItem_','Tur Dal',call('objects_','Items').map(context.itemObject_)).item.id==='TOOR_DAL','alternate bill spelling matches');
for(let i=0;i<5;i++)call('login_',{username:'locktest',password:'bad'});
ok(call('login_',{username:'locktest',password:'bad'}).error.includes('locked'),'five failed attempts lock account');
const boot=call('bootstrap_',admin);
ok(boot.users.every(u=>!u.PasswordHash&&!u.Salt),'bootstrap never exposes password hashes or salts');
ok(boot.items.length>50&&boot.staff.length>0&&boot.dishes.length>0,'bootstrap returns all operating masters');
props.DRIVE_FOLDER_ID='folder-1';
const photoSave=call('saveItem_',{name:'Photo item',category:'Test',unit:'kg',purchaseUnit:'kg',conversion:1,minLevel:1,meals:['B'],active:true,aliases:[],photoBase64:'aGVsbG8=',photoMime:'image/jpeg',photoName:'grain.jpg'},admin);
ok(photoSave.ok&&call('objects_','Items').some(r=>r.Name==='Photo item'&&String(r.PhotoURL).includes('drive-photo-1')),'item reference photo stays in private Drive storage');
ok(call('getItemPhoto_',photoSave.itemId).dataUrl==='data:image/jpeg;base64,aGVsbG8=','authenticated item photo retrieval returns image data');
let duplicateItem=false;try{call('saveItem_',{name:'Photo item',category:'Test',unit:'kg',purchaseUnit:'kg',conversion:1,minLevel:1},admin);}catch(e){duplicateItem=String(e).includes('already exists');}
ok(duplicateItem,'duplicate item names are rejected');
let lastAdmin=false;try{call('saveUser_',{originalUsername:'admin',username:'admin',name:'Canteen Admin',role:'Viewer',active:true},admin);}catch(e){lastAdmin=String(e).includes('at least one active Admin');}
ok(lastAdmin,'server prevents removing the last active Admin');
console.log('\n'+passed+' backend assertions passed.');
