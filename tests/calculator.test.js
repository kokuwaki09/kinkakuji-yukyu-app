import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculate,
  classifyPattern,
  timeStringToMinutes,
  minutesToTimeString,
  calcStandardMinutes,
  formatDuration,
} from '../js/calculator.js';
import { AUX_ITEM_NAMES, resolveRequiredBreakMinutes } from '../js/companyRules.js';

function t(hhmm) {
  return timeStringToMinutes(hhmm);
}

// 共通の「通常勤務」設定を作るヘルパー。
// 「勤務中に実際に取る休憩」はスタッフに質問せず、アプリ側が残る勤務時間から自動判定するため、
// calculate()への入力に breakDuringWork は存在しない。
function makeInput({ isWorkday = true, normalStart, normalEnd, normalBreak, leaveStart, leaveEnd } = {}) {
  return {
    isWorkday,
    normalStart: t(normalStart),
    normalEnd: t(normalEnd),
    normalBreak,
    leaveStart: t(leaveStart),
    leaveEnd: t(leaveEnd),
  };
}

// --- 基本ヘルパー関数 ---

test('timeStringToMinutes / minutesToTimeString の相互変換', () => {
  assert.equal(timeStringToMinutes('08:45'), 525);
  assert.equal(timeStringToMinutes('00:00'), 0);
  assert.equal(timeStringToMinutes('23:59'), 1439);
  assert.equal(minutesToTimeString(525), '08:45');
  assert.equal(minutesToTimeString(0), '00:00');
});

test('calcStandardMinutes: 拘束時間から所定労働時間を計算する', () => {
  const std = calcStandardMinutes({ start: '08:45', end: '17:45', break: 60 });
  assert.equal(std, 8 * 60); // 9時間拘束 - 60分休憩 = 8時間
});

test('formatDuration: 分を「◯時間◯分」表記にする', () => {
  assert.equal(formatDuration(180), '3時間');
  assert.equal(formatDuration(270), '4時間30分');
  assert.equal(formatDuration(45), '45分');
  assert.equal(formatDuration(0), '0分');
});

test('classifyPattern: AM/PM/FULL_DAY/MIDDLE/OUT_OF_RANGEの判定', () => {
  const normalStart = t('09:00');
  const normalEnd = t('18:00');
  assert.equal(
    classifyPattern({ normalStart, normalEnd, leaveStart: t('09:00'), leaveEnd: t('18:00') }),
    'FULL_DAY',
  );
  assert.equal(
    classifyPattern({ normalStart, normalEnd, leaveStart: t('09:00'), leaveEnd: t('14:00') }),
    'AM',
  );
  assert.equal(
    classifyPattern({ normalStart, normalEnd, leaveStart: t('13:00'), leaveEnd: t('18:00') }),
    'PM',
  );
  assert.equal(
    classifyPattern({ normalStart, normalEnd, leaveStart: t('12:00'), leaveEnd: t('13:00') }),
    'MIDDLE',
  );
  assert.equal(
    classifyPattern({ normalStart, normalEnd, leaveStart: t('08:00'), leaveEnd: t('13:00') }),
    'OUT_OF_RANGE',
  );
});

// --- 休憩自動判定ルール（companyRules.js）のテスト ---
// 会社ルール: 6時間以下→0分／6時間超8時間未満→45分／8時間以上→60分

test('resolveRequiredBreakMinutes: 境界値の判定', () => {
  assert.equal(resolveRequiredBreakMinutes(0), 0);
  assert.equal(resolveRequiredBreakMinutes(6 * 60), 0); // 6時間ちょうどは0分側
  assert.equal(resolveRequiredBreakMinutes(6 * 60 + 1), 45); // 6時間超
  assert.equal(resolveRequiredBreakMinutes(7 * 60), 45);
  assert.equal(resolveRequiredBreakMinutes(8 * 60 - 1), 45); // 8時間未満
  assert.equal(resolveRequiredBreakMinutes(8 * 60), 60); // 8時間ちょうどは60分側
  assert.equal(resolveRequiredBreakMinutes(9 * 60), 60);
});

