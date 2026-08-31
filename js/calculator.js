// calculator.js
// 部分有休の補助項目計算ロジック（純粋関数のみ、DOM非依存）。
// ブラウザ（ESモジュール）とNode.jsテストの両方から同じコードを読み込む。
// 会社独自ルールの定数は companyRules.js に集約し、ここではロジックのみを扱う。

import {
  AUX_ITEM_NAMES,
  LEAVE_UNIT_MINUTES,
  resolveFullDayItemName,
  resolveRequiredBreakMinutes,
} from './companyRules.js';

/**
 * 'HH:MM' 形式の文字列を、0時からの分数に変換する。
 * @param {string} hhmm
 * @returns {number}
 */
export function timeStringToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h * 60 + min;
}

/**
 * 0時からの分数を 'HH:MM' 形式の文字列に変換する。
 * @param {number} minutes
 * @returns {string}
 */
export function minutesToTimeString(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 分数を「◯時間◯分」の日本語表記にする。
 * @param {number} minutes
 * @returns {string}
 */
export function formatDuration(minutes) {
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}分`;
  if (m === 0) return `${sign}${h}時間`;
  return `${sign}${h}時間${m}分`;
}

/**
 * その曜日の所定労働時間(分)を、拘束時間と通常休憩から計算する。
 * 所定労働時間 = 通常勤務終了 - 通常勤務開始 - 通常休憩
 * @param {{start:string, end:string, break:number}} weekday
 * @returns {number}
 */
export function calcStandardMinutes(weekday) {
  const start = timeStringToMinutes(weekday.start);
  const end = timeStringToMinutes(weekday.end);
  return end - start - weekday.break;
}

/**
 * 入力された有給の時間帯が、通常勤務時間帯のどこに位置するかを判定する。
 * - FULL_DAY: 有給が通常勤務の全域と一致（丸1日）
 * - AM: 有給が通常勤務開始から始まる（午前側の有給）
 * - PM: 有給が通常勤務終了まで続く（午後側の有給）
 * - MIDDLE: 有給がどちらの端にも接していない（中抜け）
 * - OUT_OF_RANGE: 有給が通常勤務時間の範囲外
 */
export function classifyPattern({ normalStart, normalEnd, leaveStart, leaveEnd }) {
  if (leaveStart < normalStart || leaveEnd > normalEnd) return 'OUT_OF_RANGE';
  if (leaveStart === normalStart && leaveEnd === normalEnd) return 'FULL_DAY';
  if (leaveStart === normalStart && leaveEnd < normalEnd) return 'AM';
  if (leaveStart > normalStart && leaveEnd === normalEnd) return 'PM';
  return 'MIDDLE';
}

/**
 * 部分有休の補助項目申請の内容を計算する。
 *
 * @param {object} input
 * @param {boolean} input.isWorkday - 対象曜日が勤務日かどうか
 * @param {number} input.normalStart - 通常勤務開始（分）
 * @param {number} input.normalEnd - 通常勤務終了（分）
 * @param {number} input.normalBreak - 通常休憩時間（分）
 * @param {number} input.leaveStart - 有給開始（分）
 * @param {number} input.leaveEnd - 有給終了（分）
 *
 * 「勤務中に実際に取る休憩」はスタッフに質問しない。勤革時マニュアル09〜11の確認により、
 * スケジュール申請・補助項目申請のいずれにも「本人が休憩時間を選ぶ」手順は存在せず、
 * 残る勤務時間から会社ルール（companyRules.js の resolveRequiredBreakMinutes）で
 * 自動的に必要休憩を判定する方針とした。
 *
 * @returns {object} 判定結果。statusは以下のいずれか。
 *   - 'ERROR': 入力エラー。message に日本語のエラー文を含む
 *   - 'FULL_DAY_OUT_OF_SCOPE': 丸1日の有給（このツールの対象外）
 *   - 'MIDDLE_UNSUPPORTED': 中抜け有給（第1版では未対応）
 *   - 'HALF': 半日有休として計算完了
 *   - 'FULL': 全日扱いとして計算完了（補助項目名が未確定の場合あり）
 */
export function calculate(input) {
  const { isWorkday, normalStart, normalEnd, normalBreak, leaveStart, leaveEnd } = input;

  if (!isWorkday) {
    return {
      status: 'ERROR',
      message: 'この曜日は「勤務なし」に設定されています。設定内容をご確認ください。',
    };
  }

  if (
    !Number.isFinite(normalStart) ||
    !Number.isFinite(normalEnd) ||
    !Number.isFinite(normalBreak)
  ) {
    return {
      status: 'ERROR',
      message: 'この曜日の通常勤務設定が正しくありません。設定画面をご確認ください。',
    };
  }

  if (!Number.isFinite(leaveStart) || !Number.isFinite(leaveEnd)) {
    return {
      status: 'ERROR',
      message: '有給開始・有給終了の時刻を入力してください。',
    };
  }

  if (leaveStart >= leaveEnd) {
    return {
      status: 'ERROR',
      message: '有給終了は、有給開始より後の時刻にしてください。',
    };
  }

  const pattern = classifyPattern({ normalStart, normalEnd, leaveStart, leaveEnd });

  if (pattern === 'OUT_OF_RANGE') {
    return {
      status: 'ERROR',
      message: '有給の時間帯が、通常勤務時間の範囲外です。通常勤務時間内で入力してください。',
    };
  }

  if (pattern === 'FULL_DAY') {
    return {
      status: 'FULL_DAY_OUT_OF_SCOPE',
      message: '1日すべての有給は、この計算ツールを使う必要はありません。',
    };
  }

  if (pattern === 'MIDDLE') {
    return {
      status: 'MIDDLE_UNSUPPORTED',
      message: '勤務の途中だけ取得する有給は、現在未対応です。所長・資料でご確認ください。',
    };
  }

  const leaveMinutes = leaveEnd - leaveStart;

  if (leaveMinutes % LEAVE_UNIT_MINUTES !== 0) {
    return {
      status: 'ERROR',
      message: `有給時間は30分単位にしてください（現在の入力: ${formatDuration(leaveMinutes)}）。`,
    };
  }

  const standardMinutes = normalEnd - normalStart - normalBreak;

  if (leaveMinutes > standardMinutes) {
    return {
      status: 'ERROR',
      message: '有給時間が所定労働時間を超えています。入力内容をご確認ください。',
    };
  }

  const actualMinutes = standardMinutes - leaveMinutes;
  const isHalf = leaveMinutes <= standardMinutes / 2;

  if (isHalf) {
    // 半日有休では、補助項目の時間帯＝実際の有給取得時間帯。
    // スケジュール（勤務）側は、通常勤務時間から有給時間帯を除いた側になる。
    // 通常休憩は勤務側で処理されるため、スケジュールの休憩時間＝通常休憩時間とする。
    let scheduleStart;
    let scheduleEnd;
    if (pattern === 'AM') {
      scheduleStart = leaveEnd;
      scheduleEnd = normalEnd;
    } else {
      // pattern === 'PM'
      scheduleStart = normalStart;
      scheduleEnd = leaveStart;
    }

    return {
      status: 'HALF',
      data: {
        classification: 'HALF',
        pattern,
        leaveMinutes,
        actualMinutes,
        standardMinutes,
        auxItemName: AUX_ITEM_NAMES.HALF,
        auxStart: leaveStart,
        auxEnd: leaveEnd,
        scheduleStart,
        scheduleEnd,
        scheduleBreak: normalBreak,
      },
    };
  }

  // ここから全日扱い（全日有休扱い）。
  // 「全日扱い」は有給時間が所定の半分を超える場合に限られるため、残る勤務時間(actualMinutes)は
  // 必ず所定の半分未満になる。会社ルール(6時間以下→休憩0分)の範囲に収まるため、
  // 実務上ここは常に0分になりうるが、将来所定労働時間が長いケースにも対応できるよう
  // 一般式のまま自動判定する。
  const breakDuringWork = resolveRequiredBreakMinutes(actualMinutes);

  if (breakDuringWork > normalBreak) {
    return {
      status: 'ERROR',
      message: `自動判定された勤務中の休憩時間（${formatDuration(breakDuringWork)}）が、通常の休憩時間（${formatDuration(normalBreak)}）を超えています。設定内容をご確認ください。`,
    };
  }

  const leaveSideBreak = normalBreak - breakDuringWork;

  let auxStart;
  let auxEnd;
  if (pattern === 'AM') {
    auxStart = normalStart;
    auxEnd = leaveEnd + leaveSideBreak;
  } else {
    // pattern === 'PM'
    auxStart = leaveStart - leaveSideBreak;
    auxEnd = normalEnd;
  }

  const auxItemName = resolveFullDayItemName(leaveSideBreak);

  // スケジュール（勤務）側は、補助項目の時間帯の反対側。休憩は勤務中に実際に取る休憩時間を使う。
  let scheduleStart;
  let scheduleEnd;
  if (pattern === 'AM') {
    scheduleStart = auxEnd;
    scheduleEnd = normalEnd;
  } else {
    // pattern === 'PM'
    scheduleStart = normalStart;
    scheduleEnd = auxStart;
  }

  return {
    status: 'FULL',
    data: {
      classification: 'FULL',
      pattern,
      leaveMinutes,
      actualMinutes,
      standardMinutes,
      breakDuringWork,
      leaveSideBreak,
      auxItemName,
      auxStart,
      auxEnd,
      scheduleStart,
      scheduleEnd,
      scheduleBreak: breakDuringWork,
      itemUndetermined: auxItemName === null,
    },
  };
}
