/**
 * نظام إدارة الطلاب - Google Sheets backend
 * V22
 *
 * الخطوات:
 * 1) افتح script.google.com وأنشئ مشروعًا جديدًا.
 * 2) الصق هذا الملف كاملًا.
 * 3) شغّل createDatabaseSpreadsheet() مرة واحدة ووافق على الصلاحيات
 *    (يجب الموافقة على Sheets و Drive لأن الصور تُحفظ في Drive).
 * 4) سيُنشئ Google Sheet تلقائيًا ومجلدًا للصور.
 * 5) انشر المشروع كتطبيق ويب: Deploy > New deployment > Web app.
 *    Execute as: Me
 *    Who has access: Anyone with the link (إذا كان متاحًا لحسابك).
 * 6) انسخ رابط /exec وضعه في صفحة Google Sheets داخل الموقع إن لزم.
 *
 * الصور: لا تُحفظ Base64 داخل الخلية (حدّها ~50 ألف حرف).
 * تُرفع إلى مجلد Drive «نظام إدارة الطلاب - صور السلوك»
 * ويُحفظ في عمود image معرف الملف: drive:FILE_ID
 */

const DB_NAME = 'نظام إدارة الطلاب - قاعدة البيانات';
const IMAGES_FOLDER_NAME = 'نظام إدارة الطلاب - صور السلوك';
const SHEETS = {
  Classes: ['id','name','section'],
  Students: ['id','name','classId'],
  Attendance: ['id','studentId','date','status'],
  Behavior: ['id','studentId','date','period','time','type','action','notes','image'],
  BehaviorTypes: ['name'],
  Days: ['date','status'],
  Meta: ['key','value']
};
const DEFAULT_BEHAVIORS = ['مشاغبة داخل الصف','تشويش وإزعاج','مخالفة التعليمات','متأخر','خرج من الصف'];

function createDatabaseSpreadsheet() {
  const existing = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (existing) {
    const ss = SpreadsheetApp.openById(existing);
    Logger.log('قاعدة البيانات موجودة: ' + ss.getUrl());
    getImagesFolder_();
    return ss.getUrl();
  }
  const ss = SpreadsheetApp.create(DB_NAME);
  setupSheets_(ss);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  getImagesFolder_();
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
    ['version','22'],
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

function getImagesFolder_() {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('IMAGES_FOLDER_ID');
  if (saved) {
    try { return DriveApp.getFolderById(saved); } catch (e) {}
  }
  const folder = DriveApp.createFolder(IMAGES_FOLDER_NAME);
  props.setProperty('IMAGES_FOLDER_ID', folder.getId());
  return folder;
}

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'ping';
    if (action === 'ping') return json_({ok:true, message:'الاتصال بـ Google Sheets ناجح.'});
    if (action === 'getAll') return json_({ok:true, data:readDatabase_()});
    if (action === 'imgjson' && e.parameter.id) {
      const file = DriveApp.getFileById(e.parameter.id);
      const blob = file.getBlob();
      return json_({
        ok:true,
        mime: blob.getContentType() || 'image/jpeg',
        data: 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes())
      });
    }
    return json_({ok:false, error:'أمر GET غير معروف.'});
  } catch (err) {
    return json_({ok:false, error:String(err.message || err)});
  }
}

