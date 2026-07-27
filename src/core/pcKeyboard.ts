/**
 * PCキーボード物理マッピング & イベント変換
 */

import { encodeAddress } from './address';

// キー配列定義 (行 index 0: 奥(数字段), 1: QWERTY, 2: ASDF, 3: 手前(ZXCV))
const ROW_KEYS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='], // row 0: 奥
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'], // row 1
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],      // row 2
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],           // row 3: 手前
];

/**
 * PC物理キーコードから対象の 8ビット番地を算出
 * @param key KeyCode (例: "KeyQ", "Digit1", "KeyZ")
 * @param depthOffset depthオフセット (0 ~ 4)
 */
export function keyToAddress(key: string, depthOffset: number = 0): number | null {
  const lowerKey = key.toLowerCase();

  // 行と列を探索
  let foundRow = -1;
  let foundCol = -1;

  for (let r = 0; r < ROW_KEYS.length; r++) {
    const colIdx = ROW_KEYS[r].indexOf(lowerKey);
    if (colIdx !== -1) {
      foundRow = r;
      foundCol = colIdx;
      break;
    }
  }

  if (foundRow === -1 || foundCol === -1) {
    return null;
  }

  // Row 0 = 奥(高depth), Row 3 = 手前(低depth)
  // depthOffsetにより割り当てる段を変更
  const targetDepth = Math.max(0, Math.min(7, (3 - foundRow) + depthOffset));

  // 列idx から x と isBlack を判定
  // 左から: 0白(col0), 0黒(col1), 1白(col2), 1黒(col3), 2白(col4), 2黒(col5)...
  const x = Math.floor(foundCol / 2);
  const isBlack = foundCol % 2 === 1;

  if (x >= 16) return null;

  return encodeAddress(x, isBlack, targetDepth);
}
