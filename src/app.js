// src/app.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs'); // (حاليًا غير مستخدم عندك، سايبه لتطوير لاحق)
const crypto = require('crypto');
const { supabase } = require('./supabaseClient');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 168);
const CV_BUCKET = process.env.SUPABASE_CV_BUCKET || 'cvs';

// إعداد رفع الملفات في الذاكرة (علشان نرفعها لـ Supabase Storage)
const upload = multer({ storage: multer.memoryStorage() });

// إعداد الـ View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// =======================
// Static Files (IMPORTANT)
// =======================
// public/ يجب أن يكون متاح مباشرة بدون /public prefix
// علشان يشتغل: /css/styles.css , /js/home.js , /images/logo.png
const publicDir = path.join(__dirname, '..', 'public');

// Primary static (recommended)
app.use(express.static(publicDir));

// Backward compatibility: لو عندك صفحات قديمة بتستخدم /public/...
app.use('/public', express.static(publicDir));

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // مفيد لو هتجرب endpoints بـ curl/json
app.use(cookieParser());

// Middleware: جلب المستخدم من الـ session_token (لو موجود)
app.use(async (req, res, next) => {
  const token = req.cookies.session_token;
  req.user = null;
  req.sessionRecord = null;

  if (!token) {
    res.locals.currentUser = null;
    return next();
  }

  try {
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('sessions')
      .select('*, users(*)')
      .eq('session_token', token)
      .gt('expires_at', nowIso)
      .maybeSingle();

    if (!error && data && data.users) {
      req.user = data.users;
      req.sessionRecord = data;
    }
  } catch (e) {
    console.error('Session middleware error:', e);
  }

  // عشان نستخدمه جوه الـ Views
  res.locals.currentUser = req.user;
  next();
});

// Middleware بسيط للتأكد إن الشخص عامل Login
function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

// ------------------- ROUTES ----------------------

// Home Page
app.get('/', (req, res) => {
  res.render('home');
});

// Signup GET
app.get('/signup', (req, res) => {
  res.render('signup', { error: null, formData: {} });
});

// Signup POST
app.post('/signup', async (req, res) => {
  const {
    first_name,
    last_name,
    date_of_birth,
    gender,
    phone_number,
    email,
    password,
  } = req.body;

  const formData = {
    first_name,
    last_name,
    date_of_birth,
    gender,
    phone_number,
    email,
  };

  if (!first_name || !last_name || !email || !password) {
    return res.render('signup', {
      error: 'من فضلك املأ جميع الحقول المطلوبة (الاسم الاول، اسم العائلة، البريد، كلمة السر).',
      formData,
    });
  }

  // التأكد إن الإيميل مش مكرر
  const { data: existingUser, error: findError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (findError) {
    console.error(findError);
    return res.render('signup', {
      error: 'حدث خطأ في النظام. حاول مرة أخرى.',
      formData,
    });
  }

  if (existingUser) {
    return res.render('signup', {
      error: 'هذا البريد الإلكتروني مسجل بالفعل.',
      formData,
    });
  }

  const nowIso = new Date().toISOString();

  // تخزين كلمة المرور كما هي (حسب طلبك الحالي)
  const { error: insertError } = await supabase.from('users').insert([
    {
      first_name,
      last_name,
      date_of_birth,
      gender,
      phone_number,
      email,
      password: password, // Plaintext (غير مُوصى به أمنياً)
      created_at: nowIso,
      updated_at: nowIso,
    },
  ]);

  if (insertError) {
    console.error(insertError);
    return res.render('signup', {
      error: 'حدث خطأ أثناء إنشاء الحساب. حاول مرة أخرى.',
      formData,
    });
  }

  res.redirect('/signup/confirmation');
});

// صفحة Confirmation بعد الـ Signup
app.get('/signup/confirmation', (req, res) => {
  res.render('signup_confirmation');
});

// Login GET
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

// Login POST
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'من فضلك أدخل البريد الإلكتروني وكلمة المرور.' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    console.error(error);
    return res.render('login', { error: 'حدث خطأ في النظام. حاول مرة أخرى.' });
  }

  if (!user) {
    return res.render('login', { error: 'بيانات الدخول غير صحيحة.' });
  }

  // مقارنة كلمة المرور النصية المدخلة مع كلمة المرور المخزنة كما هي
  if (user.password !== password) {
    return res.render('login', { error: 'بيانات الدخول غير صحيحة.' });
  }

  // إنشاء Session
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  const { error: sessionError } = await supabase.from('sessions').insert([{
    user_id: user.id,
    session_token: sessionToken,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  }]);

  if (sessionError) {
    console.error(sessionError);
    return res.render('login', { error: 'تعذر إنشاء جلسة الدخول. حاول مرة أخرى.' });
  }

  // حفظ التوكن في Cookie
  res.cookie('session_token', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // على Vercel/Production لازم HTTPS
    maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
  });

  // هل المستخدم ملأ HR Form من قبل؟
  const { data: existingHrForm, error: hrError } = await supabase
    .from('hr_forms')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (hrError) {
    console.error(hrError);
    return res.render('login', { error: 'خطأ أثناء التحقق من حالة طلبك.' });
  }

  if (existingHrForm) {
    return res.redirect('/hr/confirmation');
  } else {
    return res.redirect('/hr/form');
  }
});