function doPost(e) {
  try {
    var raw = e && e.parameter && e.parameter.payload;
    if (!raw && e && e.postData && e.postData.contents) raw = e.postData.contents;
    if (!raw) throw new Error('لم تصل بيانات الطلب.');
    const req = JSON.parse(raw);
    if (req.action === 'saveAll') {
      saveDatabase_(req.data || {});
      return json_({ok:true, message:'تم حفظ البيانات في Google Sheets.'});
    }
    if (req.action === 'saveImage') {
      const out = withLock_(function(){ return saveBehaviorImage_(req.id, req.image, req.oldDriveId, req.studentName, req.studentId); });
      return json_({ok:true, message:'تم حفظ الصورة في Google Drive داخل مجلد الطالب وإظهارها في الـ Sheet.', ...out});
    }
    if (req.action === 'deleteImage') {
      withLock_(function(){ deleteBehaviorImage_(req.id, req.driveId); });
      return json_({ok:true, message:'تم حذف الصورة.'});
    }
    if (req.action === 'deleteImages') {
      withLock_(function(){ (req.driveIds || []).forEach(function(id){ trashDriveFile_(id); }); });
      return json_({ok:true, message:'تم حذف الصور.'});
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
    const range = sh.getRange(2,1,sh.getLastRow(),SHEETS[name].length);
    const values = range.getValues();
    const display = range.getDisplayValues();
    const formulas = range.getFormulas();
    return values.map((row,r) => ({row, disp: display[r], formula: formulas[r]})).filter(x => x.row.some(v => v !== '') || (x.formula && x.formula.some(v => v !== ''))).map(x => {
      const obj = {};
      SHEETS[name].forEach((h,i)=>{
        if (h === 'image' && x.formula && x.formula[i]) obj[h] = x.formula[i];
        else obj[h]=vToString_(x.row[i],h,tz,x.disp[i]);
      });
      return obj;
    });
  };
  out.classes = readRows('Classes');
  out.students = readRows('Students');
  out.attendance = readRows('Attendance');
  out.behaviors = readRows('Behavior').map(b => {
    b.image = imageViewUrl_(b.image);
    return b;
  });
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
    const existingImgs = readExistingBehaviorImages_(ss);
    const behaviors = (data.behaviors || []).map(b => {
      let img = normalizeImageRef_(b.image);
      if (!img || img.indexOf('data:') === 0) img = existingImgs[String(b.id)] || '';
      return Object.assign({}, b, {image: img});
    });
    writeRows_(ss,'Classes',data.classes || [],SHEETS.Classes);
    writeRows_(ss,'Students',data.students || [],SHEETS.Students);
    writeRows_(ss,'Attendance',data.attendance || [],SHEETS.Attendance);
    writeRows_(ss,'Behavior',behaviors,SHEETS.Behavior);
    writeRows_(ss,'BehaviorTypes',(data.behaviorTypes || DEFAULT_BEHAVIORS).map(name=>({name})),SHEETS.BehaviorTypes);
    writeRows_(ss,'Days',data.days || [],SHEETS.Days);
    writeRows_(ss,'Meta',[{key:'version',value:'22'},{key:'description',value:'قاعدة بيانات نظام إدارة الطلاب'}],SHEETS.Meta);
  } finally {
    lock.releaseLock();
  }
}

function readExistingBehaviorImages_(ss) {
  const map = {};
  const sh = ss.getSheetByName('Behavior');
  if (!sh || sh.getLastRow() < 2) return map;
  const n = sh.getLastRow() - 1;
  const ids = sh.getRange(2, 1, n, 1).getDisplayValues();
  const imgCol = SHEETS.Behavior.indexOf('image') + 1;
  const formulas = sh.getRange(2, imgCol, n, 1).getFormulas();
  const values = sh.getRange(2, imgCol, n, 1).getValues();
  for (let i = 0; i < n; i++) {
    const id = String(ids[i][0] || '');
    if (!id) continue;
    const f = String(formulas[i][0] || '');
    const v = values[i][0];
    if (f) map[id] = f;
    else if (v) map[id] = String(v);
  }
  return map;
}

function writeRows_(ss,name,rows,headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]);
  sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#DCE6F1');
  const imgCol = headers.indexOf('image') + 1;
  headers.forEach((h,i)=>{
    if (h === 'date' || h === 'time' || h === 'period') {
      sh.getRange(1, i+1, Math.max(rows.length + 1, 50), 1).setNumberFormat('@');
    }
  });
  if (!rows.length) return;
  const values = rows.map(obj=>headers.map(h=>{
    if (h === 'image') return '';
    if (obj[h] == null || obj[h] === '') return '';
    if (h === 'time') return normalizeTime_(obj[h]) || '';
    return String(obj[h]);
  }));
  const numRows = values.length;
  sh.getRange(2, 1, numRows, headers.length).setValues(values);
  headers.forEach((h,i)=>{
    if (h === 'date' || h === 'time' || h === 'period') {
      sh.getRange(2, i+1, numRows, 1).setNumberFormat('@');
    }
  });
  if (name === 'Behavior' && imgCol > 0) {
    sh.setColumnWidth(imgCol, 150);
    rows.forEach((obj, i) => {
      const cell = sh.getRange(i + 2, imgCol);
      const id = extractDriveId_(obj.image);
      if (id) {
        cell.setFormula(imageFormula_(id));
        sh.setRowHeight(i + 2, 96);
      } else if (obj.image && String(obj.image).indexOf('=IMAGE') === 0) {
        cell.setFormula(String(obj.image));
        sh.setRowHeight(i + 2, 96);
      } else {
        cell.setValue('');
      }
    });
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function trashDriveFile_(id) {
  const clean = extractDriveId_(id);
  if (!clean) return;
  try { DriveApp.getFileById(clean).setTrashed(true); } catch (e) {}
}

// صورة واحدة فقط لكل حالة: أي ملف سابق لنفس الحالة يُنقل إلى سلة المهملات قبل رفع الجديد
// تُحفظ داخل مجلد فرعي باسم الطالب تحت مجلد الصور الرئيسي
function saveBehaviorImage_(behaviorId, dataUrl, oldDriveId, studentName, studentId) {
  if (!behaviorId) throw new Error('معرف الحالة مفقود.');
  if (!dataUrl || String(dataUrl).indexOf('data:image') !== 0) throw new Error('لا توجد صورة للرفع.');
  const folder = getStudentImagesFolder_(studentName, studentId);
  const safeDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Amman', 'yyyy-MM-dd_HHmm');
  const prefix = 'behavior-' + String(behaviorId).replace(/[^\w\-]/g, '').slice(0, 40);
  const fileName = prefix + '_' + safeDate + '.jpg';
  trashSameBehaviorFiles_(folder, prefix);
  trashSameBehaviorFiles_(getImagesFolder_(), prefix);
  if (oldDriveId) trashDriveFile_(oldDriveId);
  const file = uploadDataUrlToFolder_(dataUrl, fileName, folder);
  const driveId = file.getId();
  const ref = 'drive:' + driveId;
  updateBehaviorImageCell_(behaviorId, ref);
  return {id: behaviorId, driveId: driveId, url: imageViewUrl_(ref), image: imageViewUrl_(ref), folder: folder.getName()};
}

function sanitizeFolderName_(name) {
  var s = String(name || '').trim().replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) s = 'بدون_اسم';
  if (s.length > 80) s = s.slice(0, 80);
  return s;
}