// --- 仕様書 25章記載の13テストケース（休憩は自動判定に更新） ---

test('TC1: 8時間勤務・午後3時間有給 → 半日・14:45〜17:45', () => {
  const input = makeInput({
    normalStart: '08:45',
    normalEnd: '17:45',
    normalBreak: 60,
    leaveStart: '14:45',
    leaveEnd: '17:45',
  });
  const result = calculate(input);
  assert.equal(result.status, 'HALF');
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.HALF);
  assert.equal(minutesToTimeString(result.data.auxStart), '14:45');
  assert.equal(minutesToTimeString(result.data.auxEnd), '17:45');
  assert.equal(result.data.leaveMinutes, 180);
  assert.equal(result.data.actualMinutes, 300);
  assert.equal(result.data.actualMinutes + result.data.leaveMinutes, result.data.standardMinutes);
});

test('TC2: 8時間勤務・午前5時間有給 → 全日・休憩は自動的に0分と判定され60分取得者・補助窓6時間', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '14:00',
  });
  // 休憩を尋ねる中間ステップなしで、1回の計算で完結する
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.breakDuringWork, 0); // 残る勤務3時間 → 会社ルールで自動的に0分
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_60);
  assert.equal(minutesToTimeString(result.data.auxStart), '09:00');
  assert.equal(minutesToTimeString(result.data.auxEnd), '15:00');
  assert.equal(result.data.auxEnd - result.data.auxStart, 360); // 補助窓6時間
  assert.equal(result.data.leaveMinutes, 300);
  assert.equal(result.data.actualMinutes, 180);
});

test('TC3: 8時間勤務・午後5時間有給 → 全日・休憩は自動的に0分と判定され60分取得者・補助窓6時間', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '13:00',
    leaveEnd: '18:00',
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.breakDuringWork, 0);
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_60);
  assert.equal(minutesToTimeString(result.data.auxStart), '12:00');
  assert.equal(minutesToTimeString(result.data.auxEnd), '18:00');
  assert.equal(result.data.auxEnd - result.data.auxStart, 360);
  assert.equal(result.data.leaveMinutes, 300);
  assert.equal(result.data.actualMinutes, 180);
});

test('TC4: 所定8時間・有給4時間ちょうど → 半日（境界値）', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '13:00',
  });
  const result = calculate(input);
  assert.equal(result.status, 'HALF');
  assert.equal(result.data.leaveMinutes, 240);
});

test('TC5: 所定8時間・有給4時間30分 → 全日扱い（境界値）', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '13:30',
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.leaveMinutes, 270);
});

test('TC6: 通常休憩30分の曜日 → 全日扱いで自動的に有給側30分 → 30分取得者', () => {
  // 全日扱いでは残る勤務時間が必ず所定の半分未満（8時間勤務なら4時間未満）になるため、
  // 会社ルール上、勤務側で自動判定される休憩は常に0分になる。
  // したがって「有給側で処理する休憩」は通常休憩の値そのものになる。
  // ここでは通常休憩を30分に設定した曜日で検証する。
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '17:30', // 拘束8時間30分
    normalBreak: 30, // 所定8時間
    leaveStart: '09:00',
    leaveEnd: '14:00', // 有給5時間 → 全日扱い
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.breakDuringWork, 0);
  assert.equal(result.data.leaveSideBreak, 30);
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_30);
});

test('TC7: 通常休憩0分の曜日 → 全日扱いで自動的に有給側0分 → 00分取得者', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '17:00', // 拘束8時間
    normalBreak: 0, // 所定8時間（休憩なしの曜日）
    leaveStart: '09:00',
    leaveEnd: '14:00', // 有給5時間 → 全日扱い
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.breakDuringWork, 0);
  assert.equal(result.data.leaveSideBreak, 0);
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_00);
});

