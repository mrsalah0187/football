# METALS FOOTBALL CHAMPIONSHIP — دوري الفلزات

لعبة كرة قدم جماعية لمراجعة درس الفلزات. المعلم هو الـ HOST، والطلاب يدخلون من أجهزتهم برمز PIN، والجميع يشاهد نفس المباراة (المحاكاة تعمل على الخادم فقط).

## التشغيل
    npm install      # يثبّت ws فقط (مرفقة أيضًا داخل node_modules)
    npm start        # المنفذ 3000 (أو PORT=...)
- المعلم:  `http://HOST:PORT/host`
- الطلاب:  `http://HOST:PORT/`  (أو الرابط الذي تنسخه من لوحة المعلم، يتضمن الـ PIN)
- اختياري: `HOST_PASSWORD=كلمة_سر` لمنع الطلاب من إنشاء مباريات.
- يتطلب Node 22.5+ (قاعدة SQLite مدمجة: `data/metals.db`؛ وإلا يُحفظ `data/results.jsonl`).

## الاستضافة
أي استضافة Node تدعم WebSocket (Render، Railway، Fly.io، VPS). أمر التشغيل `npm start`، والمنفذ من متغير `PORT`. استخدم HTTPS (يتحول الاتصال تلقائيًا إلى wss).
خادم واحد يكفي لعشرات الطلاب. لا تشغّل أكثر من نسخة واحدة (حالة المباريات في الذاكرة).
على استضافة مجانية بقرص مؤقت، تُفقد `data/` عند إعادة التشغيل.

## الاختبار
    PORT=3111 node server.js &
    PORT=3111 node test/bots.js      # معلم + 6 طلاب عبر WebSocket
    node test/e2e.js http://localhost:3111   # متصفح حقيقي + لقطات في test/shots
