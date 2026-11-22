/* Local, clearly-labelled demonstration adapter. No real credentials or cloud data. */
window.DemoAPI = (function () {
  var KEY = 'megaverks-canteen-demo-v1';
  var delay = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  var clone = function (v) { return JSON.parse(JSON.stringify(v)); };
  var uid = function (prefix) { return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); };
  var isoDate = function (d) { var x = d || new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  var daysAgo = function (n) { var d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); };
  function initial() {
    var items = clone(CANTEEN_SEED.items);
    var inward = [], issue = [], plates = [], adjust = [];
    items.forEach(function (item, i) {
      var opening = i < 65 ? Math.max(item.minLevel * (i % 7 === 0 ? 0.45 : 2.4), item.conversion) : item.minLevel * 2;
      item.openingQty = Math.round(opening * 100) / 100;
      item.lastRate = item.unit === 'kg' ? 72 : item.unit === 'litre' ? 128 : 4;
    });
    var rice = items.find(function (i) { return i.id === 'RICE_IDLI'; });
    var urad = items.find(function (i) { return i.id === 'URAD_DAL'; });
    var oil = items.find(function (i) { return i.id === 'SUNFLOWER_OIL'; });
    [rice, urad, oil].forEach(function (item, idx) {
      issue.push({id:uid('ISS'),dateTime:daysAgo(1)+'T08:00:00',date:daysAgo(1),meal:'B',itemId:item.id,qty:[4,1.2,0.8][idx],unit:item.unit,receivedBy:'Ramesh',issuedBy:'Demo Storekeeper',purpose:'Breakfast',remarks:'Demonstration entry',clientId:'DEMO_PREV_'+idx});
    });
    ['B','L','S','D'].forEach(function (meal, idx) {
      plates.push({date:daysAgo(1),meal:meal,platesServed:[82,126,0,104][idx],menuServed:['Idli-Vada','Rice-Sambar-Rasam','','Chapati-Dal'][idx],platesPrepared:[86,130,0,108][idx],leftover:[4,4,0,4][idx],updatedBy:'Demo Storekeeper',dateTime:daysAgo(1)+'T09:00:00'});
    });
    return {version:1,items:items,staff:clone(CANTEEN_SEED.staff),dishes:clone(CANTEEN_SEED.dishes),inward:inward,issue:issue,plates:plates,adjust:adjust,logs:[],users:[{username:'demo-admin',name:'Demo Admin',role:'Admin',active:true}]};
  }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || initial(); } catch (e) { return initial(); } }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function stock(db) {
    return db.items.map(function (item) {
      var inbound = db.inward.filter(function(r){return r.itemId===item.id;}).reduce(function(s,r){return s+Number(r.qtyIssue||0);},0);
      var adjustment = db.adjust.filter(function(r){return r.itemId===item.id;}).reduce(function(s,r){return s+Number(r.qty||0);},0);
      var outbound = db.issue.filter(function(r){return r.itemId===item.id;}).reduce(function(s,r){return s+Number(r.qty||0);},0);
      var movements = db.inward.concat(db.issue,db.adjust).filter(function(r){return r.itemId===item.id;}).sort(function(a,b){return String(b.dateTime).localeCompare(String(a.dateTime));});
      var balance = Number(item.openingQty||0)+inbound+adjustment-outbound;
      return Object.assign({},item,{inQty:inbound,outQty:outbound,adjustQty:adjustment,balance:Math.round(balance*1000)/1000,status:!item.active?'inactive':balance<=0?'out':balance<=Number(item.minLevel)?'low':'ok',lastMovement:movements.length?movements[0].dateTime:'',value:Math.round(balance*Number(item.lastRate||0)*100)/100});
    });
  }
  function bootstrap(db, session) {
    return {ok:true,institution:'Demo Canteen — local only',version:'demo',user:session.user,items:db.items,staff:db.staff,dishes:db.dishes,stock:stock(db),inward:db.inward.slice(-1000),issue:db.issue.slice(-1500),plates:db.plates.slice(-500),adjust:db.adjust.slice(-500),logs:db.logs.slice(-300),users:session.user.role==='Admin'?db.users.map(function(u){return {username:u.username,name:u.name,role:u.role,active:u.active};}):[],serverTime:new Date().toISOString(),queuedOffline:0};
  }
  function requireWrite(session) { if (!session || session.user.role === 'Viewer') throw new Error('Viewer access is read-only.'); }
  function requireAdmin(session) { if (!session || session.user.role !== 'Admin') throw new Error('Admin permission is required.'); }
  function handle(action, p, session) {
    var db = load(), item, existing, total, lines;
    if (action === 'demoLogin') {
      var role = p.role || 'Admin';
      return {ok:true,token:'demo-'+Date.now(),user:{username:'demo-'+role.toLowerCase(),name:'Demo '+role,role:role},demo:true};
    }
    if (action === 'resetDemo') { save(initial()); return {ok:true}; }
    if (!session) throw new Error('Please sign in again.');
    if (action === 'getBootstrap') return bootstrap(db, session);
    if (action === 'getItemPhoto') { var photoItem=db.items.find(function(i){return i.id===p.itemId;});if(!photoItem||!photoItem.photoUrl)throw new Error('Item photo not found.');return {ok:true,dataUrl:photoItem.photoUrl}; }
    if (action === 'getHistory') return {ok:true,inward:db.inward.slice(-500),issue:db.issue.slice(-500),adjust:db.adjust.slice(-500),logs:db.logs.slice(-200)};
    if (action === 'savePlates') {
      requireWrite(session);
      if (session.user.role !== 'Admin' && p.date !== isoDate()) throw new Error('Past plate counts can only be changed by Admin.');
      var plate = Object.assign({},p,{updatedBy:session.user.name,dateTime:new Date().toISOString(),platesServed:Math.max(0,Math.round(Number(p.platesServed)||0))});
      var pi = db.plates.findIndex(function(r){return r.date===p.date&&r.meal===p.meal;});
      if (pi >= 0) db.plates[pi] = plate; else db.plates.push(plate);
      save(db); return {ok:true,message:'Plate count saved.'};
    }
    if (action === 'saveIssue') {
      requireWrite(session);
      if (session.user.role !== 'Admin' && p.date !== isoDate()) throw new Error('Past issues can only be changed by Admin.');
      if (!String(p.receivedBy||'').trim()) throw new Error('Select who received the items.');
      lines = p.lines || [];
      if (!lines.length) throw new Error('Add at least one item.');
      var balances = {}; stock(db).forEach(function(s){balances[s.id]=s.balance;});
      lines.forEach(function(l){
        item = db.items.find(function(i){return i.id===l.itemId&&i.active;});
        if (!item) throw new Error('An item is inactive or missing.');
        var qty=Number(l.qty); if (!(qty>0)) throw new Error('Quantity must be greater than zero.');
        if (session.user.role!=='Admin' && qty>(balances[item.id]||0)+0.00001) throw new Error('Insufficient stock for '+item.name+'. Available: '+(balances[item.id]||0)+' '+item.unit+'.');
        balances[item.id]=(balances[item.id]||0)-qty;
        if (l.clientId && db.issue.some(function(r){return r.clientId===l.clientId;})) throw new Error('This entry was already saved. Refresh before trying again.');
      });
      lines.forEach(function(l){item=db.items.find(function(i){return i.id===l.itemId;});db.issue.push({id:uid('ISS'),dateTime:new Date().toISOString(),date:p.date,meal:p.meal,itemId:item.id,qty:Number(l.qty),unit:item.unit,receivedBy:p.receivedBy,issuedBy:session.user.name,purpose:p.meal,remarks:p.remarks||'',clientId:l.clientId||uid('OFF')});});
      save(db); return {ok:true,message:'Stock issued successfully.'};
    }
    if (action === 'scanBill' || action === 'scanInventory') {
      requireWrite(session);
      var bill = action === 'scanBill';
      return {ok:true,photoUrl:'',demoNotice:'Local demo returned sample rows. No AI or Drive call was made.',bill:bill?{supplier:'Demo Suppliers',billNo:'DEMO-001',billDate:isoDate(),total:5010,items:[{name:'Tur Dal',itemId:'TOOR_DAL',qty:1,unit:'bag',rate:3600,amount:3600,confidence:.96,matched:true,flags:[]},{name:'Sunflower oil',itemId:'SUNFLOWER_OIL',qty:1,unit:'tin',rate:1410,amount:1410,confidence:.92,matched:true,flags:[]}]}:{items:[{name:'Toor dal',itemId:'TOOR_DAL',qty:0,unit:'kg',confidence:.78,matched:true,flags:['Confirm counted quantity']},{name:'Rava',itemId:'RAVA',qty:0,unit:'kg',confidence:.82,matched:true,flags:['Confirm counted quantity']}]}};
    }
    if (action === 'saveInward') {
      requireWrite(session); lines=p.lines||[];
      if (!lines.length) throw new Error('Add at least one stock line.');
      if (p.billNo && db.inward.some(function(r){return r.supplier===p.supplier&&r.billNo===p.billNo;}) && !p.confirmDuplicate) return {ok:false,duplicate:true,error:'This supplier and bill number already exist.'};
      lines.forEach(function(l){item=db.items.find(function(i){return i.id===l.itemId&&i.active;});if(!item)throw new Error('Match every line to an active item.');var qty=Number(l.qty);if(!(qty>0))throw new Error('Quantity must be greater than zero.');var factor=l.unit===item.purchaseUnit?Number(item.conversion):l.unit===item.unit?1:0;if(!factor)throw new Error('Use '+item.unit+' or '+item.purchaseUnit+' for '+item.name+'.');db.inward.push({id:uid('INW'),dateTime:new Date().toISOString(),billNo:p.billNo||'',billDate:p.billDate||isoDate(),supplier:p.supplier||'Manual purchase',itemId:item.id,qty:qty,unit:l.unit,rate:Number(l.rate)||0,amount:Number(l.amount)||qty*(Number(l.rate)||0),conversionFactor:factor,qtyIssue:qty*factor,billPhotoUrl:p.photoUrl||'',source:p.source||'Manual',enteredBy:session.user.name,clientId:l.clientId||uid('OFF')});item.lastRate=factor?((Number(l.rate)||0)/factor):item.lastRate;});
      save(db);return {ok:true,message:'Stock added to the ledger.'};
    }
    if (action === 'saveCount') {
      requireWrite(session);lines=p.lines||[];var current=stock(db);
      lines.forEach(function(l){var now=current.find(function(s){return s.id===l.itemId;});var counted=Number(l.counted);if(!now||!(counted>=0))throw new Error('Enter a valid physical count.');var diff=Math.round((counted-now.balance)*1000)/1000;if(Math.abs(diff)>0.0001)db.adjust.push({id:uid('ADJ'),dateTime:new Date().toISOString(),itemId:l.itemId,qty:diff,type:'Physical count',reason:p.reason||'Physical stock verification',enteredBy:session.user.name,clientId:l.clientId||uid('OFF')});});
      save(db);return {ok:true,message:'Physical count posted as ledger adjustments.'};
    }
    if (action === 'saveItem') { requireAdmin(session);if(!p.item||!p.item.name)throw new Error('Item name is required.');var it=Object.assign({},p.item);if(it.photoBase64){it.photoUrl='data:'+(it.photoMime||'image/jpeg')+';base64,'+it.photoBase64;delete it.photoBase64;}var ix=db.items.findIndex(function(i){return i.id===it.id;});if(ix>=0)db.items[ix]=Object.assign(db.items[ix],it);else{it.id=it.id||uid('ITEM');db.items.push(it);}save(db);return {ok:true,message:'Item saved.'}; }
    if (action === 'saveStaff') { requireAdmin(session);var st=Object.assign({},p.staff);var si=db.staff.findIndex(function(s){return s.id===st.id;});if(si>=0)db.staff[si]=Object.assign(db.staff[si],st);else{st.id=st.id||uid('STAFF');db.staff.push(st);}save(db);return {ok:true,message:'Staff list saved.'}; }
    if (action === 'saveDish') { requireAdmin(session);var ds=Object.assign({},p.dish);var di=db.dishes.findIndex(function(d){return d.id===ds.id;});if(di>=0)db.dishes[di]=Object.assign(db.dishes[di],ds);else{ds.id=ds.id||uid('DISH');db.dishes.push(ds);}save(db);return {ok:true,message:'Dish saved.'}; }
    if (action === 'saveUser') { requireAdmin(session);if(!p.user||!p.user.username||!p.user.name)throw new Error('Username and name are required.');var us=Object.assign({},p.user);delete us.password;delete us.originalUsername;var ui=db.users.findIndex(function(u){return u.username===us.username;});if(ui>=0)db.users[ui]=Object.assign(db.users[ui],us);else db.users.push(us);save(db);return {ok:true,message:'User saved.'}; }
    if (action === 'reverseMovement') { requireAdmin(session);var delta=0;if(p.type==='IN'){var ir=db.inward.find(function(r){return r.id===p.id;});if(!ir)throw new Error('Inward entry not found.');delta=-Number(ir.qtyIssue);}else{var or=db.issue.find(function(r){return r.id===p.id;});if(!or)throw new Error('Issue entry not found.');delta=Number(or.qty);}db.adjust.push({id:uid('ADJ'),dateTime:new Date().toISOString(),itemId:p.itemId,qty:delta,type:'Correction',reason:p.reason,enteredBy:session.user.name,reference:p.id});save(db);return {ok:true,message:'Reversing entry saved. Original history is unchanged.'}; }
    if (action === 'createBackup') { requireAdmin(session);return {ok:true,message:'Demo data is already stored in this browser.',backupUrl:''}; }
    throw new Error('Unknown action: '+action);
  }
  return {
    request:function(action,payload,session){var p=payload||{};return delay(action.indexOf('scan')===0?700:100).then(function(){try{return clone(handle(action,p,session));}catch(e){return {ok:false,error:e.message};}});},
    reset:function(){save(initial());return true;}
  };
})();
