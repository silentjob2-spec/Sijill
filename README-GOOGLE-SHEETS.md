# ربط نظام إدارة الطلاب مع Google Sheets

## ما الذي تم تجهيزه؟
- الموقع يعمل محليًا عبر `localStorage` كنسخة احتياطية فورية.
- ملف `Code.gs` ينشئ Google Sheet تلقائيًا عند تشغيل `createDatabaseSpreadsheet()` لأول مرة.
- الموقع يحتوي على صفحة **Google Sheets** لوضع رابط Web App واختبار الاتصال والمزامنة.
- قاعدة البيانات في Sheets مقسمة إلى: `Classes`, `Students`, `Attendance`, `Behavior`, `BehaviorTypes`, `Days`, `Meta`.
- قاعدة الحضور تفرض منطقيًا: طالب واحد + تاريخ واحد = حالة واحدة.
- العطلة والإجازة تحفظان في ورقة `Days` ولا يُسجل لهما حضور أو غياب.

## إنشاء قاعدة Google Sheets
1. افتح `https://script.google.com/`.
2. أنشئ مشروع Apps Script جديد.
3. افتح `Code.gs` وانسخ محتوى الملف الموجود هنا بالكامل.
4. شغّل الدالة `createDatabaseSpreadsheet` مرة واحدة.
5. وافق على الصلاحيات.
6. افتح **سجل التنفيذ / Execution log** وانسخ رابط Google Sheet الذي أنشأه السكربت.

## نشر API للموقع
1. من Apps Script اختر **Deploy > New deployment**.
2. اختر **Web app**.
3. Execute as: **Me**.
4. حدّد صلاحية الوصول المناسبة لحسابك؛ للاستخدام الشخصي يمكن استخدام **Anyone with the link** إذا كانت متاحة.
5. انسخ رابط `/exec`.
6. افتح الموقع > **Google Sheets**.
7. الصق الرابط واضغط **حفظ الرابط** ثم **اختبار الاتصال**.
8. اضغط **استرداد من Sheets** إذا كانت Sheets تحتوي بيانات تريد تحميلها للموقع، أو **رفع البيانات إلى Sheets** لأول مزامنة.

## رفع الموقع على GitHub Pages
يمكن رفع ملفات الموقع الثابتة إلى GitHub Pages. لا ترفع بيانات الطلاب الحقيقية داخل `database.json` أو المستودع العام؛ استخدم Google Sheets كمخزن البيانات.

الملفات الأساسية للموقع:
- `index.html`
- `style.css`
- `app.js`
- `database.json`

ويمكن حذف `database.json` بعد أول إعداد إذا أردت بدء الموقع فارغًا.

## مهم
GitHub Pages يستضيف HTML/CSS/JavaScript، لكنه ليس قاعدة بيانات ولا يستطيع JavaScript الموجود في الصفحة تعديل ملف JSON داخل المستودع مباشرة. لذلك تكون البنية الصحيحة:

`GitHub Pages -> Google Apps Script -> Google Sheets`

احتفظ أيضًا بنسخة JSON من صفحة **النسخ الاحتياطي** بشكل دوري.
