const KEY="student_manager_v3";
const IMG_KEY="student_manager_images_v1";
let behaviorSelected=new Set();
let behaviorTypeSelected=new Set();
let behaviorActionSelected=new Set();
let cloudTimer=null;
let editingBehaviorId=null;
let editFromReport=false;
let editingOriginalTime="";
let pendingEditBehaviorId=(function(){try{return new URLSearchParams(location.search).get("editBehavior")}catch(e){return null}})();
let behMsgTimer=null;
let editingStudentId=null;
let editingClassId=null;
let pendingBehaviorImage=null;
let imageTouched=false;
let behTimeAutoUpdate=true;
const $=id=>document.getElementById(id);
const today=()=>new Date().toISOString().slice(0,10);
const DEFAULT_BEHAVIORS=["مشاغبة داخل الصف","تشويش وإزعاج","مخالفة التعليمات","متأخر","خرج من الصف"];
const ATT_STATUSES=["present","absent","excused"];
const FIXED_CLOUD_URL="https://script.google.com/macros/s/AKfycbwHPUUQY_Zacs9fzSZ3MWVx4PYxeXHH3pADVVkquH-AUv2umNO_qFq3NEf5zdUmKOGE/exec";
const CLOUD_READY_KEY="student_manager_cloud_ready";
let db=loadDB();
let imageStore=loadImageStore();
try{if(db.settings&&db.settings.googleAppsScriptUrl)localStorage.setItem(CLOUD_READY_KEY,"1")}catch(e){}
db.settings={...(db.settings||{}),googleAppsScriptUrl:FIXED_CLOUD_URL};

function loadImageStore(){
  try{
    const x=JSON.parse(localStorage.getItem(IMG_KEY)||"{}");
    return x&&typeof x==="object"?x:{};
  }catch(e){return{}}
}
function saveImageStore(){
  try{localStorage.setItem(IMG_KEY,JSON.stringify(imageStore))}catch(e){
    alert("تعذر حفظ الصور: مساحة تخزين المتصفح ممتلئة. احذف بعض الصور القديمة من حالات السلوك.");
  }
}
const PENDING_KEY="student_manager_img_pending_v1";
const PENDING_MIGRATED_KEY="student_manager_img_pending_migrated";
let imgPending=loadPending();
let imgOps=0;
const driveCache={};
function loadPending(){
  try{const a=JSON.parse(localStorage.getItem(PENDING_KEY)||"[]");return new Set(Array.isArray(a)?a:[])}catch(e){return new Set()}
}
function savePending(){try{localStorage.setItem(PENDING_KEY,JSON.stringify([...imgPending]))}catch(e){}}
function markPending(id){imgPending.add(id);savePending()}
function unmarkPending(id){if(imgPending.delete(id))savePending()}
function isDataImg(v){return String(v||"").indexOf("data:image")===0}
// ترحيل لمرة واحدة: الصور المحلية غير المرتبطة بملف Drive تعتبر بانتظار الرفع
function legacyPendingMigration(){
  try{if(localStorage.getItem(PENDING_MIGRATED_KEY)==="1")return;
    (db.behaviors||[]).forEach(b=>{if(isDataImg(imageStore[b.id])&&!extractDriveId(b.image))imgPending.add(b.id)});
    savePending();localStorage.setItem(PENDING_MIGRATED_KEY,"1");
  }catch(e){}
}
function driveIdOfBehavior(b){return extractDriveId((b&&b.image)||"")||extractDriveId(imageStore[b&&b.id]||"")}
function trashDriveImages(ids){
  ids=[...new Set((ids||[]).filter(Boolean))];
  if(!ids.length)return;
  imgOps++;
  cloudPost("deleteImages",{driveIds:ids}).catch(()=>{}).finally(()=>{imgOps--;queueCloudSync()});
}
function imgFallback(el){
  if(!el||el.dataset.fb)return;
  el.dataset.fb="1";
  const id=extractDriveId(el.getAttribute("src"));
  if(!id)return;
  if(driveCache[id]){el.src=driveCache[id];return}
  cloudGet("imgjson",{id}).then(r=>{if(r&&isDataImg(r.data)){driveCache[id]=r.data;el.src=r.data}}).catch(()=>{});
}
function getBehaviorImage(id){
  if(!id)return null;
  if(imageStore[id])return resolveCloudImage(imageStore[id])||imageStore[id];
  const b=(db.behaviors||[]).find(x=>x.id===id);
  return resolveCloudImage(b&&b.image);
}
function setBehaviorImage(id,dataUrl){
  if(!id)return;
  if(dataUrl)imageStore[id]=dataUrl;
  else delete imageStore[id];
  saveImageStore();
}
function extractDriveId(s){
  const m=String(s||"").match(/(?:drive:|id=|\/d\/|\/file\/d\/)([a-zA-Z0-9_-]{20,})/);
  if(m)return m[1];
  if(/^[a-zA-Z0-9_-]{25,}$/.test(String(s||"").trim()))return String(s).trim();
  return "";
}
function resolveCloudImage(v){
  if(!v)return null;
  const s=String(v).trim();
  if(!s)return null;
  if(s.indexOf("data:image")===0)return s;
  if(s.indexOf("http")===0)return s;
  const id=extractDriveId(s);
  if(id)return "https://lh3.googleusercontent.com/d/"+id+"=w1200";
  return null;
}
function migrateImagesFromDb(){
  let changed=false;
  (db.behaviors||[]).forEach(b=>{
    if(imgPending.has(b.id)&&isDataImg(imageStore[b.id]))return;
    if(isDataImg(imageStore[b.id])&&!imgPending.has(b.id)&&extractDriveId(b.image)){
      imageStore[b.id]=resolveCloudImage(b.image);changed=true;
    }
    if(!b.image)return;
    const s=String(b.image);
    if(s.indexOf("data:image")===0){
      if(!imageStore[b.id]){imageStore[b.id]=s;changed=true}
    }else{
      const url=resolveCloudImage(s);
      if(url&&imageStore[b.id]!==url){imageStore[b.id]=url;changed=true}
    }
  });
  if(changed)saveImageStore();
}

function loadDB(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY));
    if(x&&Array.isArray(x.classes)&&Array.isArray(x.students)&&Array.isArray(x.attendance)&&Array.isArray(x.behaviors)){
      return {...x,days:Array.isArray(x.days)?x.days:[],settings:{googleAppsScriptUrl:x.settings?.googleAppsScriptUrl||"",...(x.settings||{})},behaviorTypes:Array.isArray(x.behaviorTypes)&&x.behaviorTypes.length?x.behaviorTypes:DEFAULT_BEHAVIORS.slice()};
    }
  }catch(e){}
  return{classes:[],students:[],attendance:[],behaviors:[],behaviorTypes:DEFAULT_BEHAVIORS.slice(),days:[],settings:{googleAppsScriptUrl:""}};
}
/** إعادة قراءة قاعدة البيانات من localStorage (مهم بين التبويبات بعد التعديل) */
function reloadDBFromStorage(){
  try{
    const fresh=loadDB();
    // حافظ على رابط السحابة والإعدادات الحساسة للجلسة إن لزم
    const url=(db.settings&&db.settings.googleAppsScriptUrl)||(fresh.settings&&fresh.settings.googleAppsScriptUrl)||"";
    db=fresh;
    if(!db.settings)db.settings={googleAppsScriptUrl:""};
    if(url)db.settings.googleAppsScriptUrl=url;
    if(!Array.isArray(db.behaviorTypes)||!db.behaviorTypes.length)db.behaviorTypes=DEFAULT_BEHAVIORS.slice();
    if(!Array.isArray(db.days))db.days=[];
    // حدّث مخزن الصور أيضًا (قد تتغير من تبويب آخر)
    imageStore=loadImageStore();
    imgPending=loadPending();
    return true;
  }catch(e){return false}
}
if(!Array.isArray(db.behaviorTypes)||!db.behaviorTypes.length)db.behaviorTypes=DEFAULT_BEHAVIORS.slice();
if(!Array.isArray(db.days))db.days=[];
if(!db.settings)db.settings={googleAppsScriptUrl:""};

