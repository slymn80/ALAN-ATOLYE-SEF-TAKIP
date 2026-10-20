'use strict';

const state = { user: null, schoolYear: null, weeks: [], periodTimes: [], dayPeriodLimits: {}, weekIndex: 0, users: [], currentPage: '' };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const dayNames = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
const shortDays = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum'];
const monthNames = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || 'İşlem tamamlanamadı.');
  return data;
}

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.className = 'toast', 3200);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('tr-TR');
}

function dateParts(value) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function formatDate(value, includeYear = false) {
  const { year, month, day } = dateParts(value);
  return `${day} ${monthNames[month - 1]}${includeYear ? ` ${year}` : ''}`;
}

function addDays(value, count) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function formatPeriods(count) { return `${count} ders saati`; }

function currentWeekIndex() {
  const today = new Date().toISOString().slice(0, 10);
  const found = state.weeks.findIndex(week => today >= week.start && today <= addDays(week.start, 6));
  if (found >= 0) return found;
  if (today < state.weeks[0].start) return 0;
  return state.weeks.length - 1;
}

function weekSelector() {
  return `<div class="week-nav">
    <button type="button" data-week-prev aria-label="Önceki hafta">←</button>
    <select id="week-select" aria-label="Hafta seçimi">
      ${state.weeks.map((week, index) => `<option value="${index}" ${index === state.weekIndex ? 'selected' : ''}>${week.index}. Hafta · ${formatDate(week.start)}—${formatDate(week.end)}</option>`).join('')}
    </select>
    <button type="button" data-week-next aria-label="Sonraki hafta">→</button>
  </div>`;
}

function wireWeekSelector(render) {
  $('#week-select').addEventListener('change', event => { state.weekIndex = Number(event.target.value); render(); });
  $('[data-week-prev]').addEventListener('click', () => { state.weekIndex = Math.max(0, state.weekIndex - 1); render(); });
  $('[data-week-next]').addEventListener('click', () => { state.weekIndex = Math.min(state.weeks.length - 1, state.weekIndex + 1); render(); });
}

function setHeader(kicker, title) {
  $('#page-kicker').textContent = kicker;
  $('#page-title').textContent = title;
}

function setActiveNav(page) {
  $$('.nav-button').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  state.currentPage = page;
  $('.sidebar').classList.remove('open');
}

function setupApp() {
  $('#user-initials').textContent = initials(state.user.fullName);
  $('#user-name').textContent = state.user.fullName;
  $('#user-position').textContent = state.user.role === 'admin' ? 'Yönetici' : state.user.position;
  const items = state.user.role === 'admin'
    ? [{ page: 'report', icon: '▦', label: 'Haftalık rapor' }, { page: 'users', icon: '◎', label: 'Şef hesapları' }]
    : [{ page: 'attendance', icon: '✓', label: 'Haftalık takibim' }, { page: 'profile', icon: '◉', label: 'Hesabım' }];
  $('#main-nav').innerHTML = items.map(item => `<button class="nav-button" data-page="${item.page}"><span class="nav-icon">${item.icon}</span>${item.label}</button>`).join('');
  $$('.nav-button').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  navigate(items[0].page);
  if (state.user.mustChangePassword) $('#password-dialog').showModal();
}

function navigate(page) {
  setActiveNav(page);
  if (page === 'attendance') renderAttendance();
  if (page === 'report') renderReport();
  if (page === 'users') renderUsers();
  if (page === 'profile') renderProfile();
}