// Logout
app.get('/logout', async (req, res) => {
  const token = req.cookies.session_token;

  if (token) {
    await supabase.from('sessions').delete().eq('session_token', token);
    res.clearCookie('session_token');
  }

  res.redirect('/');
});

// HR Form GET
app.get('/hr/form', requireAuth, async (req, res) => {
  const { data: existingHrForm } = await supabase
    .from('hr_forms')
    .select('id')
    .eq('user_id', req.user.id)
    .maybeSingle();

  if (existingHrForm) {
    return res.redirect('/hr/confirmation');
  }

  res.render('hr_form', { error: null });
});

app.post('/hr/form', requireAuth, upload.single('cv_file'), async (req, res) => {
  const {
    question_1,
    question_2,
    question_3,
    question_4,
    question_5,
    question_6,
    question_7,
    question_8,
    question_9,
    question_10,
  } = req.body;

  let cvUrl = null;

  // التأكد من أن جميع الأسئلة تم الإجابة عليها
  if (!question_1 || !question_2 || !question_3 || !question_4 || !question_5 || !question_6 || !question_7 || !question_8 || !question_9 || !question_10) {
    return res.render('hr_form', { error: 'من فضلك املأ جميع الأسئلة.' });
  }

  // رفع CV لو موجود
  if (req.file) {
    const fileExt = path.extname(req.file.originalname) || '.pdf';
    const fileName = `user-${req.user.id}-${Date.now()}${fileExt}`;
    const filePath = `${req.user.id}/${fileName}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from(CV_BUCKET)
        .upload(filePath, req.file.buffer, {
          contentType: req.file.mimetype || 'application/pdf',
          upsert: true,
        });

      if (uploadError) {
        console.error(uploadError);
        return res.render('hr_form', { error: 'حدث خطأ أثناء رفع ملف السيرة الذاتية.' });
      }

      const { data: publicUrlData } = supabase.storage
        .from(CV_BUCKET)
        .getPublicUrl(filePath);

      cvUrl = publicUrlData.publicUrl;
    } catch (uploadErr) {
      console.error("Error uploading CV:", uploadErr);
      return res.render('hr_form', { error: 'حدث خطأ أثناء رفع ملف السيرة الذاتية.' });
    }
  }

  const nowIso = new Date().toISOString();

  // إدخال البيانات في جدول HR Forms
  try {
    const { error: insertError } = await supabase.from('hr_forms').insert([{
      user_id: req.user.id,
      question_1,
      question_2,
      question_3,
      question_4,
      question_5,
      question_6,
      question_7,
      question_8,
      question_9,
      question_10,
      cv_url: cvUrl,
      submitted_at: nowIso,
    }]);

    if (insertError) {
      console.error(insertError);
      return res.render('hr_form', { error: 'حدث خطأ أثناء إرسال النموذج. حاول مرة أخرى.' });
    }

    res.redirect('/hr/welcome');
  } catch (err) {
    console.error("Error inserting data into Supabase:", err);
    return res.render('hr_form', { error: 'حدث خطأ أثناء إرسال النموذج. حاول مرة أخرى.' });
  }
});

// Welcome After HR Form
app.get('/hr/welcome', requireAuth, (req, res) => {
  res.render('welcome_after_hr', { user: req.user });
});

// Confirmation After HR Form (للي ملّوا الفورم سابقاً)
app.get('/hr/confirmation', requireAuth, (req, res) => {
  res.render('confirmation_after_hr', { user: req.user });
});

// 404 بسيط
app.use((req, res) => {
  res.status(404).send('الصفحة غير موجودة');
});

// تشغيل السيرفر
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