function normalizeAttendance(){
  const map=new Map();
  for(const a of(db.attendance||[])){
    if(!a||!a.studentId||!a.date||!ATT_STATUSES.includes(a.status))continue;
    if(getDayStatus(a.date)!=='school')continue;
    map.set(`${a.studentId}__${a.date}`,{...a});
  }
  db.attendance=Array.from(map.values()).sort((a,b)=>(a.date+a.studentId).localeCompare(b.date+b.studentId));
}
function saveDB(){
  try{
    localStorage.setItem(KEY,JSON.stringify(db));
  }catch(e){
    alert("تعذر حفظ البيانات: مساحة تخزين المتصفح ممتلئة (غالبًا بسبب الصور المرفقة). يرجى تصدير نسخة احتياطية ثم حذف بعض الصور القديمة من حالات السلوك.");
    return;
  }
  queueCloudSync();
}
function uid(){return crypto?.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random()}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function classText(c){return c?`${c.name} / ${c.section}`:""}
function options(all=false){return (all?'<option value="">جميع الصفوف والشعب</option>':"")+db.classes.map(c=>`<option value="${c.id}">${esc(classText(c))}</option>`).join("")}
function fillClasses(){
  ["studentClass","bulkClass","attClass","behClass","attReportClass","behReportClass","studentFilterClass"].forEach(id=>{
    const el=$(id);
    if(!el)return;
    const keepAll=id.endsWith("ReportClass")||id==="studentFilterClass";
    const current=el.value;
    el.innerHTML=options(keepAll);
    if([...el.options].some(o=>o.value===current))el.value=current;
  });
}
function show(page){
  const el=$(page);
  if(!el)return;
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
  el.classList.remove("hidden");
  document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("active",n.dataset.page===page));
  const titles={home:"الرئيسية",classes:"الصفوف والشعب",students:"الطلاب",attendance:"الحضور والغياب",behavior:"السلوك والتأخير والخروج",reports:"التقارير",backup:"النسخ الاحتياطي والاسترداد",cloud:"Google Sheets"};
  if($("pageTitle"))$("pageTitle").textContent=titles[page]||"";
  if(page==="reports"){
    refreshAttendanceStudentSelect();
    refreshBehaviorPicker();
    // إن كانت الفترة الحالية بلا بيانات بينما توجد بيانات أخرى — وسّع الفترة تلقائيًا
    const span=dataDateSpan();
    if(span){
      const af=$("attFrom")?.value,at=$("attTo")?.value,bf=$("behFrom")?.value,bt=$("behTo")?.value;
      const attEmpty=!(db.attendance||[]).some(a=>a.date>=af&&a.date<=at);
      const behEmpty=!(db.behaviors||[]).some(b=>b.date>=bf&&b.date<=bt);
      if(attEmpty||behEmpty)setReportDateDefaults();
    }
    clearReport("reportAttendance");clearReport("reportBehavior");
    switchReportTab("attendanceReportSection",document.querySelector(".report-tab"));
  }
  if(page==="cloud")loadCloudSettings();
  if(page==="behavior")updateBehTimeLive();
  renderAll();
}
document.querySelectorAll(".nav").forEach(n=>n.onclick=()=>show(n.dataset.page));
async function seedDatabaseFile(){
  if(localStorage.getItem(KEY))return;
  try{
    const r=await fetch("database.json",{cache:"no-store"});
    if(!r.ok)return;
    const x=await r.json();
    if(x&&Array.isArray(x.classes)&&Array.isArray(x.students)&&Array.isArray(x.attendance)&&Array.isArray(x.behaviors)){
      db={...x,days:Array.isArray(x.days)?x.days:[],settings:x.settings||{googleAppsScriptUrl:""}};
      if(!Array.isArray(db.behaviorTypes)||!db.behaviorTypes.length)db.behaviorTypes=DEFAULT_BEHAVIORS.slice();
      normalizeAttendance();
      saveDB();renderAll();
    }
  }catch(e){}
}
function daysAgo(n){
  const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10);
}
function dataDateSpan(){
  const dates=[];
  (db.attendance||[]).forEach(a=>{if(a&&a.date)dates.push(a.date)});
  (db.behaviors||[]).forEach(b=>{if(b&&b.date)dates.push(b.date)});
  if(!dates.length)return null;
  dates.sort();
  return {from:dates[0],to:dates[dates.length-1]};
}
function setReportDateDefaults(){
  const t=today();
  const span=dataDateSpan();
  // إن وُجدت بيانات: من أقدم سجل حتى اليوم (أو آخر سجل إن كان أحدث من اليوم)
  let from=daysAgo(30), to=t;
  if(span){
    from=span.from;
    to=span.to>t?span.to:t;
  }
  if($("attFrom"))$("attFrom").value=from;
  if($("attTo"))$("attTo").value=to;
  if($("behFrom"))$("behFrom").value=from;
  if($("behTo"))$("behTo").value=to;
}
function init(){
  const t=today();
  if($("attDate"))$("attDate").value=t;
  if($("behDate"))$("behDate").value=t;
  setReportDateDefaults();
  if($("behPeriod"))$("behPeriod").innerHTML=Array.from({length:7},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
  if($("behTime"))$("behTime").value=nowTime();
  fillClasses();
  refreshAttendanceStudentSelect();
  refreshBehaviorPicker();
  renderAll();
  tick();
  loadCloudSettings();
  if($("behTime"))$("behTime").addEventListener("input",()=>{behTimeAutoUpdate=false;refreshBehTimeHint()});
  setInterval(updateBehTimeLive,5000);
  // لا تظهر الرئيسية إن فُتحت الصفحة لتعديل حالة من التقارير
  if(pendingEditBehaviorId){
    show("behavior");
  }else{
    show("home");
  }
}
function updateBehTimeLive(){
  const el=$("behTime");
  // يعمل فقط في وضع «حفظ الحالة» (ليس أثناء «تحديث الحالة»)
  // behTimeAutoUpdate=false أو editingBehaviorId → لا تغيّر الوقت المخزّن
  if(!el||!behTimeAutoUpdate||editingBehaviorId)return;
  if(document.activeElement===el)return;
  if(($("behDate")?.value||today())!==today())return;
  el.value=nowTime();
  refreshBehTimeHint();
}
function refreshBehTimeHint(){
  const el=$("behTime"),hint=$("behTimeHint");
  if(!hint)return;
  const n=normTime(el&&el.value);
  hint.textContent=n?("المعروض: "+formatTime12(n)):"";
}
function tick(){
  if($("clock"))$("clock").textContent=new Date().toLocaleString("ar-JO",{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"});
  setTimeout(tick,30000);
}
function nowTime(){const d=new Date();return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`}

/* ---------- Classes ---------- */
function addClass(){
  const n=$("className").value.trim(),s=$("sectionName").value.trim();
  if(!n||!s)return alert("يجب إدخال الصف والشعبة معًا.");
  if(db.classes.some(c=>c.name===n&&c.section===s))return alert("الصف والشعبة موجودان مسبقًا.");
  db.classes.push({id:uid(),name:n,section:s});
  $("className").value=$("sectionName").value="";
  saveDB();renderAll();
}
function renderClasses(){
  const rows=db.classes.map((c,i)=>{
    if(c.id===editingClassId){
      return `<tr><td>${i+1}</td><td><input class="table-input" id="editClassName_${c.id}" value="${esc(c.name)}"></td><td><input class="table-input" id="editClassSection_${c.id}" value="${esc(c.section)}"></td><td>${db.students.filter(s=>s.classId===c.id).length}</td><td><div class="row-actions"><button class="soft" onclick="saveClassEdit('${c.id}')">حفظ</button><button class="soft" onclick="cancelClassEdit()">إلغاء</button></div></td></tr>`;
    }
    return `<tr><td>${i+1}</td><td>${esc(c.name)}</td><td>${esc(c.section)}</td><td>${db.students.filter(s=>s.classId===c.id).length}</td><td><div class="row-actions"><button class="soft" onclick="startClassEdit('${c.id}')">تعديل</button><button class="soft danger-soft" onclick="removeClass('${c.id}')">حذف</button></div></td></tr>`;
  }).join("");
  $("classList").innerHTML=rows?`<div class="table-wrap"><table><tr><th>#</th><th>الصف</th><th>الشعبة</th><th>الطلاب</th><th>إجراء</th></tr>${rows}</table></div>`:`<div class="empty">لا توجد صفوف وشعب.</div>`;
}
function startClassEdit(id){editingClassId=id;renderClasses()}
function cancelClassEdit(){editingClassId=null;renderClasses()}
function saveClassEdit(id){
  const n=$("editClassName_"+id).value.trim(),s=$("editClassSection_"+id).value.trim();
  if(!n||!s)return alert("يجب إدخال الصف والشعبة معًا.");
  if(db.classes.some(c=>c.id!==id&&c.name===n&&c.section===s))return alert("الصف والشعبة موجودان مسبقًا.");
  const c=db.classes.find(x=>x.id===id);
  c.name=n;c.section=s;
  editingClassId=null;
  saveDB();renderAll();
}
function removeClass(id){
  if(db.students.some(s=>s.classId===id))return alert("لا يمكن حذف الصف لأنه مرتبط بطلاب.");
  if(confirm("حذف الصف والشعبة؟")){db.classes=db.classes.filter(c=>c.id!==id);saveDB();renderAll()}
}

/* ---------- Students ---------- */
function addStudent(){
  const c=$("studentClass").value,n=$("studentName").value.trim();
  if(!c||!n)return alert("اختر الصف والشعبة وأدخل اسم الطالب.");
  if(db.students.some(s=>s.classId===c&&s.name===n))return alert("الطالب موجود مسبقًا.");
  db.students.push({id:uid(),name:n,classId:c});
  $("studentName").value="";
  saveDB();renderAll();
}
function addBulk(){
  const c=$("bulkClass").value,names=$("bulkNames").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!c||!names.length)return alert("اختر الصف وأدخل الأسماء.");
  const ex=new Set(db.students.filter(s=>s.classId===c).map(s=>s.name));
  let a=0;
  names.forEach(n=>{if(!ex.has(n)){db.students.push({id:uid(),name:n,classId:c});ex.add(n);a++}});
  $("bulkNames").value="";
  saveDB();renderAll();
  alert(`تمت إضافة ${a} طالبًا.`);
}
function renderStudents(){
  const q=($("studentSearch")?.value||"").trim().toLowerCase();
  const filterClass=$("studentFilterClass")?.value||"";
  const list=db.students.filter(s=>(!filterClass||s.classId===filterClass)&&s.name.toLowerCase().includes(q));
  const rows=list.map((s,i)=>{
    const c=db.classes.find(c=>c.id===s.classId);
    if(s.id===editingStudentId){
      return `<tr><td>${i+1}</td><td><input class="table-input" id="editStudentName_${s.id}" value="${esc(s.name)}"></td><td><select class="table-select" id="editStudentClass_${s.id}">${options()}</select></td><td><div class="row-actions"><button class="soft" onclick="saveStudentEdit('${s.id}')">حفظ</button><button class="soft" onclick="cancelStudentEdit()">إلغاء</button></div></td></tr>`;
    }
    return `<tr><td>${i+1}</td><td>${esc(s.name)}</td><td>${c?esc(classText(c)):"-"}</td><td><div class="row-actions"><button class="soft" onclick="startStudentEdit('${s.id}')">تعديل</button><button class="soft danger-soft" onclick="deleteStudent('${s.id}')">حذف</button></div></td></tr>`;
  }).join("");
  $("studentList").innerHTML=rows?`<div class="table-wrap"><table><tr><th>#</th><th>الطالب</th><th>الصف والشعبة</th><th>إجراء</th></tr>${rows}</table></div>`:`<div class="empty">لا يوجد طلاب.</div>`;
  if(editingStudentId){
    const s=db.students.find(x=>x.id===editingStudentId);
    const sel=$("editStudentClass_"+editingStudentId);
    if(s&&sel)sel.value=s.classId;
  }
}
function startStudentEdit(id){editingStudentId=id;renderStudents()}
function cancelStudentEdit(){editingStudentId=null;renderStudents()}
function saveStudentEdit(id){
  const nameEl=$("editStudentName_"+id),classEl=$("editStudentClass_"+id);
  if(!nameEl||!classEl)return;
  const n=nameEl.value.trim(),c=classEl.value;
  if(!n||!c)return alert("أدخل اسم الطالب واختر الصف والشعبة.");
  if(db.students.some(s=>s.id!==id&&s.classId===c&&s.name===n))return alert("يوجد طالب بنفس الاسم في هذا الصف.");
  const s=db.students.find(x=>x.id===id);
  s.name=n;s.classId=c;
  editingStudentId=null;
  saveDB();renderAll();
}
function deleteStudent(id){
  const s=db.students.find(x=>x.id===id);
  if(!s)return;
  const attCount=db.attendance.filter(a=>a.studentId===id).length;
  const behCount=db.behaviors.filter(b=>b.studentId===id).length;
  let msg=`حذف الطالب "${s.name}"؟`;
  if(attCount||behCount)msg+=` سيتم أيضًا حذف ${attCount} سجل حضور و${behCount} حالة سلوكية مرتبطة به.`;
  if(!confirm(msg))return;
  const gone=db.behaviors.filter(b=>b.studentId===id);
  const goneDrive=gone.map(driveIdOfBehavior);
  gone.forEach(b=>{setBehaviorImage(b.id,null);unmarkPending(b.id)});
  db.students=db.students.filter(x=>x.id!==id);
  db.attendance=db.attendance.filter(a=>a.studentId!==id);
  db.behaviors=db.behaviors.filter(b=>b.studentId!==id);
  trashDriveImages(goneDrive);
  behaviorSelected.delete(id);
  if(editingStudentId===id)editingStudentId=null;
  saveDB();renderAll();
}

/* ---------- Attendance ---------- */
function getClassStudents(id){return db.students.filter(s=>s.classId===id)}
function getDayStatus(date){return db.days.find(d=>d.date===date)?.status||"school"}
function dayStatusLabel(status){return status==='holiday'?'يوم عطلة':status==='leave'?'إجازة':'يوم دراسي'}
function setDayStatus(date,status){db.days=db.days.filter(d=>d.date!==date);if(status!=="school")db.days.push({date,status});db.attendance=db.attendance.filter(a=>a.date!==date);saveDB()}
function changeDayStatus(){const d=$("attDate").value||today(),status=$("dayStatus").value;setDayStatus(d,status);renderAttendance();}
function updateDayStatusUI(){
  const d=$("attDate").value||today(),st=getDayStatus(d);
  if($("dayStatus"))$("dayStatus").value=st;
  const note=$("dayStatusNote");
  if(note){
    if(st==='school'){note.classList.add('hidden');note.textContent=''}
    else{note.classList.remove('hidden');note.textContent=`تم تعريف ${dayStatusLabel(st)} لهذا التاريخ؛ لن يتم تسجيل حضور أو غياب للطلاب.`}
  }
}
function attRecord(studentId,date){return db.attendance.find(a=>a.studentId===studentId&&a.date===date)}
function renderAttendance(){
  const c=$("attClass").value;
  updateDayStatusUI();
  const d=$("attDate").value||today(),daySt=getDayStatus(d);
  if(daySt!=="school"){$("attList").innerHTML=`<div class="empty">${dayStatusLabel(daySt)} — لا يحتاج هذا اليوم إلى تسجيل حضور أو غياب.</div>`;updateAttCounter();return}
  if(!c){$("attList").innerHTML=`<div class="empty">اختر الصف والشعبة لعرض الطلاب.</div>`;updateAttCounter();return}
  const ss=getClassStudents(c);
  const rows=ss.map((s,i)=>{
    const a=attRecord(s.id,d),st=a?.status||"";
    return `<tr><td>${i+1}</td><td>${esc(s.name)}</td><td><div class="status"><button class="${st==='present'?'active present':''}" onclick="setAttendance('${s.id}','present')">حاضر</button><button class="${st==='absent'?'active absent':''}" onclick="setAttendance('${s.id}','absent')">غائب</button><button class="${st==='excused'?'active excused':''}" onclick="setAttendance('${s.id}','excused')">غائب بعذر</button></div></td><td>${st?'<span class="hint">محفوظ</span>':'<span class="hint">غير مسجل</span>'}</td></tr>`;
  }).join("");
  $("attList").innerHTML=rows?`<div class="table-wrap"><table><tr><th>#</th><th>الطالب</th><th>الحالة</th><th>الحفظ</th></tr>${rows}</table></div>`:`<div class="empty">لا يوجد طلاب في هذا الصف.</div>`;
  updateAttCounter();
}
function setAttendance(studentId,status){
  const d=$("attDate").value||today();
  if(getDayStatus(d)!=="school")return alert("لا يمكن تسجيل حضور في يوم عطلة أو إجازة.");
  db.attendance=db.attendance.filter(a=>!(a.studentId===studentId&&a.date===d));
  db.attendance.push({id:uid(),studentId,date:d,status});
  normalizeAttendance();saveDB();renderAttendance();
}
function allAtt(status){
  const c=$("attClass").value;
  if(!c)return alert("اختر الصف والشعبة.");
  const d=$("attDate").value||today();
  if(getDayStatus(d)!=="school")return alert("لا يمكن التسجيل في يوم عطلة أو إجازة.");
  getClassStudents(c).forEach(s=>{
    db.attendance=db.attendance.filter(a=>!(a.studentId===s.id&&a.date===d));
    db.attendance.push({id:uid(),studentId:s.id,date:d,status});
  });
  normalizeAttendance();saveDB();renderAttendance();
}
function updateAttCounter(){
  const c=$("attClass").value,d=$("attDate").value||today(),ss=getClassStudents(c),records=ss.map(s=>attRecord(s.id,d)).filter(Boolean);
  const p=records.filter(a=>a.status==='present').length,ab=records.filter(a=>a.status==='absent').length,ex=records.filter(a=>a.status==='excused').length,r=ss.length-records.length;
  $("attCounter").textContent=`${records.length} / ${ss.length}`;
  $("attPresentCount").textContent=p;
  $("attAbsentCount").textContent=ab;
  if($("attExcusedCount"))$("attExcusedCount").textContent=ex;
  $("attUnrecordedCount").textContent=r;
  $("attProgress").style.width=(ss.length&&getDayStatus(d)==='school'?records.length/ss.length*100:0)+'%';
}
$("attDate").addEventListener("change",renderAttendance);

/* ---------- Behavior ---------- */
function fillBehaviorStudents(){
  const c=$("behClass").value;
  const current=$("behStudent")?.value;
  $("behStudent").innerHTML=getClassStudents(c).map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("")||'<option value="">لا يوجد طلاب</option>';
  if([...$("behStudent").options].some(o=>o.value===current))$("behStudent").value=current;
}
function showBehSaveMsg(msg,kind){
  const el=$("behSaveMsg");
  if(!el)return;
  el.className="beh-save-msg "+(kind||"ok");
  el.textContent=msg;
  el.classList.remove("hidden");
  if(behMsgTimer)clearTimeout(behMsgTimer);
  behMsgTimer=setTimeout(()=>{el.classList.add("hidden")},8000);
}
function hideBehSaveMsg(){
  const el=$("behSaveMsg");
  if(el)el.classList.add("hidden");
}
function saveBehavior(){
  const sid=$("behStudent").value;
  if(!sid)return alert("اختر الطالب.");
  const typeVal=($("behType").value||"").trim();
  if(!typeVal)return alert("اختر أو ابحث عن السلوك.");
  if(!db.behaviorTypes.includes(typeVal)){
    if(!confirm(`"${typeVal}" غير موجود ضمن قائمة السلوكيات. هل تريد إضافته كسلوك جديد؟`))return;
    db.behaviorTypes.push(typeVal);
  }
  const wasEditing=!!editingBehaviorId;
  let recordId=editingBehaviorId;
  // عند التعديل: لا تستخدم الوقت الحالي أبدًا كبديل — احتفظ بالوقت الأصلي
  let cleanTime="";
  if(wasEditing){
    const existing=(db.behaviors||[]).find(b=>b.id===editingBehaviorId);
    const raw=($("behTime")&&$("behTime").value)?$("behTime").value:"";
    cleanTime=normTime(raw)||normTime(existing&&existing.time)||normTime(editingOriginalTime)||"";
  }else{
    const rawTime=($("behTime")&&$("behTime").value)?$("behTime").value:nowTime();
    cleanTime=normTime(rawTime)||nowTime();
  }
  const data={studentId:sid,date:$("behDate").value||today(),period:String($("behPeriod").value),time:cleanTime,type:typeVal,action:$("behAction").value,notes:$("behNotes").value.trim(),image:null};
  if(editingBehaviorId){
    const idx=db.behaviors.findIndex(b=>b.id===editingBehaviorId);
    if(idx>-1){
      const existing=db.behaviors[idx];
      // إن بقي الوقت فارغًا لسبب ما، لا تستبدل وقت السجل القديم
      if(!data.time)data.time=normTime(existing.time)||existing.time||"";
      db.behaviors[idx]={...existing,...data,image:existing.image||"",id:existing.id,time:data.time||existing.time||""};
      if(imageTouched){
        if(pendingBehaviorImage){setBehaviorImage(existing.id,pendingBehaviorImage);markPending(existing.id)}
        else{
          const old=driveIdOfBehavior(existing);
          setBehaviorImage(existing.id,null);unmarkPending(existing.id);
          db.behaviors[idx].image="";
          trashDriveImages([old]);
        }
      }
    }
    editingBehaviorId=null;
  }else{
    recordId=uid();
    db.behaviors.push({id:recordId,...data});
    if(pendingBehaviorImage){setBehaviorImage(recordId,pendingBehaviorImage);markPending(recordId)}
  }
  saveDB();renderAll();
  if(recordId&&imgPending.has(recordId)&&isDataImg(imageStore[recordId])){
    uploadPendingImages().then(n=>{if(n)renderBehavior();});
  }
  if(wasEditing){
    // بعد التحديث: صفّر النموذج لسجل تالٍ — الوقت يصبح الوقت الحالي (مثل التسجيل الجديد)
    editingOriginalTime="";
    $("behTime").value=nowTime();
    behTimeAutoUpdate=true;
    refreshBehTimeHint();
    $("behAction").value="تنبيه";
    setBehTypeValue(data.type);
    $("behNotes").value="";
    if($("behStudent")){
      // أضف خيارًا فارغًا إن لزم وامسح اختيار الطالب
      if(![...$("behStudent").options].some(o=>o.value==="")){
        $("behStudent").insertAdjacentHTML("afterbegin",'<option value="">— اختر الطالب —</option>');
      }
      $("behStudent").value="";
    }
    imageTouched=false;
    pendingBehaviorImage=null;
    if($("behImageInput"))$("behImageInput").value="";
    resetBehaviorImagePicker();
    setBehaviorFormMode(false);
    if($("behSaveBtn")){
      $("behSaveBtn").disabled=true;
      $("behSaveBtn").textContent="تم التحديث ✓";
      setTimeout(()=>{
        if($("behSaveBtn")&&!editingBehaviorId){
          $("behSaveBtn").disabled=false;
          $("behSaveBtn").textContent="حفظ الحالة";
        }
      },2500);
    }
    if(editFromReport){
      showBehSaveMsg("تم تحديث الحالة بنجاح. يمكنك إغلاق هذه الصفحة والعودة لتبويب التقارير ثم الضغط على «إنشاء التقرير».","ok");
      editFromReport=false;
    }else{
      showBehSaveMsg("تم تحديث الحالة بنجاح. تم مسح اسم الطالب والملاحظات فقط.","ok");
    }
  }else{
    // تسجيل جديد: صفّر النموذج لسجل تالٍ
    $("behNotes").value="";
    $("behTime").value=nowTime();
    behTimeAutoUpdate=true;
    $("behAction").value="تنبيه";
    resetBehaviorImagePicker();
    setBehaviorFormMode(false);
    refreshBehTimeHint();
    showBehSaveMsg("تم حفظ الحالة بنجاح.","ok");
  }
}
function setBehaviorFormMode(editing){
  if($("behSaveBtn"))$("behSaveBtn").textContent=editing?"تحديث الحالة":"حفظ الحالة";
  if($("behFormTitle"))$("behFormTitle").textContent=editing?"تعديل حالة":"تسجيل حالة";
  if($("behCancelEditBtn"))$("behCancelEditBtn").classList.toggle("hidden",!editing);
  // حفظ الحالة → عدّاد الوقت يعمل | تحديث الحالة → عدّاد الوقت متوقف (الوقت المخزّن)
  if(editing){
    behTimeAutoUpdate=false;
  }else{
    behTimeAutoUpdate=true;
  }
}
function openBehaviorEditInNewTab(id){
  if(!id)return;
  try{
    const u=new URL(location.href);
    u.searchParams.set("editBehavior",id);
    // أزل باراميترات أخرى غير ضرورية إن وُجدت
    const win=window.open(u.toString(),"_blank");
    if(!win)alert("يرجى السماح بالنوافذ المنبثقة حتى يفتح التعديل في صفحة جديدة.");
  }catch(e){
    // احتياطي: نفس الصفحة
    show("behavior");startEditBehavior(id);
  }
}
function applyEditBehaviorFromUrl(){
  try{
    const id=pendingEditBehaviorId||new URLSearchParams(location.search).get("editBehavior");
    pendingEditBehaviorId=null;
    if(!id)return;
    editFromReport=true;
    // نظّف الرابط حتى لا يُعاد فتح التعديل عند التحديث
    const u=new URL(location.href);
    u.searchParams.delete("editBehavior");
    history.replaceState(null,"",u.pathname+u.search+u.hash);
    show("behavior");
    // بعد توفر البيانات: افتح نموذج التعديل مباشرة
    const tryEdit=()=>{
      const b=(db.behaviors||[]).find(x=>x.id===id);
      if(b){startEditBehavior(id);return true}
      return false;
    };
    if(!tryEdit()){
      // انتظر المزامنة إن لم تكن البيانات جاهزة بعد
      let n=0;
      const t=setInterval(()=>{
        n++;
        if(tryEdit()||n>40)clearInterval(t);
      },100);
    }
  }catch(e){}
}
function startEditBehavior(id){
  const b=db.behaviors.find(x=>x.id===id);
  if(!b)return;
  const s=db.students.find(x=>x.id===b.studentId);
  if(!s)return alert("تعذر العثور على الطالب المرتبط بهذه الحالة.");
  hideBehSaveMsg();
  if($("behSaveBtn")){$("behSaveBtn").disabled=false}
  editingBehaviorId=id;
  $("behClass").value=s.classId;
  fillBehaviorStudents();
  $("behStudent").value=b.studentId;
  $("behDate").value=b.date;
  $("behPeriod").value=b.period;
  const t=normTime(b.time)||String(b.time||"").trim();
  editingOriginalTime=normTime(b.time)||"";
  behTimeAutoUpdate=false;
  $("behTime").value=editingOriginalTime||t||"";
  if($("behTimeHint"))$("behTimeHint").textContent=(editingOriginalTime||t)?("المعروض: "+formatTime12(editingOriginalTime||t)):"";
  setBehTypeValue(b.type);
  $("behAction").value=b.action;
  $("behNotes").value=b.notes||"";
  pendingBehaviorImage=null;
  imageTouched=false;
  if($("behImageInput"))$("behImageInput").value="";
  const existingImg=getBehaviorImage(b.id);
  showBehaviorImagePreview(existingImg);
  if($("behImageFileName"))$("behImageFileName").textContent=existingImg?"📎 يوجد مرفق محفوظ لهذه الحالة":"لم يتم اختيار صورة";
  setBehaviorFormMode(true);
  window.scrollTo({top:0,behavior:"smooth"});
}
function cancelEditBehavior(){
  editingBehaviorId=null;
  editFromReport=false;
  editingOriginalTime="";
  hideBehSaveMsg();
  $("behNotes").value="";
  $("behTime").value=nowTime();
  behTimeAutoUpdate=true;
  $("behAction").value="تنبيه";
  resetBehaviorImagePicker();
  setBehaviorFormMode(false);
  if($("behSaveBtn")){$("behSaveBtn").disabled=false;$("behSaveBtn").textContent="حفظ الحالة"}
  refreshBehTimeHint();
}
function deleteBehaviorRecord(id){
  if(!confirm("حذف هذه الحالة السلوكية؟"))return;
  const driveId=driveIdOfBehavior(db.behaviors.find(b=>b.id===id));
  db.behaviors=db.behaviors.filter(b=>b.id!==id);
  setBehaviorImage(id,null);unmarkPending(id);
  if(editingBehaviorId===id)cancelEditBehavior();
  saveDB();renderAll();
  trashDriveImages([driveId]);
}
function addBehaviorType(){
  const n=$("newBehavior").value.trim();
  if(!n)return;
  if(db.behaviorTypes.includes(n))return alert("هذا السلوك موجود مسبقًا.");
  db.behaviorTypes.push(n);
  $("newBehavior").value="";
  saveDB();fillBehaviorTypes();openBehaviorManager();
  alert("تمت إضافة السلوك.");
}
function fillBehaviorTypes(){
  if(!$("behType"))return;
  if(!$("behType").value&&db.behaviorTypes.length&&!editingBehaviorId)$("behType").value=db.behaviorTypes[0];
  setBehTypeValue($("behType").value);
}
function setBehTypeValue(v){
  if($("behType"))$("behType").value=v||"";
  if($("behTypeLabel"))$("behTypeLabel").textContent=v||"اختر سلوكًا";
}
function toggleBehTypeMenu(){
  const menu=$("behTypeMenu");
  if(!menu)return;
  const opening=menu.classList.contains("hidden");
  document.querySelectorAll(".dropdown-menu").forEach(m=>m.classList.add("hidden"));
  if(opening){
    menu.classList.remove("hidden");
    if($("behTypeSearch"))$("behTypeSearch").value="";
    renderBehTypeOptions();
    $("behTypeSearch")?.focus();
  }
}
function renderBehTypeOptions(){
  const q=($("behTypeSearch")?.value||"").trim();
  const ql=q.toLowerCase();
  const matches=db.behaviorTypes.filter(t=>t.toLowerCase().includes(ql));
  let html=matches.map(t=>`<div class="pick-row beh-type-option" data-value="${esc(t)}">${esc(t)}</div>`).join("");
  if(!matches.length)html=`<div class="empty">لا توجد نتائج مطابقة.</div>`;
  if(q&&!db.behaviorTypes.includes(q)){
    html+=`<div class="picker-actions"><button type="button" class="soft beh-type-custom" data-value="${esc(q)}">استخدام "${esc(q)}" كسلوك جديد</button></div>`;
  }
  if($("behTypeOptions"))$("behTypeOptions").innerHTML=html;
}
document.addEventListener("click",e=>{
  const opt=e.target.closest(".beh-type-option,.beh-type-custom");
  if(opt){setBehTypeValue(opt.dataset.value);$("behTypeMenu")?.classList.add("hidden")}
});
function toggleBehReportTypeMenu(){
  const menu=$("behReportTypeMenu");
  if(!menu)return;
  const opening=menu.classList.contains("hidden");
  document.querySelectorAll(".dropdown-menu").forEach(m=>{if(m!==menu)m.classList.add("hidden")});
  if(opening){
    menu.classList.remove("hidden");
    if($("behReportTypeSearchBox"))$("behReportTypeSearchBox").value="";
    renderBehReportTypeOptions();
    $("behReportTypeSearchBox")?.focus();
  }else menu.classList.add("hidden");
}
function renderBehReportTypeOptions(){
  const q=($("behReportTypeSearchBox")?.value||"").trim().toLowerCase();
  const matches=db.behaviorTypes.filter(t=>t.toLowerCase().includes(q));
  let html=`<div class="picker-actions"><button type="button" class="soft" onclick="selectAllReportTypes()">اختيار الظاهر</button><button type="button" class="soft" onclick="clearReportTypes()">مسح الاختيار</button></div>`;
  html+=matches.map(t=>`<label class="pick-row"><input type="checkbox" data-type="${esc(t)}" ${behaviorTypeSelected.has(t)?'checked':''} onchange="toggleReportType(this.dataset.type,this.checked)"><span>${esc(t)}</span></label>`).join("");
  if(q&&!matches.length)html+=`<div class="empty">لا توجد نتائج مطابقة.</div>`;
  if($("behReportTypeOptions"))$("behReportTypeOptions").innerHTML=html;
  updateReportTypeLabel();
}
function toggleReportType(t,checked){if(checked)behaviorTypeSelected.add(t);else behaviorTypeSelected.delete(t);updateReportTypeLabel()}
function selectAllReportTypes(){
  const q=($("behReportTypeSearchBox")?.value||"").trim().toLowerCase();
  db.behaviorTypes.filter(t=>t.toLowerCase().includes(q)).forEach(t=>behaviorTypeSelected.add(t));
  renderBehReportTypeOptions();
}
function clearReportTypes(){behaviorTypeSelected.clear();renderBehReportTypeOptions()}
function updateReportTypeLabel(){
  const n=behaviorTypeSelected.size;
  if($("behReportTypeLabel"))$("behReportTypeLabel").textContent=n?`تم اختيار ${n} سلوك`:"كل السلوكيات";
}
function toggleBehReportActionMenu(){
  const menu=$("behReportActionMenu");
  if(!menu)return;
  const opening=menu.classList.contains("hidden");
  document.querySelectorAll(".dropdown-menu").forEach(m=>{if(m!==menu)m.classList.add("hidden")});
  if(opening){
    menu.classList.remove("hidden");
    if($("behReportActionSearchBox"))$("behReportActionSearchBox").value="";
    renderBehReportActionOptions();
    $("behReportActionSearchBox")?.focus();
  }else menu.classList.add("hidden");
}
function reportActionList(){
  const fromSelect=[...($("behAction")?.options||[])].map(o=>o.value).filter(Boolean);
  const fromData=[...new Set((db.behaviors||[]).map(b=>b.action).filter(Boolean))];
  return [...new Set(["لا يوجد إجراء","تنبيه","إخراج من الصف","إحالة للإدارة","استدعاء ولي الأمر",...fromSelect,...fromData])];
}
function renderBehReportActionOptions(){
  const q=($("behReportActionSearchBox")?.value||"").trim().toLowerCase();
  const matches=reportActionList().filter(t=>t.toLowerCase().includes(q));
  let html=`<div class="picker-actions"><button type="button" class="soft" onclick="selectAllReportActions()">اختيار الظاهر</button><button type="button" class="soft" onclick="clearReportActions()">مسح الاختيار</button></div>`;
  html+=matches.map(t=>`<label class="pick-row"><input type="checkbox" data-action="${esc(t)}" ${behaviorActionSelected.has(t)?'checked':''} onchange="toggleReportAction(this.dataset.action,this.checked)"><span>${esc(t)}</span></label>`).join("");
  if(q&&!matches.length)html+=`<div class="empty">لا توجد نتائج مطابقة.</div>`;
  if($("behReportActionOptions"))$("behReportActionOptions").innerHTML=html;
  updateReportActionLabel();
}
function toggleReportAction(t,checked){if(checked)behaviorActionSelected.add(t);else behaviorActionSelected.delete(t);updateReportActionLabel()}
function selectAllReportActions(){
  const q=($("behReportActionSearchBox")?.value||"").trim().toLowerCase();
  reportActionList().filter(t=>t.toLowerCase().includes(q)).forEach(t=>behaviorActionSelected.add(t));
  renderBehReportActionOptions();
}
function clearReportActions(){behaviorActionSelected.clear();renderBehReportActionOptions()}
function updateReportActionLabel(){
  const n=behaviorActionSelected.size;
  if($("behReportActionLabel"))$("behReportActionLabel").textContent=n?`تم اختيار ${n} إجراء`:"كل الإجراءات";
}
function setBehReportTypeValue(v){
  behaviorTypeSelected.clear();
  if(v)behaviorTypeSelected.add(v);
  updateReportTypeLabel();
}
function openBehaviorManager(){renderBehaviorManager();$("behaviorManager").classList.remove("hidden")}
function closeBehaviorManager(){$("behaviorManager").classList.add("hidden")}
function renderBehaviorManager(){
  const q=($("behaviorManagerSearch")?.value||"").trim().toLowerCase();
  const list=db.behaviorTypes.map((x,i)=>({x,i})).filter(o=>o.x.toLowerCase().includes(q));
  $("behaviorManagerList").innerHTML=list.map(o=>`<div class="behavior-manager-row"><input id="bt_${o.i}" value="${esc(o.x)}"><button class="soft" onclick="renameBehaviorType(${o.i})">حفظ الاسم</button><button class="soft danger-soft" onclick="deleteBehaviorType(${o.i})">حذف</button></div>`).join("")||'<div class="empty">لا توجد سلوكيات مطابقة.</div>';
}
function renameBehaviorType(i){
  const n=$("bt_"+i).value.trim();
  if(!n)return alert("اكتب اسم السلوك.");
  if(db.behaviorTypes.some((x,j)=>j!==i&&x===n))return alert("اسم السلوك مستخدم مسبقًا.");
  const old=db.behaviorTypes[i];
  db.behaviorTypes[i]=n;
  db.behaviors.forEach(b=>{if(b.type===old)b.type=n});
  if($("behType")&&$("behType").value===old)setBehTypeValue(n);
  if($("behReportType")&&$("behReportType").value===old)setBehReportTypeValue(n);
  saveDB();fillBehaviorTypes();renderBehaviorManager();renderBehavior();
}
function deleteBehaviorType(i){
  if(!confirm("حذف هذا السلوك من القائمة؟ السجلات القديمة لن تحذف."))return;
  const removed=db.behaviorTypes[i];
  db.behaviorTypes.splice(i,1);
  if(!db.behaviorTypes.length)db.behaviorTypes.push(...DEFAULT_BEHAVIORS.slice(0,2));
  if($("behReportType")&&$("behReportType").value===removed)setBehReportTypeValue("");
  saveDB();fillBehaviorTypes();renderBehaviorManager();
}

/* ---------- Behavior image attachment (محلي في المتصفح) ---------- */
function compressImageToDataUrl(img,maxSide,quality){
  const scale=Math.min(1,maxSide/Math.max(img.width,img.height));
  const w=Math.max(1,Math.round(img.width*scale));
  const h=Math.max(1,Math.round(img.height*scale));
  const canvas=document.createElement("canvas");
  canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext("2d");
  ctx.fillStyle="#fff";
  ctx.fillRect(0,0,w,h);
  ctx.drawImage(img,0,0,w,h);
  return canvas.toDataURL("image/jpeg",quality);
}
function handleBehaviorImageSelect(e){
  const file=e.target.files&&e.target.files[0];
  if(!file)return;
  if(!file.type||!file.type.startsWith("image/")){
    alert("الرجاء اختيار ملف صورة (JPG أو PNG أو WebP).");
    e.target.value="";
    return;
  }
  if(file.size>12*1024*1024){
    alert("حجم الصورة كبير جدًا (أكثر من 12 ميجابايت). اختر صورة أصغر.");
    e.target.value="";
    return;
  }
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      try{
        let dataUrl=compressImageToDataUrl(img,640,0.5);
        if(dataUrl.length>45000)dataUrl=compressImageToDataUrl(img,480,0.4);
        if(dataUrl.length>45000)dataUrl=compressImageToDataUrl(img,360,0.32);
        if(dataUrl.length>45000)dataUrl=compressImageToDataUrl(img,280,0.28);
        if(dataUrl.length>50000){
          alert("تعذر ضغط الصورة بما يكفي للرفع إلى Google Drive. جرّب صورة أصغر.");
          e.target.value="";
          return;
        }
        if(dataUrl.length>120000){
          alert("تعذر ضغط الصورة بما يكفي. جرّب صورة أصغر.");
          e.target.value="";
          return;
        }
        pendingBehaviorImage=dataUrl;
        imageTouched=true;
        showBehaviorImagePreview(pendingBehaviorImage);
        if($("behImageFileName"))$("behImageFileName").textContent=`✅ ${file.name||"تم اختيار صورة"}`;
      }catch(err){
        alert("تعذر معالجة الصورة.");
        e.target.value="";
      }
    };
    img.onerror=()=>{alert("تعذر قراءة الصورة.");e.target.value=""};
    img.src=reader.result;
  };
  reader.onerror=()=>{alert("تعذر قراءة الملف.");e.target.value=""};
  reader.readAsDataURL(file);
}
function showBehaviorImagePreview(dataUrl){
  const wrap=$("behImagePreviewWrap"),img=$("behImagePreview");
  if(!wrap||!img)return;
  if(!dataUrl){wrap.classList.add("hidden");img.removeAttribute("src");return}
  img.src=dataUrl;
  wrap.classList.remove("hidden");
}
function viewPendingBehaviorImage(){
  const src=$("behImagePreview")?.getAttribute("src");
  if(!src)return;
  $("imageViewerImg").src=src;
  $("imageViewerModal").classList.remove("hidden");
}
function removeBehaviorImage(){
  pendingBehaviorImage=null;
  imageTouched=true;
  if($("behImageInput"))$("behImageInput").value="";
  if($("behImageFileName"))$("behImageFileName").textContent="لم يتم اختيار صورة";
  showBehaviorImagePreview(null);
}
function resetBehaviorImagePicker(){
  pendingBehaviorImage=null;
  imageTouched=false;
  if($("behImageInput"))$("behImageInput").value="";
  if($("behImageFileName"))$("behImageFileName").textContent="لم يتم اختيار صورة";
  showBehaviorImagePreview(null);
}
function viewBehaviorImage(id){
  const src=getBehaviorImage(id);
  if(!src)return alert("لا توجد صورة مرفقة لهذه الحالة.");
  const v=$("imageViewerImg");
  delete v.dataset.fb;
  v.onerror=()=>imgFallback(v);
  v.src=src;
  $("imageViewerModal").classList.remove("hidden");
}
function closeImageViewer(){$("imageViewerModal").classList.add("hidden");$("imageViewerImg").removeAttribute("src")}