async function renderAttendance() {
  setHeader('HAFTALIK TAKİP', 'Görev günlerim');
  const week = state.weeks[state.weekIndex];
  $('#page-content').innerHTML = `<div class="hero-strip"><div><h3>${formatDate(week.start)} — ${formatDate(week.end, true)}</h3><p>Geldiğiniz günleri işaretleyip çalışma saatlerinizi girin.</p></div>${weekSelector()}</div><div class="empty-state">Hafta bilgileri yükleniyor…</div>`;
  wireWeekSelector(renderAttendance);
  try {
    const data = await request(`/api/attendance?weekStart=${week.start}`);
    if (state.weeks[state.weekIndex].start !== week.start) return;
    const markSet = new Set(data.marks.map(item => `${item.date}:${item.period}`));
    const scheduleSet = new Set(data.schedule.map(item => `${item.weekday}:${item.period}`));
    const markedDays = new Set(data.marks.map(item => item.date)).size;
    $('#page-content').innerHTML = `
      <div class="hero-strip"><div><h3>${formatDate(week.start)} — ${formatDate(week.end, true)}</h3><p>Geldiğiniz günleri işaretleyip çalışma saatlerinizi girin.</p></div>${weekSelector()}</div>
      <div class="stats-row">
        <div class="stat-card"><small>İŞARETLENEN GÜN</small><strong id="marked-stat">${markedDays} / 5</strong></div>
        <div class="stat-card"><small>İŞARETLENEN SAAT</small><strong id="hours-stat">${formatPeriods(data.marks.length)}</strong></div>
        <div class="stat-card"><small>ALAN / ATÖLYE</small><strong style="font-size:18px">${escapeHtml(state.user.workshop || state.user.department)}</strong></div>
      </div>
      <form id="attendance-form">
        <div class="schedule-legend"><span><i class="legend-dot planned"></i> Excel planındaki şeflik saati</span><span><i class="legend-dot marked"></i> Geldim olarak işaretlendi</span></div>
        <div class="schedule-wrap"><div class="schedule-grid">
          <div class="schedule-corner">DERS<br>SAATİ</div>
          ${dayNames.map((name, index) => `<div class="schedule-day"><strong>${name}</strong><small>${formatDate(addDays(week.start, index))}</small></div>`).join('')}
          ${state.periodTimes.map(time => {
            const periodIndex = time.period - 1;
            const period = periodIndex + 1;
            return `<div class="period-label"><strong>${period}</strong><small>${time.start}<br>${time.end}</small></div>${dayNames.map((_, dayIndex) => {
              const date = addDays(week.start, dayIndex);
              const key = `${date}:${period}`;
              const planned = scheduleSet.has(`${dayIndex + 1}:${period}`);
              const available = period <= Number(state.dayPeriodLimits[dayIndex + 1]);
              if (!available) return `<div class="period-cell unavailable" title="Bu gün ${period}. ders saati uygulanmıyor"><span>—</span></div>`;
              return `<label class="period-cell ${planned ? 'planned' : ''}" title="${time.start}–${time.end}${planned ? ' · Planlı şeflik saati' : ''}"><input type="checkbox" data-date="${date}" data-period="${period}" ${markSet.has(key) ? 'checked' : ''}><span>${planned ? 'Ş' : ''}</span></label>`;
            }).join('')}`;
          }).join('')}
        </div></div>
        <div class="save-bar"><p>Planlı hücreler çizelgeden alınmıştır. Geldiğiniz her ders saatini işaretleyin.</p><button class="primary-button" type="submit">Haftayı kaydet</button></div>
      </form>`;
    wireWeekSelector(renderAttendance);
    $$('.period-cell input').forEach(input => input.addEventListener('change', updateAttendanceStats));
    updateAttendanceStats();
    $('#attendance-form').addEventListener('submit', saveAttendance);
  } catch (error) { toast(error.message, true); }
}

function updateAttendanceStats() {
  const checked = $$('.period-cell input:checked');
  const markedDays = new Set(checked.map(input => input.dataset.date)).size;
  if ($('#marked-stat')) $('#marked-stat').textContent = `${markedDays} / 5`;
  if ($('#hours-stat')) $('#hours-stat').textContent = formatPeriods(checked.length);
}

