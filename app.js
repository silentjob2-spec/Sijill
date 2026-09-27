const KEY="student_manager_v3";
let behaviorSelected=new Set();
let cloudTimer=null;
let editingBehaviorId=null;
let editingStudentId=null;
let editingClassId=null;
let pendingBehaviorImage=null;
let imageTouched=false;
let behTimeAutoUpdate=true;
const $=id=>document.getElementById(id);
const today=()=>new Date().toISOString().slice(0,10);
const DEFAULT_BEHAVIORS=["مشاغبة داخل الصف","تشويش وإزعاج","مخالفة التعليمات","متأخر","خرج من الصف"];
const ATT_STATUSES=["present","absent","excused"];
let db=loadDB();

function loadDB(){
  try{
    const x=JSON.parse(localStorage.getItem(KEY));
    if(x&&Array.isArray(x.classes)&&Array.isArray(x.students)&&Array.isArray(x.attendance)&&Array.isArray(x.behaviors)){
      return {...x,days:Array.isArray(x.days)?x.days:[],settings:{googleAppsScriptUrl:x.settings?.googleAppsScriptUrl||"",...(x.settings||{})},behaviorTypes:Array.isArray(x.behaviorTypes)&&x.behaviorTypes.length?x.behaviorTypes:DEFAULT_BEHAVIORS.slice()};
    }
  }catch(e){}
  return{classes:[],students:[],attendance:[],behaviors:[],behaviorTypes:DEFAULT_BEHAVIORS.slice(),days:[],settings:{googleAppsScriptUrl:""}};
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
  document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
  $(page).classList.remove("hidden");
  document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("active",n.dataset.page===page));
  const titles={home:"الرئيسية",classes:"الصفوف والشعب",students:"الطلاب",attendance:"الحضور والغياب",behavior:"السلوك والتأخير والخروج",reports:"التقارير",backup:"النسخ الاحتياطي والاسترداد",cloud:"Google Sheets"};
  $("pageTitle").textContent=titles[page]||"";
  if(page==="reports"){refreshAttendanceStudentSelect();refreshBehaviorPicker();clearReport("reportAttendance");clearReport("reportBehavior");switchReportTab("attendanceReportSection",document.querySelector(".report-tab"))}
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
function init(){
  const t=today();
  ["attDate","behDate","attFrom","attTo","behFrom","behTo"].forEach(id=>{if($(id))$(id).value=t});
  $("behPeriod").innerHTML=Array.from({length:7},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
  $("behTime").value=nowTime();
  fillClasses();
  refreshAttendanceStudentSelect();
  refreshBehaviorPicker();
  renderAll();
  tick();
  loadCloudSettings();
  if($("behTime"))$("behTime").addEventListener("input",()=>{behTimeAutoUpdate=false});
  setInterval(updateBehTimeLive,5000);
}
function updateBehTimeLive(){
  const el=$("behTime");
  if(!el||!behTimeAutoUpdate||editingBehaviorId)return;
  if(document.activeElement===el)return;
  if(($("behDate")?.value||today())!==today())return;
  el.value=nowTime();
}
function tick(){$("clock").textContent=new Date().toLocaleString("ar-JO",{weekday:"long",year:"numeric",month:"long",day:"numeric",hour:"2-digit",minute:"2-digit"});setTimeout(tick,30000)}
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
  db.students=db.students.filter(x=>x.id!==id);
  db.attendance=db.attendance.filter(a=>a.studentId!==id);
  db.behaviors=db.behaviors.filter(b=>b.studentId!==id);
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
function saveBehavior(){
  const sid=$("behStudent").value;
  if(!sid)return alert("اختر الطالب.");
  const typeVal=($("behType").value||"").trim();
  if(!typeVal)return alert("اختر أو ابحث عن السلوك.");
  if(!db.behaviorTypes.includes(typeVal)){
    if(!confirm(`"${typeVal}" غير موجود ضمن قائمة السلوكيات. هل تريد إضافته كسلوك جديد؟`))return;
    db.behaviorTypes.push(typeVal);
  }
  const data={studentId:sid,date:$("behDate").value||today(),period:String($("behPeriod").value),time:$("behTime").value,type:typeVal,action:$("behAction").value,notes:$("behNotes").value.trim()};
  if(editingBehaviorId){
    const idx=db.behaviors.findIndex(b=>b.id===editingBehaviorId);
    if(idx>-1){
      const existing=db.behaviors[idx];
      const image=imageTouched?pendingBehaviorImage:(existing.image||null);
      db.behaviors[idx]={...existing,...data,image};
    }
    editingBehaviorId=null;
  }else{
    db.behaviors.push({id:uid(),...data,image:pendingBehaviorImage||null});
  }
  $("behNotes").value="";
  $("behTime").value=nowTime();
  behTimeAutoUpdate=true;
  $("behAction").value="تنبيه";
  resetBehaviorImagePicker();
  setBehaviorFormMode(false);
  saveDB();renderAll();
}
function setBehaviorFormMode(editing){
  if($("behSaveBtn"))$("behSaveBtn").textContent=editing?"تحديث الحالة":"حفظ الحالة";
  if($("behCancelEditBtn"))$("behCancelEditBtn").classList.toggle("hidden",!editing);
}
function startEditBehavior(id){
  const b=db.behaviors.find(x=>x.id===id);
  if(!b)return;
  const s=db.students.find(x=>x.id===b.studentId);
  if(!s)return alert("تعذر العثور على الطالب المرتبط بهذه الحالة.");
  editingBehaviorId=id;
  $("behClass").value=s.classId;
  fillBehaviorStudents();
  $("behStudent").value=b.studentId;
  $("behDate").value=b.date;
  $("behPeriod").value=b.period;
  $("behTime").value=b.time;
  setBehTypeValue(b.type);
  $("behAction").value=b.action;
  $("behNotes").value=b.notes||"";
  pendingBehaviorImage=null;
  imageTouched=false;
  if($("behImageInput"))$("behImageInput").value="";
  showBehaviorImagePreview(b.image||null);
  if($("behImageFileName"))$("behImageFileName").textContent=b.image?"📎 يوجد مرفق محفوظ لهذه الحالة":"لم يتم اختيار صورة";
  setBehaviorFormMode(true);
  window.scrollTo({top:0,behavior:"smooth"});
}
function cancelEditBehavior(){
  editingBehaviorId=null;
  $("behNotes").value="";
  $("behTime").value=nowTime();
  behTimeAutoUpdate=true;
  $("behAction").value="تنبيه";
  resetBehaviorImagePicker();
  setBehaviorFormMode(false);
}
function deleteBehaviorRecord(id){
  if(!confirm("حذف هذه الحالة السلوكية؟"))return;
  db.behaviors=db.behaviors.filter(b=>b.id!==id);
  if(editingBehaviorId===id)cancelEditBehavior();
  saveDB();renderAll();
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
  if($("behReportType")&&$("behReportType").value&&!db.behaviorTypes.includes($("behReportType").value))setBehReportTypeValue("");
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
  const ropt=e.target.closest(".beh-report-type-option");
  if(ropt){setBehReportTypeValue(ropt.dataset.value);$("behReportTypeMenu")?.classList.add("hidden")}
});
function toggleBehReportTypeMenu(){
  const menu=$("behReportTypeMenu");
  if(!menu)return;
  const opening=menu.classList.contains("hidden");
  document.querySelectorAll(".dropdown-menu").forEach(m=>m.classList.add("hidden"));
  if(opening){
    menu.classList.remove("hidden");
    if($("behReportTypeSearchBox"))$("behReportTypeSearchBox").value="";
    renderBehReportTypeOptions();
    $("behReportTypeSearchBox")?.focus();
  }
}
function renderBehReportTypeOptions(){
  const q=($("behReportTypeSearchBox")?.value||"").trim().toLowerCase();
  const matches=db.behaviorTypes.filter(t=>t.toLowerCase().includes(q));
  let html=`<div class="pick-row beh-report-type-option" data-value="">كل السلوكيات</div>`;
  html+=matches.map(t=>`<div class="pick-row beh-report-type-option" data-value="${esc(t)}">${esc(t)}</div>`).join("");
  if(q&&!matches.length)html+=`<div class="empty">لا توجد نتائج مطابقة.</div>`;
  if($("behReportTypeOptions"))$("behReportTypeOptions").innerHTML=html;
}
function setBehReportTypeValue(v){
  if($("behReportType"))$("behReportType").value=v||"";
  if($("behReportTypeLabel"))$("behReportTypeLabel").textContent=v||"كل السلوكيات";
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

/* ---------- Behavior image attachment ---------- */
function handleBehaviorImageSelect(e){
  const file=e.target.files&&e.target.files[0];
  if(!file)return;
  if(!file.type.startsWith("image/")){alert("الرجاء اختيار ملف صورة.");e.target.value="";return}
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      const maxW=900;
      const scale=Math.min(1,maxW/img.width);
      const w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));
      const canvas=document.createElement("canvas");
      canvas.width=w;canvas.height=h;
      canvas.getContext("2d").drawImage(img,0,0,w,h);
      pendingBehaviorImage=canvas.toDataURL("image/jpeg",0.6);
      imageTouched=true;
      showBehaviorImagePreview(pendingBehaviorImage);
      if($("behImageFileName"))$("behImageFileName").textContent=`✅ ${file.name||"تم اختيار صورة"}`;
    };
    img.onerror=()=>alert("تعذر قراءة الصورة.");
    img.src=reader.result;
  };
  reader.onerror=()=>alert("تعذر قراءة الملف.");
  reader.readAsDataURL(file);
}
function showBehaviorImagePreview(dataUrl){
  const wrap=$("behImagePreviewWrap"),img=$("behImagePreview");
  if(!wrap||!img)return;
  if(!dataUrl){wrap.classList.add("hidden");img.src="";return}
  img.src=dataUrl;
  wrap.classList.remove("hidden");
}
function viewPendingBehaviorImage(){
  const src=$("behImagePreview")?.src;
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
  const b=db.behaviors.find(x=>x.id===id);
  if(!b||!b.image)return;
  $("imageViewerImg").src=b.image;
  $("imageViewerModal").classList.remove("hidden");
}
function closeImageViewer(){$("imageViewerModal").classList.add("hidden");$("imageViewerImg").src=""}

