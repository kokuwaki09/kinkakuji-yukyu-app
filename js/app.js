// app.js
// 画面表示・入力受付・localStorage連携を行うUI層。
// 会社独自ルール・計算ロジックはこのファイルには書かず、companyRules.js / calculator.js を呼び出すだけにする。

import {
  calculate,
  timeStringToMinutes,
  minutesToTimeString,
  formatDuration,
  calcStandardMinutes,
} from './calculator.js';
import { BREAK_DURING_WORK_PRESETS } from './companyRules.js';
import {
  loadSettings,
  saveSettings,
  hasUsableSettings,
  createEmptySettings,
  WEEKDAY_LABELS,
  weekdayKeyFromDateString,
} from './storage.js';

// 設定画面での表示順（月曜始まり）。ストレージ側のキー(sun〜sat)とは独立。
const DISPLAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

let settings = loadSettings() || createEmptySettings();

// 全日扱いと判定されたあと、休憩入力を待っている間に使う「計算のベースになる入力」
let pendingBaseInput = null;

// --- DOM参照 ---

const el = {
  headerTitle: document.getElementById('header-title'),
  btnOpenSettings: document.getElementById('btn-open-settings'),
  btnBackToMain: document.getElementById('btn-back-to-main'),

  viewCalc: document.getElementById('view-calc'),
  viewSettings: document.getElementById('view-settings'),

  settingsWarning: document.getElementById('settings-warning'),
  btnGotoSettingsFromWarning: document.getElementById('btn-goto-settings-from-warning'),

  calcForm: document.getElementById('calc-form'),
  leaveDate: document.getElementById('leave-date'),
  weekdayInfo: document.getElementById('weekday-info'),
  leaveStart: document.getElementById('leave-start'),
  leaveEnd: document.getElementById('leave-end'),

  breakSection: document.getElementById('break-section'),
  breakPresets: document.getElementById('break-presets'),
  breakOther: document.getElementById('break-other'),
  btnBreakOtherConfirm: document.getElementById('btn-break-other-confirm'),

  resultSection: document.getElementById('result-section'),

  settingsForm: document.getElementById('settings-form'),
  weekdaySettingsList: document.getElementById('weekday-settings-list'),
  btnCopyMonToWeekdays: document.getElementById('btn-copy-mon-to-weekdays'),
  copySource: document.getElementById('copy-source'),
  copyTargets: document.getElementById('copy-targets'),
  btnCopyCustom: document.getElementById('btn-copy-custom'),
};

// --- 画面切り替え ---

function showCalcView() {
  el.viewCalc.hidden = false;
  el.viewSettings.hidden = true;
  el.btnOpenSettings.hidden = false;
  el.btnBackToMain.hidden = true;
  el.headerTitle.textContent = '有給かんたん計算';
  refreshSettingsWarning();
  updateWeekdayInfo();
}

function showSettingsView() {
  renderSettingsForm();
  el.viewCalc.hidden = true;
  el.viewSettings.hidden = false;
  el.btnOpenSettings.hidden = true;
  el.btnBackToMain.hidden = false;
  el.headerTitle.textContent = '曜日ごとの勤務設定';
}

function refreshSettingsWarning() {
  const usable = hasUsableSettings(settings);
  el.settingsWarning.hidden = usable;
  el.calcForm.querySelectorAll('input, button').forEach((node) => {
    node.disabled = !usable;
  });
}

// --- 通常画面：曜日情報の表示 ---

function updateWeekdayInfo() {
  const dateStr = el.leaveDate.value;
  clearResult();
  hideBreakSection();

  if (!dateStr) {
    el.weekdayInfo.textContent = '';
    return;
  }
  const key = weekdayKeyFromDateString(dateStr);
  const day = settings[key];
  if (!day || !day.isWorkday) {
    el.weekdayInfo.textContent = `${WEEKDAY_LABELS[key]}：この曜日は「勤務なし」に設定されています。`;
    return;
  }
  const standardMinutes = calcStandardMinutes(day);
  el.weekdayInfo.textContent =
    `${WEEKDAY_LABELS[key]} ${day.start}〜${day.end}` +
    ` / 休憩${day.break}分 / 所定${formatDuration(standardMinutes)}`;
}

// --- 計算実行 ---

function clearResult() {
  el.resultSection.hidden = true;
  el.resultSection.innerHTML = '';
}

function hideBreakSection() {
  el.breakSection.hidden = true;
  el.breakOther.value = '';
  pendingBaseInput = null;
  el.breakPresets.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
}

