/**
 * 鍵盤番地 (`xxxx c ddd`) のユーティリティ
 */

export interface DecodedAddress {
  address: number;
  x: number;
  isBlack: boolean;
  depth: number;
  laneIndex: number;
  hexString: string;
}

export function encodeAddress(x: number, isBlack: boolean, depth: number): number {
  const cleanX = Math.max(0, Math.floor(x));
  const cleanC = isBlack ? 1 : 0;
  const cleanDepth = Math.max(0, Math.min(7, Math.floor(depth)));
  return cleanX * 16 + cleanC * 8 + cleanDepth;
}

export function decodeAddress(address: number): DecodedAddress {
  const addr = Math.max(0, Math.floor(address));
  const x = Math.floor(addr / 16);
  const isBlack = addr % 16 >= 8;
  const depth = addr % 8;
  const laneIndex = x * 2 + (isBlack ? 1 : 0);
  const hexString = `0x${addr.toString(16).padStart(2, '0').toUpperCase()}`;

  return {
    address: addr,
    x,
    isBlack,
    depth,
    laneIndex,
    hexString,
  };
}

export function laneToKeyInfo(laneIndex: number): {x: number; isBlack: boolean} {
  const cleanLane = Math.max(0, Math.floor(laneIndex));
  return {
    x: Math.floor(cleanLane / 2),
    isBlack: cleanLane % 2 === 1,
  };
}

export function keyInfoToLane(x: number, isBlack: boolean): number {
  return Math.max(0, Math.floor(x)) * 2 + (isBlack ? 1 : 0);
}

export function getAddressLabel(address: number): string {
  const decoded = decodeAddress(address);
  const color = decoded.isBlack ? '黒' : '白';
  const xHex = decoded.x.toString(16).toUpperCase();
  return `${color}${xHex}-d${decoded.depth}`;
}

export function getStandardAddressOrder(): number[] {
  const addresses: number[] = [];
  for (let x = 0; x < 16; x += 1) {
    for (let depth = 0; depth < 8; depth += 1) {
      addresses.push(encodeAddress(x, false, depth));
    }
    for (let depth = 0; depth < 8; depth += 1) {
      addresses.push(encodeAddress(x, true, depth));
    }
  }
  return addresses;
}
