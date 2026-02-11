// src/app.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { supabase } = require('./supabaseClient');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 168);
const CV_BUCKET = process.env.SUPABASE_CV_BUCKET || 'cvs';

const upload = multer({ storage: multer.memoryStorage() });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const publicDir = path.join(__dirname, '..', 'public');

app.use(express.static(publicDir));
app.use('/public', express.static(publicDir));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

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

  res.locals.currentUser = req.user;
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}

// ------------------- ROUTES ----------------------

app.get('/', (req, res) => {
  res.render('home');
});

// Signup GET
app.get('/signup', (req, res) => {
  const type = req.query.type || 'influencer';

  res.render('signup', {
    error: null,
    formData: {},
    type
  });
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
    userType
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
      error: 'من فضلك املأ جميع الحقول المطلوبة.',
      formData,
      type: userType
    });
  }

  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existingUser) {
    return res.render('signup', {
      error: 'هذا البريد الإلكتروني مسجل بالفعل.',
      formData,
      type: userType
    });
  }

  const nowIso = new Date().toISOString();

  await supabase.from('users').insert([{
    first_name,
    last_name,
    date_of_birth,
    gender,
    phone_number,
    email,
    password,
    created_at: nowIso,
    updated_at: nowIso,
  }]);

  if (userType === 'entrepreneur') {
    return res.redirect('/signup_confirmation_entrepreneur');
  } else {
    return res.redirect('/signup_confirmation_influencer');
  }
});

// ---------------- Login ----------------

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (!user || user.password !== password) {
    return res.render('login', { error: 'بيانات الدخول غير صحيحة.' });
  }

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  await supabase.from('sessions').insert([{
    user_id: user.id,
    session_token: sessionToken,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  }]);

  res.cookie('session_token', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
  });

  return res.redirect('/hr/form');
});

app.get('/logout', async (req, res) => {
  const token = req.cookies.session_token;
  if (token) {
    await supabase.from('sessions').delete().eq('session_token', token);
    res.clearCookie('session_token');
  }
  res.redirect('/');
});

// ---------------- HR FORM ----------------

app.get('/hr/form', requireAuth, (req, res) => {
  res.render('hr_form', { error: null });
});

app.post('/hr/form', requireAuth, async (req, res) => {

  const {
    full_name,
    age,
    field,
    platform_links,
    followers_count,
    unique_value,
    tv_pitch,
    whatsapp_number
  } = req.body;

  if (!full_name || !age || !field || !unique_value || !tv_pitch || !whatsapp_number) {
    return res.render('hr_form', { error: 'من فضلك املأ جميع الحقول المطلوبة.' });
  }

  const nowIso = new Date().toISOString();

  await supabase.from('hr_forms').insert([{
    user_id: req.user.id,
    full_name,
    age,
    field,
    platform_links,
    followers_count,
    unique_value,
    tv_pitch,
    whatsapp_number,
    submitted_at: nowIso
  }]);

  return res.redirect('/hr/confirmation');
});

app.get('/hr/confirmation', requireAuth, (req, res) => {
  res.render('confirmation_after_hr', { user: req.user });
});

app.get('/signup_confirmation_entrepreneur', (req, res) => {
  res.render('signup_confirmation_entrepreneur');
});

app.get('/signup_confirmation_influencer', (req, res) => {
  res.render('signup_confirmation_influencer');
});

app.use((req, res) => {
  res.status(404).send('الصفحة غير موجودة');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