function buildBaseInput() {
  const dateStr = el.leaveDate.value;
  const key = weekdayKeyFromDateString(dateStr);
  const day = settings[key] || { isWorkday: false };

  return {
    isWorkday: !!day.isWorkday,
    normalStart: day.start ? timeStringToMinutes(day.start) : NaN,
    normalEnd: day.end ? timeStringToMinutes(day.end) : NaN,
    normalBreak: typeof day.break === 'number' ? day.break : NaN,
    leaveStart: el.leaveStart.value ? timeStringToMinutes(el.leaveStart.value) : NaN,
    leaveEnd: el.leaveEnd.value ? timeStringToMinutes(el.leaveEnd.value) : NaN,
  };
}

function runCalculation(breakDuringWork) {
  if (!pendingBaseInput) return;
  const result = calculate({ ...pendingBaseInput, breakDuringWork });
  renderResult(result);
}

el.calcForm.addEventListener('submit', (e) => {
  e.preventDefault();
  hideBreakSection();

  if (!el.leaveDate.value) {
    renderResult({ status: 'ERROR', message: '有給を取る日を選択してください。' });
    return;
  }

  const baseInput = buildBaseInput();
  const result = calculate(baseInput);

  if (result.status === 'NEEDS_BREAK_INPUT') {
    pendingBaseInput = baseInput;
    el.breakSection.hidden = false;
    clearResult();
    el.breakSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  renderResult(result);
});

el.leaveDate.addEventListener('change', updateWeekdayInfo);

BREAK_DURING_WORK_PRESETS.forEach((minutes) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = `${minutes}分`;
  btn.dataset.minutes = String(minutes);
  btn.addEventListener('click', () => {
    el.breakPresets.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    el.breakOther.value = '';
    runCalculation(minutes);
  });
  el.breakPresets.appendChild(btn);
});

el.btnBreakOtherConfirm.addEventListener('click', () => {
  const val = Number(el.breakOther.value);
  if (!el.breakOther.value || Number.isNaN(val) || val < 0) {
    renderResult({ status: 'ERROR', message: '勤務中に取る休憩時間を分単位の数字で入力してください。' });
    return;
  }
  el.breakPresets.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
  runCalculation(val);
});

// --- 結果表示 ---

// 休憩は「◯分」の分単位のみで表示する（仕様: 休憩開始・終了時刻を保持していないため、
// 存在しない休憩時刻を生成せず、分数だけを示す。60分を「1時間」と時間換算表示しない）。
function formatBreakMinutes(minutes) {
  return `${minutes}分`;
}

function renderResult(result) {
  el.resultSection.hidden = false;
  el.resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  switch (result.status) {
    case 'ERROR':
      el.resultSection.innerHTML = renderNotice('notice-error', '入力内容をご確認ください', result.message);
      return;
    case 'FULL_DAY_OUT_OF_SCOPE':
      el.resultSection.innerHTML = renderNotice('notice-info', 'このツールの対象外です', result.message);
      return;
    case 'MIDDLE_UNSUPPORTED':
      el.resultSection.innerHTML = renderNotice('notice-warning', '現在未対応のケースです', result.message);
      return;
    case 'HALF':
      el.resultSection.innerHTML = renderHalfResult(result.data);
      return;
    case 'FULL':
      el.resultSection.innerHTML = renderFullResult(result.data);
      return;
    default:
      el.resultSection.innerHTML = renderNotice('notice-error', 'エラー', '想定外の状態です。入力しなおしてください。');
  }
}