/* ---------- Visual helpers ---------- */
function avatarHtml(name){
  const n=String(name||"").trim(),ch=n?[...n][0]:"؟";
  let h=0;for(const c of n)h=(h*31+c.charCodeAt(0))%5;
  return `<span class="avatar c${h+1}">${esc(ch)}</span>`;
}
function typeTone(t){
  if(t==='متأخر')return 'b-warn';
  if(t==='خرج من الصف')return 'b-vio';
  if(/مشاغب|تشويش|إزعاج|عنف|ضرب|شجار/.test(t||''))return 'b-bad';
  return 'b-brand';
}
function actionTone(a){
  switch(a){
    case 'لا يوجد إجراء':return 'b-mute';
    case 'تنبيه':return 'b-warn';
    case 'إخراج من الصف':return 'b-org';
    case 'إحالة للإدارة':return 'b-bad';
    case 'استدعاء ولي الأمر':return 'b-vio';
    default:return 'b-brand';
  }
}
const typeBadge=t=>`<span class="badge ${typeTone(t)}">${esc(t||'-')}</span>`;
const actionBadge=a=>`<span class="badge plain ${actionTone(a)}">${esc(a||'-')}</span>`;
function dayNameOnly(d){
  const p=(d||"").split("-");if(p.length!==3)return "";
  const dt=new Date(+p[0],+p[1]-1,+p[2]);return isNaN(dt.getTime())?"":ARABIC_DAYS[dt.getDay()];
}
function dateCell(d){return `<div class="date-cell"><b>${formatDateAR(d)}</b><small>${dayNameOnly(d)}</small></div>`}
function icon(id){return `<svg class="ic"><use href="#i-${id}"/></svg>`}
function miniStat(label,val,ic,tone){return `<div class="mini-stat ${tone||''}"><span class="ms-ic">${icon(ic)}</span><div><span>${label}</span><b>${val}</b></div></div>`}

