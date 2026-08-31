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
import { AUX_ITEM_NAMES } from '../js/companyRules.js';

function t(hhmm) {
  return timeStringToMinutes(hhmm);
}

// 共通の「通常勤務」設定を作るヘルパー
function makeInput({
  isWorkday = true,
  normalStart,
  normalEnd,
  normalBreak,
  leaveStart,
  leaveEnd,
  breakDuringWork,
} = {}) {
  return {
    isWorkday,
    normalStart: t(normalStart),
    normalEnd: t(normalEnd),
    normalBreak,
    leaveStart: t(leaveStart),
    leaveEnd: t(leaveEnd),
    breakDuringWork: breakDuringWork === undefined ? null : breakDuringWork,
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

// --- 仕様書 25章記載の13テストケース ---

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

test('TC2: 8時間勤務・午前5時間有給・休憩0分 → 全日・60分取得者・補助窓6時間', () => {
  const partial = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '14:00',
  });
  const needsBreak = calculate(partial);
  assert.equal(needsBreak.status, 'NEEDS_BREAK_INPUT');

  const full = calculate({ ...partial, breakDuringWork: 0 });
  assert.equal(full.status, 'FULL');
  assert.equal(full.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_60);
  assert.equal(minutesToTimeString(full.data.auxStart), '09:00');
  assert.equal(minutesToTimeString(full.data.auxEnd), '15:00');
  assert.equal(full.data.auxEnd - full.data.auxStart, 360); // 補助窓6時間
  assert.equal(full.data.leaveMinutes, 300);
  assert.equal(full.data.actualMinutes, 180);
});

test('TC3: 8時間勤務・午後5時間有給・休憩0分 → 全日・60分取得者・補助窓6時間', () => {
  const partial = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '13:00',
    leaveEnd: '18:00',
  });
  const full = calculate({ ...partial, breakDuringWork: 0 });
  assert.equal(full.status, 'FULL');
  assert.equal(full.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_60);
  assert.equal(minutesToTimeString(full.data.auxStart), '12:00');
  assert.equal(minutesToTimeString(full.data.auxEnd), '18:00');
  assert.equal(full.data.auxEnd - full.data.auxStart, 360);
  assert.equal(full.data.leaveMinutes, 300);
  assert.equal(full.data.actualMinutes, 180);
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
    breakDuringWork: 0,
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.leaveMinutes, 270);
});

test('TC6: 通常休憩60分・勤務中休憩30分 → 有給側30分 → 30分取得者', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '14:00',
    breakDuringWork: 30,
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.leaveSideBreak, 30);
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_30);
});

test('TC7: 通常休憩60分・勤務中休憩60分 → 有給側0分 → 00分取得者', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '14:00',
    breakDuringWork: 60,
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
  assert.equal(result.data.leaveSideBreak, 0);
  assert.equal(result.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_00);
});

test('TC8: 通常休憩45分・勤務中休憩0分 → 有給側45分 → 補助項目名は未確定だが計算は成功', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '16:00',
    normalBreak: 45,
    leaveStart: '09:00',
    leaveEnd: '13:00',
    breakDuringWork: 0,
  });
  const result = calculate(input);
  assert.equal(result.status, 'FULL');
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

test('勤務中休憩が通常休憩を超える → エラー', () => {
  const input = makeInput({
    normalStart: '09:00',
    normalEnd: '18:00',
    normalBreak: 60,
    leaveStart: '09:00',
    leaveEnd: '14:00',
    breakDuringWork: 90,
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
      breakDuringWork: 0,
    }),
  );
  assert.equal(full.data.actualMinutes + full.data.leaveMinutes, full.data.standardMinutes);
});