function renderNotice(cssClass, title, message) {
  return `
    <div class="notice ${cssClass}">
      <p style="margin:0 0 6px 0; font-weight:800;">${escapeHtml(title)}</p>
      <p style="margin:0;">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderScheduleBlock(data) {
  return `
    <div class="result-section-block">
      <p class="result-block-title">スケジュール申請</p>
      <div class="result-grid">
        <div class="result-grid-item">
          <div class="label">勤務開始</div>
          <div class="value">${minutesToTimeString(data.scheduleStart)}</div>
        </div>
        <div class="result-grid-item">
          <div class="label">勤務終了</div>
          <div class="value">${minutesToTimeString(data.scheduleEnd)}</div>
        </div>
      </div>
      <p class="result-break-line">休憩：${formatBreakMinutes(data.scheduleBreak)}</p>
    </div>
  `;
}

function renderAuxBlock(data, itemNameHtml) {
  return `
    <div class="result-section-block">
      <p class="result-block-title">補助項目申請</p>
      ${itemNameHtml}
      <div class="result-grid">
        <div class="result-grid-item">
          <div class="label">開始</div>
          <div class="value">${minutesToTimeString(data.auxStart)}</div>
        </div>
        <div class="result-grid-item">
          <div class="label">終了</div>
          <div class="value">${minutesToTimeString(data.auxEnd)}</div>
        </div>
      </div>
    </div>
  `;
}

function renderConfirmBlock(data) {
  return `
    <div class="result-section-block">
      <p class="result-block-title">確認</p>
      <div class="result-grid">
        <div class="result-grid-item">
          <div class="label">実働</div>
          <div class="value">${formatDuration(data.actualMinutes)}</div>
        </div>
        <div class="result-grid-item">
          <div class="label">有給</div>
          <div class="value">${formatDuration(data.leaveMinutes)}</div>
        </div>
      </div>
      <div class="verify-box">
        実働 ${formatDuration(data.actualMinutes)} + 有給 ${formatDuration(data.leaveMinutes)}
        = 所定 ${formatDuration(data.standardMinutes)} ✓ 計算一致
      </div>
    </div>
  `;
}

function renderHalfResult(data) {
  const itemNameHtml = `<p class="result-item-name">${escapeHtml(data.auxItemName)}</p>`;

  return `
    <div class="result-card">
      <p class="result-block-title">判定</p>
      <p class="result-headline">半日有休</p>

      ${renderScheduleBlock(data)}
      ${renderAuxBlock(data, itemNameHtml)}
      ${renderConfirmBlock(data)}

      ${renderDetails(data)}
    </div>
  `;
}

function renderFullResult(data) {
  const itemNameHtml = data.itemUndetermined
    ? `<p class="result-item-name undetermined">補助項目：未確定</p>`
    : `<p class="result-item-name">${escapeHtml(data.auxItemName)}</p>`;

  const undeterminedBoxHtml = data.itemUndetermined
    ? `
      <div class="undetermined-box">
        <span class="undetermined-badge">未確定</span>
        <p style="margin:6px 0 0 0;">
          有給側で処理する休憩は ${formatDuration(data.leaveSideBreak)} と計算できましたが、
          この分数に対応する会社の補助項目名は現在未確認です。スケジュール申請・開始終了時刻・有給時間はこの計算結果のとおりですが、
          補助項目名だけは所長・資料でご確認ください。
        </p>
      </div>
    `
    : '';

  return `
    <div class="result-card">
      <p class="result-block-title">判定</p>
      <p class="result-headline">全日扱い</p>

      ${renderScheduleBlock(data)}
      ${renderAuxBlock(data, itemNameHtml)}
      <p class="leave-side-break-box">有給側で処理する休憩：${formatDuration(data.leaveSideBreak)}</p>
      ${undeterminedBoxHtml}
      ${renderConfirmBlock(data)}

      ${renderDetails(data)}
    </div>
  `;
}

function renderDetails(data) {
  const patternLabel = data.pattern === 'AM' ? '午前側の有給' : '午後側の有給';
  return `
    <details class="result-details">
      <summary>詳細を見る</summary>
      <dl class="result-details-body">
        <dt>パターン</dt>
        <dd>${patternLabel}</dd>
        <dt>所定労働時間</dt>
        <dd>${formatDuration(data.standardMinutes)}</dd>
        <dt>実働時間</dt>
        <dd>${formatDuration(data.actualMinutes)}</dd>
        <dt>有給時間</dt>
        <dd>${formatDuration(data.leaveMinutes)}</dd>
        ${
          data.classification === 'FULL'
            ? `<dt>勤務中に取る休憩</dt><dd>${formatDuration(data.breakDuringWork)}</dd>
               <dt>有給側で処理する休憩</dt><dd>${formatDuration(data.leaveSideBreak)}</dd>`
            : ''
        }
      </dl>
    </details>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// --- 設定画面 ---

function renderSettingsForm() {
  el.weekdaySettingsList.innerHTML = '';
  el.copySource.innerHTML = '';
  el.copyTargets.innerHTML = '';

  DISPLAY_ORDER.forEach((key) => {
    el.weekdaySettingsList.appendChild(buildWeekdayCard(key));

    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = WEEKDAY_LABELS[key];
    el.copySource.appendChild(opt);

    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = key;
    checkbox.name = 'copy-target';
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(WEEKDAY_LABELS[key]));
    el.copyTargets.appendChild(label);
  });
}