function getStudentImagesFolder_(studentName, studentId) {
  const root = getImagesFolder_();
  const label = sanitizeFolderName_(studentName || studentId || 'طالب');
  const it = root.getFoldersByName(label);
  if (it.hasNext()) return it.next();
  return root.createFolder(label);
}

function trashSameBehaviorFiles_(folder, prefix) {
  if (!folder || !prefix) return;
  try {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const n = f.getName() || '';
      if (n.indexOf(prefix) === 0) {
        try { f.setTrashed(true); } catch (e) {}
      }
    }
  } catch (e) {}
}

function uploadDataUrlToFolder_(dataUrl, name, folder) {
  const m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!m) throw new Error('صيغة الصورة غير صالحة.');
  const bytes = Utilities.base64Decode(m[2]);
  const blob = Utilities.newBlob(bytes, m[1], name || 'image.jpg');
  const target = folder || getImagesFolder_();
  const file = target.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}
  return file;
}

function deleteBehaviorImage_(behaviorId, driveId) {
  if (driveId) trashDriveFile_(driveId);
  if (behaviorId) updateBehaviorImageCell_(behaviorId, '');
}

function updateBehaviorImageCell_(behaviorId, value) {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName('Behavior');
  if (!sh || sh.getLastRow() < 2) return;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues();
  const imgCol = SHEETS.Behavior.indexOf('image') + 1;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(behaviorId)) {
      const cell = sh.getRange(i + 2, imgCol);
      const id = extractDriveId_(value);
      if (id) {
        cell.setFormula(imageFormula_(id));
        sh.setRowHeight(i + 2, 90);
        sh.setColumnWidth(imgCol, 140);
      } else {
        cell.setValue(value || '');
      }
      return;
    }
  }
}

function imageFormula_(id) {
  // يظهر الصورة داخل خلية الـ Sheet. يعتمد على مشاركة الملف «أي شخص لديه الرابط».
  return '=IMAGE("https://lh3.googleusercontent.com/d/' + id + '=w800")';
}

function uploadDataUrl_(dataUrl, name) {
  const m = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!m) throw new Error('صيغة الصورة غير صالحة.');
  const bytes = Utilities.base64Decode(m[2]);
  const blob = Utilities.newBlob(bytes, m[1], name || 'image.jpg');
  const file = getImagesFolder_().createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // بعض حسابات Workspace تمنع المشاركة العامة — نعرض الصورة عبر imgjson
  }
  return file;
}

function normalizeImageRef_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (s.indexOf('data:image') === 0) return s;
  if (s.indexOf('drive:') === 0) return s;
  const id = extractDriveId_(s);
  if (id) return 'drive:' + id;
  if (s.indexOf('http') === 0) return s;
  return '';
}

