// storage.js
// 曜日別の通常勤務設定を、端末内(localStorage)だけに保存・読込する。
// 外部へは一切送信しない。

export const STORAGE_KEY = 'yukyu-kantan-keisan.settings.v1';

export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const WEEKDAY_LABELS = {
  sun: '日曜日',
  mon: '月曜日',
  tue: '火曜日',
  wed: '水曜日',
  thu: '木曜日',
  fri: '金曜日',
  sat: '土曜日',
};

/**
 * 空の設定オブジェクトを作る（全曜日「勤務なし」・時刻未設定）。
 */
export function createEmptySettings() {
  const settings = {};
  for (const key of WEEKDAY_KEYS) {
    settings[key] = {
      isWorkday: false,
      start: '09:00',
      end: '18:00',
      break: 60,
    };
  }
  return settings;
}

/**
 * localStorageから設定を読み込む。保存されていない・壊れている場合はnullを返す。
 */
export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * 設定をlocalStorageへ保存する。
 */
export function saveSettings(settings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * 設定が「最低限使える状態」かどうかを判定する。
 * 少なくとも1曜日が勤務日として設定されていることを条件とする。
 */
export function hasUsableSettings(settings) {
  if (!settings) return false;
  return WEEKDAY_KEYS.some((key) => settings[key] && settings[key].isWorkday);
}

/**
 * 'YYYY-MM-DD' 形式の日付文字列から、曜日キー(sun〜sat)を求める。
 * タイムゾーンずれを避けるため、UTCパースではなくローカル日時として構築する。
 */
export function weekdayKeyFromDateString(dateString) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const date = new Date(year, month, day);
  if (Number.isNaN(date.getTime())) return null;
  return WEEKDAY_KEYS[date.getDay()];
}
