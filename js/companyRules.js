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

// 勤務中に取る休憩時間の入力候補（分）。「その他」はUI側で自由入力を受け付ける。
export const BREAK_DURING_WORK_PRESETS = [0, 30, 60];
