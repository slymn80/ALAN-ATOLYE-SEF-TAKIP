'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const PDFDocument = require('pdfkit');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'takip.db');
const SCHOOL_YEAR = {
  label: '2026-2027',
  start: '2026-09-14',
  end: '2027-06-25'
};
const DAY_PERIOD_LIMITS = { 1: 11, 2: 10, 3: 9, 4: 11, 5: 10 };
const PERIOD_TIMES = [
  { period: 1, start: '08:20', end: '09:00' },
  { period: 2, start: '09:10', end: '09:50' },
  { period: 3, start: '10:00', end: '10:40' },
  { period: 4, start: '10:50', end: '11:30' },
  { period: 5, start: '11:40', end: '12:20' },
  { period: 6, start: '13:10', end: '13:50' },
  { period: 7, start: '14:00', end: '14:40' },
  { period: 8, start: '14:50', end: '15:30' },
  { period: 9, start: '15:40', end: '16:20' },
  { period: 10, start: '16:30', end: '17:10' },
  { period: 11, start: '17:20', end: '18:00' }
];
const SESSION_MAX_AGE = 60 * 60 * 12;
let generatedAdminPassword = null;
let generatedChiefPassword = null;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    department TEXT NOT NULL,
    position TEXT NOT NULL CHECK(position IN ('admin', 'Alan Şefi', 'Atölye Şefi')),
    workshop TEXT NOT NULL DEFAULT '',
    username TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'chief' CHECK(role IN ('admin', 'chief')),
    active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_date TEXT NOT NULL,
    attended INTEGER NOT NULL DEFAULT 0 CHECK(attended IN (0, 1)),
    start_time TEXT,
    end_time TEXT,
    note TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, attendance_date)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chief_schedule (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 5),
    period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 11),
    PRIMARY KEY(user_id, weekday, period)
  );

  CREATE TABLE IF NOT EXISTS attendance_periods (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attendance_date TEXT NOT NULL,
    period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 11),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id, attendance_date, period)
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_attendance_periods_date ON attendance_periods(attendance_date);
`);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expectedHex] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function seedDatabase() {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) {
    const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    if (!process.env.ADMIN_PASSWORD) generatedAdminPassword = adminPassword;
    db.prepare(`INSERT INTO users
      (full_name, department, position, username, password_hash, role, must_change_password)
      VALUES (?, ?, 'admin', ?, ?, 'admin', 1)`)
      .run('Sistem Yöneticisi', 'Yönetim', adminUsername, hashPassword(adminPassword));
  }

  const chiefs = [
    ['Suat ÇELİKER', 'Bilişim Teknolojileri', 'Alan Şefi', 'Yazılım Geliştirme Atölyesi', 'suat.celiker'],
    ['Hüseyin Özgür GÜLER', 'Bilişim Teknolojileri', 'Atölye Şefi', '1. Atölye', 'huseyin.ozgur.guler'],
    ['Osman KALDAN', 'Bilişim Teknolojileri', 'Atölye Şefi', '2. Atölye', 'osman.kaldan'],
    ['Ayşe Evrensel BÜZRÜÇ', 'Çocuk Gelişimi ve Eğitimi', 'Alan Şefi', '', 'ayse.evrensel.buzruc'],
    ['Burcu COŞKUN', 'Çocuk Gelişimi ve Eğitimi', 'Atölye Şefi', '1. Atölye', 'burcu.coskun'],
    ['Handan KOCAACAR', 'Çocuk Gelişimi ve Eğitimi', 'Atölye Şefi', '2. Atölye', 'handan.kocaacar'],
    ['Zeliha ÇETİN', 'Çocuk Gelişimi ve Eğitimi', 'Atölye Şefi', 'Ana Sınıfı', 'zeliha.cetin'],
    ['Melis AĞAR', 'Grafik ve Fotoğraf', 'Alan Şefi', '', 'melis.agar'],
    ['Güner Kaya BOZKURT', 'Grafik ve Fotoğraf', 'Atölye Şefi', 'Bilgisayarlı Grafik Atölyesi', 'guner.kaya.bozkurt'],
    ['Dilek DIRAMAN CEVİZ', 'Grafik ve Fotoğraf', 'Atölye Şefi', 'Desen Atölyesi', 'dilek.diraman.ceviz'],
    ['Ezgi İFTAR KAZAR', 'Güzellik ve Saç Bakım Hizmetleri', 'Alan Şefi', 'Cilt Bakım Atölyesi', 'ezgi.iftar.kazar'],
    ['Zehra ÇETİN', 'Güzellik ve Saç Bakım Hizmetleri', 'Atölye Şefi', 'Kuaförlük Atölyesi', 'zehra.cetin'],
    ['Sevda ÇETİNALP', 'Yiyecek İçecek Hizmetleri', 'Alan Şefi', '', 'sevda.cetinalp'],
    ['Fatma SÖZEN', 'Yiyecek İçecek Hizmetleri', 'Atölye Şefi', '1. Atölye', 'fatma.sozen'],
    ['Serkan BEKTAŞ', 'Yiyecek İçecek Hizmetleri', 'Atölye Şefi', '2. Atölye', 'serkan.bektas'],
    ['Seray ABAOĞLU', 'Yiyecek İçecek Hizmetleri', 'Atölye Şefi', '3. Atölye', 'seray.abaoglu'],
    ['Sevil EYİLETEN', 'Yiyecek İçecek Hizmetleri', 'Atölye Şefi', 'Servis Atölyesi', 'sevil.eyileten']
  ];
  const exists = db.prepare('SELECT id, password_hash FROM users WHERE full_name = ? AND department = ? LIMIT 1');
  const insert = db.prepare(`INSERT INTO users
    (full_name, department, position, workshop, username, password_hash, role, active, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, 'chief', 1, 1)`);
  const setFixedUsername = db.prepare('UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const createMissingCredentials = db.prepare(`UPDATE users SET username = ?, password_hash = ?, must_change_password = 1,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
  const automaticAccountsApplied = Boolean(db.prepare("SELECT 1 FROM app_settings WHERE setting_key = 'automatic_chief_accounts_v1'").get());
  const configuredChiefPassword = process.env.CHIEF_DEFAULT_PASSWORD;
  if (configuredChiefPassword && (configuredChiefPassword.length < 8 || configuredChiefPassword.length > 128)) {
    throw new Error('CHIEF_DEFAULT_PASSWORD en az 8 karakter olmalıdır.');
  }
  const chiefDefaultPassword = configuredChiefPassword || crypto.randomBytes(12).toString('base64url');
  let chiefDefaultPasswordUsed = false;
  db.exec('BEGIN');
  try {
    for (const chief of chiefs) {
      const current = exists.get(chief[0], chief[1]);
      if (!current) {
        insert.run(...chief, hashPassword(chiefDefaultPassword));
        chiefDefaultPasswordUsed = true;
      } else if (!automaticAccountsApplied || !current.password_hash) {
        createMissingCredentials.run(chief[4], hashPassword(chiefDefaultPassword), current.id);
        chiefDefaultPasswordUsed = true;
      }
      else setFixedUsername.run(chief[4], current.id);
    }
    if (!automaticAccountsApplied) {
      db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'chief')").run();
      db.prepare("INSERT INTO app_settings (setting_key, setting_value) VALUES ('automatic_chief_accounts_v1', CURRENT_TIMESTAMP)").run();
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  if (chiefDefaultPasswordUsed && !configuredChiefPassword) generatedChiefPassword = chiefDefaultPassword;

  // şeflik saatleri.xlsx dosyasındaki haftalık çizelge (gün: [ders saatleri])
  const schedules = {
    'Suat ÇELİKER': { 1: [6,7,8,9,10], 2: [10], 3: [1,2,5], 4: [9] },
    'Hüseyin Özgür GÜLER': { 1: [10], 2: [6,10], 3: [1,8,9] },
    'Osman KALDAN': { 1: [9,10,11], 2: [10], 3: [8,9] },
    'Ayşe Evrensel BÜZRÜÇ': { 1: [1,2,3], 2: [7,8,9], 3: [7,8,9], 4: [9] },
    'Burcu COŞKUN': { 1: [10,11], 5: [7,8,9,10] },
    'Handan KOCAACAR': { 3: [7,8,9], 4: [8,9,10] },
    'Zeliha ÇETİN': { 1: [2,3], 3: [6], 5: [7,8,9] },
    'Melis AĞAR': { 1: [5,6,7,8,9,10], 4: [10,11], 5: [8,9] },
    'Güner Kaya BOZKURT': { 1: [5], 4: [6,7,8], 5: [8,9] },
    'Dilek DIRAMAN CEVİZ': { 2: [9], 3: [4,5,9], 5: [7,8] },
    'Ezgi İFTAR KAZAR': { 2: [5,6,7], 4: [1,2,3,4,5,6,7] },
    'Zehra ÇETİN': { 2: [4,5], 3: [9], 5: [1,2,3] },
    'Sevda ÇETİNALP': { 1: [1,2,3,4,5], 2: [3,4,5], 3: [8,9] },
    'Fatma SÖZEN': { 2: [7,8,9], 4: [7,8,9] },
    'Serkan BEKTAŞ': { 3: [5], 4: [7,8,9,10], 5: [3] },
    'Seray ABAOĞLU': { 1: [9,10,11], 2: [10], 4: [10,11] },
    'Sevil EYİLETEN': { 1: [10,11], 4: [2,3], 5: [1,4] }
  };
  const findChief = db.prepare("SELECT id FROM users WHERE full_name = ? AND role = 'chief'");
  const addSchedule = db.prepare('INSERT OR IGNORE INTO chief_schedule (user_id, weekday, period) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const [name, days] of Object.entries(schedules)) {
      const chief = findChief.get(name);
      if (!chief) continue;
      for (const [weekday, periods] of Object.entries(days)) {
        for (const period of periods) addSchedule.run(chief.id, Number(weekday), period);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

seedDatabase();
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

function parseCookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function publicUser(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    department: row.department,
    position: row.position,
    workshop: row.workshop,
    username: row.username,
    role: row.role,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password)
  };
}

function currentUser(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(tokenHash, Date.now());
  return row ? publicUser(row) : null;
}

function requireUser(req, res, role) {
  const user = currentUser(req);
  if (!user) {
    json(res, 401, { error: 'Oturum açmanız gerekiyor.' });
    return null;
  }
  if (role && user.role !== role) {
    json(res, 403, { error: 'Bu işlem için yetkiniz yok.' });
    return null;
  }
  return user;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('İstek çok büyük.'));
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Geçersiz JSON.')); }
    });
    req.on('error', reject);
  });
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf());
}

