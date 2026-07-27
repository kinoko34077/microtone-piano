/**
 * 鍵番地 (8ビット `xxxx c ddd`) の処理ユーティリティ
 */

export interface DecodedAddress {
  address: number;      // 0x00 ~ 0xFF
  x: number;            // 横位置 0 ~ 15 (0 ~ F)
  isBlack: boolean;     // false=白鍵, true=黒鍵
  depth: number;        // 奥行 0 ~ 7 (0が最手前)
  laneIndex: number;    // レーンインデックス 0 ~ 31
  hexString: string;    // 例: "0x42"
}

/**
 * x, isBlack, depth から 番地を生成 (xが15を超えても一意になるよう拡張)
 */
export function encodeAddress(x: number, isBlack: boolean, depth: number): number {
  const cleanX = Math.max(0, Math.floor(x)); // 制限15を解除
  const cleanC = isBlack ? 1 : 0;
  const cleanDepth = Math.max(0, Math.min(7, Math.floor(depth)));
  return (cleanX * 16) + (cleanC * 8) + cleanDepth;
}

/**
 * 番地から構成要素に分解
 */
export function decodeAddress(address: number): DecodedAddress {
  const addr = Math.max(0, Math.floor(address));
  const x = Math.floor(addr / 16);
  const isBlack = (addr % 16) >= 8;
  const depth = addr % 8;
  const laneIndex = (x * 2) + (isBlack ? 1 : 0);
  const hexString = '0x' + addr.toString(16).padStart(2, '0').toUpperCase();

  return {
    address: addr,
    x,
    isBlack,
    depth,
    laneIndex,
    hexString,
  };
}

/**
 * レーンインデックスから x, isBlack を取得
 */
export function laneToKeyInfo(laneIndex: number): { x: number; isBlack: boolean } {
  const cleanLane = Math.max(0, Math.floor(laneIndex));
  return {
    x: Math.floor(cleanLane / 2),
    isBlack: cleanLane % 2 === 1,
  };
}

/**
 * x と isBlack からレーンインデックスを取得
 */
export function keyInfoToLane(x: number, isBlack: boolean): number {
  return (Math.max(0, Math.floor(x)) * 2) + (isBlack ? 1 : 0);
}

/**
 * 番地表示用のラベル文字列を取得 (例: "白3-2" や "黒F-0")
 */
export function getAddressLabel(address: number): string {
  const decoded = decodeAddress(address);
  const colorStr = decoded.isBlack ? '黒' : '白';
  const xHex = decoded.x.toString(16).toUpperCase();
  return `${colorStr}${xHex}-段${decoded.depth}`;
}

/**
 * 全256番地の走査順リストを生成
 * 仕様: 横位置0白 → 0黒 → 1白 → 1黒 ... 各レーン内はdepth 0~7
 */
export function getStandardAddressOrder(): number[] {
  const addresses: number[] = [];
  for (let x = 0; x < 16; x++) {
    // 白鍵レーン
    for (let d = 0; d < 8; d++) {
      addresses.push(encodeAddress(x, false, d));
    }
    // 黒鍵レーン
    for (let d = 0; d < 8; d++) {
      addresses.push(encodeAddress(x, true, d));
    }
  }
  return addresses;
}