function buildWeekdayCard(key) {
  const day = settings[key] || { isWorkday: false, start: '09:00', end: '18:00', break: 60 };

  const card = document.createElement('div');
  card.className = 'weekday-card';
  card.dataset.weekday = key;

  card.innerHTML = `
    <div class="weekday-card-header">
      <h2>${WEEKDAY_LABELS[key]}</h2>
      <label class="workday-toggle">
        <input type="checkbox" id="wd-${key}-workday" ${day.isWorkday ? 'checked' : ''} />
        勤務日
      </label>
    </div>
    <div class="weekday-fields">
      <div class="field">
        <label for="wd-${key}-start">通常勤務開始</label>
        <input type="time" id="wd-${key}-start" value="${day.start}" />
      </div>
      <div class="field">
        <label for="wd-${key}-end">通常勤務終了</label>
        <input type="time" id="wd-${key}-end" value="${day.end}" />
      </div>
      <div class="field field-break">
        <label for="wd-${key}-break">通常休憩（分）</label>
        <input type="number" id="wd-${key}-break" min="0" step="5" value="${day.break}" />
      </div>
      <p class="weekday-standard-info" id="wd-${key}-standard-info"></p>
    </div>
  `;

  const startInput = card.querySelector(`#wd-${key}-start`);
  const endInput = card.querySelector(`#wd-${key}-end`);
  const breakInput = card.querySelector(`#wd-${key}-break`);
  const infoEl = card.querySelector(`#wd-${key}-standard-info`);

  function updateInfo() {
    const std = calcStandardMinutes({
      start: startInput.value,
      end: endInput.value,
      break: Number(breakInput.value) || 0,
    });
    if (Number.isFinite(std) && std >= 0) {
      infoEl.textContent = `所定労働時間：${formatDuration(std)}（自動計算）`;
    } else {
      infoEl.textContent = '通常勤務開始・終了・休憩を正しく入力してください。';
    }
  }
  [startInput, endInput, breakInput].forEach((input) => input.addEventListener('input', updateInfo));
  updateInfo();

  return card;
}

function getWeekdayFieldValues(key) {
  const workdayInput = document.getElementById(`wd-${key}-workday`);
  const startInput = document.getElementById(`wd-${key}-start`);
  const endInput = document.getElementById(`wd-${key}-end`);
  const breakInput = document.getElementById(`wd-${key}-break`);
  return {
    isWorkday: workdayInput.checked,
    start: startInput.value,
    end: endInput.value,
    break: Number(breakInput.value) || 0,
  };
}

function setWeekdayFieldValues(key, values) {
  document.getElementById(`wd-${key}-workday`).checked = !!values.isWorkday;
  document.getElementById(`wd-${key}-start`).value = values.start;
  document.getElementById(`wd-${key}-end`).value = values.end;
  document.getElementById(`wd-${key}-break`).value = values.break;
  document.getElementById(`wd-${key}-start`).dispatchEvent(new Event('input'));
}

el.btnCopyMonToWeekdays.addEventListener('click', () => {
  const source = getWeekdayFieldValues('mon');
  ['tue', 'wed', 'thu', 'fri'].forEach((key) => setWeekdayFieldValues(key, source));
});

el.btnCopyCustom.addEventListener('click', () => {
  const sourceKey = el.copySource.value;
  const source = getWeekdayFieldValues(sourceKey);
  const targets = Array.from(el.copyTargets.querySelectorAll('input[name="copy-target"]:checked')).map(
    (cb) => cb.value,
  );
  targets.forEach((key) => setWeekdayFieldValues(key, source));
});

el.settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const next = {};
  DISPLAY_ORDER.forEach((key) => {
    const values = getWeekdayFieldValues(key);
    if (values.isWorkday) {
      if (!values.start || !values.end) {
        alert(`${WEEKDAY_LABELS[key]}の通常勤務開始・終了を入力してください。`);
        throw new Error('validation stopped');
      }
      if (timeStringToMinutes(values.start) >= timeStringToMinutes(values.end)) {
        alert(`${WEEKDAY_LABELS[key]}の通常勤務終了は、開始より後の時刻にしてください。`);
        throw new Error('validation stopped');
      }
      const std = calcStandardMinutes(values);
      if (std < 0) {
        alert(`${WEEKDAY_LABELS[key]}の休憩時間が、勤務時間より長くなっています。`);
        throw new Error('validation stopped');
      }
    }
    next[key] = values;
  });
  settings = next;
  saveSettings(settings);
  showCalcView();
});

el.btnOpenSettings.addEventListener('click', showSettingsView);
el.btnBackToMain.addEventListener('click', showCalcView);
el.btnGotoSettingsFromWarning.addEventListener('click', showSettingsView);

// --- Service Worker登録（PWA・オフライン対応） ---

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {
      // オフライン対応ができないだけで、通常利用には支障がないため無視する
    });
  });
}

// --- 初期化 ---

(function init() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  el.leaveDate.value = `${yyyy}-${mm}-${dd}`;

  if (!hasUsableSettings(settings)) {
    showSettingsView();
  } else {
    showCalcView();
  }
})();