function inSchoolYear(date) {
  return validDate(date) && date >= SCHOOL_YEAR.start && date <= SCHOOL_YEAR.end;
}

function mondayOf(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayOf(dateString) {
  return new Date(`${dateString}T12:00:00Z`).getUTCDay();
}

function validWeek(weekStart) {
  return validDate(weekStart) && mondayOf(weekStart) === weekStart && weekStart >= SCHOOL_YEAR.start && weekStart <= SCHOOL_YEAR.end;
}

function durationMinutes(start, end) {
  if (!/^\d{2}:\d{2}$/.test(start || '') || !/^\d{2}:\d{2}$/.test(end || '')) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  const value = eh * 60 + em - sh * 60 - sm;
  return value > 0 ? value : null;
}

function listWeeks() {
  const result = [];
  for (let date = SCHOOL_YEAR.start, index = 1; date <= SCHOOL_YEAR.end; date = addDays(date, 7), index++) {
    result.push({ index, start: date, end: addDays(date, 4) });
  }
  return result;
}

function dateRangeForReport(range, value) {
  if (range === 'week') {
    if (!validWeek(value)) return null;
    return { start: value, end: addDays(value, 4), label: `${value} / ${addDays(value, 4)}` };
  }
  if (range === 'month') {
    if (!/^\d{4}-\d{2}$/.test(value || '')) return null;
    const start = `${value}-01`;
    const date = new Date(`${start}T12:00:00Z`);
    if (Number.isNaN(date.valueOf())) return null;
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    const end = date.toISOString().slice(0, 10);
    if (end < SCHOOL_YEAR.start || start > SCHOOL_YEAR.end) return null;
    return { start: start < SCHOOL_YEAR.start ? SCHOOL_YEAR.start : start, end: end > SCHOOL_YEAR.end ? SCHOOL_YEAR.end : end, label: value };
  }
  if (range === 'year') return { start: SCHOOL_YEAR.start, end: SCHOOL_YEAR.end, label: SCHOOL_YEAR.label };
  return null;
}

function reportData(start, end, selectedUserId = null) {
  const users = selectedUserId
    ? db.prepare(`SELECT id, full_name AS fullName, department, position, workshop
        FROM users WHERE role = 'chief' AND active = 1 AND id = ? ORDER BY department, full_name`).all(selectedUserId)
    : db.prepare(`SELECT id, full_name AS fullName, department, position, workshop
        FROM users WHERE role = 'chief' AND active = 1 ORDER BY department, full_name`).all();
  const marks = db.prepare(`SELECT user_id AS userId, attendance_date AS date, period FROM attendance_periods
    WHERE attendance_date BETWEEN ? AND ? ORDER BY attendance_date, period`).all(start, end);
  const schedules = db.prepare('SELECT user_id AS userId, weekday, period FROM chief_schedule ORDER BY weekday, period').all();
  return users.map(user => ({
    ...user,
    marks: marks.filter(mark => mark.userId === user.id).map(({ date, period }) => ({ date, period })),
    schedule: schedules.filter(slot => slot.userId === user.id).map(({ weekday, period }) => ({ weekday, period }))
  }));
}

function trDate(value) {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function createReportPdf(res, people, reportRange, range) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 38, bufferPages: true, info: { Title: `Şef Takip ${SCHOOL_YEAR} Raporu`, Author: 'Alan & Atölye Şef Takip' } });
  const fontCandidates = [
    'C:\\Windows\\Fonts\\arial.ttf',
    'C:\\Windows\\Fonts\\calibri.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
  ];
  const boldCandidates = [
    'C:\\Windows\\Fonts\\arialbd.ttf',
    'C:\\Windows\\Fonts\\calibrib.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
  ];
  const regularFont = fontCandidates.find(fs.existsSync);
  const boldFont = boldCandidates.find(fs.existsSync);
  if (regularFont) doc.registerFont('AppRegular', regularFont);
  if (boldFont) doc.registerFont('AppBold', boldFont);
  const regular = regularFont ? 'AppRegular' : 'Helvetica';
  const bold = boldFont ? 'AppBold' : 'Helvetica-Bold';
  doc.pipe(res);

  const rangeNames = { week: 'HAFTALIK', month: 'AYLIK', year: 'YILLIK' };
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const rowHeight = 28;
  const columns = [245, 220, 75, 105, 100];

  function header() {
    doc.rect(0, 0, doc.page.width, 98).fill('#163b38');
    doc.fillColor('#d9e9a6').font(bold).fontSize(9).text(`${rangeNames[range]} RAPOR · ${SCHOOL_YEAR}`, left, 25, { characterSpacing: 1.2 });
    doc.fillColor('#ffffff').font(bold).fontSize(22).text('Alan & Atölye Şef Takip', left, 45);
    doc.font(regular).fontSize(10).fillColor('#d4e2df').text(`${trDate(reportRange.start)} — ${trDate(reportRange.end)}`, left, 72);
    doc.y = 120;
  }

  function tableHeader() {
    const y = doc.y;
    doc.rect(left, y, width, 27).fill('#e8e4da');
    const labels = ['ŞEF', 'ALAN / GÖREV', 'GÜN', 'İŞARETLENEN', 'HAFTALIK PLAN'];
    let x = left;
    labels.forEach((label, index) => {
      doc.fillColor('#516663').font(bold).fontSize(8).text(label, x + 7, y + 9, { width: columns[index] - 14 });
      x += columns[index];
    });
    doc.y = y + 27;
  }

  function ensureSpace(height) {
    if (doc.y + height > doc.page.height - 48) {
      doc.addPage();
      header();
      tableHeader();
    }
  }

  header();
  doc.fillColor('#163b38').font(bold).fontSize(13).text(people.length === 1 ? people[0].fullName : `Toplu rapor · ${people.length} şef`);
  doc.moveDown(.7);
  tableHeader();
  for (const person of people) {
    ensureSpace(rowHeight);
    const y = doc.y;
    doc.rect(left, y, width, rowHeight).fillAndStroke('#fffdf8', '#ddd8cd');
    const values = [
      person.fullName,
      `${person.department} · ${person.position}${person.workshop ? ` · ${person.workshop}` : ''}`,
      String(new Set(person.marks.map(mark => mark.date)).size),
      `${person.marks.length} ders saati`,
      `${person.schedule.length} ders saati`
    ];
    let x = left;
    values.forEach((value, index) => {
      doc.fillColor('#163b38').font(index === 0 ? bold : regular).fontSize(index < 2 ? 8.5 : 9)
        .text(value, x + 7, y + 9, { width: columns[index] - 14, height: 14, ellipsis: true });
      x += columns[index];
    });
    doc.y = y + rowHeight;
  }

  if (people.length === 1) {
    const person = people[0];
    const grouped = new Map();
    for (const mark of person.marks) {
      if (!grouped.has(mark.date)) grouped.set(mark.date, []);
      grouped.get(mark.date).push(mark.period);
    }
    doc.moveDown(1.4);
    ensureSpace(55);
    doc.fillColor('#163b38').font(bold).fontSize(13).text('Günlük işaretleme dökümü');
    doc.moveDown(.5);
    if (!grouped.size) {
      doc.font(regular).fontSize(10).fillColor('#71807d').text('Seçilen dönemde işaretlenmiş ders saati bulunmuyor.');
    } else {
      for (const [date, periods] of grouped) {
        ensureSpace(22);
        doc.font(bold).fontSize(9).fillColor('#163b38').text(trDate(date), left, doc.y, { continued: true, width: 95 });
        const detail = periods.map(period => {
          const time = PERIOD_TIMES[period - 1];
          return `${period}. ders (${time.start}–${time.end})`;
        }).join(', ');
        doc.font(regular).fillColor('#425b58').text(`  ${detail}`);
        doc.moveDown(.35);
      }
    }
  }

  const totalPages = doc.bufferedPageRange().count;
  for (let index = 0; index < totalPages; index++) {
    doc.switchToPage(index);
    doc.font(regular).fontSize(8).fillColor('#71807d')
      .text(`Oluşturulma: ${new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(new Date())}`, left, doc.page.height - 29, { width: width / 2 });
    doc.text(`${index + 1} / ${totalPages}`, left + width / 2, doc.page.height - 29, { width: width / 2, align: 'right' });
  }
  doc.end();
}