test('TC8: 通常休憩45分の曜日 → 全日扱いで有給側45分 → 補助項目名は未確定だが計算は成功', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '16:00',
    normalBreak: 45,
    leaveStart: '09:00',
    leaveEnd: '13:00',
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.breakDuringWork, 0);
  assert.equal(result.data.leaveSideBreak, 45);
  assert.equal(result.data.auxItemName, null);
  assert.equal(result.data.itemUndetermined, true);
  // 未確定でも他の数値は計算されている
  assert.equal(typeof result.data.auxStart, 'number');
  assert.equal(typeof result.data.auxEnd, 'number');
});

test('TC9: 8:45〜11:45の有給 → 3時間 → 30分単位として有効', () => {
  const input = makeInput({
    normalStart: '08:45',
    normalEnd: '17:45',
    normalBreak: 60,
    leaveStart: '08:45',
    leaveEnd: '11:45',
  });
  const result = calculate(input);
  assert.notEqual(result.status, 'ERROR');
  assert.equal(result.data.leaveMinutes, 180);
});

test('TC10: 8:45〜11:30の有給 → 2時間45分 → 30分単位ではないためエラー', () => {
  const input = makeInput({
    normalStart: '08:45',
    normalEnd: '17:45',
    normalBreak: 60,
    leaveStart: '08:45',
    leaveEnd: '11:30',
  });
  const result = calculate(input);
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /30分単位/);
});

test('TC11: 中抜け有給 → 未対応表示', () => {
  const input = makeInput({
    normalStart: '08:20',
    normalEnd: '17:20',
    normalBreak: 60,
    leaveStart: '12:00',
    leaveEnd: '13:00',
  });
  const result = calculate(input);
  assert.equal(result.status, 'MIDDLE_UNSUPPORTED');
});

test('TC12: 勤務なし曜日 → エラー', () => {
  const input = makeInput({
    isWorkday: false,
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '13:00',
  });
  const result = calculate(input);
  assert.equal(result.status, 'ERROR');
});

test('TC13: 全休（丸1日） → 対象外案内', () => {
  const input = makeInput({
    normalStart: '08:20',
    normalEnd: '17:20',
    normalBreak: 60,
    leaveStart: '08:20',
    leaveEnd: '17:20',
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL_DAY_OUT_OF_SCOPE');
});

// --- 追加のバリデーション・境界テスト ---

test('有給開始が有給終了以降 → エラー', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '14:00',
    leaveEnd: '14:00',
  });
  const result = calculate(input);
  assert.equal(result.status, 'ERROR');
});

test('有給の時間帯が通常勤務時間の範囲外 → エラー', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '08:00',
    leaveEnd: '13:00',
  });
  const result = calculate(input);
  assert.equal(result.status, 'ERROR');
});

test('有給時間が所定労働時間を超える → エラー', () => {
  // 拘束9時間・休憩60分 → 所定8時間。有給を8時間30分（丸1日にはならないAM側）申請しようとする入力。
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '17:30', // 通常勤務終了(18:00)より前なのでAM側部分有休として判定される
  });
  const result = calculate(input);
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /所定労働時間を超えて/);
});

test('自動判定された休憩が通常休憩を超える極端な所定労働時間 → エラー', () => {
  // 通常は起こらない組み合わせだが、防御的なガード処理を確認するための境界テスト。
  // 所定15時間・通常休憩30分という極端な曜日設定で、全日扱いの残る勤務時間が
  // 6〜8時間の範囲(自動判定45分)に入るよう有給時間を調整すると、
  // 45分 > 通常休憩30分 となり矛盾が生じる。
  const input = makeInput({
    normalStart: '00:00',
    normalEnd: '15:30',
    normalBreak: 30, // 所定900分(15時間)
    leaveStart: '00:00',
    leaveEnd: '08:00', // 有給8時間(480分) > 所定の半分(450分) → 全日扱い
  });
  const result = calculate(input);
  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /通常の休憩時間/);
});

