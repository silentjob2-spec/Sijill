/**
 * نظام إدارة الطلاب - Google Sheets backend
 * V17
 *
 * الخطوات:
 * 1) افتح script.google.com وأنشئ مشروعًا جديدًا.
 * 2) الصق هذا الملف كاملًا.
 * 3) شغّل createDatabaseSpreadsheet() مرة واحدة ووافق على الصلاحيات.
 * 4) سيُنشئ Google Sheet تلقائيًا ويخزن معرفها داخل خصائص المشروع.
 * 5) انشر المشروع كتطبيق ويب: Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone with the link (إذا كان متاحًا لحسابك).
 * 6) انسخ رابط /exec وضعه في صفحة Google Sheets داخل الموقع.
 */

const DB_NAME = 'نظام إدارة الطلاب - قاعدة البيانات';
const SHEETS = {
  Classes: ['id','name','section'],
  Students: ['id','name','classId'],
  Attendance: ['id','studentId','date','status'],
  Behavior: ['id','studentId','date','period','time','type','action','notes','image'],
  BehaviorTypes: ['name'],
  Days: ['date','status'],
  Meta: ['key','value']
};
// ملاحظة: أضيف عمود "image" لتخزين مرفقات السلوك (صور) كنص Base64.
// خلايا Google Sheets محدودة بحوالي 50 ألف حرف، لذا قد تفشل مزامنة صورة كبيرة جدًا رغم أن الصور تُضغط تلقائيًا داخل الموقع.
const DEFAULT_BEHAVIORS = ['مشاغبة داخل الصف','تشويش وإزعاج','مخالفة التعليمات','متأخر','خرج من الصف'];

function createDatabaseSpreadsheet() {
  const existing = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (existing) {
    const ss = SpreadsheetApp.openById(existing);
    Logger.log('قاعدة البيانات موجودة: ' + ss.getUrl());
    return ss.getUrl();
  }
  const ss = SpreadsheetApp.create(DB_NAME);
  setupSheets_(ss);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Logger.log('تم إنشاء قاعدة البيانات: ' + ss.getUrl());
  return ss.getUrl();
}

function setupSheets_(ss) {
  Object.keys(SHEETS).forEach((name, index) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name, index);
    sh.clear();
    sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
    sh.getRange(1, 1, 1, SHEETS[name].length)
      .setFontWeight('bold')
      .setBackground('#DCE6F1')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, SHEETS[name].length);
  });
  const bt = ss.getSheetByName('BehaviorTypes');
  if (bt.getLastRow() === 1) bt.getRange(2,1,DEFAULT_BEHAVIORS.length,1).setValues(DEFAULT_BEHAVIORS.map(x=>[x]));
  const meta = ss.getSheetByName('Meta');
  meta.getRange(2,1,2,2).setValues([
    ['version','17'],
    ['description','قاعدة بيانات نظام إدارة الطلاب']
  ]);
}

function getSpreadsheet_() {
  let id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    createDatabaseSpreadsheet();
    id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  }
  return SpreadsheetApp.openById(id);
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'ping';
    if (action === 'ping') return json_({ok:true, message:'الاتصال بـ Google Sheets ناجح.'});
    if (action === 'getAll') return json_({ok:true, data:readDatabase_()});
    return json_({ok:false, error:'أمر GET غير معروف.'});
  } catch (err) {
    return json_({ok:false, error:String(err.message || err)});
  }
}

function doPost(e) {
  try {
    const raw = e && e.parameter && e.parameter.payload;
    if (!raw) throw new Error('لم تصل بيانات الطلب.');
    const req = JSON.parse(raw);
    if (req.action === 'saveAll') {
      saveDatabase_(req.data || {});
      return json_({ok:true, message:'تم حفظ البيانات في Google Sheets.'});
    }
    return json_({ok:false, error:'أمر POST غير معروف.'});
  } catch (err) {
    return json_({ok:false, error:String(err.message || err)});
  }
}

function readDatabase_() {
  const ss = getSpreadsheet_();
  const out = {classes:[], students:[], attendance:[], behaviors:[], behaviorTypes:[], days:[], settings:{}};
  const tz = ss.getSpreadsheetTimeZone() || 'Asia/Amman';
  const readRows = (name) => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return [];
    const range = sh.getRange(2,1,sh.getLastRow()-1,SHEETS[name].length);
    const values = range.getValues();
    const display = range.getDisplayValues();
    return values.map((row,r) => ({row, disp: display[r]})).filter(x => x.row.some(v => v !== '')).map(x => {
      const obj = {};
      SHEETS[name].forEach((h,i)=>obj[h]=vToString_(x.row[i],h,tz,x.disp[i]));
      return obj;
    });
  };
  out.classes = readRows('Classes');
  out.students = readRows('Students');
  out.attendance = readRows('Attendance');
  out.behaviors = readRows('Behavior');
  out.behaviorTypes = readRows('BehaviorTypes').map(x=>x.name).filter(Boolean);
  out.days = readRows('Days');
  const meta = readRows('Meta');
  meta.forEach(x=>{ if (x.key === 'googleAppsScriptUrl') out.settings.googleAppsScriptUrl = x.value; });
  return out;
}

function saveDatabase_(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = getSpreadsheet_();
    writeRows_(ss,'Classes',data.classes || [],SHEETS.Classes);
    writeRows_(ss,'Students',data.students || [],SHEETS.Students);
    writeRows_(ss,'Attendance',data.attendance || [],SHEETS.Attendance);
    writeRows_(ss,'Behavior',data.behaviors || [],SHEETS.Behavior);
    writeRows_(ss,'BehaviorTypes',(data.behaviorTypes || DEFAULT_BEHAVIORS).map(name=>({name})),SHEETS.BehaviorTypes);
    writeRows_(ss,'Days',data.days || [],SHEETS.Days);
    writeRows_(ss,'Meta',[{key:'version',value:'17'},{key:'description',value:'قاعدة بيانات نظام إدارة الطلاب'}],SHEETS.Meta);
  } finally {
    lock.releaseLock();
  }
}

function writeRows_(ss,name,rows,headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#DCE6F1');
  if (!rows.length) return;
  const values = rows.map(obj=>headers.map(h=>obj[h] == null ? '' : obj[h]));
  // تثبيت الأعمدة كنص حتى لا يحوّل Sheets الوقت/التاريخ إلى قيم زمنية
  headers.forEach((h,i)=>{ if (['date','time','period'].indexOf(h) > -1) sh.getRange(2,i+1,values.length,1).setNumberFormat('@'); });
  sh.getRange(2,1,values.length,headers.length).setValues(values);
}

function normalizeTime_(text) {
  // يقبل: 08:19 / 8:19:00 / 8:19 AM / 08:19 م ... ويعيد HH:mm
  const m = String(text || '').match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm|ص|م)?/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const suf = (m[3] || '').toLowerCase();
  if ((suf === 'pm' || suf === 'م') && h < 12) h += 12;
  if ((suf === 'am' || suf === 'ص') && h === 12) h = 0;
  return ('0' + h).slice(-2) + ':' + m[2];
}

function vToString_(v, header, tz, disp) {
  tz = tz || Session.getScriptTimeZone() || 'Asia/Amman';
  if (header === 'time') {
    // نعتمد النص المعروض في الخلية (يتجنب مشكلة فرق التوقيت التاريخي لقيم الوقت)
    const t = normalizeTime_(disp != null && disp !== '' ? disp : v);
    if (t) return t;
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'HH:mm');
    return String(v == null ? '' : v);
  }
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