function sanitizeText(value, max = 250) {
  return String(value || '').trim().slice(0, max);
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, requested);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

async function api(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const username = sanitizeText(body.username, 50);
    const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1').get(username);
    if (!row || !verifyPassword(String(body.password || ''), row.password_hash)) {
      return json(res, 401, { error: 'Kullanıcı adı veya şifre hatalı.' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash, row.id, Date.now() + SESSION_MAX_AGE * 1000);
    const secure = req.socket.encrypted ? '; Secure' : '';
    return json(res, 200, { user: publicUser(row) }, {
      'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}${secure}`
    });
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = parseCookies(req).session;
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(crypto.createHash('sha256').update(token).digest('hex'));
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    const user = requireUser(req, res);
    if (user) json(res, 200, { user, schoolYear: SCHOOL_YEAR, weeks: listWeeks(), periodTimes: PERIOD_TIMES, dayPeriodLimits: DAY_PERIOD_LIMITS });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/auth/change-password') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const password = String(body.password || '');
    if (password.length < 8 || password.length > 128) return json(res, 400, { error: 'Şifre en az 8 karakter olmalıdır.' });
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(hashPassword(password), user.id);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/attendance') {
    const user = requireUser(req, res, 'chief');
    if (!user) return;
    const weekStart = searchParams.get('weekStart');
    if (!validWeek(weekStart)) return json(res, 400, { error: 'Geçersiz hafta.' });
    const marks = db.prepare(`SELECT attendance_date AS date, period FROM attendance_periods
      WHERE user_id = ? AND attendance_date BETWEEN ? AND ? ORDER BY attendance_date, period`)
      .all(user.id, weekStart, addDays(weekStart, 4));
    const schedule = db.prepare('SELECT weekday, period FROM chief_schedule WHERE user_id = ? ORDER BY weekday, period').all(user.id);
    return json(res, 200, { marks, schedule });
  }

  if (req.method === 'PUT' && pathname === '/api/attendance') {
    const user = requireUser(req, res, 'chief');
    if (!user) return;
    const body = await readBody(req);
    if (!validWeek(body.weekStart) || !Array.isArray(body.marks)) return json(res, 400, { error: 'Geçersiz hafta verisi.' });
    const allowedDates = new Set(Array.from({ length: 5 }, (_, i) => addDays(body.weekStart, i)));
    const normalized = new Map();
    for (const item of body.marks) {
      if (!allowedDates.has(item.date) || !inSchoolYear(item.date)) return json(res, 400, { error: 'Geçersiz tarih.' });
      const period = Number(item.period);
      if (!Number.isInteger(period) || period < 1 || period > 11) return json(res, 400, { error: 'Geçersiz ders saati.' });
      const weekday = weekdayOf(item.date);
      if (!DAY_PERIOD_LIMITS[weekday] || period > DAY_PERIOD_LIMITS[weekday]) return json(res, 400, { error: `${item.date} tarihinde ${period}. ders saati uygulanmıyor.` });
      normalized.set(`${item.date}:${period}`, { date: item.date, period });
    }
    const insertMark = db.prepare(`INSERT INTO attendance_periods (user_id, attendance_date, period, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)`);
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM attendance_periods WHERE user_id = ? AND attendance_date BETWEEN ? AND ?')
        .run(user.id, body.weekStart, addDays(body.weekStart, 4));
      for (const item of normalized.values()) insertMark.run(user.id, item.date, item.period);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/admin/users') {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const rows = db.prepare("SELECT * FROM users WHERE role = 'chief' ORDER BY department, position, full_name").all();
    return json(res, 200, { users: rows.map(publicUser) });
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (req.method === 'PATCH' && userMatch) {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const id = Number(userMatch[1]);
    const existing = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'chief'").get(id);
    if (!existing) return json(res, 404, { error: 'Şef bulunamadı.' });
    const body = await readBody(req);
    const active = body.active === false ? 0 : 1;
    const password = String(body.password || '');
    if (password && (password.length < 8 || password.length > 128)) return json(res, 400, { error: 'Şifre en az 8 karakter olmalıdır.' });
    if (password) {
      db.prepare(`UPDATE users SET password_hash=?, active=?, must_change_password=1,
        updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(hashPassword(password), active, id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    } else {
      db.prepare('UPDATE users SET active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(active, id);
    }
    return json(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  }

  if (req.method === 'GET' && pathname === '/api/admin/report') {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const weekStart = searchParams.get('weekStart');
    if (!validWeek(weekStart)) return json(res, 400, { error: 'Geçersiz hafta.' });
    const people = reportData(weekStart, addDays(weekStart, 4));
    return json(res, 200, { people });
  }

  if (req.method === 'GET' && pathname === '/api/admin/report.pdf') {
    const admin = requireUser(req, res, 'admin');
    if (!admin) return;
    const range = searchParams.get('range') || 'week';
    const value = searchParams.get('date') || SCHOOL_YEAR.start;
    const reportRange = dateRangeForReport(range, value);
    if (!reportRange) return json(res, 400, { error: 'Geçersiz rapor dönemi.' });
    const userValue = searchParams.get('userId') || 'all';
    const selectedUserId = userValue === 'all' ? null : Number(userValue);
    if (selectedUserId !== null && (!Number.isInteger(selectedUserId) || selectedUserId < 1)) return json(res, 400, { error: 'Geçersiz kişi seçimi.' });
    const people = reportData(reportRange.start, reportRange.end, selectedUserId);
    if (selectedUserId !== null && !people.length) return json(res, 404, { error: 'Şef bulunamadı.' });
    const filename = `sef-takip-${range}-${reportRange.start}-${userValue}.pdf`;
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store'
    });
    createReportPdf(res, people, reportRange, range);
    return;
  }

  return json(res, 404, { error: 'İstek bulunamadı.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (serveStatic(req, res, url.pathname)) return;
    if (req.method === 'GET') return serveStatic(req, res, '/');
    json(res, 404, { error: 'Bulunamadı.' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: 'Beklenmeyen bir sunucu hatası oluştu.' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Şef Takip uygulaması http://${HOST}:${PORT} adresinde çalışıyor.`);
  if (generatedAdminPassword) console.log(`İlk yönetici girişi: admin / ${generatedAdminPassword} (girişte değiştirmeniz istenir)`);
  if (generatedChiefPassword) console.log(`Şef hesapları için üretilen ilk şifre: ${generatedChiefPassword}`);
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