test('実働時間+有給時間=所定労働時間の検算が常に成立する（HALF/FULLとも）', () => {
  const half = calculate(
    makeInput({
      normalStart: '08:20',
      normalEnd: '17:20',
      normalBreak: 60,
      leaveStart: '08:20',
      leaveEnd: '10:20',
    }),
  );
  assert.equal(half.data.actualMinutes + half.data.leaveMinutes, half.data.standardMinutes);

  const full = calculate(
    makeInput({
      normalStart: '09:00',
      normalEnd: '18:00',
      normalBreak: 60,
      leaveStart: '09:00',
      leaveEnd: '15:00',
    }),
  );
  assert.equal(full.data.actualMinutes + full.data.leaveMinutes, full.data.standardMinutes);
});

// --- スケジュール申請フィールドのテスト ---

test('TC-S1: 半日有休(PM側) 8:45〜17:45・休憩60・有給14:45〜17:45 → スケジュール8:45〜14:45・休憩60', () => {
  const input = makeInput({
    normalStart: '08:45',
    normalEnd: '17:45',
    normalBreak: 60,
    leaveStart: '14:45',
    leaveEnd: '17:45',
  });
  const result = calculate(input);
  assert.equal(result.status, 'HALF');
  assert.equal(result.data.pattern, 'PM');
  assert.equal(minutesToTimeString(result.data.scheduleStart), '08:45');
  assert.equal(minutesToTimeString(result.data.scheduleEnd), '14:45');
  assert.equal(result.data.scheduleBreak, 60);
  // 補助項目側は既存ロジックのまま変わらないことも確認
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.HALF);
  assert.equal(minutesToTimeString(result.data.auxStart), '14:45');
  assert.equal(minutesToTimeString(result.data.auxEnd), '17:45');
});

test('TC-S2: 全日扱い(AM側) 9:00〜18:00・休憩60・有給9:00〜14:00 → スケジュール15:00〜18:00・休憩0（自動判定）', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '14:00',
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.pattern, 'AM');
  assert.equal(minutesToTimeString(result.data.scheduleStart), '15:00');
  assert.equal(minutesToTimeString(result.data.scheduleEnd), '18:00');
  assert.equal(result.data.scheduleBreak, 0);
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_60);
  assert.equal(minutesToTimeString(result.data.auxStart), '09:00');
  assert.equal(minutesToTimeString(result.data.auxEnd), '15:00');
});

test('TC-S3: 全日扱い(PM側) 9:00〜18:00・休憩60・有給13:00〜18:00 → スケジュール9:00〜12:00・休憩0（自動判定）', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '13:00',
    leaveEnd: '18:00',
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.pattern, 'PM');
  assert.equal(minutesToTimeString(result.data.scheduleStart), '09:00');
  assert.equal(minutesToTimeString(result.data.scheduleEnd), '12:00');
  assert.equal(result.data.scheduleBreak, 0);
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_60);
  assert.equal(minutesToTimeString(result.data.auxStart), '12:00');
  assert.equal(minutesToTimeString(result.data.auxEnd), '18:00');
});

test('スケジュール実働時間+休憩 と 補助項目時間帯 は所定と有給に整合する（AM側・PM側とも）', () => {
  const am = calculate(
    makeInput({
      normalStart: '09:00',
      normalEnd: '18:00',
      normalBreak: 60,
      leaveStart: '09:00',
      leaveEnd: '14:00',
    }),
  );
  assert.equal(am.data.scheduleStart, am.data.auxEnd);
  assert.equal(am.data.scheduleEnd - am.data.scheduleStart - am.data.scheduleBreak, am.data.actualMinutes);

  const pm = calculate(
    makeInput({
      normalStart: '09:00',
      normalEnd: '18:00',
      normalBreak: 60,
      leaveStart: '13:00',
      leaveEnd: '18:00',
    }),
  );
  assert.equal(pm.data.scheduleEnd, pm.data.auxStart);
  assert.equal(pm.data.scheduleEnd - pm.data.scheduleStart - pm.data.scheduleBreak, pm.data.actualMinutes);
});