function extractDriveId_(s) {
  const m = String(s || '').match(/(?:drive:|id=|\/d\/|\/file\/d\/)([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(s)) return s;
  return '';
}

function imageViewUrl_(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (s.indexOf('data:image') === 0) return s;
  const id = extractDriveId_(s);
  if (id) return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1200';
  if (s.indexOf('http') === 0) return s;
  return '';
}

function normalizeTime_(text) {
  if (text instanceof Date && !isNaN(text.getTime())) {
    var hhD = text.getHours();
    var mmD = text.getMinutes();
    if (text.getFullYear() <= 1900 && hhD === 0 && mmD === 0) return '';
    return ('0' + hhD).slice(-2) + ':' + ('0' + mmD).slice(-2);
  }
  if (typeof text === 'number' && isFinite(text)) {
    var totalMin = Math.round((((text % 1) + 1) % 1) * 24 * 60);
    var hh = Math.floor(totalMin / 60) % 24;
    var mm = totalMin % 60;
    return ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2);
  }
  const s = String(text == null ? '' : text).trim();
  if (!s) return '';
  const hm = s.match(/\b(\d{1,2})h(\d{2})\b/i);
  if (hm) {
    var hh2 = parseInt(hm[1], 10);
    if (hh2 >= 0 && hh2 <= 23) return ('0' + hh2).slice(-2) + ':' + hm[2];
  }
  const iso = s.match(/T(\d{1,2}):(\d{2})/);
  if (iso) {
    var hi = parseInt(iso[1], 10);
    if (/1899/.test(s) && hi === 0 && iso[2] === '00') return '';
    return ('0' + hi).slice(-2) + ':' + iso[2];
  }
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?\s*(AM|PM|am|pm|ص|م)?/);
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const suf = (m[3] || '').toLowerCase();
  if ((suf === 'pm' || suf === 'م') && h < 12) h += 12;
  if ((suf === 'am' || suf === 'ص') && h === 12) h = 0;
  if (h < 0 || h > 23) return '';
  if (/1899/.test(s) && h === 0 && m[2] === '00') return '';
  return ('0' + h).slice(-2) + ':' + m[2];
}

function vToString_(v, header, tz, disp) {
  tz = tz || Session.getScriptTimeZone() || 'Asia/Amman';
  if (header === 'image') {
    const s = String((disp != null && String(disp).trim() !== '') ? disp : (v == null ? '' : v)).trim();
    return s;
  }
  if (header === 'time') {
    if (v instanceof Date && !isNaN(v.getTime())) {
      const recovered = normalizeTime_(v);
      if (recovered) return recovered;
      return Utilities.formatDate(v, tz, 'HH:mm');
    }
    if (typeof v === 'number' && isFinite(v)) return normalizeTime_(v);
    const src = (disp != null && String(disp).trim() !== '') ? disp : v;
    const t = normalizeTime_(src);
    return t || '';
  }
  if (header === 'date') {
    if (v instanceof Date && !isNaN(v.getTime())) {
      return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    }
    const s = String(v == null ? '' : v).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (dmy) return dmy[3] + '-' + ('0'+dmy[2]).slice(-2) + '-' + ('0'+dmy[1]).slice(-2);
    return s;
  }
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ============ تنظيف الصور المكررة / غير المستخدمة في Drive ============
 * شغّل previewUnusedImages() أولًا لمعاينة القائمة في السجل (View > Logs)،
 * ثم trashUnusedImages() لنقلها إلى سلة المهملات (يمكن استرجاعها 30 يومًا).
 * الصورة «المستخدمة» هي التي تظهر في عمود image بأي حالة في الـ Sheet.
 */
function listUnusedImages_() {
  const ss = getSpreadsheet_();
  const used = {};
  const sh = ss.getSheetByName('Behavior');
  if (sh && sh.getLastRow() > 1) {
    const imgCol = SHEETS.Behavior.indexOf('image') + 1;
    const n = sh.getLastRow() - 1;
    const formulas = sh.getRange(2, imgCol, n, 1).getFormulas();
    const values = sh.getRange(2, imgCol, n, 1).getValues();
    for (let i = 0; i < n; i++) {
      const id = extractDriveId_(formulas[i][0] || values[i][0]);
      if (id) used[id] = true;
    }
  }
  const out = [];
  const files = getImagesFolder_().getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (!used[f.getId()]) out.push(f);
  }
  return out;
}

function previewUnusedImages() {
  const list = listUnusedImages_();
  Logger.log('عدد الصور غير المستخدمة: ' + list.length);
  list.forEach(function(f){ Logger.log(f.getName() + '  |  ' + f.getId()); });
}

function trashUnusedImages() {
  const list = listUnusedImages_();
  list.forEach(function(f){ f.setTrashed(true); });
  Logger.log('تم نقل ' + list.length + ' صورة إلى سلة المهملات.');
}
