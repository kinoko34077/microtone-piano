/**
 * 多段微分音Web鍵盤App - 型定義
 */

// 音高定義のタイプ
export type PitchType = 'edo' | 'cents' | 'ratio' | 'frequency';

export interface PitchDefinition {
  id: number; // 0 ~ 254 (最大255音)
  name: string;
  type: PitchType;
  // EDO指定の場合
  edo?: number;       // 例: 31, 24, 12
  step?: number;      // 例: 0, 1, 2... 周期外ステップも許可
  // Cents指定の場合
  cents?: number;     // 例: 700.0
  // Ratio(音程比)指定の場合
  numerator?: number;   // 分子 例: 3
  denominator?: number; // 分母 例: 2
  // Frequency指定の場合
  frequency?: number; // 例: 440.0 Hz
}

// 音高プリセット
export interface TuningPreset {
  id: string;
  name: string;
  description?: string;
  isStandard?: boolean; // 標準プリセット(読取専用)
  periodCents: number;  // 周期 (既定 1200)
  baseAddress: number;  // 基準キー番地 (0x00 ~ 0xFF)
  baseFrequency: number; // 基準周波数 (既定 440.0)
  baseStep?: number;     // 基準ステップ
  pitches: PitchDefinition[];
  noteNames?: string[];   // カスタム音名リスト (例: ["C", "C#", "D", ...])
  doremiNames?: string[]; // カスタムドレミ表記リスト (例: ["ド", "ド#", "レ", ...])
}

// 無効区画の描画・配置処理モード
export type InvalidSectionMode = 'fixed' | 'compressed' | 'custom';

// 境界テンプレート: 1~8段ごとの0.0~1.0の正規化値の配列
// 例: 3段の場合 [0, 0.333, 0.666, 1.0]
export type BoundaryTemplate = number[];

// 各レーン(0~31)の配置構成
export interface LaneConfig {
  activeDepths: number; // 有効段数 (0 ~ 8)
  customBoundaries?: number[]; // customモード時の境界値
}

// 配置プリセット
export interface LayoutPreset {
  id: string;
  name: string;
  description?: string;
  isStandard?: boolean;
  defaultTuningId?: string; // 連動する標準音高調律プリセットID
  
  horizontalCount?: number; // 使用する横位置数 (1 ~ 16, 既定 16)
  
  // 16横位置 x 2 (白/黒) = 32レーンの設定
  lanes: LaneConfig[]; // 長さ32
  
  // 番地 -> Pitch ID (0~254) のマッピング. -1は未割当
  // インデックス = 番地 (0x00 ~ 0xFF, 長さ256)
  mapping: number[];

  // 各番地(0~255)のスロット有効状態フラグ (省略時は mapping !== -1 が有効)
  slotFlags?: boolean[];
  
  // 境界テンプレート (2~8段用)
  boundaryTemplates: Record<number, number[]>; // key: 段数(2~8), value: [0, ..., 1]
  
  invalidSectionMode: InvalidSectionMode;
}

// アプリケーション全体・表示設定
export type PitchLabelMode = 'note' | 'doremi' | 'step' | 'freq' | 'none';

export interface AppSettings {
  soundSource: 'piano' | 'sawtooth' | 'square';
  masterVolume: number; // 0.0 ~ 1.0
  sustainLatch: boolean;
  sustainMomentary?: boolean;
  keyWidth: number; // 鍵盤1横位置あたりのピクセル幅 (例: 60px)
  visibleKeysCount: number; // 画面内に表示する鍵盤横数
  showTwoRows: boolean; // 上下二段表示
  showInvalidSections: boolean; // 無効区画も暗色表示する
  autoMappingDirection: 'lowToHigh' | 'highToLow'; // 自動マッピング方向: 手前低音/手前高音
  blackKeyWidthRatio: number; // 白鍵に対する黒鍵の横幅比 (例: 0.65)
  blackKeyHeightRatio: number; // 白鍵に対する黒鍵高さ比 (例: 0.6)
  pcDepthOffset: number; // PCキーボードのdepthオフセット (0 ~ 4)
  upperOctaveOffset: number; // 上段鍵盤のオクターブオフセット
  lowerOctaveOffset: number; // 下段鍵盤のオクターブオフセット
  showAddressBinary?: boolean; // 鍵盤上にバイナリ/16進番地を表示する (既定: false)
  pitchLabelMode: PitchLabelMode; // 音高表示名: note(C4), doremi(ド), step(S0), freq(440Hz), none
  defaultLayoutPresetId?: string; // 起動時既定配置プリセットID
  defaultPitchPresetId?: string; // 起動時既定音高プリセットID
}

// 発音中ボイス情報
export interface ActiveVoice {
  id: string; // 一意なキー (例: "0x40_touch1")
  address: number;
  pitchId: number;
  frequency: number;
  velocity: number; // 0.0 ~ 1.0
  startTime: number;
  pointerId?: number | string;
}

// 範囲外周波数通知イベント
export interface OutOfRangeNotice {
  id: string;
  frequency: number;
  address: number;
  message: string;
  timestamp: number;
}