function renderBehavior(){
  const q=($("behaviorListSearch")?.value||"").trim().toLowerCase();
  const withRefs=db.behaviors.map(b=>{
    const s=db.students.find(x=>x.id===b.studentId);
    const c=s&&db.classes.find(x=>x.id===s.classId);
    return {b,s,c};
  }).filter(({b,s,c})=>{
    if(!q)return true;
    const hay=[s?.name,c?classText(c):"",b.type,b.action,b.notes].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }).sort((x,y)=>(y.b.date+y.b.time).localeCompare(x.b.date+x.b.time));
  const rows=withRefs.map(({b,s,c},i)=>`<tr><td>${i+1}</td><td>${s?esc(s.name):'-'}</td><td>${c?esc(classText(c)):'-'}</td><td>${b.date}</td><td>${b.period}</td><td>${b.time}</td><td>${esc(b.type)}</td><td>${esc(b.action)}</td><td>${esc(b.notes||'-')}</td><td>${b.image?`<button type="button" class="soft" onclick="viewBehaviorImage('${b.id}')">عرض الصورة</button>`:'-'}</td><td><div class="row-actions"><button class="soft" onclick="startEditBehavior('${b.id}')">تعديل</button><button class="soft danger-soft" onclick="deleteBehaviorRecord('${b.id}')">حذف</button></div></td></tr>`).join("");
  $("behaviorList").innerHTML=rows?`<div class="table-wrap"><table><tr><th>#</th><th>الطالب</th><th>الصف والشعبة</th><th>التاريخ</th><th>الحصة</th><th>الوقت</th><th>السلوك</th><th>الإجراء</th><th>الملاحظات</th><th>المرفق</th><th>إجراء</th></tr>${rows}</table></div>`:`<div class="empty">لا توجد حالات مسجلة${q?' مطابقة للبحث':''}.</div>`;
}

