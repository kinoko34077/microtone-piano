/**
 * 多段微分音Web鍵盤 - 鍵盤描画・インタラクティブ演奏コンポーネント
 */

import React, { useRef, useState, useCallback } from 'react';
import { LayoutPreset, TuningPreset, AppSettings, ActiveVoice } from '../../types/keyboard';
import { encodeAddress } from '../../core/address';
import { calculateFrequency, getFormattedPitchLabel, resolvePitch } from '../../core/pitch';
import { globalAudioEngine } from '../../core/audio';

interface InteractiveKeyboardProps {
  layout: LayoutPreset;
  tuning: TuningPreset;
  settings: AppSettings;
  octaveShift?: number; // 上下2段表示時などのオクターブシフト (0, 1, -1など)
  selectedAddress?: number | null;
  onSelectAddress?: (addr: number) => void;
  activeVoices: ActiveVoice[];
}

export const InteractiveKeyboard: React.FC<InteractiveKeyboardProps> = ({
  layout,
  tuning,
  settings,
  octaveShift = 0,
  selectedAddress,
  onSelectAddress,
  activeVoices,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pressedAddresses, setPressedAddresses] = useState<Map<string, { address: number; voiceId: string }>>(
    new Map<string, { address: number; voiceId: string }>()
  );

  // アクティブなVoiceのSetを作成 (描画用)
  const activeAddressSet = new Set<number>();
  activeVoices.forEach((v) => activeAddressSet.add(v.address));

  // 各レーンの有効段数と境界情報を取得 (periodでラップ)
  const getLaneDepths = (x: number, isBlack: boolean) => {
    const period = layout.horizontalCount || 16;
    const laneIdx = (x % period) * 2 + (isBlack ? 1 : 0);
    const lane = layout.lanes[laneIdx];
    return lane ? lane.activeDepths : 0;
  };

  /**
   * タッチ/マウスポインタ位置から対象の番地を計算 (hit-test)
   */
  const getAddressFromCoordinates = useCallback(
    (clientX: number, clientY: number): number | null => {
      if (!containerRef.current) return null;

      const rect = containerRef.current.getBoundingClientRect();
      const scrollLeft = containerRef.current.scrollLeft;

      const relX = clientX - rect.left + scrollLeft;
      const relY = clientY - rect.top;
      const totalHeight = rect.height;

      const keyW = settings.keyWidth;
      const blackH = totalHeight * settings.blackKeyHeightRatio;
      
      const visibleCols = Math.max(16, Math.ceil(rect.width / keyW) + 1);

      // --- Phase 1: 黒鍵判定 (優先) ---
      if (relY <= blackH) {
        for (let x = 0; x < visibleCols; x++) {
          const activeDepths = getLaneDepths(x, true);
          if (activeDepths === 0 && !settings.showInvalidSections) continue;

          // 黒鍵のX位置: 白鍵x と 白鍵(x+1) の境界線を中心に設置
          const blackW = keyW * settings.blackKeyWidthRatio;
          const center = (x + 1) * keyW;
          const blackLeft = center - blackW / 2;
          const blackRight = center + blackW / 2;

          if (relX >= blackLeft && relX <= blackRight) {
            const topRatio = relY / blackH; // 0.0 (最上部) ~ 1.0 (最下部)

            const depth = calculateDepthFromRatio(
              x,
              true,
              topRatio,
              activeDepths,
              layout,
              settings
            );
            return encodeAddress(x, true, depth);
          }
        }
      }

      // --- Phase 2: 白鍵判定 ---
      const whiteXIndex = Math.floor(relX / keyW);
      if (whiteXIndex >= 0 && whiteXIndex < visibleCols) {
        const activeDepths = getLaneDepths(whiteXIndex, false);
        const topRatio = relY / totalHeight; // 0.0 (最上部) ~ 1.0 (最下部)

        const depth = calculateDepthFromRatio(
          whiteXIndex,
          false,
          topRatio,
          activeDepths,
          layout,
          settings
        );
        return encodeAddress(whiteXIndex, false, depth);
      }

      return null;
    },
    [layout, settings]
  );

  /**
   * 音声再生のトリガー
   */
  const triggerNoteOn = useCallback(
    async (address: number, pointerKey: string, velocity: number = 1.0) => {
      const period = layout.horizontalCount || 16;
      const x = Math.floor(address / 16);
      const isBlack = (address % 16) >= 8;
      const depth = address % 8;
      
      const baseAddress = encodeAddress(x % period, isBlack, depth);
      const octOffset = Math.floor(x / period);
      
      const pitchId = layout.mapping[baseAddress];
      if (pitchId === undefined || pitchId === -1) {
        if (onSelectAddress) onSelectAddress(address);
        return;
      }

      const { pitchDef, octaveShift: tuningOctaveShift } = resolvePitch(pitchId, tuning);
      if (!pitchDef) return;

      const freq = calculateFrequency(pitchDef, tuning, octaveShift + tuningOctaveShift + octOffset);

      const voiceId = await globalAudioEngine.noteOn(
        address,
        pitchId,
        freq,
        velocity,
        pointerKey
      );

      setPressedAddresses((prev) => {
        const next = new Map<string, { address: number; voiceId: string }>(prev);
        next.set(pointerKey, { address, voiceId });
        return next;
      });

      if (onSelectAddress) {
        onSelectAddress(address);
      }
    },
    [layout, tuning, octaveShift, onSelectAddress]
  );

  /**
   * 音声停止のトリガー
   */
  const triggerNoteOff = useCallback((pointerKey: string) => {
    setPressedAddresses((prev) => {
      const next = new Map<string, { address: number; voiceId: string }>(prev);
      const item = next.get(pointerKey);
      if (item) {
        globalAudioEngine.noteOff(item.voiceId);
        next.delete(pointerKey);
      }
      return next;
    });
  }, []);

  // ポインターイベント (マウス/マルチタッチ/グリッサンド)
  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pointerKey = `pointer_${e.pointerId}`;
    const addr = getAddressFromCoordinates(e.clientX, e.clientY);
    if (addr !== null) {
      const pressure = e.pressure && e.pressure > 0 ? e.pressure : 1.0;
      triggerNoteOn(addr, pointerKey, pressure);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!e.buttons && e.pointerType === 'mouse') return;
    const pointerKey = `pointer_${e.pointerId}`;
    const currentItem = pressedAddresses.get(pointerKey);
    const newAddr = getAddressFromCoordinates(e.clientX, e.clientY);

    if (newAddr !== null) {
      if (!currentItem || currentItem.address !== newAddr) {
        if (currentItem) {
          triggerNoteOff(pointerKey);
        }
        const pressure = e.pressure && e.pressure > 0 ? e.pressure : 1.0;
        triggerNoteOn(newAddr, pointerKey, pressure);
      }
    } else if (currentItem) {
      triggerNoteOff(pointerKey);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const pointerKey = `pointer_${e.pointerId}`;
    triggerNoteOff(pointerKey);
  };

  const [visibleColumns, setVisibleColumns] = useState(16);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        // 画面幅を埋めるのに必要な列数を計算 (+1 余裕を持たせる)
        const cols = Math.max(16, Math.ceil(width / settings.keyWidth) + 1);
        setVisibleColumns(cols);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [settings.keyWidth]);

  // 16白鍵の描画 -> 可変白鍵の描画
  const renderWhiteKey = (x: number) => {
    const activeDepths = getLaneDepths(x, false);
    const totalDepths = 8;
    const period = layout.horizontalCount || 16;
    const octOffset = Math.floor(x / period);
    const baseX = x % period;

    return (
      <div
        key={`white_${x}`}
        className="relative flex flex-col border-r border-slate-400/80 bg-white select-none h-full shadow-[inset_-1px_0_2px_rgba(0,0,0,0.1)] rounded-b-md"
        style={{ width: `${settings.keyWidth}px`, flexShrink: 0 }}
      >
        {/* 奥 (depth=7) から 手前 (depth=0) へ上から順に配置 */}
        {Array.from({ length: totalDepths }, (_, idx) => {
          const depth = 7 - idx; // 上が奥(7), 下が手前(0)
          const isInvalid = depth >= activeDepths;
          const address = encodeAddress(x, false, depth);
          const baseAddress = encodeAddress(baseX, false, depth);
          
          const pitchId = layout.mapping[baseAddress];
          const isPressed = activeAddressSet.has(address);
          const isSelected = selectedAddress === address;

          if (isInvalid && !settings.showInvalidSections) {
            return null; // 無効区間表示オフなら、モードに関わらず非表示（詰める）
          }

          const { pitchDef, octaveShift: tuningOctaveShift } = resolvePitch(pitchId, tuning);
          const totalOctaveShift = octaveShift + tuningOctaveShift + octOffset;

          const formattedLabel = pitchDef
            ? getFormattedPitchLabel(pitchDef, tuning, settings.pitchLabelMode, totalOctaveShift)
            : '';

          // オクターブに応じたバッジの背景カラー (画像のようなポップなバッジ)
          const stepVal = pitchDef?.step ?? 0;
          const edoVal = pitchDef?.edo ?? 12;
          const octVal = Math.floor((stepVal + totalOctaveShift * edoVal) / edoVal) + 4;
          const badgeBg =
            octVal <= 3
              ? 'bg-amber-300 text-amber-950 border-amber-400'
              : octVal === 4
              ? 'bg-emerald-300 text-emerald-950 border-emerald-400'
              : octVal === 5
              ? 'bg-sky-300 text-sky-950 border-sky-400'
              : 'bg-indigo-300 text-indigo-950 border-indigo-400';

          return (
            <div
              key={`white_${x}_depth_${depth}`}
              className={`relative flex-1 border-b border-slate-200 p-1 flex flex-col justify-between transition-colors ${
                isPressed
                  ? 'bg-gradient-to-b from-amber-300 to-amber-400 text-amber-950 font-bold shadow-inner'
                  : isSelected
                  ? 'bg-sky-100 border-sky-400 text-sky-900 font-medium'
                  : isInvalid
                  ? 'bg-slate-200/80 text-slate-400 border-slate-300'
                  : 'hover:bg-slate-100 text-slate-800'
              }`}
            >
              <div className="flex justify-between items-center text-[8px] font-mono opacity-50">
                <span>d{depth}</span>
                {settings.showAddressBinary && (
                  <span>{`0x${address.toString(16).padStart(2, '0').toUpperCase()}`}</span>
                )}
              </div>

              {/* 鍵盤裾の音名ラベルバッジ (添付画像のような直感的デザイン) */}
              <div className="flex justify-center items-end mb-1">
                {formattedLabel && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[11px] font-extrabold shadow-sm border font-sans tracking-tight leading-none ${badgeBg}`}
                  >
                    {formattedLabel}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // 黒鍵の描画 (重ね表示)
  const renderBlackKeys = () => {
    return Array.from({ length: visibleColumns }, (_, x) => {
      const activeDepths = getLaneDepths(x, true);
      if (activeDepths === 0 && !settings.showInvalidSections) return null;

      const period = layout.horizontalCount || 16;
      const octOffset = Math.floor(x / period);
      const baseX = x % period;

      const blackWidth = settings.keyWidth * settings.blackKeyWidthRatio;
      const center = (x + 1) * settings.keyWidth;
      const blackLeft = center - blackWidth / 2;

      return (
        <div
          key={`black_lane_${x}`}
          className="absolute top-0 flex flex-col z-10 rounded-b-md shadow-2xl bg-gradient-to-b from-slate-900 to-black select-none overflow-hidden border-x border-b border-slate-800"
          style={{
            left: `${blackLeft}px`,
            width: `${blackWidth}px`,
            height: `${settings.blackKeyHeightRatio * 100}%`,
          }}
        >
          {Array.from({ length: 8 }, (_, idx) => {
            const depth = 7 - idx; // 奥(7) -> 手前(0)
            const isInvalid = depth >= activeDepths;
            const address = encodeAddress(x, true, depth);
            const baseAddress = encodeAddress(baseX, true, depth);
            
            const pitchId = layout.mapping[baseAddress];
            const isPressed = activeAddressSet.has(address);
            const isSelected = selectedAddress === address;

            if (isInvalid && !settings.showInvalidSections) {
              return null; // 無効区間表示オフなら、モードに関わらず非表示（詰める）
            }

            const { pitchDef, octaveShift: tuningOctaveShift } = resolvePitch(pitchId, tuning);
            const totalOctaveShift = octaveShift + tuningOctaveShift + octOffset;

            const formattedLabel = pitchDef
              ? getFormattedPitchLabel(pitchDef, tuning, settings.pitchLabelMode, totalOctaveShift)
              : '';

            return (
              <div
                key={`black_${x}_depth_${depth}`}
                className={`relative flex-1 border-b border-slate-800 p-0.5 text-[9px] flex flex-col justify-between transition-colors ${
                  isPressed
                    ? 'bg-amber-400 text-amber-950 font-bold shadow-inner border-amber-500'
                    : isSelected
                    ? 'bg-sky-500 text-white font-medium border-sky-400'
                    : isInvalid
                    ? 'bg-slate-900/60 text-slate-700 border-slate-800'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-200'
                }`}
              >
                <div className="flex justify-between items-center text-[7px] font-mono opacity-40">
                  <span>d{depth}</span>
                  {settings.showAddressBinary && (
                    <span>{`0x${address.toString(16).padStart(2, '0').toUpperCase()}`}</span>
                  )}
                </div>

                {/* 黒鍵音名表示 */}
                <div className="flex justify-center items-end mb-0.5">
                  {formattedLabel && (
                    <span className="px-1 py-0.2 rounded text-[9px] font-extrabold bg-slate-800 text-amber-300 border border-slate-700 font-sans">
                      {formattedLabel}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    });
  };

  return (
    <div className="w-full flex flex-col h-full bg-[#0d1117] overflow-hidden">
      {/* スクロール鍵盤エリア */}
      <div
        ref={containerRef}
        className="relative flex-1 flex overflow-x-hidden overflow-y-hidden touch-none select-none p-0 cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="relative flex h-full w-full">
          {/* 白鍵群 */}
          {Array.from({ length: visibleColumns }, (_, x) => renderWhiteKey(x))}

          {/* 黒鍵群 (重ね) */}
          {renderBlackKeys()}
        </div>
      </div>
    </div>
  );
};

// 上からの位置比率 (0.0~1.0) から奥行 depth (0~7) を算出するヘルパー
function calculateDepthFromRatio(
  x: number,
  isBlack: boolean,
  topRatio: number, // 0.0 (最上部/画面奥 depth 7 または activeDepths-1) ~ 1.0 (最下部/画面手前 depth 0)
  activeDepths: number,
  layout: LayoutPreset,
  settings: AppSettings
): number {
  if (activeDepths <= 0) return 0;

  const clampedTopRatio = Math.max(0, Math.min(0.9999, topRatio));

  // 1. 無効区画を表示する場合 (8段全体が画面に均等描画されている)
  if (settings.showInvalidSections) {
    const idxFromTop = Math.floor(clampedTopRatio * 8);
    const depth = 7 - idxFromTop;
    return Math.max(0, Math.min(7, depth));
  }

  // 2. 無効区画を非表示の場合 (画面には activeDepths 個のブロックが均等配置されている)
  // 無効段配置モードに関わらず、表示されている段のみでタッチ判定を行う
  const idxFromTop = Math.floor(clampedTopRatio * activeDepths);
  const depth = (activeDepths - 1) - idxFromTop;
  return Math.max(0, Math.min(activeDepths - 1, depth));
}