async function saveAttendance(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const marks = $$('.period-cell input:checked').map(input => ({ date: input.dataset.date, period: Number(input.dataset.period) }));
  try {
    await request('/api/attendance', { method: 'PUT', body: JSON.stringify({ weekStart: state.weeks[state.weekIndex].start, marks }) });
    toast('Haftalık bilgileriniz kaydedildi.');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}

async function renderUsers() {
  setHeader('YÖNETİM', 'Şef hesapları');
  $('#page-content').innerHTML = `<div class="hero-strip"><div><h3>Hesap yönetimi</h3><p>Şef hesapları ve sabit kullanıcı adları otomatik oluşturulur.</p></div></div><div class="empty-state">Hesaplar yükleniyor…</div>`;
  try {
    const data = await request('/api/admin/users');
    state.users = data.users;
    drawUsers('');
  } catch (error) { toast(error.message, true); }
}

function drawUsers(filter) {
  const needle = filter.toLocaleLowerCase('tr-TR');
  const users = state.users.filter(user => `${user.fullName} ${user.department} ${user.username || ''}`.toLocaleLowerCase('tr-TR').includes(needle));
  $('#page-content').innerHTML = `
    <div class="hero-strip"><div><h3>Hesap yönetimi</h3><p>${state.users.length} otomatik hesap · Kullanıcı adları sabittir</p></div></div>
    <div class="toolbar"><input id="user-search" type="search" value="${escapeHtml(filter)}" placeholder="Şef veya alan ara…"></div>
    <div class="table-card"><table class="data-table"><thead><tr><th>ŞEF</th><th>ALAN</th><th>GÖREV</th><th>KULLANICI ADI</th><th>DURUM</th><th></th></tr></thead>
    <tbody>${users.map(user => `<tr>
      <td><div class="person-cell"><strong>${escapeHtml(user.fullName)}</strong><small>${escapeHtml(user.workshop || '—')}</small></div></td>
      <td>${escapeHtml(user.department)}</td><td>${escapeHtml(user.position)}</td>
      <td><strong>${escapeHtml(user.username)}</strong></td>
      <td><span class="badge ${user.active ? 'ok' : ''}">${user.active ? 'AKTİF' : 'PASİF'}</span></td>
      <td><button class="ghost-button" data-edit-user="${user.id}">Yönet</button></td>
    </tr>`).join('') || '<tr><td colspan="6"><div class="empty-state">Eşleşen kayıt bulunamadı.</div></td></tr>'}</tbody></table></div>`;
  $('#user-search').addEventListener('input', event => drawUsers(event.target.value));
  $$('[data-edit-user]').forEach(button => button.addEventListener('click', () => openAccount(Number(button.dataset.editUser))));
}

function openAccount(id) {
  const user = state.users.find(item => item.id === id);
  const form = $('#account-form');
  form.elements.id.value = id;
  form.elements.username.value = user.username;
  form.elements.password.value = '';
  form.elements.active.checked = user.active;
  $('#account-person').textContent = user.fullName;
  $('#account-dialog').showModal();
}

async function saveAccount(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const id = Number(form.elements.id.value);
  try {
    const data = await request(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ password: form.elements.password.value, active: form.elements.active.checked }) });
    state.users = state.users.map(user => user.id === id ? data.user : user);
    $('#account-dialog').close();
    drawUsers($('#user-search')?.value || '');
    toast('Hesap bilgileri kaydedildi.');
  } catch (error) { toast(error.message, true); }
}

async function renderReport() {
  setHeader('YÖNETİM', 'Haftalık rapor');
  const week = state.weeks[state.weekIndex];
  $('#page-content').innerHTML = `<div class="hero-strip"><div><h3>${formatDate(week.start)} — ${formatDate(week.end, true)}</h3><p>Şeflerin haftalık işaretleme ve saat özeti.</p></div>${weekSelector()}</div><div class="empty-state">Rapor hazırlanıyor…</div>`;
  wireWeekSelector(renderReport);
  try {
    const data = await request(`/api/admin/report?weekStart=${week.start}`);
    if (state.weeks[state.weekIndex].start !== week.start) return;
    const markedPeople = data.people.filter(person => person.marks.length).length;
    const total = data.people.reduce((sum, person) => sum + person.marks.length, 0);
    $('#page-content').innerHTML = `
      <div class="hero-strip"><div><h3>${formatDate(week.start)} — ${formatDate(week.end, true)}</h3><p>Şeflerin haftalık işaretleme ve saat özeti.</p></div>${weekSelector()}</div>
      <section class="report-export">
        <div><p class="eyebrow">PDF RAPORU</p><h4>Rapor kapsamını seçin</h4></div>
        <label>DÖNEM<select id="pdf-range"><option value="week">Haftalık</option><option value="month">Aylık</option><option value="year">Yıllık</option></select></label>
        <label id="pdf-month-wrap" hidden>AY<input id="pdf-month" type="month" min="2026-09" max="2027-06" value="${week.start.slice(0, 7)}"></label>
        <label>KİŞİ<select id="pdf-person"><option value="all">Tüm şefler</option>${data.people.map(person => `<option value="${person.id}">${escapeHtml(person.fullName)}</option>`).join('')}</select></label>
        <button id="pdf-download" class="primary-button" type="button">PDF indir ↓</button>
      </section>
      <div class="stats-row"><div class="stat-card"><small>AKTİF ŞEF</small><strong>${data.people.length}</strong></div><div class="stat-card"><small>İŞARETLEME YAPAN</small><strong>${markedPeople}</strong></div><div class="stat-card"><small>TOPLAM İŞARETLEME</small><strong>${formatPeriods(total)}</strong></div></div>
      <div class="table-card"><table class="data-table"><thead><tr><th>ŞEF</th><th>ALAN</th><th>HAFTANIN GÜNLERİ</th><th>İŞARETLENEN / PLAN</th><th>DURUM</th></tr></thead><tbody>
        ${data.people.map(person => reportRow(person, week)).join('')}
      </tbody></table></div>`;
    wireWeekSelector(renderReport);
    wirePdfExport(week);
  } catch (error) { toast(error.message, true); }
}