/* ---------- Reports ---------- */
function refreshAttendanceStudentSelect(){
  const c=$("attReportClass").value,students=c?getClassStudents(c):db.students,current=$("attReportStudent").value;
  $("attReportStudent").innerHTML='<option value="">جميع الطلاب</option>'+students.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join("");
  if(students.some(s=>s.id===current))$("attReportStudent").value=current;
}
function formatDateAR(d){if(!d)return '-';const [y,m,day]=d.split('-');return `${day}/${m}/${y}`}
function attendanceDetailsForStudent(studentId,from,to){
  const inRange=a=>a.studentId===studentId&&a.date>=from&&a.date<=to&&getDayStatus(a.date)==='school';
  const absent=db.attendance.filter(a=>inRange(a)&&a.status==='absent').sort((a,b)=>a.date.localeCompare(b.date));
  const excused=db.attendance.filter(a=>inRange(a)&&a.status==='excused').sort((a,b)=>a.date.localeCompare(b.date));
  return{absent,excused};
}
function makeAttendanceReport(){
  const from=$("attFrom").value,to=$("attTo").value,c=$("attReportClass").value,sid=$("attReportStudent").value;
  if(!from||!to||from>to)return alert("يرجى تحديد فترة صحيحة.");
  normalizeAttendance();
  const ss=sid?db.students.filter(s=>s.id===sid):(c?getClassStudents(c):db.students);
  if(!ss.length){$("reportAttendance").innerHTML='<div class="empty">لا يوجد طلاب ضمن الاختيار الحالي.</div>';markReport("reportAttendance");return}
  const details=ss.map((s,i)=>{const d=attendanceDetailsForStudent(s.id,from,to);return{s,i,absent:d.absent,excused:d.excused,absentDates:d.absent.map(x=>x.date),excusedDates:d.excused.map(x=>x.date)}});
  const withAbs=details.filter(x=>x.absent.length||x.excused.length);
  const totalA=withAbs.reduce((n,x)=>n+x.absent.length,0);
  const totalEx=withAbs.reduce((n,x)=>n+x.excused.length,0);
  const selection=sid?`الطالب: ${esc(ss[0].name)}`:(c?`الصف والشعبة: ${esc(classText(db.classes.find(x=>x.id===c)))}`:'جميع الطلاب');
  let html=`<div class="print-header"><h2>تقرير الغياب</h2><p><b>الفترة:</b> ${formatDateAR(from)} إلى ${formatDateAR(to)} &nbsp; | &nbsp; <b>${selection}</b></p></div>`+
    `<div class="summary"><div class="metric"><span>عدد الطلاب</span><b>${ss.length}</b></div><div class="metric"><span>طلاب لديهم غياب</span><b>${withAbs.length}</b></div><div class="metric"><span>إجمالي أيام الغياب</span><b>${totalA}</b></div><div class="metric"><span>إجمالي أيام الغياب بعذر</span><b>${totalEx}</b></div></div>`;
  html+=withAbs.map(x=>`<div class="student-report attendance-student-report"><div class="student-report-head"><div><h3>${esc(x.s.name)}</h3><p>${esc(classText(db.classes.find(c=>c.id===x.s.classId)))}</p></div><button class="soft no-print" onclick="printAttendanceStudent('${x.s.id}','${from}','${to}')">طباعة الطالب</button></div>`+
    (x.absentDates.length?`<div class="absence-box"><b>أيام الغياب:</b><ul>${x.absentDates.map(d=>`<li>${formatDateAR(d)}</li>`).join('')}</ul></div>`:'')+
    (x.excusedDates.length?`<div class="absence-box excused-box"><b>أيام الغياب بعذر:</b><ul>${x.excusedDates.map(d=>`<li>${formatDateAR(d)}</li>`).join('')}</ul></div>`:'')+
    `</div>`).join('');
  if(!withAbs.length)html+=`<div class="empty">لا توجد أيام غياب للطلاب المحددين خلال هذه الفترة.</div>`;
  $("reportAttendance").innerHTML=html;markReport("reportAttendance");
}
function printAttendanceStudent(studentId,from,to){
  const s=db.students.find(x=>x.id===studentId);
  if(!s)return;
  const d=attendanceDetailsForStudent(studentId,from,to),c=db.classes.find(x=>x.id===s.classId);
  const absDates=d.absent.length?d.absent.map(x=>`<li>${formatDateAR(x.date)}</li>`).join(''):'<li>لا يوجد غياب خلال الفترة.</li>';
  const exDates=d.excused.length?d.excused.map(x=>`<li>${formatDateAR(x.date)}</li>`).join(''):'<li>لا يوجد غياب بعذر خلال الفترة.</li>';
  openPrintWindow(`<div class="single-report"><div class="print-header"><h1>تقرير غياب الطالب</h1><p><b>الطالب:</b> ${esc(s.name)}</p><p><b>الصف والشعبة:</b> ${esc(c?classText(c):'-')}</p><p><b>الفترة:</b> ${formatDateAR(from)} إلى ${formatDateAR(to)}</p></div><div class="summary"><div class="metric"><span>عدد أيام الغياب</span><b>${d.absent.length}</b></div><div class="metric"><span>عدد أيام الغياب بعذر</span><b>${d.excused.length}</b></div></div><div class="student-detail"><h3>أيام الغياب</h3><ul>${absDates}</ul></div><div class="student-detail"><h3>أيام الغياب بعذر</h3><ul>${exDates}</ul></div></div>`,'تقرير غياب الطالب');
}
function makeBehaviorReport(){
  const from=$("behFrom").value,to=$("behTo").value,c=$("behReportClass").value;
  const typeFilter=($("behReportType")?.value||"").trim();
  if(!from||!to||from>to)return alert("يرجى تحديد فترة صحيحة.");
  const base=c?getClassStudents(c):db.students,ss=behaviorSelected.size?base.filter(s=>behaviorSelected.has(s.id)):base,
    data=db.behaviors.filter(b=>b.date>=from&&b.date<=to&&ss.some(s=>s.id===b.studentId)&&(!typeFilter||b.type===typeFilter)),
    grouped=ss.map(s=>({s,items:data.filter(b=>b.studentId===s.id)})).filter(x=>x.items.length),
    late=data.filter(b=>b.type==='متأخر').length,
    out=data.filter(b=>b.type==='خرج من الصف'||b.action==='إخراج من الصف').length,
    selection=(behaviorSelected.size?`تم اختيار ${ss.length} طالب`:(c?`الصف والشعبة: ${esc(classText(db.classes.find(x=>x.id===c)))}`:"جميع الطلاب"))+(typeFilter?` &nbsp;|&nbsp; نوع السلوك: "${esc(typeFilter)}"`:"");
  let html=`<div class="print-header"><h2>تقرير السلوك</h2><p><b>الفترة:</b> ${formatDateAR(from)} إلى ${formatDateAR(to)} &nbsp; | &nbsp; <b>${selection}</b></p></div><div class="summary"><div class="metric"><span>الطلاب</span><b>${ss.length}</b></div><div class="metric"><span>إجمالي الحالات</span><b>${data.length}</b></div><div class="metric"><span>تأخير</span><b>${late}</b></div><div class="metric"><span>خروج من الصف</span><b>${out}</b></div></div>`;
  if(!grouped.length)html+=`<div class="empty">لا توجد حالات سلوكية ضمن المدة المحددة${typeFilter?' لهذا السلوك':''}.</div>`;
  else html+=grouped.map(x=>`<div class="student-report behavior-student-report"><div class="student-report-head"><div><h3>${esc(x.s.name)}</h3><p>${esc(classText(db.classes.find(c=>c.id===x.s.classId)))}</p></div><button class="soft no-print" onclick="printBehaviorStudent('${x.s.id}','${from}','${to}')">طباعة سلوك الطالب</button></div><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الحصة</th><th>الوقت</th><th>السلوك</th><th>الإجراء</th><th>الملاحظات</th><th>المرفق</th></tr></thead><tbody>${x.items.map(b=>`<tr><td>${formatDateAR(b.date)}</td><td>${esc(b.period)}</td><td>${esc(b.time)}</td><td>${esc(b.type)}</td><td>${esc(b.action)}</td><td>${esc(b.notes||'-')}</td><td>${b.image?`<img class="report-thumb" src="${b.image}" alt="مرفق">`:'-'}</td></tr>`).join("")}</tbody></table></div></div>`).join("");
  $("reportBehavior").innerHTML=html;markReport("reportBehavior");
}
function printBehaviorStudent(studentId,from,to){
  const s=db.students.find(x=>x.id===studentId);
  if(!s)return;
  const c=db.classes.find(x=>x.id===s.classId),items=db.behaviors.filter(b=>b.studentId===studentId&&b.date>=from&&b.date<=to).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const rows=items.map(b=>`<tr><td>${formatDateAR(b.date)}</td><td>${esc(b.period)}</td><td>${esc(b.time)}</td><td>${esc(b.type)}</td><td>${esc(b.action)}</td><td>${esc(b.notes||'-')}</td><td>${b.image?`<img class="report-thumb" src="${b.image}" alt="مرفق">`:'-'}</td></tr>`).join('');
  openPrintWindow(`<div class="single-report"><div class="print-header"><h1>تقرير سلوك الطالب</h1><p><b>الطالب:</b> ${esc(s.name)}</p><p><b>الصف والشعبة:</b> ${esc(c?classText(c):'-')}</p><p><b>الفترة:</b> ${formatDateAR(from)} إلى ${formatDateAR(to)}</p></div><div class="summary"><div class="metric"><span>عدد الحالات</span><b>${items.length}</b></div></div><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>الحصة</th><th>الوقت</th><th>السلوك</th><th>الإجراء</th><th>الملاحظات</th><th>المرفق</th></tr></thead><tbody>${rows||'<tr><td colspan="7">لا توجد حالات.</td></tr>'}</tbody></table></div></div>`,'تقرير سلوك الطالب');
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
  const el=$(id);
  if(!el||!el.innerHTML.trim())return alert("أنشئ التقرير أولًا ثم اضغط طباعة التقرير.");
  const title=id==='reportAttendance'?'تقرير الغياب':'تقرير السلوك';
  openPrintWindow(`<div class="print-only-wrap">${el.innerHTML}</div>`,title);
}
function openPrintWindow(content,title){
  const win=window.open('', '_blank', 'width=1100,height=800');
  if(!win)return alert('يرجى السماح بالنوافذ المنبثقة حتى يمكن طباعة التقرير.');
  const styles=[...document.querySelectorAll('link[rel="stylesheet"],style')].map(x=>x.outerHTML).join('');
  win.document.open();
  win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>${styles}<style>body{background:#fff!important;padding:25px!important}.print-only-wrap{max-width:1100px;margin:auto}.no-print{display:none!important}.student-report{break-inside:avoid;page-break-inside:avoid}.single-report{max-width:900px;margin:auto}.report{display:block!important;border:0!important;box-shadow:none!important;min-height:0!important}</style></head><body><div class="print-only-wrap">${content}</div><script>window.onload=function(){setTimeout(function(){window.print();},250)}<\/script></body></html>`);
  win.document.close();
}
function toggleBehaviorPicker(){$("behaviorPicker").classList.toggle("hidden")}
document.addEventListener("click",e=>{
  if(!e.target.closest("#behaviorPickerWrap"))$("behaviorPicker")?.classList.add("hidden");
  if(!e.target.closest("#behTypeWrap"))$("behTypeMenu")?.classList.add("hidden");
  if(!e.target.closest("#behReportTypeWrap"))$("behReportTypeMenu")?.classList.add("hidden");
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
    ['الطلاب',db.students.length],
    ['حاضر اليوم',a.filter(x=>x.status==='present').length],
    ['غائب اليوم',a.filter(x=>x.status==='absent').length],
    ['غياب بعذر اليوم',a.filter(x=>x.status==='excused').length],
    ['حالات سلوكية',b.length],
    ['تأخير / خروج',b.filter(x=>x.type==='متأخر'||x.type==='خرج من الصف'||x.action==='إخراج من الصف').length]
  ].map(x=>`<div class="stat"><span>${x[0]}</span><b>${x[1]}</b></div>`).join('');
}
function renderAll(){
  normalizeAttendance();
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
  $("backupInfo").textContent=`آخر حفظ تلقائي: ${new Date().toLocaleTimeString('ar-JO')}`;
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
      if(!confirm('سيتم استبدال البيانات الحالية بالنسخة الاحتياطية. هل تريد المتابعة؟'))return;
      db={...x,days:Array.isArray(x.days)?x.days:[],settings:x.settings||{googleAppsScriptUrl:""},behaviorTypes:Array.isArray(x.behaviorTypes)&&x.behaviorTypes.length?x.behaviorTypes:DEFAULT_BEHAVIORS.slice()};
      editingBehaviorId=null;editingStudentId=null;editingClassId=null;
      normalizeAttendance();saveDB();renderAll();
      alert('تم استرداد النسخة بنجاح.');
    }catch(err){alert('ملف النسخة غير صالح.')}
  };
  r.readAsText(f);
}
function clearAttendanceData(){
  if(!db.attendance.length&&!db.days.length)return alert('لا توجد بيانات حضور وغياب لحذفها.');
  if(!confirm('سيتم حذف جميع سجلات الحضور والغياب وحالات الأيام. هل تريد المتابعة؟'))return;
  db.attendance=[];db.days=[];
  saveDB();renderAll();
  alert('تم تصفير الحضور والغياب.');
}
function clearBehaviorData(){
  if(!db.behaviors.length)return alert('لا توجد بيانات سلوك لحذفها.');
  if(!confirm('سيتم حذف جميع سجلات السلوك والتأخير والخروج فقط. هل تريد المتابعة؟'))return;
  db.behaviors=[];
  editingBehaviorId=null;
  saveDB();renderAll();
  alert('تم تصفير بيانات السلوك.');
}
function resetAllData(){
  if(!confirm('تحذير: سيتم حذف الصفوف والطلاب والحضور والسلوك وجميع البيانات نهائيًا من هذا المتصفح. هل تريد المتابعة؟'))return;
  if(!confirm('تأكيد أخير: لا يمكن التراجع عن هذه العملية إلا باسترداد نسخة احتياطية. هل تريد تصفير النظام بالكامل؟'))return;
  db={classes:[],students:[],attendance:[],behaviors:[],behaviorTypes:DEFAULT_BEHAVIORS.slice(),days:[],settings:{googleAppsScriptUrl:""}};
  behaviorSelected.clear();
  editingBehaviorId=null;editingStudentId=null;editingClassId=null;
  saveDB();renderAll();
  alert('تم تصفير النظام بالكامل.');
}