function renderBehavior(){
  const q=($("behaviorListSearch")?.value||"").trim().toLowerCase();
  const all=db.behaviors.map(b=>{
    const s=db.students.find(x=>x.id===b.studentId);
    const c=s&&db.classes.find(x=>x.id===s.classId);
    return {b,s,c};
  });
  const withRefs=all.filter(({b,s,c})=>{
    if(!q)return true;
    const hay=[s?.name,c?classText(c):"",b.type,b.action,b.notes].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }).sort((x,y)=>(y.b.date+y.b.time).localeCompare(x.b.date+x.b.time));
  const t=today();
  if($("behaviorSummary"))$("behaviorSummary").innerHTML=all.length?
    miniStat('إجمالي الحالات',all.length,'behavior','')+
    miniStat('حالات اليوم',all.filter(x=>x.b.date===t).length,'clock','t-bad')+
    miniStat('تأخير',all.filter(x=>x.b.type==='متأخر').length,'clock','t-warn')+
    miniStat('خروج من الصف',all.filter(x=>x.b.type==='خرج من الصف'||x.b.action==='إخراج من الصف').length,'exit','t-vio'):'';
  if($("behaviorCountNote"))$("behaviorCountNote").textContent=q?`${withRefs.length} نتيجة من أصل ${all.length} حالة`:(all.length?`${all.length} حالة مسجلة — الأحدث أولًا`:'لا توجد حالات بعد');
  const rows=withRefs.map(({b,s,c},i)=>{
    const img=getBehaviorImage(b.id);
    return `<tr><td class="hint">${i+1}</td><td><div class="person">${avatarHtml(s?.name)}<div><b>${s?esc(s.name):'-'}</b><small>${c?esc(classText(c)):'-'}</small></div></div></td><td>${dateCell(b.date)}</td><td><span class="period-pill">${esc(b.period)}</span></td><td class="time-cell">${displayTime(b.time)}</td><td>${typeBadge(b.type)}</td><td class="action-cell">${actionBadge(b.action)}</td><td class="notes-cell">${esc(b.notes||'-')}</td><td>${img?`<button type="button" class="soft attach-btn" onclick="viewBehaviorImage('${b.id}')">عرض الصورة</button>`:'-'}</td><td><div class="row-actions"><button class="soft" onclick="startEditBehavior('${b.id}')">تعديل</button><button class="soft danger-soft" onclick="deleteBehaviorRecord('${b.id}')">حذف</button></div></td></tr>`;
  }).join("");
  $("behaviorList").innerHTML=rows?`<div class="table-wrap"><table><thead><tr><th>#</th><th>الطالب</th><th>التاريخ</th><th>الحصة</th><th>الوقت</th><th>السلوك</th><th>الإجراء</th><th>الملاحظات</th><th>المرفق</th><th>إجراء</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty">لا توجد حالات مسجلة${q?' مطابقة للبحث':''}.</div>`;
}

