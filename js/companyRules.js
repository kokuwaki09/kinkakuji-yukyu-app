// companyRules.js
// 高円寺営業所の会社独自ルール（補助項目の名称・対応表）を1か所にまとめたファイル。
// 新しいパターンが会社側で確認されたら、このファイルに追記するだけで対応できるようにする。
// UI側・計算ロジック側にルールをif文で埋め込まないこと。

// 現在確認済みの補助項目の正式名称（表記は変更しない）
export const AUX_ITEM_NAMES = {
  HALF: '半日有休（全訪問スタッフ対象）',
  FULL_BREAK_60: '全日有休（休憩60分取得者）',
  FULL_BREAK_30: '全日有休（休憩30分取得者）',
  FULL_BREAK_00: '全日有休（休憩00分取得者）',
};

// 全日扱い（全日有休扱い）の場合に、
// 「有給側で処理する休憩時間（分）」から補助項目名を決定する対応表。
//
// 重要: このキーは「勤務中に本人が取った休憩」ではなく
// 「有給側で処理する休憩（= 通常休憩 − 勤務中に取る休憩）」である。
//
// 例: 勤務中休憩0分・通常休憩60分 → 有給側で処理する休憩60分 → 全日有休（休憩60分取得者）
//
// 新しい対応が会社側で確認された場合は、ここに1行追加するだけでよい。
// 例: LEAVE_SIDE_BREAK_TO_ITEM[45] = '全日有休（休憩45分取得者）';
export const LEAVE_SIDE_BREAK_TO_ITEM = {
  60: AUX_ITEM_NAMES.FULL_BREAK_60,
  30: AUX_ITEM_NAMES.FULL_BREAK_30,
  0: AUX_ITEM_NAMES.FULL_BREAK_00,
};

/**
 * 有給側で処理する休憩時間(分)から、補助項目名を決定する。
 * 対応表にない場合はnull（未確定）を返す。計算自体は止めない。
 * @param {number} leaveSideBreakMinutes
 * @returns {string|null}
 */
export function resolveFullDayItemName(leaveSideBreakMinutes) {
  if (Object.prototype.hasOwnProperty.call(LEAVE_SIDE_BREAK_TO_ITEM, leaveSideBreakMinutes)) {
    return LEAVE_SIDE_BREAK_TO_ITEM[leaveSideBreakMinutes];
  }
  return null;
}

// 有給取得の最小単位（分）。開始・終了時刻そのものはこの単位に制限しないが、
// 有給時間の合計はこの単位でなければならない。
export const LEAVE_UNIT_MINUTES = 30;

// 実際に働く時間（分）から、その勤務時間に対して必要な休憩時間（分）を判定するルール。
// 勤革時マニュアル09〜11の確認により、スタッフ本人に「勤務中に取る休憩」を選ばせるのではなく、
// 残る勤務時間からアプリ側で自動判定する方針に変更した（本人には質問しない）。
//
// 現在確認済みの会社ルール（「6時間以上勤務の場合は45分、8時間勤務の場合は60分」という
// 会社側の回答に基づく。ちょうど6時間勤務は45分側に含まれる点に注意）：
//   6時間未満          → 休憩0分
//   6時間以上8時間未満 → 休憩45分
//   8時間以上          → 休憩60分
//
// 8時間(480分)を超える勤務は、今回のアプリが対象とする通常所定労働時間（最大8時間）の
// 範囲外のため、ここでは新しいルールを推測せず、8時間以上の勤務は一律60分として扱う。
//
// 【誤用防止メモ】この関数は現在、calculator.js の「全日扱い」判定内でのみ、
// actualMinutes（残る勤務時間）を引数として呼び出されている。「全日扱い」は
// leaveMinutes > standardMinutes/2 の場合に限られるため、actualMinutes は必ず
// standardMinutes/2 未満になる。このアプリが想定する通常所定労働時間は最大8時間(480分)
// のため、actualMinutes は常に240分未満となり、「480分以上」の分岐には実務上到達しない
// （tests/calculator.test.js の不変条件テストで確認済み）。
// 将来、この関数を他の場所（例:所定労働時間が8時間を超えるケースや、休憩以外の用途）
// から呼び出す場合は、この前提が崩れていないか必ず確認すること。
//
// 境界値はミリ秒単位の誤差を避けるため分単位の整数で判定する。
const SIX_HOURS_MINUTES = 6 * 60;
const EIGHT_HOURS_MINUTES = 8 * 60;

/**
 * 実際に働く時間（分）から、その勤務に必要な休憩時間（分）を自動判定する。
 * @param {number} workMinutes
 * @returns {number}
 */
export function resolveRequiredBreakMinutes(workMinutes) {
  if (workMinutes < SIX_HOURS_MINUTES) return 0;
  if (workMinutes < EIGHT_HOURS_MINUTES) return 45;
  return 60;
}
