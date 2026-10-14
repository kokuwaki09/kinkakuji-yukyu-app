import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculate,
  calculateFromRealTimes,
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
// 会社確認済みルール: 「6時間以上勤務の場合は45分、8時間勤務の場合は60分」
// つまり 6時間未満→0分／6時間以上8時間未満→45分／8時間以上→60分（ちょうど6時間勤務は45分側）

test('resolveRequiredBreakMinutes: 境界値の判定', () => {
  assert.equal(resolveRequiredBreakMinutes(0), 0);
  assert.equal(resolveRequiredBreakMinutes(359), 0); // 6時間未満
  assert.equal(resolveRequiredBreakMinutes(360), 45); // 6時間ちょうどは45分側
  assert.equal(resolveRequiredBreakMinutes(361), 45);
  assert.equal(resolveRequiredBreakMinutes(479), 45); // 8時間未満
  assert.equal(resolveRequiredBreakMinutes(480), 60); // 8時間ちょうどは60分側
  assert.equal(resolveRequiredBreakMinutes(9 * 60), 60);
});

test('不変条件: 全日扱いでは actualMinutes は所定労働時間の半分未満になるため、480分超の分岐には通常到達しない', () => {
  // 「全日扱い(FULL)」は leaveMinutes > standardMinutes/2 の場合に限られるため、
  // actualMinutes(= standardMinutes - leaveMinutes) は必ず standardMinutes/2 未満になる。
  // このアプリが想定する通常所定労働時間は最大8時間(480分)のため、
  // actualMinutes は常に240分未満となり、resolveRequiredBreakMinutes の
  // 「480分以上→60分」の分岐には実務上到達しない（常に0分側になる）。
  const scenarios = [
    { normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, leaveStart: '09:00', leaveEnd: '14:00' }, // 所定8h
    { normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, leaveStart: '13:00', leaveEnd: '18:00' }, // 所定8h
    { normalStart: '08:45', normalEnd: '17:45', normalBreak: 60, leaveStart: '08:45', leaveEnd: '13:45' }, // 所定8h
    { normalStart: '09:00', normalEnd: '17:00', normalBreak: 0, leaveStart: '09:00', leaveEnd: '14:00' }, // 所定8h(休憩なし)
    { normalStart: '09:00', normalEnd: '17:30', normalBreak: 30, leaveStart: '09:00', leaveEnd: '14:00' }, // 所定8h
  ];

  for (const scenario of scenarios) {
    const result = calculate(makeInput(scenario));
    assert.equal(result.status, 'FULL');
    assert.ok(result.data.standardMinutes <= 8 * 60); // このアプリが想定する所定労働時間の上限
    assert.ok(result.data.actualMinutes < result.data.standardMinutes / 2);
    assert.ok(result.data.actualMinutes < 8 * 60); // 480分未満 → 「480分以上」の分岐には到達しない
    assert.equal(result.data.breakDuringWork, 0); // 実務上は常に0分側に判定される
  }
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

// --- 半日有休の境界（会社確認済み・R8.7就業規則第46条） ---
//
// 就業規則第46条は「午前：始業から4時間／午後：終業までさかのぼって4時間、ただし所定6時間の
// 者は3時間」と定めるが、これは個別パターンごとの固定値ではなく、「その日の所定労働時間の
// 半分以内は半日有休、半分を超えると全日扱い」という一般ルールの結果であることを会社に確認済み
// （8時間÷2＝4時間、6時間÷2＝3時間は、この一般ルールからの帰結）。
// 既存の calculate() の isHalf = leaveMinutes <= standardMinutes / 2 は、この確認済みルールと
// 一致しているため変更しない。以下は、就業規則に記載されている訪問職員の勤務パターン
// （A〜F・J・K・L・M・N）それぞれについて、半日/全日の境界が会社確認どおりになることを
// 固定する回帰テスト。
test('半日境界(会社確認済み): A〜F 所定8時間 → 4時間以内は半日、超えると全日', () => {
  const half = calculate(makeInput({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, leaveStart: '14:00', leaveEnd: '18:00' }));
  assert.equal(half.status, 'HALF');
  assert.equal(half.data.leaveMinutes, 240); // 4時間ちょうど

  const full = calculate(makeInput({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, leaveStart: '13:30', leaveEnd: '18:00' }));
  assert.equal(full.status, 'FULL');
  assert.equal(full.data.leaveMinutes, 270); // 4時間30分
});

test('半日境界(会社確認済み): J(8:30〜14:30・休憩なし) 所定6時間 → 3時間以内は半日、超えると全日', () => {
  const half = calculate(makeInput({ normalStart: '08:30', normalEnd: '14:30', normalBreak: 0, leaveStart: '11:30', leaveEnd: '14:30' }));
  assert.equal(half.status, 'HALF');
  assert.equal(half.data.leaveMinutes, 180); // 3時間ちょうど

  const full = calculate(makeInput({ normalStart: '08:30', normalEnd: '14:30', normalBreak: 0, leaveStart: '11:00', leaveEnd: '14:30' }));
  assert.equal(full.status, 'FULL');
  assert.equal(full.data.leaveMinutes, 210); // 3時間30分
});

test('半日境界(会社確認済み): K(9:00〜15:00・休憩なし) 所定6時間 → 3時間以内は半日、超えると全日', () => {
  const half = calculate(makeInput({ normalStart: '09:00', normalEnd: '15:00', normalBreak: 0, leaveStart: '12:00', leaveEnd: '15:00' }));
  assert.equal(half.status, 'HALF');
  assert.equal(half.data.leaveMinutes, 180);

  const full = calculate(makeInput({ normalStart: '09:00', normalEnd: '15:00', normalBreak: 0, leaveStart: '11:30', leaveEnd: '15:00' }));
  assert.equal(full.status, 'FULL');
  assert.equal(full.data.leaveMinutes, 210);
});

test('半日境界(会社確認済み): L(9:00〜12:00・休憩なし) 所定3時間 → 1時間30分以内は半日、超えると全日', () => {
  const half = calculate(makeInput({ normalStart: '09:00', normalEnd: '12:00', normalBreak: 0, leaveStart: '10:30', leaveEnd: '12:00' }));
  assert.equal(half.status, 'HALF');
  assert.equal(half.data.leaveMinutes, 90); // 1時間30分ちょうど

  const full = calculate(makeInput({ normalStart: '09:00', normalEnd: '12:00', normalBreak: 0, leaveStart: '10:00', leaveEnd: '12:00' }));
  assert.equal(full.status, 'FULL');
  assert.equal(full.data.leaveMinutes, 120); // 2時間
});

test('半日境界(会社確認済み): M(9:00〜16:00・休憩45分) 所定6時間15分 → 境界は3時間7分30秒(30分単位では跨げないため3時間/3時間30分で確認)', () => {
  // 境界(187.5分)はLEAVE_UNIT_MINUTES(30分)の倍数ではないため、ちょうど境界の値は
  // 入力できない。境界を挟む2つの有給時間(3時間/3時間30分)で半日・全日が
  // 正しく切り替わることを確認する。
  const half = calculate(makeInput({ normalStart: '09:00', normalEnd: '16:00', normalBreak: 45, leaveStart: '13:00', leaveEnd: '16:00' }));
  assert.equal(half.status, 'HALF');
  assert.equal(half.data.leaveMinutes, 180); // 3時間 < 3時間7分30秒

  const full = calculate(makeInput({ normalStart: '09:00', normalEnd: '16:00', normalBreak: 45, leaveStart: '12:30', leaveEnd: '16:00' }));
  assert.equal(full.status, 'FULL');
  assert.equal(full.data.leaveMinutes, 210); // 3時間30分 > 3時間7分30秒
});

test('半日境界(会社確認済み): N(9:00〜17:00・休憩60分) 所定7時間 → 3時間30分以内は半日、超えると全日', () => {
  const half = calculate(makeInput({ normalStart: '09:00', normalEnd: '17:00', normalBreak: 60, leaveStart: '13:30', leaveEnd: '17:00' }));
  assert.equal(half.status, 'HALF');
  assert.equal(half.data.leaveMinutes, 210); // 3時間30分ちょうど

  const full = calculate(makeInput({ normalStart: '09:00', normalEnd: '17:00', normalBreak: 60, leaveStart: '13:00', leaveEnd: '17:00' }));
  assert.equal(full.status, 'FULL');
  assert.equal(full.data.leaveMinutes, 240); // 4時間
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

// --- calculateFromRealTimes(): 「現実に働く・休む時刻」からの計算 ---
//
// 利用者には「実際に休み始める・休みが終わる時刻」をそのまま入力してもらい、
// 会社確認済みの計算ロジック(calculate())はそのまま温存した上で、
// その手前で「現実の時刻 → calculate()が期待する申請用の時刻」へ変換する層。
// 現実の勤務時間の長さだけでは半休/全日扱いを一意に決められない範囲(空白地帯)でのみ、
// 休憩を取ったかどうかの追加確認(tookBreakDuringWork)が必要になる。

function realBase({ isWorkday = true, normalStart, normalEnd, normalBreak, realLeaveStart, realLeaveEnd, tookBreakDuringWork } = {}) {
  return {
    isWorkday,
    normalStart: t(normalStart),
    normalEnd: t(normalEnd),
    normalBreak,
    realLeaveStart: t(realLeaveStart),
    realLeaveEnd: t(realLeaveEnd),
    tookBreakDuringWork,
  };
}

test('現実時刻入力: 9:00-18:00・休憩60分で9:30から休む(実質30分勤務) → 質問なしでFULL、実際の時刻のまま申請できる', () => {
  const r = calculateFromRealTimes(
    realBase({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, realLeaveStart: '09:30', realLeaveEnd: '18:00' }),
  );
  assert.equal(r.status, 'FULL');
  assert.equal(minutesToTimeString(r.data.scheduleStart), '09:00');
  assert.equal(minutesToTimeString(r.data.scheduleEnd), '09:30');
  assert.equal(r.data.scheduleBreak, 0);
  assert.equal(minutesToTimeString(r.data.auxStart), '09:30');
  assert.equal(minutesToTimeString(r.data.auxEnd), '18:00');
  assert.equal(r.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_60);
  assert.equal(r.data.actualMinutes, 30);
  assert.equal(r.data.deadZoneAdjustment, false);
});

test('現実時刻入力: 9:00-18:00・休憩60分で12:00から休む → 質問なしでFULL、補助項目が実際の開始時刻(12:00)と一致する', () => {
  const r = calculateFromRealTimes(
    realBase({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, realLeaveStart: '12:00', realLeaveEnd: '18:00' }),
  );
  assert.equal(r.status, 'FULL');
  assert.equal(minutesToTimeString(r.data.scheduleStart), '09:00');
  assert.equal(minutesToTimeString(r.data.scheduleEnd), '12:00');
  assert.equal(r.data.scheduleBreak, 0);
  assert.equal(minutesToTimeString(r.data.auxStart), '12:00');
  assert.equal(minutesToTimeString(r.data.auxEnd), '18:00');
  assert.equal(r.data.deadZoneAdjustment, false);
});

test('現実時刻入力: TC1相当(8:45-14:45勤務・14:45-17:45休み) → calculate()直接呼び出しと同じ結果を再現する(回帰確認)', () => {
  const direct = calculate({
    isWorkday: true,
    normalStart: t('08:45'),
    normalEnd: t('17:45'),
    normalBreak: 60,
    leaveStart: t('14:45'),
    leaveEnd: t('17:45'),
  });
  const viaReal = calculateFromRealTimes(
    realBase({ normalStart: '08:45', normalEnd: '17:45', normalBreak: 60, realLeaveStart: '14:45', realLeaveEnd: '17:45' }),
  );
  assert.equal(viaReal.status, 'HALF');
  assert.equal(viaReal.status, direct.status);
  assert.equal(viaReal.data.scheduleStart, direct.data.scheduleStart);
  assert.equal(viaReal.data.scheduleEnd, direct.data.scheduleEnd);
  assert.equal(viaReal.data.scheduleBreak, direct.data.scheduleBreak);
  assert.equal(viaReal.data.actualMinutes, direct.data.actualMinutes);
  assert.equal(viaReal.data.deadZoneAdjustment, false);
});

test('現実時刻入力: TC2相当(AM側, 9:00-14:00休み) → calculate()直接呼び出しと同じ結果を再現する(回帰確認)', () => {
  const direct = calculate({
    isWorkday: true,
    normalStart: t('09:00'),
    normalEnd: t('18:00'),
    normalBreak: 60,
    leaveStart: t('09:00'),
    leaveEnd: t('14:00'),
  });
  // 実際に職場に戻った時刻は15:00(実働3時間=180分、空白地帯の外)。
  // legacy変換後の有給終了は14:00となり、direct呼び出しのTC2(leaveEnd=14:00)と一致する。
  // (実際の復帰が14:00だと、その4時間に通常休憩を含むかどうかが一意に決まらず、
  //  空白地帯の確認が必要になってしまうため、ここでは空白地帯の外側の時刻で検証する)
  const viaReal = calculateFromRealTimes(
    realBase({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, realLeaveStart: '09:00', realLeaveEnd: '15:00' }),
  );
  assert.equal(viaReal.status, 'FULL');
  assert.equal(viaReal.data.scheduleStart, direct.data.scheduleStart);
  assert.equal(viaReal.data.scheduleEnd, direct.data.scheduleEnd);
  assert.equal(viaReal.data.auxStart, direct.data.auxStart);
  assert.equal(viaReal.data.auxEnd, direct.data.auxEnd);
  assert.equal(viaReal.data.deadZoneAdjustment, false);
});

test('空白地帯: 9:00-18:00・休憩60分で13:30まで在席 → 回答なしではNEEDS_BREAK_CONFIRMATIONを返す', () => {
  const r = calculateFromRealTimes(
    realBase({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, realLeaveStart: '13:30', realLeaveEnd: '18:00' }),
  );
  assert.equal(r.status, 'NEEDS_BREAK_CONFIRMATION');
  assert.equal(r.data.pattern, 'PM');
  assert.equal(minutesToTimeString(r.data.workWindowStart), '09:00');
  assert.equal(minutesToTimeString(r.data.workWindowEnd), '13:30');
  assert.equal(r.data.normalBreak, 60);
});

test('空白地帯: 「休憩を取った」と回答 → 全日扱い、スケジュールは実際の在籍時刻のまま・休憩は通常休憩を明示、補助項目は休憩0分(00分取得者)', () => {
  // 勤革時への実際の入力方法として現場で確認された内容: スケジュール申請は実際に職場にいた
  // 時刻をずらさずそのまま使い、通常休憩はスケジュール側に明示する。休憩はスケジュール側で
  // 処理済みのため、補助項目側の休憩は0分(全日有休・休憩00分取得者)になる。
  const r = calculateFromRealTimes(
    realBase({
      normalStart: '09:00', normalEnd: '18:00', normalBreak: 60,
      realLeaveStart: '13:30', realLeaveEnd: '18:00', tookBreakDuringWork: true,
    }),
  );
  assert.equal(r.status, 'FULL');
  assert.equal(r.data.actualMinutes, 210);
  assert.equal(r.data.leaveMinutes, 270);
  assert.equal(minutesToTimeString(r.data.scheduleStart), '09:00');
  assert.equal(minutesToTimeString(r.data.scheduleEnd), '13:30');
  assert.equal(r.data.scheduleBreak, 60);
  assert.equal(minutesToTimeString(r.data.auxStart), '13:30');
  assert.equal(minutesToTimeString(r.data.auxEnd), '18:00');
  assert.equal(r.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_00);
  assert.equal(r.data.leaveSideBreak, 0);
  assert.equal(r.data.deadZoneAdjustment, true);
});

test('空白地帯: 「休憩を取った」と回答した場合も、有給時間が30分単位でなければ既存ルールどおりERRORになる', () => {
  // calculate()を経由しない結果合成経路でも、既存の「有給は30分単位」ルール(calculate()側)を
  // 迂回してしまわないことを確認する回帰テスト。
  const r = calculateFromRealTimes(
    realBase({
      normalStart: '09:00', normalEnd: '18:00', normalBreak: 60,
      realLeaveStart: '13:07', realLeaveEnd: '18:00', tookBreakDuringWork: true,
    }),
  );
  assert.equal(r.status, 'ERROR');
  assert.match(r.message, /30分単位/);
});

test('空白地帯: 「休憩を取っていない」と回答 → 半日有休、スケジュールは実際の在籍時刻のまま・休憩0分', () => {
  // 勤革時への実際の入力方法として現場で確認された内容: スケジュールは実際に職場にいた時刻
  // (9:00〜13:00)のまま・休憩0分とし、補助項目(14:30〜18:00)との間の1時間は明示的には
  // 埋めない。判定・補助項目の時間帯・有給時間は従来どおりの合成ロジックで決める。
  const r = calculateFromRealTimes(
    realBase({
      normalStart: '09:00', normalEnd: '18:00', normalBreak: 60,
      realLeaveStart: '13:30', realLeaveEnd: '18:00', tookBreakDuringWork: false,
    }),
  );
  assert.equal(r.status, 'HALF');
  assert.equal(r.data.actualMinutes, 270);
  assert.equal(r.data.leaveMinutes, 210);
  assert.equal(minutesToTimeString(r.data.scheduleStart), '09:00');
  assert.equal(minutesToTimeString(r.data.scheduleEnd), '13:30');
  assert.equal(r.data.scheduleBreak, 0);
  assert.equal(minutesToTimeString(r.data.auxStart), '14:30');
  assert.equal(minutesToTimeString(r.data.auxEnd), '18:00');
  assert.equal(r.data.auxItemName, AUX_ITEM_NAMES.HALF);
  assert.equal(r.data.deadZoneAdjustment, true);
});

test('空白地帯: AM側でも同じ考え方が成立する(PM側と対称)', () => {
  // AM側: 有給が9:00開始、実際の勤務が終業側に残るケース。13:30まで休み(=終業側に4時間30分勤務)は
  // PM側の実働4時間30分ケースと対称になるよう、9:00-18:00・休憩60分で有給9:00-13:30を試す。
  const rTaken = calculateFromRealTimes(
    realBase({
      normalStart: '09:00', normalEnd: '18:00', normalBreak: 60,
      realLeaveStart: '09:00', realLeaveEnd: '13:30', tookBreakDuringWork: true,
    }),
  );
  assert.equal(rTaken.status, 'FULL');
  assert.equal(rTaken.data.actualMinutes, 210);
  assert.equal(minutesToTimeString(rTaken.data.scheduleStart), '13:30');
  assert.equal(minutesToTimeString(rTaken.data.scheduleEnd), '18:00');
  assert.equal(rTaken.data.scheduleBreak, 60);
  assert.equal(minutesToTimeString(rTaken.data.auxStart), '09:00');
  assert.equal(minutesToTimeString(rTaken.data.auxEnd), '13:30');
  assert.equal(rTaken.data.auxItemName, AUX_ITEM_NAMES.FULL_BREAK_00);

  const rNotTaken = calculateFromRealTimes(
    realBase({
      normalStart: '09:00', normalEnd: '18:00', normalBreak: 60,
      realLeaveStart: '09:00', realLeaveEnd: '13:30', tookBreakDuringWork: false,
    }),
  );
  assert.equal(rNotTaken.status, 'HALF');
  assert.equal(rNotTaken.data.actualMinutes, 270);
  assert.equal(minutesToTimeString(rNotTaken.data.scheduleStart), '13:30');
  assert.equal(minutesToTimeString(rNotTaken.data.scheduleEnd), '18:00');
  assert.equal(rNotTaken.data.scheduleBreak, 0);
});

test('空白地帯: 境界値ちょうど(deadZoneStart)は質問が必要、1分外側(deadZoneStart-1)は自動判定される', () => {
  // 所定8時間(480分)・休憩60分 → 空白地帯は実働換算で240分〜299分(= deadZoneStart=240, deadZoneEnd=300)
  const atStart = calculateFromRealTimes(
    realBase({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, realLeaveStart: '13:00', realLeaveEnd: '18:00' }),
  );
  assert.equal(atStart.status, 'NEEDS_BREAK_CONFIRMATION'); // workMinutesPresent=240=deadZoneStart

  // 空白地帯のすぐ外側は、有給は30分単位という既存ルールと矛盾しない実在しうる入力(30分単位)で確認する。
  // (1分単位でdeadZoneStart-1を試すと、変換後の有給時間が30分単位にならずERRORになるのは別ルールの話であり、
  //  このテストが確認したい「空白地帯の外では自動判定される」という性質とは無関係のため対象にしない)
  const justBelow = calculateFromRealTimes(
    realBase({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, realLeaveStart: '12:30', realLeaveEnd: '18:00' }),
  );
  assert.equal(justBelow.status, 'FULL'); // workMinutesPresent=210 < deadZoneStart(240)
  assert.equal(justBelow.data.deadZoneAdjustment, false);

  const atEnd = calculateFromRealTimes(
    realBase({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, realLeaveStart: '13:59', realLeaveEnd: '18:00' }),
  );
  assert.equal(atEnd.status, 'NEEDS_BREAK_CONFIRMATION'); // workMinutesPresent=299 < deadZoneEnd(300)

  const justAbove = calculateFromRealTimes(
    realBase({ normalStart: '09:00', normalEnd: '18:00', normalBreak: 60, realLeaveStart: '14:00', realLeaveEnd: '18:00' }),
  );
  assert.equal(justAbove.status, 'HALF'); // workMinutesPresent=300=deadZoneEnd → 自動HALF
  assert.equal(justAbove.data.deadZoneAdjustment, false);
});

test('通常休憩0分の曜日には空白地帯が存在しない(常に質問なしで自動判定できる)', () => {
  // 所定8時間・休憩0分。半分(240分)付近を1分刻みで試しても、質問が発生しないことを確認する。
  for (const realEndStr of ['12:55', '13:00', '13:05']) {
    const r = calculateFromRealTimes(
      realBase({ normalStart: '09:00', normalEnd: '17:00', normalBreak: 0, realLeaveStart: realEndStr, realLeaveEnd: '17:00' }),
    );
    assert.notEqual(r.status, 'NEEDS_BREAK_CONFIRMATION', `${realEndStr} で質問が発生してはいけない`);
  }
});

test('空白地帯の全件検証: ①スケジュール+補助項目の時間帯整合 ②休憩の二重計上なし ③半休/全日の判定が有給時間と整合 ④AM/PM対称 を複数の所定・休憩パターンで確認する', () => {
  // 通常休憩(normalBreak)が30分単位でないパターン(例: 45分)は対象にしない。
  // 「休憩を取った」回答時に actualMinutes が30分単位からずれ、既存の
  // 「有給は30分単位」ルール(calculate()側、本機能とは無関係の既存ルール)に
  // 必ず抵触してERRORになるため、このパターンはそもそも対象外
  // (補助項目対応表(companyRules.js)に有給側休憩45分の対応がない、という既知の未確定事項と同根)。
  const patterns = [
    { normalStart: '09:00', normalEnd: '18:00', normalBreak: 60 }, // 所定8h
    { normalStart: '09:00', normalEnd: '17:30', normalBreak: 30 }, // 所定8h
    { normalStart: '09:00', normalEnd: '16:00', normalBreak: 60 }, // 所定6h
    { normalStart: '09:00', normalEnd: '17:00', normalBreak: 60 }, // 所定7h
  ];

  // 1件分のFULL(休憩を取った/取らなかった全日候補)結果を検証する共通チェック。
  // スケジュール・補助項目とも、実際の在籍・不在時刻のまま(ずらさない)ことと、
  // 休憩がどちらか一方でのみ計上される(二重計上なし)ことを確認する。
  function assertFullLiteral(data, standardMinutes, normalBreakMinutes, presenceStart, presenceEnd, absenceStart, absenceEnd, label) {
    assert.equal(data.scheduleStart, presenceStart, `${label} scheduleStart`);
    assert.equal(data.scheduleEnd, presenceEnd, `${label} scheduleEnd`);
    assert.equal(data.auxStart, absenceStart, `${label} auxStart`);
    assert.equal(data.auxEnd, absenceEnd, `${label} auxEnd`);
    assert.equal(data.scheduleBreak + data.leaveSideBreak, normalBreakMinutes, `${label} 休憩の二重計上なし`);
    assert.equal(data.leaveMinutes, absenceEnd - absenceStart, `${label} leaveMinutesは補助項目の時間幅と一致`);
    assert.ok(data.leaveMinutes > standardMinutes / 2, `${label} 全日扱いは有給時間が所定の半分超`);
  }

  for (const p of patterns) {
    const normalStart = t(p.normalStart);
    const normalEnd = t(p.normalEnd);
    const standardMinutes = normalEnd - normalStart - p.normalBreak;
    const deadZoneStart = standardMinutes / 2;
    const deadZoneEnd = deadZoneStart + p.normalBreak;

    // 実際の入力は「有給は30分単位」という既存ルールと整合する30分刻みのみを対象とする
    // (1分刻みで全数検証すると、変換後の有給時間が30分単位からずれるケースを拾ってしまい、
    //  本機能とは無関係な既存ルールのERRORと混同するため)。
    for (let w = deadZoneStart; w < deadZoneEnd; w += 30) {
      // --- 「休憩を取った」: PM側・AM側とも単一のFULL結果(スケジュールは在籍時刻のまま) ---
      const pmLeaveStart = normalStart + w;
      const pmTaken = calculateFromRealTimes({
        isWorkday: true, normalStart, normalEnd, normalBreak: p.normalBreak,
        realLeaveStart: pmLeaveStart, realLeaveEnd: normalEnd, tookBreakDuringWork: true,
      });
      assert.equal(pmTaken.status, 'FULL', `PM休憩あり w=${w} status`);
      assertFullLiteral(pmTaken.data, standardMinutes, p.normalBreak, normalStart, pmLeaveStart, pmLeaveStart, normalEnd, `PM休憩あり w=${w}`);

      const amLeaveEnd = normalEnd - w;
      const amTaken = calculateFromRealTimes({
        isWorkday: true, normalStart, normalEnd, normalBreak: p.normalBreak,
        realLeaveStart: normalStart, realLeaveEnd: amLeaveEnd, tookBreakDuringWork: true,
      });
      assert.equal(amTaken.status, 'FULL', `AM休憩あり w=${w} status`);
      assertFullLiteral(amTaken.data, standardMinutes, p.normalBreak, amLeaveEnd, normalEnd, normalStart, amLeaveEnd, `AM休憩あり w=${w}`);

      // ④ AM/PM対称(休憩あり): 実働時間・休憩の計上先が一致する
      assert.equal(amTaken.data.actualMinutes, pmTaken.data.actualMinutes, `④ 休憩あり actualMinutes対称 w=${w}`);
      assert.equal(amTaken.data.scheduleBreak, pmTaken.data.scheduleBreak, `④ 休憩あり scheduleBreak対称 w=${w}`);
      assert.equal(amTaken.data.leaveSideBreak, pmTaken.data.leaveSideBreak, `④ 休憩あり leaveSideBreak対称 w=${w}`);

      // --- 「休憩を取っていない」: PM側・AM側とも単一の半日有休結果 ---
      // 実働+有給=所定。スケジュールは実際の在籍時刻のまま・休憩0分
      // (補助項目との間の通常休憩分は明示的には埋めない、現場で確認された入力方法のまま)。
      const pmNotTaken = calculateFromRealTimes({
        isWorkday: true, normalStart, normalEnd, normalBreak: p.normalBreak,
        realLeaveStart: pmLeaveStart, realLeaveEnd: normalEnd, tookBreakDuringWork: false,
      });
      assert.equal(pmNotTaken.status, 'HALF', `PM休憩なし w=${w} status`);
      assert.equal(pmNotTaken.data.actualMinutes + pmNotTaken.data.leaveMinutes, standardMinutes, `① PM半日 w=${w}`);
      assert.ok(pmNotTaken.data.leaveMinutes <= standardMinutes / 2, `② PM半日 w=${w}`);
      assert.equal(pmNotTaken.data.scheduleStart, normalStart, `③ PM半日 scheduleStart w=${w}`);
      assert.equal(pmNotTaken.data.scheduleEnd, pmLeaveStart, `③ PM半日 scheduleEnd w=${w}`);
      assert.equal(pmNotTaken.data.scheduleBreak, 0, `③ PM半日 w=${w}`);

      const amNotTaken = calculateFromRealTimes({
        isWorkday: true, normalStart, normalEnd, normalBreak: p.normalBreak,
        realLeaveStart: normalStart, realLeaveEnd: amLeaveEnd, tookBreakDuringWork: false,
      });
      assert.equal(amNotTaken.status, 'HALF', `AM休憩なし w=${w} status`);
      assert.equal(amNotTaken.data.actualMinutes + amNotTaken.data.leaveMinutes, standardMinutes, `① AM半日 w=${w}`);
      assert.ok(amNotTaken.data.leaveMinutes <= standardMinutes / 2, `② AM半日 w=${w}`);
      assert.equal(amNotTaken.data.scheduleStart, amLeaveEnd, `③ AM半日 scheduleStart w=${w}`);
      assert.equal(amNotTaken.data.scheduleEnd, normalEnd, `③ AM半日 scheduleEnd w=${w}`);
      assert.equal(amNotTaken.data.scheduleBreak, 0, `③ AM半日 w=${w}`);

      // ④ AM/PM対称(休憩なし)
      assert.equal(amNotTaken.data.actualMinutes, pmNotTaken.data.actualMinutes, `④ 休憩なし actualMinutes対称 w=${w}`);
      assert.equal(amNotTaken.data.scheduleBreak, pmNotTaken.data.scheduleBreak, `④ 休憩なし scheduleBreak対称 w=${w}`);
    }
  }
});