/* ---------- Reports ---------- */
function refreshAttendanceStudentSelect(){
  const c=$("attReportClass").value,students=c?getClassStudents(c):db.students,current=$("attReportStudent").value;
  $("attReportStudent").innerHTML='<option value="">جميع الطلاب</option>'+students.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("");
  if(students.some(s=>s.id===current))$("attReportStudent").value=current;
}
const ARABIC_DAYS=["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"];
function formatDateAR(d){if(!d)return '-';const [y,m,day]=d.split('-');return `${day}/${m}/${y}`}
function formatDateWithDay(d){
  if(!d)return '-';
  const parts=d.split('-');
  if(parts.length!==3)return formatDateAR(d);
  const dt=new Date(+parts[0],+parts[1]-1,+parts[2]);
  if(isNaN(dt.getTime()))return formatDateAR(d);
  return `${ARABIC_DAYS[dt.getDay()]} ${formatDateAR(d)}`;
}
function imageHtml(src,cls){
  if(!src)return '-';
  return `<img class="${cls||'report-thumb'}" src="${esc(src)}" alt="مرفق" referrerpolicy="no-referrer" loading="lazy" onerror="window.imgFallback&&imgFallback(this)">`;
}
function formatTime12(t){
  const n=normTime(t);
  if(!n)return "";
  const [hs,ms]=n.split(":");
  let h=parseInt(hs,10);
  if(isNaN(h))return n;
  const suf=h>=12?"م":"ص";
  h=h%12;if(h===0)h=12;
  return h+":"+ms+" "+suf;
}
function displayTime(t){
  return formatTime12(t)||'-';
}
function timeCell(b){
  return formatTime12(b&&b.time)||'-';
}
function attendanceDetailsForStudent(studentId,from,to){
  const inRange=a=>a.studentId===studentId&&a.date>=from&&a.date<=to&&getDayStatus(a.date)==='school';
  const absent=db.attendance.filter(a=>inRange(a)&&a.status==='absent').sort((a,b)=>a.date.localeCompare(b.date));
  const excused=db.attendance.filter(a=>inRange(a)&&a.status==='excused').sort((a,b)=>a.date.localeCompare(b.date));
  return{absent,excused};
}
const reportStamp=()=>`أُنشئ في ${new Date().toLocaleString('ar-JO',{dateStyle:'medium',timeStyle:'short'})}`;
function repHeader(title,from,to,chips){
  return `<div class="print-header"><h2>${title}</h2><div class="rep-meta"><span class="rep-chip">الفترة: <b>${formatDateAR(from)}</b> ← <b>${formatDateAR(to)}</b></span>${chips.map(c=>`<span class="rep-chip">${c}</span>`).join('')}</div><div class="rep-stamp">${reportStamp()}</div></div>`;
}
function studentOrderIndex(){
  const map=new Map();
  (db.students||[]).forEach((s,i)=>{if(s&&s.id)map.set(s.id,i)});
  return map;
}
function sortStudentsByListOrder(arr, getStudent){
  const order=studentOrderIndex();
  return arr.slice().sort((a,b)=>{
    const sa=getStudent?getStudent(a):a;
    const sb=getStudent?getStudent(b):b;
    const ia=order.has(sa&&sa.id)?order.get(sa.id):99999;
    const ib=order.has(sb&&sb.id)?order.get(sb.id):99999;
    if(ia!==ib)return ia-ib;
    return String(sa&&sa.name||"").localeCompare(String(sb&&sb.name||""),"ar",{sensitivity:"base"});
  });
}
function makeAttendanceReport(){
  reloadDBFromStorage();
  const from=$("attFrom").value,to=$("attTo").value,c=$("attReportClass").value,sid=$("attReportStudent").value;
  if(!from||!to||from>to)return alert("يرجى تحديد فترة صحيحة.");
  normalizeAttendance();
  const ss=sid?db.students.filter(s=>s.id===sid):(c?getClassStudents(c):db.students);
  if(!ss.length){$("reportAttendance").innerHTML='<div class="empty">لا يوجد طلاب ضمن الاختيار الحالي.</div>';markReport("reportAttendance");return}
  const details=ss.map((s,i)=>{const d=attendanceDetailsForStudent(s.id,from,to);return{s,i,absent:d.absent,excused:d.excused,absentDates:d.absent.map(x=>x.date),excusedDates:d.excused.map(x=>x.date)}});
  const withAbs=sortStudentsByListOrder(details.filter(x=>x.absent.length||x.excused.length),x=>x.s);
  const totalA=withAbs.reduce((n,x)=>n+x.absent.length,0);
  const totalEx=withAbs.reduce((n,x)=>n+x.excused.length,0);
  const selection=sid?`الطالب: <b>${esc(ss[0].name)}</b>`:(c?`الصف والشعبة: <b>${esc(classText(db.classes.find(x=>x.id===c)))}</b>`:'<b>جميع الطلاب</b>');
  let html=repHeader('تقرير الغياب',from,to,[selection])+
    `<div class="summary"><div class="metric"><span>عدد الطلاب</span><b>${ss.length}</b></div><div class="metric t-warn"><span>طلاب لديهم غياب</span><b>${withAbs.length}</b></div><div class="metric t-bad"><span>إجمالي أيام الغياب</span><b>${totalA}</b></div><div class="metric t-vio"><span>إجمالي أيام الغياب بعذر</span><b>${totalEx}</b></div></div>`;
  html+=withAbs.map(x=>`<div class="student-report attendance-student-report"><div class="student-report-head"><div class="person">${avatarHtml(x.s.name)}<div><h3>${esc(x.s.name)}</h3><p>${esc(classText(db.classes.find(c=>c.id===x.s.classId)))}</p></div></div><div class="head-side">${x.absent.length?`<span class="badge b-bad">غياب ${x.absent.length}</span>`:''}${x.excused.length?`<span class="badge b-warn">بعذر ${x.excused.length}</span>`:''}<button class="soft no-print" onclick="printAttendanceStudent('${x.s.id}','${from}','${to}')">${icon('print')}طباعة الطالب</button></div></div>`+
    (x.absentDates.length?`<div class="absence-box"><b>أيام الغياب</b><div class="chips">${x.absentDates.map(d=>`<span class="date-chip">${formatDateWithDay(d)}</span>`).join('')}</div></div>`:'')+
    (x.excusedDates.length?`<div class="absence-box excused-box"><b>أيام الغياب بعذر</b><div class="chips">${x.excusedDates.map(d=>`<span class="date-chip ex">${formatDateWithDay(d)}</span>`).join('')}</div></div>`:'')+
    `</div>`).join('');
  if(!withAbs.length)html+=`<div class="empty">لا توجد أيام غياب للطلاب المحددين خلال هذه الفترة.</div>`;
  $("reportAttendance").innerHTML=html;markReport("reportAttendance");
}
function printAttendanceStudent(studentId,from,to){
  const s=db.students.find(x=>x.id===studentId);
  if(!s)return;
  const d=attendanceDetailsForStudent(studentId,from,to),c=db.classes.find(x=>x.id===s.classId);
  const absDates=d.absent.length?d.absent.map(x=>`<li>${formatDateWithDay(x.date)}</li>`).join(''):'<li>لا يوجد غياب خلال الفترة.</li>';
  const exDates=d.excused.length?d.excused.map(x=>`<li>${formatDateWithDay(x.date)}</li>`).join(''):'<li>لا يوجد غياب بعذر خلال الفترة.</li>';
  openPrintWindow(`<div class="single-report"><div class="print-header"><h1>تقرير غياب الطالب</h1><p><b>الطالب:</b> ${esc(s.name)}</p><p><b>الصف والشعبة:</b> ${esc(c?classText(c):'-')}</p><p><b>الفترة:</b> ${formatDateAR(from)} إلى ${formatDateAR(to)}</p></div><div class="summary"><div class="metric"><span>عدد أيام الغياب</span><b>${d.absent.length}</b></div><div class="metric"><span>عدد أيام الغياب بعذر</span><b>${d.excused.length}</b></div></div><div class="student-detail"><h3>أيام الغياب</h3><ul>${absDates}</ul></div><div class="student-detail"><h3>أيام الغياب بعذر</h3><ul>${exDates}</ul></div></div>`,'تقرير غياب الطالب');
}
function behaviorRowsHtml(items){
  return items.map(b=>{
    const img=getBehaviorImage(b.id);
    const tm=timeCell(b);
    const editBtn=`<button type="button" class="soft no-print" style="padding:4px 10px;font-size:12px;margin-top:4px" onclick="openBehaviorEditInNewTab('${b.id}')">تعديل</button>`;
    return `<tr>
      <td>${dateCell(b.date)}</td>
      <td><span class="period-pill">${esc(b.period)}</span></td>
      <td class="time-cell">${tm}</td>
      <td>${typeBadge(b.type)}</td>
      <td class="action-cell">${actionBadge(b.action)}</td>
      <td class="notes-cell">${esc(b.notes||'-')}</td>
      <td>${img?imageHtml(img):'-'}${editBtn}</td>
    </tr>`;
  }).join("");
}
const BEH_HEAD='<thead><tr><th>التاريخ</th><th>الحصة</th><th>الوقت</th><th>السلوك</th><th>الإجراء</th><th>الملاحظات</th><th>المرفق</th></tr></thead>';
function makeBehaviorReport(){
  reloadDBFromStorage();
  const from=$("behFrom").value,to=$("behTo").value,c=$("behReportClass").value;
  if(!from||!to||from>to)return alert("يرجى تحديد فترة صحيحة.");
  const types=behaviorTypeSelected;
  const actions=behaviorActionSelected;
  const base=c?getClassStudents(c):db.students,ss=behaviorSelected.size?base.filter(s=>behaviorSelected.has(s.id)):base,
    data=db.behaviors.filter(b=>b.date>=from&&b.date<=to&&ss.some(s=>s.id===b.studentId)&&(!types.size||types.has(b.type))&&(!actions.size||actions.has(b.action))),
    grouped=sortStudentsByListOrder(ss.map(s=>({s,items:data.filter(b=>b.studentId===s.id).sort((a,b)=>(a.date+(normTime(a.time)||"")).localeCompare(b.date+(normTime(b.time)||"")))})).filter(x=>x.items.length),x=>x.s),
    late=data.filter(b=>b.type==='متأخر').length,
    out=data.filter(b=>b.type==='خرج من الصف'||b.action==='إخراج من الصف').length;
  const chips=[behaviorSelected.size?`تم اختيار <b>${ss.length}</b> طالب`:(c?`الصف والشعبة: <b>${esc(classText(db.classes.find(x=>x.id===c)))}</b>`:"<b>جميع الطلاب</b>")];
  if(types.size)chips.push(types.size>3?`السلوك: <b>${types.size} أنواع محددة</b>`:`السلوك: <b>${[...types].map(esc).join("، ")}</b>`);
  if(actions.size)chips.push(actions.size>3?`الإجراء: <b>${actions.size} إجراءات محددة</b>`:`الإجراء: <b>${[...actions].map(esc).join("، ")}</b>`);
  let html=repHeader('تقرير السلوك',from,to,chips)+`<div class="summary"><div class="metric"><span>الطلاب</span><b>${ss.length}</b></div><div class="metric t-bad"><span>إجمالي الحالات</span><b>${data.length}</b></div><div class="metric t-warn"><span>تأخير</span><b>${late}</b></div><div class="metric t-vio"><span>خروج من الصف</span><b>${out}</b></div></div>`;
  if(!grouped.length)html+=`<div class="empty">لا توجد حالات سلوكية ضمن المدة والفلاتر المحددة.</div>`;
  else html+=grouped.map(x=>`<div class="student-report behavior-student-report"><div class="student-report-head"><div class="person">${avatarHtml(x.s.name)}<div><h3>${esc(x.s.name)}</h3><p>${esc(classText(db.classes.find(c=>c.id===x.s.classId)))}</p></div></div><div class="head-side"><span class="badge b-bad">${x.items.length} ${x.items.length===1?'حالة':'حالات'}</span><button class="soft no-print" onclick="printBehaviorStudent('${x.s.id}','${from}','${to}')">${icon('print')}طباعة سلوك الطالب</button></div></div><div class="table-wrap">`+`<table>${BEH_HEAD}<tbody>${behaviorRowsHtml(x.items)}</tbody></table></div></div>`).join("");
  $("reportBehavior").innerHTML=html;markReport("reportBehavior");
}
function printBehaviorStudent(studentId,from,to){
  const s=db.students.find(x=>x.id===studentId);
  if(!s)return;
  const c=db.classes.find(x=>x.id===s.classId);
  const items=db.behaviors.filter(b=>b.studentId===studentId&&b.date>=from&&b.date<=to&&(!behaviorTypeSelected.size||behaviorTypeSelected.has(b.type))&&(!behaviorActionSelected.size||behaviorActionSelected.has(b.action)))
    .sort((a,b)=>(a.date+(normTime(a.time)||"")).localeCompare(b.date+(normTime(b.time)||"")));
  const rows=behaviorRowsHtml(items);
  openPrintWindow(`<div class="single-report"><div class="print-header"><h1>تقرير سلوك الطالب</h1><p><b>الطالب:</b> ${esc(s.name)}</p><p><b>الصف والشعبة:</b> ${esc(c?classText(c):'-')}</p><p><b>الفترة:</b> ${formatDateAR(from)} إلى ${formatDateAR(to)}</p></div><div class="summary"><div class="metric"><span>عدد الحالات</span><b>${items.length}</b></div></div><div class="table-wrap print-table-wrap"><table>${BEH_HEAD}<tbody>${rows||'<tr><td colspan="7">لا توجد حالات.</td></tr>'}</tbody></table></div></div>`,'تقرير سلوك الطالب');
}
function switchReportTab(id,button){
  document.querySelectorAll(".report-section").forEach(x=>x.classList.add("hidden"));
  $(id)?.classList.remove("hidden");
  document.querySelectorAll(".report-tab").forEach(x=>x.classList.remove("active"));
  if(button)button.classList.add("active");
}
function clearReport(id){const el=$(id);if(!el)return;el.innerHTML="";el.classList.remove("has-report")}
function markReport(id){const el=$(id);if(el)el.classList.add("has-report")}
function printReport(id){
  if(id==='reportAttendance')makeAttendanceReport();
  if(id==='reportBehavior')makeBehaviorReport();
  const el=$(id);
  if(!el||!el.innerHTML.trim()||el.classList.contains("report-empty")&&!el.classList.contains("has-report"))return alert("أنشئ التقرير أولًا ثم اضغط طباعة التقرير.");
  const title=id==='reportAttendance'?'تقرير الغياب':'تقرير السلوك';
  openPrintWindow(`<div class="print-only-wrap">${el.innerHTML}</div>`,title);
}
function openPrintWindow(content,title){
  const win=window.open('', '_blank', 'width=1100,height=800');
  if(!win)return alert('يرجى السماح بالنوافذ المنبثقة حتى يمكن طباعة التقرير.');
  const styles=[...document.querySelectorAll('link[rel="stylesheet"],style')].map(x=>x.outerHTML).join('');
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>${styles}<style>
body{background:#fff!important;padding:25px!important;color:#111!important}
.print-only-wrap,.single-report{max-width:1100px;margin:auto}
.no-print{display:none!important}
.student-report{page-break-inside:auto;break-inside:auto}
.student-report-head{page-break-after:avoid;break-after:avoid}
.report{display:block!important;border:0!important;box-shadow:none!important;min-height:0!important}
.table-wrap,.print-table-wrap{overflow:visible!important}
table{min-width:0!important;width:100%!important;table-layout:fixed!important;border-collapse:collapse!important}
th,td{color:#111!important;background:#fff!important;white-space:normal!important;vertical-align:top!important;overflow-wrap:anywhere!important;word-break:break-word!important;padding:6px 8px!important}
th{color:#333!important;background:#f1f3f8!important}
.notes-cell{max-width:none!important;width:26%!important;white-space:pre-wrap!important;word-break:break-word!important;overflow-wrap:anywhere!important;line-height:1.45!important;font-size:12px!important;overflow:hidden!important}
.action-cell{width:12%!important;overflow:hidden!important}
.action-cell .badge{white-space:normal!important;max-width:100%!important}
.report-thumb{width:42px!important;height:42px!important;max-width:42px!important}
.badge,.date-chip,.metric,.dist-bar i{-webkit-print-color-adjust:exact;print-color-adjust:exact}
.time-cell{font-weight:800!important;font-variant-numeric:tabular-nums;direction:ltr;text-align:center;white-space:nowrap!important;min-width:70px;width:9%!important}
@media print{
  .page,.sidebar,.topbar,.report-tabs,.report-controls,.no-print{display:none!important}
  .table-wrap{overflow:visible!important}
  .time-cell{display:table-cell!important;visibility:visible!important;color:#000!important}
  table{table-layout:fixed!important}
  .notes-cell{white-space:pre-wrap!important;word-break:break-word!important}
}
</style></head><body><div class="print-only-wrap">${content}</div><script>window.onload=function(){setTimeout(function(){window.print();},250)}<\/script></body></html>`);
  win.document.close();
}
function toggleBehaviorPicker(){$("behaviorPicker").classList.toggle("hidden")}
document.addEventListener("click",e=>{
  if(!e.target.closest("#behaviorPickerWrap"))$("behaviorPicker")?.classList.add("hidden");
  if(!e.target.closest("#behTypeWrap"))$("behTypeMenu")?.classList.add("hidden");
  if(!e.target.closest("#behReportTypeWrap"))$("behReportTypeMenu")?.classList.add("hidden");
  if(!e.target.closest("#behReportActionWrap"))$("behReportActionMenu")?.classList.add("hidden");
});
function refreshBehaviorPicker(){
  const c=$("behReportClass").value,q=($("behReportSearch").value||"").trim(),allowed=c?getClassStudents(c):db.students,ss=allowed.filter(s=>s.name.includes(q)),allowedIds=new Set(allowed.map(s=>s.id));
  behaviorSelected=new Set([...behaviorSelected].filter(id=>allowedIds.has(id)));
  const menu=$("behaviorPicker");
  menu.innerHTML=`<div class="picker-actions"><button type="button" class="soft" onclick="selectVisibleBehaviorStudents()">اختيار الظاهر</button><button type="button" class="soft" onclick="clearBehaviorStudents()">مسح الاختيار</button></div>`+(ss.length?ss.map(s=>`<label class="pick-row"><input type="checkbox" value="${s.id}" ${behaviorSelected.has(s.id)?'checked':''} onchange="toggleBehaviorStudent('${s.id}',this.checked)"><span>${esc(s.name)}</span></label>`).join(""):`<div class="empty">لا توجد نتائج.</div>`);
  updateBehaviorPickerLabel();
}
function toggleBehaviorStudent(id,checked){if(checked)behaviorSelected.add(id);else behaviorSelected.delete(id);updateBehaviorPickerLabel()}
function selectVisibleBehaviorStudents(){const c=$("behReportClass").value,q=($("behReportSearch").value||"").trim(),ss=(c?getClassStudents(c):db.students).filter(s=>s.name.includes(q));ss.forEach(s=>behaviorSelected.add(s.id));refreshBehaviorPicker()}
function clearBehaviorStudents(){behaviorSelected.clear();refreshBehaviorPicker()}
function updateBehaviorPickerLabel(){const n=behaviorSelected.size;$("behaviorPickerLabel").textContent=n?`تم اختيار ${n} طالب`:'جميع الطلاب حسب الاختيار'}

/* ---------- Home / global render ---------- */
function renderHome(){
  const d=today(),a=db.attendance.filter(x=>x.date===d),b=db.behaviors.filter(x=>x.date===d);
  $("homeStats").innerHTML=[
    ['الطلاب',db.students.length,'t-brand'],
    ['حاضر اليوم',a.filter(x=>x.status==='present').length,'t-ok'],
    ['غائب اليوم',a.filter(x=>x.status==='absent').length,'t-bad'],
    ['غياب بعذر اليوم',a.filter(x=>x.status==='excused').length,'t-warn'],
    ['حالات سلوكية',b.length,'t-brand'],
    ['تأخير / خروج',b.filter(x=>x.type==='متأخر'||x.type==='خرج من الصف'||x.action==='إخراج من الصف').length,'t-vio']
  ].map(x=>`<div class="stat ${x[2]}"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
}
function normTime(t){
  if(t==null||t==="")return "";
  if(t instanceof Date&&!isNaN(t.getTime())){
    const h=t.getHours(),m=t.getMinutes();
    if(t.getFullYear()<=1900&&h===0&&m===0)return "";
    return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
  }
  if(typeof t==="number"&&isFinite(t)){
    const total=Math.round(((t%1)+1)%1*24*60);
    const h=Math.floor(total/60)%24;
    const m=total%60;
    if(h===0&&m===0&&t<1)return "";
    return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0");
  }
  const s=String(t).trim();
  if(!s)return "";
  const hm=s.match(/\b(\d{1,2})h(\d{2})\b/i);
  if(hm){
    const h=parseInt(hm[1],10),mm=hm[2];
    if(h>=0&&h<=23)return String(h).padStart(2,"0")+":"+mm;
  }
  // ISO مثل 1899-12-30T08:19:00.000Z — نستخرج الوقت قبل رفض التاريخ
  const iso=s.match(/T(\d{1,2}):(\d{2})/);
  if(iso){
    const h=parseInt(iso[1],10),mm=iso[2];
    if(/1899/.test(s)&&h===0&&mm==="00")return "";
    return String(h).padStart(2,"0")+":"+mm;
  }
  const m=s.match(/(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?\s*(AM|PM|am|pm|ص|م)?/);
  if(m){
    let h=parseInt(m[1],10);const suf=(m[3]||"").toLowerCase();
    if((suf==="pm"||suf==="م")&&h<12)h+=12;
    if((suf==="am"||suf==="ص")&&h===12)h=0;
    if(h>=0&&h<=23){
      // لا نعتبر 00:00 على تاريخ 1899 وقتًا حقيقيًا
      if(/1899/.test(s)&&h===0&&m[2]==="00"&&!iso)return "";
      return String(h).padStart(2,"0")+":"+m[2];
    }
  }
  if(/1899/.test(s))return "";
  return "";
}
function fixBadTimes(){
  db.behaviors.forEach(b=>{
    const n=normTime(b.time);
    if(n)b.time=n;
    else if(b.time&&/1899/.test(String(b.time))&&!String(b.time).includes(":"))b.time="";
  });
}
function renderAll(){
  normalizeAttendance();
  migrateImagesFromDb();
  fixBadTimes();
  fillClasses();
  fillBehaviorTypes();
  fillBehaviorStudents();
  renderClasses();
  renderStudents();
  renderAttendance();
  renderBehavior();
  refreshAttendanceStudentSelect();
  refreshBehaviorPicker();
  renderHome();
  if($("backupInfo"))$("backupInfo").textContent=`آخر حفظ تلقائي: ${new Date().toLocaleTimeString('ar-JO')}`;
  loadCloudSettings();
}

/* ---------- Backup / reset ---------- */
function downloadBackup(){
  const blob=new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=`student-management-backup-${today()}.json`;a.click();URL.revokeObjectURL(a.href);
}
function restoreBackup(e){
  const f=e.target.files[0];
  if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const x=JSON.parse(r.result);
      if(!x.classes||!x.students||!x.attendance||!x.behaviors)throw Error();
      if(!confirm('سيتم استبدال البيانات الحالية بالنسخة الاحتياطية.\nالأوقات الفارغة تُملأ من البيانات الحالية إن وُجدت، والعكس صحيح.'))return;
      // دمج ثنائي الاتجاه: نأخذ أي وقت صالح من النسخة أو من البيانات الحالية
      const timeById={},timeByKey={};
      (db.behaviors||[]).forEach(b=>{
        const nt=normTime(b.time);
        if(!nt)return;
        if(b.id)timeById[b.id]=nt;
        const key=[b.studentId,b.date,String(b.period||''),b.type||''].join('|');
        if(!timeByKey[key])timeByKey[key]=nt;
      });
      let filled=0;
      const behaviors=(x.behaviors||[]).map(b=>{
        const fromBackup=normTime(b.time);
        if(fromBackup)return {...b,time:fromBackup};
        const keep=timeById[b.id]||timeByKey[[b.studentId,b.date,String(b.period||''),b.type||''].join('|')]||"";
        if(keep){filled++;return {...b,time:keep};}
        return {...b,time:""};
      });
      db={...x,behaviors,days:Array.isArray(x.days)?x.days:[],settings:x.settings||{googleAppsScriptUrl:""},behaviorTypes:Array.isArray(x.behaviorTypes)&&x.behaviorTypes.length?x.behaviorTypes:DEFAULT_BEHAVIORS.slice()};
      editingBehaviorId=null;editingStudentId=null;editingClassId=null;
      normalizeAttendance();saveDB();renderAll();
      setReportDateDefaults();
      alert(filled
        ?`تم استرداد النسخة بنجاح.\nتم ملء ${filled} وقت فارغ من البيانات السابقة.`
        :'تم استرداد النسخة بنجاح. تم ضبط فترة التقارير حسب تواريخ البيانات.');
    }catch(err){alert('ملف النسخة غير صالح.')}
  };
  r.readAsText(f);
}
/** ملء الأوقات الفارغة فقط من ملف نسخة — بدون استبدال باقي البيانات */
function fillTimesFromBackup(e){
  const f=e.target.files[0];
  if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const x=JSON.parse(r.result);
      if(!x.behaviors||!Array.isArray(x.behaviors))throw Error();
      const timeById={},timeByKey={};
      x.behaviors.forEach(b=>{
        const nt=normTime(b.time);
        if(!nt)return;
        if(b.id)timeById[b.id]=nt;
        const key=[b.studentId,b.date,String(b.period||''),b.type||''].join('|');
        if(!timeByKey[key])timeByKey[key]=nt;
      });
      let filled=0;
      (db.behaviors||[]).forEach(b=>{
        if(normTime(b.time))return;
        const keep=timeById[b.id]||timeByKey[[b.studentId,b.date,String(b.period||''),b.type||''].join('|')]||"";
        if(keep){b.time=keep;filled++;}
      });
      if(!filled){alert('لم يُعثر على أوقات جديدة لملئها من هذه النسخة.');return;}
      saveDB();renderAll();
      alert(`تم ملء ${filled} سجل بوقت من النسخة الاحتياطية.\nالبيانات الأخرى لم تتغيّر.`);
    }catch(err){alert('ملف النسخة غير صالح.')}
  };
  r.readAsText(f);
  e.target.value="";
}
function clearAttendanceData(){
  if(!db.attendance.length&&!db.days.length)return alert('لا توجد بيانات حضور وغياب لحذفها.');
  if(!confirm('سيتم حذف جميع سجلات الحضور والغياب وحالات الأيام. هل تريد المتابعة؟'))return;
  db.attendance=[];db.days=[];
  saveDB();renderAll();
  alert('تم تصفير الحضور والغياب.');
}
function clearBehaviorData(){
  if(!db.behaviors.length&&!Object.keys(imageStore).length)return alert('لا توجد بيانات سلوك لحذفها.');
  if(!confirm('سيتم حذف جميع سجلات السلوك والتأخير والخروج فقط. هل تريد المتابعة؟'))return;
  const goneDrive=db.behaviors.map(driveIdOfBehavior);
  db.behaviors=[];
  imageStore={};imgPending=new Set();savePending();
  saveImageStore();
  trashDriveImages(goneDrive);
  editingBehaviorId=null;
  saveDB();renderAll();
  alert('تم تصفير بيانات السلوك.');
}
function resetAllData(){
  if(!confirm('تحذير: سيتم حذف الصفوف والطلاب والحضور والسلوك وجميع البيانات نهائيًا من هذا المتصفح. هل تريد المتابعة؟'))return;
  if(!confirm('تأكيد أخير: لا يمكن التراجع عن هذه العملية إلا باسترداد نسخة احتياطية. هل تريد تصفير النظام بالكامل؟'))return;
  const goneDrive=db.behaviors.map(driveIdOfBehavior);
  db={classes:[],students:[],attendance:[],behaviors:[],behaviorTypes:DEFAULT_BEHAVIORS.slice(),days:[],settings:{googleAppsScriptUrl:""}};
  imageStore={};imgPending=new Set();savePending();
  saveImageStore();
  trashDriveImages(goneDrive);
  behaviorSelected.clear();
  editingBehaviorId=null;editingStudentId=null;editingClassId=null;
  saveDB();renderAll();
  alert('تم تصفير النظام بالكامل.');
}

/* ---------- Google Sheets integration ---------- */
function loadCloudSettings(){if($("cloudUrl"))$("cloudUrl").value=FIXED_CLOUD_URL}
function saveCloudUrl(){setCloudStatus("الرابط مثبّت داخل الموقع ولا يمكن تغييره.","ok")}
function cloudUrl(){return FIXED_CLOUD_URL}
function setCloudStatus(msg,type=''){$("cloudStatus")&&($("cloudStatus").className='cloud-status '+type,$("cloudStatus").textContent=msg)}
async function cloudGet(action,extra){
  const u=cloudUrl();
  if(!u)throw Error('لم يتم إدخال رابط Google Apps Script.');
  let url=u+`?action=${encodeURIComponent(action)}&t=${Date.now()}`;
  if(extra)Object.keys(extra).forEach(k=>{url+=`&${encodeURIComponent(k)}=${encodeURIComponent(extra[k])}`});
  const r=await fetch(url,{cache:'no-store'});
  const text=await r.text();
  let data;
  try{data=JSON.parse(text)}catch(e){throw Error('الاستجابة من Google Apps Script ليست JSON.')}
  if(!data.ok)throw Error(data.error||'فشل الطلب.');
  return data;
}
async function cloudPost(action,payload){
  const u=cloudUrl();
  if(!u)throw Error('لم يتم إدخال رابط Google Apps Script.');
  const json=JSON.stringify({action,...payload});
  const body=new URLSearchParams();
  body.set('payload',json);
  const r=await fetch(u,{method:'POST',body});
  const text=await r.text();
  let data;
  try{data=JSON.parse(text)}catch(e){throw Error('الاستجابة من Google Apps Script ليست JSON.')}
  if(!data.ok)throw Error(data.error||'فشل الطلب.');
  return data;
}
async function testCloud(){try{setCloudStatus('جارٍ اختبار الاتصال...');const x=await cloudGet('ping');setCloudStatus(x.message||'الاتصال ناجح.','ok')}catch(e){setCloudStatus(e.message,'error')}}
function applyCloudData(data,oldTimes){
  const oldBehaviors=new Map((db.behaviors||[]).map(b=>[b.id,b]));
  db={...data,days:Array.isArray(data.days)?data.days:[],settings:{...(db.settings||{}),...(data.settings||{}),googleAppsScriptUrl:FIXED_CLOUD_URL},behaviorTypes:Array.isArray(data.behaviorTypes)&&data.behaviorTypes.length?data.behaviorTypes:DEFAULT_BEHAVIORS.slice()};
  (db.behaviors||[]).forEach(b=>{
    const remoteImg=resolveCloudImage(b.image);
    const localImg=imageStore[b.id];
    if(remoteImg){
      if(!(imgPending.has(b.id)&&isDataImg(localImg)))imageStore[b.id]=remoteImg;
      b.image=remoteImg;
    }else if(localImg){
      b.image=localImg.indexOf("data:")===0?"":localImg;
    }else{
      b.image="";
    }
    const n=normTime(b.time);
    if(n){b.time=n;return}
    const old=oldTimes&&oldTimes.get(b.id);
    const oldN=normTime(old);
    if(oldN){b.time=oldN;return}
    const prev=oldBehaviors.get(b.id);
    const prevN=normTime(prev&&prev.time);
    if(prevN){b.time=prevN;return}
    if(prev&&prev.time){b.time=prev.time;return}
    b.time="";
  });
  migrateImagesFromDb();
  saveImageStore();
  normalizeAttendance();
  try{localStorage.setItem(KEY,JSON.stringify(db))}catch(e){}
}
function behaviorsForCloud(){
  return (db.behaviors||[]).map(b=>{
    const img=imageStore[b.id]||b.image||"";
    let image="";
    if(String(img).indexOf("data:image")===0)image="";
    else if(String(img).indexOf("drive:")===0||String(img).indexOf("http")===0)image=img;
    else{
      const id=extractDriveId(img);
      if(id)image="drive:"+id;
    }
    const tm=normTime(b.time);
    return{
      id:b.id,
      studentId:b.studentId,
      date:b.date,
      period:String(b.period==null?"":b.period),
      time:tm?tm.replace(":","h"):"",
      type:b.type||"",
      action:b.action||"",
      notes:b.notes||"",
      image
    };
  });
}
function pendingImageUploads(){
  const out=[];
  (db.behaviors||[]).forEach(b=>{
    if(!imgPending.has(b.id))return;
    if(isDataImg(imageStore[b.id]))out.push(b);
    else unmarkPending(b.id);
  });
  return out;
}
let uploadPromise=null;
function uploadPendingImages(){
  if(uploadPromise)return uploadPromise;
  uploadPromise=doUploadPendingImages().finally(()=>{uploadPromise=null});
  return uploadPromise;
}
async function doUploadPendingImages(){
  let ok=0;const failed=new Set();
  for(;;){
    const pending=pendingImageUploads().filter(b=>!failed.has(b.id));
    if(!pending.length)break;
    const b=pending[0];
    const sent=imageStore[b.id];
    try{
      const rec=db.behaviors.find(x=>x.id===b.id);
      const stu=db.students.find(s=>s.id===b.studentId);
      const r=await cloudPost("saveImage",{id:b.id,image:sent,oldDriveId:extractDriveId(rec&&rec.image),studentId:b.studentId||"",studentName:(stu&&stu.name)||""});
      const driveId=r.driveId||extractDriveId(r.url||r.image||"");
      const url=r.url||r.image||(driveId?("https://lh3.googleusercontent.com/d/"+driveId+"=w1200"):"");
      if(driveId||url){
        const ref=driveId?("drive:"+driveId):url;
        if(rec)rec.image=ref;
        if(imageStore[b.id]===sent){imageStore[b.id]=url||ref;unmarkPending(b.id)}
        ok++;
      }else failed.add(b.id);
    }catch(e){
      failed.add(b.id);
      const msg=String(e.message||e);
      if(/غير معروف|لم تصل/.test(msg)){
        setCloudStatus("الصورة محفوظة محليًا. لتظهر في الـ Sheet حدّث Code.gs ثم من Deploy اختر النشر الحالي → Edit → New version (نفس الرابط).","error");
      }else setCloudStatus("تعذر رفع صورة حالة: "+msg,"error");
    }
  }
  if(ok){
    saveImageStore();
    try{localStorage.setItem(KEY,JSON.stringify(db))}catch(e){}
  }
  return ok;
}
// لم يعد هناك تحميل جماعي للصور: تُجلب الصورة من Drive فقط عند تعذّر عرضها (imgFallback)
async function hydrateCloudImages(){renderBehavior()}
async function pullFromCloud(silent){
  if(!silent&&!confirm('سيتم استبدال البيانات المحلية بآخر نسخة في Google Sheets. يفضل أخذ نسخة احتياطية أولًا. متابعة؟'))return;
  try{
    setCloudStatus('جارٍ الاسترداد من Sheets...');
    const x=await cloudGet('getAll');
    if(!x.data)throw Error('لم تصل بيانات.');
    const oldTimes=new Map((db.behaviors||[]).map(b=>[b.id,b.time]));
    applyCloudData(x.data,oldTimes);
    renderAll();
    markCloudReady();
    setCloudStatus(silent?'تمت المزامنة التلقائية مع Google Sheets.':'تم استرداد البيانات من Google Sheets بنجاح.','ok');
    hydrateCloudImages().catch(()=>{});
  }catch(e){setCloudStatus((silent?'تعذر المزامنة التلقائية: ':'')+e.message,'error')}
}
async function pushToCloud(silent){
  try{
    if(!silent)setCloudStatus('جارٍ رفع البيانات إلى Sheets...');
    const n=await uploadPendingImages();
    const x=await cloudPost('saveAll',{data:{classes:db.classes,students:db.students,attendance:db.attendance,behaviors:behaviorsForCloud(),behaviorTypes:db.behaviorTypes,days:db.days}});
    markCloudReady();
    const extra=n?` تم حفظ ${n} صورة في Drive وإظهارها داخل عمود الصورة في الـ Sheet.`:"";
    setCloudStatus((x.message||'تم رفع البيانات إلى Sheets.')+extra,'ok');
  }catch(e){
    if(!silent)setCloudStatus(e.message,'error');
    else setCloudStatus('تعذر الرفع التلقائي: '+e.message,'error');
  }
}
function cloudReady(){return localStorage.getItem(CLOUD_READY_KEY)==="1"}
function markCloudReady(){try{localStorage.setItem(CLOUD_READY_KEY,"1")}catch(e){}}
function queueCloudSync(){
  if(!cloudUrl())return;
  clearTimeout(cloudTimer);
  cloudTimer=setTimeout(()=>{
    if(imgOps>0){queueCloudSync();return}
    pushToCloud(true).catch(()=>{});
  },1200);
}
function countRecords(d){
  return ((d&&d.attendance)||[]).length+((d&&d.behaviors)||[]).length+((d&&d.students)||[]).length;
}
function latestDateOf(d){
  let max="";
  ((d&&d.attendance)||[]).forEach(a=>{if(a&&a.date&&a.date>max)max=a.date});
  ((d&&d.behaviors)||[]).forEach(b=>{if(b&&b.date&&b.date>max)max=b.date});
  return max;
}
function mergeById(localArr, remoteArr, idKey){
  const map=new Map();
  (remoteArr||[]).forEach(x=>{if(x&&x[idKey])map.set(String(x[idKey]),x)});
  (localArr||[]).forEach(x=>{
    if(!x||!x[idKey])return;
    const id=String(x[idKey]);
    const r=map.get(id);
    if(!r){map.set(id,x);return}
    // احتفظ بالنسخة المحلية إن كانت أحدث تاريخًا أو لديها ملاحظات/صورة أوضح
    const ld=x.date||"";
    const rd=r.date||"";
    if(ld>rd)map.set(id,x);
    else if(ld===rd){
      const localRicher=(x.notes&&!r.notes)||(x.image&&!r.image)||(x.time&&!r.time);
      if(localRicher)map.set(id,{...r,...x});
      else map.set(id,{...x,...r});
    }
  });
  return Array.from(map.values());
}
function mergeCloudWithLocal(remote){
  const local={...db};
  const merged={
    classes: mergeById(local.classes, remote.classes, 'id'),
    students: mergeById(local.students, remote.students, 'id'),
    attendance: mergeById(local.attendance, remote.attendance, 'id'),
    behaviors: mergeById(local.behaviors, remote.behaviors, 'id'),
    behaviorTypes: (remote.behaviorTypes&&remote.behaviorTypes.length?remote.behaviorTypes:null)||(local.behaviorTypes&&local.behaviorTypes.length?local.behaviorTypes:DEFAULT_BEHAVIORS.slice()),
    settings: {...(local.settings||{}),...(remote.settings||{}),googleAppsScriptUrl:FIXED_CLOUD_URL}
  };
  const dayMap=new Map();
  (local.days||[]).forEach(d=>{if(d&&d.date)dayMap.set(d.date,d)});
  (remote.days||[]).forEach(d=>{if(d&&d.date)dayMap.set(d.date,{...(dayMap.get(d.date)||{}),...d})});
  merged.days=Array.from(dayMap.values());
  return merged;
}
async function autoSyncOnStart(){
  if(!cloudUrl())return;
  setCloudStatus('جارٍ المزامنة مع قاعدة البيانات...');
  try{
    const x=await cloudGet('getAll');
    if(!x.data)throw Error('لم تصل بيانات.');
    const hasLocal=db.classes.length||db.students.length||db.attendance.length||db.behaviors.length;
    const hasRemote=(x.data.classes||[]).length||(x.data.students||[]).length||(x.data.attendance||[]).length||(x.data.behaviors||[]).length;
    if(hasRemote && hasLocal){
      // دمج ذكي: لا تمسح السجلات المحلية الأحدث عند فتح الموقع
      const oldTimes=new Map((db.behaviors||[]).map(b=>[b.id,b.time]));
      const merged=mergeCloudWithLocal(x.data);
      const localCount=countRecords(db);
      const remoteCount=countRecords(x.data);
      const localLatest=latestDateOf(db);
      const remoteLatest=latestDateOf(x.data);
      applyCloudData(merged,oldTimes);
      renderAll();
      setReportDateDefaults();
      markCloudReady();
      let note='تمت المزامنة (دمج محلي + Sheets).';
      if(localCount>remoteCount||localLatest>remoteLatest){
        note+=' وُجدت سجلات محلية أحدث — سيتم رفعها تلقائيًا.';
        queueCloudSync();
      }
      setCloudStatus(note,'ok');
      hydrateCloudImages().catch(()=>{});
    }else if(hasRemote){
      const oldTimes=new Map((db.behaviors||[]).map(b=>[b.id,b.time]));
      applyCloudData(x.data,oldTimes);
      renderAll();
      setReportDateDefaults();
      markCloudReady();
      setCloudStatus('تمت المزامنة مع Google Sheets عند فتح الموقع.','ok');
      hydrateCloudImages().catch(()=>{});
    }else if(hasLocal){
      markCloudReady();
      await pushToCloud(true);
      setCloudStatus('تم رفع البيانات المحلية إلى Google Sheets.','ok');
    }else{
      markCloudReady();
      setCloudStatus('الاتصال بقاعدة البيانات جاهز.','ok');
    }
  }catch(e){
    setCloudStatus('تعذر المزامنة عند الفتح: '+e.message,'error');
  }
}

/* مزامنة بين التبويبات: عند تعديل في تبويب آخر تُحدَّث البيانات هنا */
window.addEventListener("storage",e=>{
  if(!e)return;
  if(e.key===KEY||e.key===IMG_KEY||e.key===PENDING_KEY){
    reloadDBFromStorage();
    // إن كنا على التقارير لا نعيد الرسم تلقائيًا للنتيجة — يُحدَّث عند «إنشاء التقرير»
    try{
      const onReports=!$("reports")?.classList.contains("hidden");
      if(!onReports)renderAll();
    }catch(err){}
  }
});
window.addEventListener("focus",()=>{
  // عند العودة لتبويب التقارير/التطبيق اقرأ أحدث نسخة
  reloadDBFromStorage();
});
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")reloadDBFromStorage();
});

legacyPendingMigration();
init();
// طبّق التعديل مبكرًا من البيانات المحلية (بدون انتظار المزامنة)
applyEditBehaviorFromUrl();
seedDatabaseFile().then(()=>autoSyncOnStart()).then(()=>{
  // إن فُتح التعديل قبل اكتمال السحابة وكانت البيانات ناقصة، أعد المحاولة بعد المزامنة
  if(editFromReport&&editingBehaviorId){
    const b=(db.behaviors||[]).find(x=>x.id===editingBehaviorId);
    if(b)startEditBehavior(editingBehaviorId);
  }
});