/* ---------- Google Sheets integration ---------- */
function loadCloudSettings(){if($("cloudUrl"))$("cloudUrl").value=db.settings?.googleAppsScriptUrl||""}
function saveCloudUrl(){const u=$("cloudUrl").value.trim();db.settings={...(db.settings||{}),googleAppsScriptUrl:u};localStorage.setItem(KEY,JSON.stringify(db));setCloudStatus(u?'تم حفظ رابط Google Apps Script.':'تم مسح رابط الربط.','ok')}
function cloudUrl(){return (db.settings?.googleAppsScriptUrl||"").trim()}
function setCloudStatus(msg,type=''){$("cloudStatus")&&($("cloudStatus").className='cloud-status '+type,$("cloudStatus").textContent=msg)}
async function cloudGet(action){
  const u=cloudUrl();
  if(!u)throw Error('لم يتم إدخال رابط Google Apps Script.');
  const r=await fetch(u+`?action=${encodeURIComponent(action)}&t=${Date.now()}`,{cache:'no-store'});
  const text=await r.text();
  let data;
  try{data=JSON.parse(text)}catch(e){throw Error('الاستجابة من Google Apps Script ليست JSON.')}
  if(!data.ok)throw Error(data.error||'فشل الطلب.');
  return data;
}
async function cloudPost(action,payload){
  const u=cloudUrl();
  if(!u)throw Error('لم يتم إدخال رابط Google Apps Script.');
  const body=new URLSearchParams();
  body.set('payload',JSON.stringify({action,...payload}));
  const r=await fetch(u,{method:'POST',body});
  const text=await r.text();
  let data;
  try{data=JSON.parse(text)}catch(e){throw Error('الاستجابة من Google Apps Script ليست JSON.')}
  if(!data.ok)throw Error(data.error||'فشل الطلب.');
  return data;
}
async function testCloud(){try{setCloudStatus('جارٍ اختبار الاتصال...');const x=await cloudGet('ping');setCloudStatus(x.message||'الاتصال ناجح.','ok')}catch(e){setCloudStatus(e.message,'error')}}
async function pullFromCloud(){
  if(!confirm('سيتم استبدال البيانات المحلية بآخر نسخة في Google Sheets. يفضل أخذ نسخة احتياطية أولًا. متابعة؟'))return;
  try{
    setCloudStatus('جارٍ الاسترداد من Sheets...');
    const x=await cloudGet('getAll');
    if(!x.data)throw Error('لم تصل بيانات.');
    db={...x.data,days:Array.isArray(x.data.days)?x.data.days:[],settings:{...(db.settings||{}),...(x.data.settings||{})},behaviorTypes:Array.isArray(x.data.behaviorTypes)&&x.data.behaviorTypes.length?x.data.behaviorTypes:DEFAULT_BEHAVIORS.slice()};
    normalizeAttendance();localStorage.setItem(KEY,JSON.stringify(db));renderAll();
    setCloudStatus('تم استرداد البيانات من Google Sheets بنجاح.','ok');
  }catch(e){setCloudStatus(e.message,'error')}
}
async function pushToCloud(){
  try{
    setCloudStatus('جارٍ رفع البيانات إلى Sheets...');
    const x=await cloudPost('saveAll',{data:{classes:db.classes,students:db.students,attendance:db.attendance,behaviors:db.behaviors,behaviorTypes:db.behaviorTypes,days:db.days}});
    setCloudStatus(x.message||'تم رفع البيانات إلى Sheets.','ok');
  }catch(e){setCloudStatus(e.message,'error')}
}
function queueCloudSync(){if(!cloudUrl())return;clearTimeout(cloudTimer);cloudTimer=setTimeout(()=>pushToCloud().catch(()=>{}),1200)}

init();seedDatabaseFile();