function wirePdfExport(week) {
  const range = $('#pdf-range');
  range.addEventListener('change', () => { $('#pdf-month-wrap').hidden = range.value !== 'month'; });
  $('#pdf-download').addEventListener('click', () => {
    const selectedRange = range.value;
    const date = selectedRange === 'week' ? week.start : selectedRange === 'month' ? $('#pdf-month').value : state.schoolYear.label;
    const person = $('#pdf-person').value;
    const link = document.createElement('a');
    link.href = `/api/admin/report.pdf?range=${encodeURIComponent(selectedRange)}&date=${encodeURIComponent(date)}&userId=${encodeURIComponent(person)}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
}

function reportRow(person, week) {
  const byDate = new Map(dayNames.map((_, index) => [addDays(week.start, index), person.marks.filter(mark => mark.date === addDays(week.start, index)).map(mark => mark.period)]));
  const marked = person.marks.length;
  return `<tr><td><div class="person-cell"><strong>${escapeHtml(person.fullName)}</strong><small>${escapeHtml(person.position)}${person.workshop ? ` · ${escapeHtml(person.workshop)}` : ''}</small></div></td>
    <td>${escapeHtml(person.department)}</td><td><div class="report-days">${shortDays.map((name, i) => { const periods = byDate.get(addDays(week.start, i)); const title = periods.length ? periods.map(period => { const time = state.periodTimes[period - 1]; return `${period}. ders ${time.start}–${time.end}`; }).join(', ') : 'İşaretlenmedi'; return `<span class="mini-day ${periods.length ? 'done' : ''}" title="${escapeHtml(title)}">${name}</span>`; }).join('')}</div></td>
    <td><strong>${marked} / ${person.schedule.length}</strong></td><td><span class="badge ${marked ? 'ok' : 'warn'}">${marked ? `${new Set(person.marks.map(item => item.date)).size} GÜN` : 'GİRİŞ YOK'}</span></td></tr>`;
}

function renderProfile() {
  setHeader('HESABIM', 'Profil ve güvenlik');
  $('#page-content').innerHTML = `<div class="hero-strip"><div><h3>${escapeHtml(state.user.fullName)}</h3><p>${escapeHtml(state.user.department)} · ${escapeHtml(state.user.position)}</p></div></div>
    <div class="table-card" style="max-width:650px;padding:26px"><form id="profile-password-form" class="stack-form"><p class="eyebrow">ŞİFRE DEĞİŞTİR</p><label>Yeni şifre<input name="password" type="password" minlength="8" required></label><label>Yeni şifre tekrar<input name="confirm" type="password" minlength="8" required></label><button class="primary-button" type="submit">Şifreyi güncelle</button></form></div>`;
  $('#profile-password-form').addEventListener('submit', event => changePassword(event, false));
}

async function changePassword(event, dialogMode) {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.password.value !== form.elements.confirm.value) return toast('Şifreler birbiriyle aynı değil.', true);
  try {
    await request('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ password: form.elements.password.value }) });
    state.user.mustChangePassword = false;
    form.reset();
    if (dialogMode) $('#password-dialog').close();
    toast('Şifreniz güncellendi.');
  } catch (error) { toast(error.message, true); }
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('#login-error');
  error.hidden = true;
  try {
    await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value }) });
    await boot();
  } catch (err) { error.textContent = err.message; error.hidden = false; }
});

$('#logout-button').addEventListener('click', async () => { await request('/api/auth/logout', { method: 'POST' }); location.reload(); });
$('#menu-button').addEventListener('click', () => $('.sidebar').classList.toggle('open'));
$('#account-form').addEventListener('submit', saveAccount);
$$('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#password-form').addEventListener('submit', event => changePassword(event, true));

async function boot() {
  try {
    const data = await request('/api/auth/me');
    state.user = data.user;
    state.schoolYear = data.schoolYear;
    state.weeks = data.weeks;
    state.periodTimes = data.periodTimes;
    state.dayPeriodLimits = data.dayPeriodLimits;
    state.weekIndex = currentWeekIndex();
    setupApp();
  } catch {
    $('#login-view').hidden = false;
    $('#app-view').hidden = true;
  }
}

boot();
