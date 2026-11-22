/* Megaverks Canteen v1.0.0 - private Apps Script backend. No secrets in this file. */
var APP_VERSION = '1.0.0';
var SHEETS = {
  Items:['ItemID','Name','LocalName','Aliases','Category','Meals','IssueUnit','PurchaseUnit','ConversionFactor','MinLevel','Active','OpeningQty','LastRate','PhotoURL'],
  Inward:['InwardID','DateTime','BillNo','BillDate','Supplier','ItemID','Qty','Unit','Rate','Amount','ConversionFactor','QtyIssue','BillPhotoURL','Source','EnteredBy','ClientID'],
  Issue:['IssueID','DateTime','Date','Meal','ItemID','Qty','Unit','ReceivedBy','IssuedBy','Purpose','Remarks','ClientID'],
  Plates:['Date','Meal','PlatesServed','MenuServed','PlatesPrepared','Leftover','UpdatedBy','DateTime'],
  Dishes:['DishID','DishName','Meals','Active'],
  Adjust:['AdjustID','DateTime','ItemID','Qty','Type','Reason','EnteredBy','ClientID','Reference'],
  Staff:['StaffID','Name','Role','Active'],
  Users:['Username','Name','PasswordHash','Salt','Role','Active'],
  Log:['DateTime','User','Action','Details']
};
function prop_(key, fallback) { var v=PropertiesService.getScriptProperties().getProperty(key);return v===null||v===''?fallback:v; }
function ss_() { var id=prop_('SHEET_ID','');var ss=id?SpreadsheetApp.openById(id):SpreadsheetApp.getActiveSpreadsheet();if(!ss)throw new Error('Set SHEET_ID in Script Properties or use a Sheet-bound script.');return ss; }
function sheet_(name) { var ss=ss_(),sh=ss.getSheetByName(name);if(!sh){sh=ss.insertSheet(name);sh.appendRow(SHEETS[name]);sh.setFrozenRows(1);}return sh; }
function objects_(name) {
  var sh=sheet_(name),values=sh.getDataRange().getValues();if(values.length<2)return [];
  var headers=values[0],out=[];
  for(var r=1;r<values.length;r++){if(!values[r][0]&&name!=='Plates')continue;var o={__row:r+1};for(var c=0;c<headers.length;c++)o[headers[c]]=values[r][c];out.push(o);}
  return out;
}
function append_(name,obj) { var headers=SHEETS[name];sheet_(name).appendRow(headers.map(function(h){return obj[h]===undefined?'':obj[h];})); }
function updateRow_(name,row,obj) { var headers=SHEETS[name];sheet_(name).getRange(row,1,1,headers.length).setValues([headers.map(function(h){return obj[h]===undefined?'':obj[h];})]); }
function response_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function doGet(e) { var action=e&&e.parameter?e.parameter.action||'ping':'ping';if(action==='ping')return response_({ok:true,service:'Megaverks Canteen',version:APP_VERSION,time:new Date().toISOString()});return response_({ok:false,error:'Use POST for application requests.'}); }
function doPost(e) {
  try {
    var body=JSON.parse(e.postData.contents||'{}'),action=String(body.action||'');
    if(action==='login')return response_(login_(body));
    if(action==='ping')return response_({ok:true,version:APP_VERSION});
    var auth=auth_(body.token);
    if(!auth)return response_({ok:false,error:'SESSION_EXPIRED'});
    return response_(route_(action,body,auth));
  } catch(err) {
    try{log_('SYSTEM','ERROR',String(err&&err.message||err));}catch(ignore){}
    return response_({ok:false,error:String(err&&err.message||err||'Unexpected server error')});
  }
}
function route_(action,b,user) {
  var read={'getBootstrap':1,'getHistory':1,'getStock':1,'getReports':1,'getItemPhoto':1};
  var write={'savePlates':1,'saveIssue':1,'saveInward':1,'saveCount':1,'scanBill':1,'scanInventory':1};
  var admin={'saveItem':1,'saveStaff':1,'saveDish':1,'saveUser':1,'reverseMovement':1,'createBackup':1};
  if(read[action]){}else if(write[action])requireRole_(user,['Admin','Storekeeper']);else if(admin[action])requireRole_(user,['Admin']);else throw new Error('Unknown action: '+action);
  switch(action){
    case 'getBootstrap':var boot=bootstrap_(user);boot.ok=true;return boot;
    case 'getStock':return {ok:true,stock:stockView_()};
    case 'getItemPhoto':return getItemPhoto_(String(b.itemId||''));
    case 'getHistory':var hist=historyData_();hist.ok=true;return hist;
    case 'getReports':var report=historyData_();report.ok=true;return report;
    case 'savePlates':return withLock_(function(){return savePlates_(b,user);});
    case 'saveIssue':return withLock_(function(){return saveIssue_(b,user);});
    case 'saveInward':return withLock_(function(){return saveInward_(b,user);});
    case 'saveCount':return withLock_(function(){return saveCount_(b,user);});
    case 'scanBill':return scanDocument_(b,user,'bill');
    case 'scanInventory':return scanDocument_(b,user,'inventory');
    case 'saveItem':return withLock_(function(){return saveItem_(b.item,user);});
    case 'saveStaff':return withLock_(function(){return saveStaff_(b.staff,user);});
    case 'saveDish':return withLock_(function(){return saveDish_(b.dish,user);});
    case 'saveUser':return withLock_(function(){return saveUser_(b.user,user);});
    case 'reverseMovement':return withLock_(function(){return reverseMovement_(b,user);});
    case 'createBackup':return createBackup_(user);
  }
}
function requireRole_(user,roles) { if(roles.indexOf(user.role)<0)throw new Error('Your role does not permit this action.'); }
function withLock_(fn) { var lock=LockService.getScriptLock();if(!lock.tryLock(30000))return {ok:false,error:'Another save is in progress. Please wait and try again.'};try{return fn();}finally{lock.releaseLock();} }
function digest_(text) { var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8);return bytes.map(function(b){var v=(b<0?b+256:b).toString(16);return v.length===1?'0'+v:v;}).join(''); }
function login_(b) {
  var username=String(b.username||'').trim().toLowerCase(),password=String(b.password||''),cache=CacheService.getScriptCache(),lockKey='LOCK_'+username,attemptKey='FAIL_'+username;
  if(!username||!password)return {ok:false,error:'Enter username and password.'};
  if(cache.get(lockKey))return {ok:false,error:'Account temporarily locked. Try again in 15 minutes.'};
  var users=objects_('Users'),u=null;users.forEach(function(x){if(String(x.Username).toLowerCase()===username)u=x;});
  var valid=!!u&&String(u.Active).toUpperCase()!=='FALSE'&&u.Active!==false&&digest_(String(u.Salt)+password)===String(u.PasswordHash);
  if(!valid){var attempts=Number(cache.get(attemptKey)||0)+1;cache.put(attemptKey,String(attempts),900);if(attempts>=5){cache.put(lockKey,'1',900);cache.remove(attemptKey);}log_(username,'LOGIN_FAIL','Failed sign-in attempt');return {ok:false,error:attempts>=5?'Too many failed attempts. Account locked for 15 minutes.':'Invalid username or password.'};}
  cache.remove(attemptKey);cache.remove(lockKey);var token=Utilities.getUuid()+Utilities.getUuid(),session={username:String(u.Username),name:String(u.Name),role:String(u.Role)};
  cache.put('SESSION_'+token,JSON.stringify(session),21600);log_(u.Username,'LOGIN','Signed in');return {ok:true,token:token,user:session};
}
function auth_(token) { if(!token)return null;var raw=CacheService.getScriptCache().get('SESSION_'+token);if(!raw)return null;var u=JSON.parse(raw),active=false;objects_('Users').forEach(function(x){if(String(x.Username)===u.username&&(String(x.Active).toUpperCase()!=='FALSE'&&x.Active!==false))active=true;});return active?u:null; }
function log_(user,action,details) { try{append_('Log',{DateTime:new Date().toISOString(),User:user,Action:action,Details:String(details||'').slice(0,450)});}catch(e){} }
function bool_(v) { return !(v===false||String(v).toUpperCase()==='FALSE'||v===0); }
function itemObject_(r) { return {id:String(r.ItemID),name:String(r.Name),localName:String(r.LocalName),aliases:String(r.Aliases)?String(r.Aliases).split('|'):[],category:String(r.Category),meals:String(r.Meals)?String(r.Meals).split(','):[],unit:String(r.IssueUnit),purchaseUnit:String(r.PurchaseUnit),conversion:Number(r.ConversionFactor)||1,minLevel:Number(r.MinLevel)||0,active:bool_(r.Active),openingQty:Number(r.OpeningQty)||0,lastRate:Number(r.LastRate)||0,photoUrl:String(r.PhotoURL)}; }
function itemRow_(i) { return {ItemID:i.id,Name:i.name,LocalName:i.localName||'',Aliases:(i.aliases||[]).join('|'),Category:i.category,Meals:(i.meals||[]).join(','),IssueUnit:i.unit,PurchaseUnit:i.purchaseUnit,ConversionFactor:Number(i.conversion)||1,MinLevel:Number(i.minLevel)||0,Active:i.active!==false,OpeningQty:Number(i.openingQty)||0,LastRate:Number(i.lastRate)||0,PhotoURL:i.photoUrl||''}; }
function stockView_() {
  var items=objects_('Items').map(itemObject_),inward=objects_('Inward'),issue=objects_('Issue'),adjust=objects_('Adjust'),stock=items.map(function(i){return Object.assign({},i,{inQty:0,outQty:0,adjustQty:0,balance:Number(i.openingQty)||0,lastMovement:''});}),map={};stock.forEach(function(s){map[s.id]=s;});
  inward.forEach(function(r){var s=map[String(r.ItemID)];if(s){var q=Number(r.QtyIssue)||0;s.inQty+=q;s.balance+=q;if(String(r.DateTime)>s.lastMovement)s.lastMovement=String(r.DateTime);}});
  issue.forEach(function(r){var s=map[String(r.ItemID)];if(s){var q=Number(r.Qty)||0;s.outQty+=q;s.balance-=q;if(String(r.DateTime)>s.lastMovement)s.lastMovement=String(r.DateTime);}});
  adjust.forEach(function(r){var s=map[String(r.ItemID)];if(s){var q=Number(r.Qty)||0;s.adjustQty+=q;s.balance+=q;if(String(r.DateTime)>s.lastMovement)s.lastMovement=String(r.DateTime);}});
  stock.forEach(function(s){s.balance=Math.round(s.balance*1000)/1000;s.value=Math.round(s.balance*s.lastRate*100)/100;s.status=!s.active?'inactive':s.balance<=0?'out':s.balance<=s.minLevel?'low':'ok';});return stock;
}
function bootstrap_(user) {
  var staff=objects_('Staff').map(function(r){return {id:String(r.StaffID),name:String(r.Name),role:String(r.Role),active:bool_(r.Active)};});
  var dishes=objects_('Dishes').map(function(r){return {id:String(r.DishID),name:String(r.DishName),meals:String(r.Meals)?String(r.Meals).split(','):[],active:bool_(r.Active)};});
  var data=historyData_();data.institution=prop_('INSTITUTION_NAME','School / College Canteen');data.version=APP_VERSION;data.user={username:user.username,name:user.name,role:user.role};data.items=objects_('Items').map(itemObject_);data.staff=staff;data.dishes=dishes;data.stock=stockView_();data.serverTime=new Date().toISOString();
  if(user.role==='Admin')data.users=objects_('Users').map(function(r){return {username:String(r.Username),name:String(r.Name),role:String(r.Role),active:bool_(r.Active)};});
  return data;
}
function historyData_() {
  var inward=objects_('Inward').map(function(r){return {id:String(r.InwardID),dateTime:String(r.DateTime),billNo:String(r.BillNo),billDate:String(r.BillDate),supplier:String(r.Supplier),itemId:String(r.ItemID),qty:Number(r.Qty),unit:String(r.Unit),rate:Number(r.Rate),amount:Number(r.Amount),conversionFactor:Number(r.ConversionFactor),qtyIssue:Number(r.QtyIssue),billPhotoUrl:String(r.BillPhotoURL),source:String(r.Source),enteredBy:String(r.EnteredBy),clientId:String(r.ClientID)};});
  var issue=objects_('Issue').map(function(r){return {id:String(r.IssueID),dateTime:String(r.DateTime),date:String(r.Date),meal:String(r.Meal),itemId:String(r.ItemID),qty:Number(r.Qty),unit:String(r.Unit),receivedBy:String(r.ReceivedBy),issuedBy:String(r.IssuedBy),purpose:String(r.Purpose),remarks:String(r.Remarks),clientId:String(r.ClientID)};});
  var plates=objects_('Plates').map(function(r){return {date:String(r.Date),meal:String(r.Meal),platesServed:Number(r.PlatesServed),menuServed:String(r.MenuServed),platesPrepared:Number(r.PlatesPrepared),leftover:Number(r.Leftover),updatedBy:String(r.UpdatedBy),dateTime:String(r.DateTime)};});
  var adjust=objects_('Adjust').map(function(r){return {id:String(r.AdjustID),dateTime:String(r.DateTime),itemId:String(r.ItemID),qty:Number(r.Qty),type:String(r.Type),reason:String(r.Reason),enteredBy:String(r.EnteredBy),clientId:String(r.ClientID),reference:String(r.Reference)};});
  var logs=objects_('Log').slice(-300).map(function(r){return {dateTime:String(r.DateTime),user:String(r.User),action:String(r.Action),details:String(r.Details)};});
  return {inward:inward.slice(-2000),issue:issue.slice(-3000),plates:plates.slice(-1000),adjust:adjust.slice(-1000),logs:logs};
}
function localDate_() { return Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Kolkata','yyyy-MM-dd'); }
function savePlates_(b,user) {
  if(user.role!=='Admin'&&String(b.date)!==localDate_())throw new Error('Past plate counts can only be changed by Admin.');
  if(['B','L','S','D'].indexOf(String(b.meal))<0)throw new Error('Invalid meal.');
  var served=Number(b.platesServed);if(!(served>=0)||Math.floor(served)!==served)throw new Error('Plates served must be a whole number.');
  var rows=objects_('Plates'),old=null;rows.forEach(function(r){if(String(r.Date)===String(b.date)&&String(r.Meal)===String(b.meal))old=r;});
  var row={Date:String(b.date),Meal:String(b.meal),PlatesServed:served,MenuServed:String(b.menuServed||''),PlatesPrepared:Math.max(0,Math.floor(Number(b.platesPrepared)||0)),Leftover:Math.max(0,Math.floor(Number(b.leftover)||0)),UpdatedBy:user.name,DateTime:new Date().toISOString()};
  if(old){log_(user.username,'PLATE_EDIT',old.Date+' '+old.Meal+' served '+old.PlatesServed+' -> '+served);updateRow_('Plates',old.__row,row);}else append_('Plates',row);
  return {ok:true,message:'Plate count saved.'};
}
function saveIssue_(b,user) {
  if(user.role!=='Admin'&&String(b.date)!==localDate_())throw new Error('Past issues can only be entered by Admin.');
  if(['B','L','S','D'].indexOf(String(b.meal))<0)throw new Error('Invalid meal.');
  if(!String(b.receivedBy||'').trim())throw new Error('Select who received the items.');
  var lines=b.lines||[];if(!lines.length)throw new Error('Add at least one item.');
  var existing=objects_('Issue'),seen={};existing.forEach(function(r){if(r.ClientID)seen[String(r.ClientID)]=true;});
  lines=lines.filter(function(l){return !l.clientId||!seen[String(l.clientId)];});if(!lines.length)return {ok:true,message:'Entry already saved. No duplicate was created.'};
  var stock=stockView_(),balances={};stock.forEach(function(s){balances[s.id]=s.balance;});
  lines.forEach(function(l){var s=balances[String(l.itemId)],qty=Number(l.qty);if(s===undefined)throw new Error('Item not found.');if(!(qty>0))throw new Error('Quantity must be greater than zero.');if(user.role!=='Admin'&&qty>s+0.00001)throw new Error('Insufficient stock. Available: '+s);balances[String(l.itemId)]=s-qty;});
  lines.forEach(function(l){var item=null;objects_('Items').forEach(function(r){if(String(r.ItemID)===String(l.itemId))item=itemObject_(r);});if(!item||!item.active)throw new Error('Item inactive or missing.');append_('Issue',{IssueID:Utilities.getUuid(),DateTime:new Date().toISOString(),Date:String(b.date),Meal:String(b.meal),ItemID:item.id,Qty:Number(l.qty),Unit:item.unit,ReceivedBy:String(b.receivedBy).trim(),IssuedBy:user.name,Purpose:String(b.meal),Remarks:String(b.remarks||''),ClientID:String(l.clientId||Utilities.getUuid())});});
  log_(user.username,'ISSUE',b.date+' '+b.meal+' '+lines.length+' lines');return {ok:true,message:'Stock issued successfully.'};
}

function saveInward_(b,user) {
  var lines=b.lines||[];if(!lines.length)throw new Error('Add at least one stock line.');
  var existing=objects_('Inward'),duplicate=false,seen={};existing.forEach(function(r){if(String(r.Supplier).toLowerCase()===String(b.supplier||'').toLowerCase()&&String(r.BillNo).toLowerCase()===String(b.billNo||'').toLowerCase()&&b.billNo)duplicate=true;if(r.ClientID)seen[String(r.ClientID)]=true;});
  lines=lines.filter(function(l){return !l.clientId||!seen[String(l.clientId)];});if(!lines.length)return {ok:true,message:'Entry already saved. No duplicate was created.'};
  if(duplicate&&!b.confirmDuplicate)return {ok:false,duplicate:true,error:'This supplier and bill number already exist.'};
  var items=objects_('Items'),prepared=[];
  lines.forEach(function(l){var item=null,source=null;items.forEach(function(r){if(String(r.ItemID)===String(l.itemId)){item=itemObject_(r);source=r;}});if(!item||!item.active)throw new Error('Match every line to an active item.');var qty=Number(l.qty);if(!(qty>0))throw new Error('Quantity must be greater than zero.');var factor=String(l.unit)===item.purchaseUnit?item.conversion:String(l.unit)===item.unit?1:0;if(!factor)throw new Error('Invalid purchase unit for '+item.name+'.');var rate=Math.max(0,Number(l.rate)||0),amount=l.amount===''||l.amount===undefined?qty*rate:Number(l.amount);if(!(amount>=0))throw new Error('Invalid line amount.');if(rate&&Math.abs(qty*rate-amount)>Math.max(1,amount*.02))throw new Error('Quantity x rate does not match amount for '+item.name+'.');prepared.push({item:item,source:source,row:{InwardID:Utilities.getUuid(),DateTime:new Date().toISOString(),BillNo:String(b.billNo||''),BillDate:String(b.billDate||localDate_()),Supplier:String(b.supplier||'Manual purchase'),ItemID:item.id,Qty:qty,Unit:String(l.unit),Rate:rate,Amount:amount,ConversionFactor:factor,QtyIssue:qty*factor,BillPhotoURL:String(b.photoUrl||''),Source:String(b.source||'Manual'),EnteredBy:user.name,ClientID:String(l.clientId||Utilities.getUuid())},ratePerIssue:rate/factor});});
  prepared.forEach(function(p){append_('Inward',p.row);p.source.LastRate=p.ratePerIssue;updateRow_('Items',p.source.__row,itemRow_(itemObject_(p.source)));});
  log_(user.username,'INWARD',b.supplier+' '+b.billNo+' '+lines.length+' lines');return {ok:true,message:'Stock added to the ledger.'};
}
function saveCount_(b,user) {
  var lines=b.lines||[];if(!lines.length)throw new Error('Enter at least one counted quantity.');if(!String(b.reason||'').trim())throw new Error('Enter a count reason.');
  var stock=stockView_(),existing=objects_('Adjust'),seen={};existing.forEach(function(r){if(r.ClientID)seen[String(r.ClientID)]=true;});var changes=0;
  lines.forEach(function(l){if(l.clientId&&seen[String(l.clientId)])return;var s=null;stock.forEach(function(x){if(x.id===String(l.itemId))s=x;});if(!s)throw new Error('Item not found.');var counted=Number(l.counted);if(!(counted>=0))throw new Error('Invalid physical count.');var diff=Math.round((counted-s.balance)*1000)/1000;if(Math.abs(diff)>.0001){append_('Adjust',{AdjustID:Utilities.getUuid(),DateTime:new Date().toISOString(),ItemID:s.id,Qty:diff,Type:'Physical count',Reason:String(b.reason),EnteredBy:user.name,ClientID:String(l.clientId||Utilities.getUuid()),Reference:''});changes++;}});
  log_(user.username,'COUNT',changes+' adjustments');return {ok:true,message:changes+' count difference'+(changes===1?'':'s')+' posted.'};
}
function scanDocument_(b,user,type) {
  var key=prop_('GEMINI_API_KEY','');if(!key)throw new Error('Set GEMINI_API_KEY in Apps Script Script Properties.');
  var base64=String(b.base64||'');if(!base64||base64.length>10000000)throw new Error('Image/PDF is missing or too large (7 MB limit).');
  var mime=String(b.mimeType||'image/jpeg');if(['image/jpeg','image/png','image/webp','application/pdf'].indexOf(mime)<0)throw new Error('Unsupported file type.');
  var folderId=prop_('DRIVE_FOLDER_ID',''),file=null,photoUrl='';
  if(folderId){var blob=Utilities.newBlob(Utilities.base64Decode(base64),mime,String(b.fileName||type)+'-'+Date.now());file=DriveApp.getFolderById(folderId).createFile(blob);photoUrl='https://drive.google.com/uc?id='+file.getId();}
  var model=prop_('GEMINI_MODEL','gemini-2.5-flash');
  var prompt=type==='bill'?'Read this supplier invoice. Return JSON only. Extract supplier, billNo, billDate in YYYY-MM-DD, total, and every purchased line. For each line return printed name, numeric qty, purchase unit, rate, amount and confidence from 0 to 1. Do not infer missing values. Use empty strings or zero when unreadable.':'Read this handwritten/printed stock list or shelf photo. Return JSON only with items. For each visible item return name, numeric qty if explicit otherwise 0, unit and confidence from 0 to 1. Never guess quantities of loose or stacked goods; use 0 so staff must confirm.';
  var schema=type==='bill'?{type:'OBJECT',properties:{supplier:{type:'STRING'},billNo:{type:'STRING'},billDate:{type:'STRING'},total:{type:'NUMBER'},items:{type:'ARRAY',items:{type:'OBJECT',properties:{name:{type:'STRING'},qty:{type:'NUMBER'},unit:{type:'STRING'},rate:{type:'NUMBER'},amount:{type:'NUMBER'},confidence:{type:'NUMBER'}},required:['name','qty','unit','rate','amount','confidence']}}},required:['supplier','billNo','billDate','items']}:{type:'OBJECT',properties:{items:{type:'ARRAY',items:{type:'OBJECT',properties:{name:{type:'STRING'},qty:{type:'NUMBER'},unit:{type:'STRING'},confidence:{type:'NUMBER'}},required:['name','qty','unit','confidence']}}},required:['items']};
  var payload={contents:[{parts:[{text:prompt},{inline_data:{mime_type:mime,data:base64}}]}],generationConfig:{responseMimeType:'application/json',responseSchema:schema,temperature:0}};
  var url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(key);
  var res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:JSON.stringify(payload),muteHttpExceptions:true});
  if(res.getResponseCode()!==200)throw new Error('Vision service error '+res.getResponseCode()+'. Check model name, API key and quota.');
  var body=JSON.parse(res.getContentText()),text=body.candidates&&body.candidates[0]&&body.candidates[0].content&&body.candidates[0].content.parts&&body.candidates[0].content.parts[0].text;
  if(!text)throw new Error('Vision service returned no readable result.');var parsed=JSON.parse(text),items=objects_('Items').map(itemObject_);
  (parsed.items||[]).forEach(function(l){var match=matchItem_(String(l.name||''),items);l.itemId=match.item?match.item.id:'';l.matched=!!match.item;l.confidence=Math.min(Number(l.confidence)||0,match.score);l.flags=[];if(!match.item)l.flags.push('No item match');if(Number(l.confidence)<.75)l.flags.push('Low confidence');if(type==='bill'){if(!(Number(l.qty)>0))l.flags.push('Check quantity');if(Math.abs(Number(l.qty)*Number(l.rate)-Number(l.amount))>Math.max(1,Number(l.amount)*.02))l.flags.push('Quantity x rate mismatch');}else if(!(Number(l.qty)>0))l.flags.push('Confirm counted quantity');});
  log_(user.username,type==='bill'?'BILL_SCAN':'INVENTORY_SCAN',(parsed.items||[]).length+' proposed lines');return {ok:true,photoUrl:photoUrl,bill:parsed};
}
function normalize_(s) { return String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\b(kg|g|gm|l|ltr|litre|ml|pcs|pkt|packet|bag|tin|box|bottle)\b/g,' ').replace(/\s+/g,' ').trim(); }
function similarity_(a,b) { if(!a||!b)return 0;if(a===b)return 1;if(a.indexOf(b)>=0||b.indexOf(a)>=0)return .9;var aa=a.split(' '),bb=b.split(' '),hit=0;aa.forEach(function(x){if(bb.indexOf(x)>=0)hit++;});return 2*hit/(aa.length+bb.length); }
function matchItem_(name,items) { var n=normalize_(name),best=null,score=0;items.forEach(function(i){if(!i.active)return;var names=[i.name].concat(i.aliases||[]);names.forEach(function(alias){var s=similarity_(n,normalize_(alias));if(s>score){score=s;best=i;}});});return {item:score>=.55?best:null,score:score}; }
function getItemPhoto_(itemId) { var found=null;objects_('Items').forEach(function(r){if(String(r.ItemID)===itemId)found=r;});if(!found||!found.PhotoURL)throw new Error('Item photo not found.');var m=String(found.PhotoURL).match(/[?&]id=([^&]+)/);if(!m)throw new Error('Item photo is not available.');var file=DriveApp.getFileById(m[1]),blob=file.getBlob();return {ok:true,dataUrl:'data:'+blob.getContentType()+';base64,'+Utilities.base64Encode(blob.getBytes())}; }
function saveItem_(item,user) { if(!item||!String(item.name||'').trim())throw new Error('Item name is required.');var rows=objects_('Items'),found=null,duplicate=false;rows.forEach(function(r){if(item.id&&String(r.ItemID)===String(item.id))found=r;if(String(r.Name).toLowerCase()===String(item.name).trim().toLowerCase()&&String(r.ItemID)!==String(item.id||''))duplicate=true;});if(duplicate)throw new Error('An item with this name already exists.');item.id=item.id||'ITEM_'+Utilities.getUuid();item.active=item.active!==false;item.conversion=Number(item.conversion);item.minLevel=Number(item.minLevel);if(!(item.conversion>0)||!(item.minLevel>=0))throw new Error('Invalid conversion or minimum.');if(item.photoBase64){var data=String(item.photoBase64);if(data.length>10000000)throw new Error('Reference photo is too large.');var mime=String(item.photoMime||'image/jpeg');if(['image/jpeg','image/png','image/webp'].indexOf(mime)<0)throw new Error('Unsupported reference photo type.');var folderId=prop_( 'DRIVE_FOLDER_ID','');if(!folderId)throw new Error('Set DRIVE_FOLDER_ID before uploading item photos.');var blob=Utilities.newBlob(Utilities.base64Decode(data),mime,String(item.photoName||item.id)+'-'+Date.now()),file=DriveApp.getFolderById(folderId).createFile(blob);item.photoUrl='https://drive.google.com/uc?id='+file.getId();}delete item.photoBase64;delete item.photoMime;delete item.photoName;if(found){var merged=itemObject_(found);Object.keys(item).forEach(function(k){merged[k]=item[k];});updateRow_('Items',found.__row,itemRow_(merged));}else append_('Items',itemRow_(item));log_(user.username,'ITEM_SAVE',item.name);return {ok:true,itemId:item.id,message:'Item saved.'}; }
function saveStaff_(staff,user) { if(!staff||!String(staff.name||'').trim())throw new Error('Staff name is required.');var rows=objects_('Staff'),found=null;rows.forEach(function(r){if(staff.id&&String(r.StaffID)===String(staff.id))found=r;});var row={StaffID:staff.id||'STAFF_'+Utilities.getUuid(),Name:String(staff.name),Role:String(staff.role||''),Active:staff.active!==false};if(found)updateRow_('Staff',found.__row,row);else append_('Staff',row);log_(user.username,'STAFF_SAVE',staff.name);return {ok:true,message:'Staff saved.'}; }
function saveDish_(dish,user) { if(!dish||!String(dish.name||'').trim())throw new Error('Dish name is required.');var rows=objects_('Dishes'),found=null;rows.forEach(function(r){if(dish.id&&String(r.DishID)===String(dish.id))found=r;});var row={DishID:dish.id||'DISH_'+Utilities.getUuid(),DishName:String(dish.name),Meals:(dish.meals||[]).join(','),Active:dish.active!==false};if(found)updateRow_('Dishes',found.__row,row);else append_('Dishes',row);return {ok:true,message:'Dish saved.'}; }
function saveUser_(input,user) { if(!input||!String(input.username||'').trim()||!String(input.name||'').trim())throw new Error('Username and name are required.');if(['Admin','Storekeeper','Viewer'].indexOf(input.role)<0)throw new Error('Invalid role.');var username=String(input.username).trim().toLowerCase(),rows=objects_('Users'),found=null;rows.forEach(function(r){if(input.originalUsername&&String(r.Username)===input.originalUsername)found=r;else if(!input.originalUsername&&String(r.Username).toLowerCase()===username)found=r;});var nameOwner=null;rows.forEach(function(r){if(String(r.Username).toLowerCase()===username&&(!found||String(r.Username)!==String(found.Username)))nameOwner=r;});if(nameOwner)throw new Error('This username is already in use.');if(found&&String(found.Role)==='Admin'&&bool_(found.Active)&&(input.role!=='Admin'||input.active===false)){var otherAdmin=rows.some(function(r){return String(r.Username)!==String(found.Username)&&String(r.Role)==='Admin'&&bool_(r.Active);});if(!otherAdmin)throw new Error('Keep at least one active Admin account.');}if(!found&&String(input.password||'').length<10)throw new Error('Initial password must be at least 10 characters.');if(input.password&&String(input.password).length<10)throw new Error('Password must be at least 10 characters.');var salt=found?String(found.Salt):Utilities.getUuid(),hash=input.password?digest_(salt+String(input.password)):String(found.PasswordHash),row={Username:username,Name:String(input.name),PasswordHash:hash,Salt:salt,Role:String(input.role),Active:input.active!==false};if(found)updateRow_('Users',found.__row,row);else append_('Users',row);log_(user.username,'USER_SAVE',username+' '+input.role);return {ok:true,message:'User saved.'}; }
function reverseMovement_(b,user) { if(!String(b.reason||'').trim())throw new Error('Correction reason is required.');var qty=0;if(b.type==='IN'){var foundI=null;objects_('Inward').forEach(function(r){if(String(r.InwardID)===String(b.id))foundI=r;});if(!foundI)throw new Error('Inward entry not found.');qty=-Number(foundI.QtyIssue);}else if(b.type==='OUT'){var foundO=null;objects_('Issue').forEach(function(r){if(String(r.IssueID)===String(b.id))foundO=r;});if(!foundO)throw new Error('Issue entry not found.');qty=Number(foundO.Qty);}else throw new Error('Only IN or OUT entries can be reversed.');append_('Adjust',{AdjustID:Utilities.getUuid(),DateTime:new Date().toISOString(),ItemID:String(b.itemId),Qty:qty,Type:'Correction',Reason:String(b.reason),EnteredBy:user.name,ClientID:Utilities.getUuid(),Reference:String(b.id)});log_(user.username,'REVERSAL',b.type+' '+b.id);return {ok:true,message:'Reversing entry saved. Original history is unchanged.'}; }
function createBackup_(user) { var ss=ss_(),folderId=prop_('DRIVE_FOLDER_ID',''),name='Canteen backup '+Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Kolkata','yyyy-MM-dd HH-mm');var copy=ss.copy(name),file=DriveApp.getFileById(copy.getId());if(folderId){DriveApp.getFolderById(folderId).addFile(file);DriveApp.getRootFolder().removeFile(file);}log_(user.username,'BACKUP',name);return {ok:true,message:'Spreadsheet backup created in Drive.',backupUrl:file.getUrl()}; }
function setupCanteen() {
  var p=PropertiesService.getScriptProperties(),admin=p.getProperty('ADMIN_USERNAME'),password=p.getProperty('ADMIN_PASSWORD');if(!admin||!password||password.length<10)throw new Error('Set ADMIN_USERNAME and an ADMIN_PASSWORD of at least 10 characters in Script Properties before setup.');
  Object.keys(SHEETS).forEach(function(n){sheet_(n);});
  if(objects_('Items').length===0)CANTEEN_SEED.items.forEach(function(i){append_('Items',itemRow_(i));});
  if(objects_('Staff').length===0)CANTEEN_SEED.staff.forEach(function(s){append_('Staff',{StaffID:s.id,Name:s.name,Role:s.role,Active:s.active});});
  if(objects_('Dishes').length===0)CANTEEN_SEED.dishes.forEach(function(d){append_('Dishes',{DishID:d.id,DishName:d.name,Meals:d.meals.join(','),Active:d.active});});
  if(objects_('Users').length===0){var salt=Utilities.getUuid();append_('Users',{Username:String(admin).toLowerCase(),Name:'Canteen Admin',PasswordHash:digest_(salt+password),Salt:salt,Role:'Admin',Active:true});}
  p.deleteProperty('ADMIN_PASSWORD');return 'Canteen setup complete. Temporary admin password removed from Script Properties.';
}
