import React, {useCallback, useRef, useState} from 'react';
import {LayoutPreset, TuningPreset, AppSettings} from '../../types/keyboard';
import {encodeAddress} from '../../core/address';
import {calculateFrequency, getFormattedPitchLabel, resolvePitch} from '../../core/pitch';
import {globalAudioEngine} from '../../core/audio';

interface InteractiveKeyboardProps {
  layout: LayoutPreset;
  tuning: TuningPreset;
  settings: AppSettings;
  octaveShift?: number;
  selectedAddress?: number | null;
  onSelectAddress?: (addr: number) => void;
  externalPressedAddresses?: Set<number>;
}

export const InteractiveKeyboard: React.FC<InteractiveKeyboardProps> = ({
  layout,
  tuning,
  settings,
  octaveShift = 0,
  selectedAddress,
  onSelectAddress,
  externalPressedAddresses,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pressedPointers, setPressedPointers] = useState<Map<string, {address: number; voiceId: string}>>(
    new Map<string, {address: number; voiceId: string}>(),
  );

  const heldAddressSet = new Set<number>(externalPressedAddresses ?? []);
  pressedPointers.forEach(({address}) => heldAddressSet.add(address));

  const getLaneDepths = (x: number, isBlack: boolean) => {
    const period = layout.horizontalCount || 16;
    const laneIdx = (x % period) * 2 + (isBlack ? 1 : 0);
    const lane = layout.lanes[laneIdx];
    return lane ? lane.activeDepths : 0;
  };

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

      if (relY <= blackH) {
        for (let x = 0; x < visibleCols; x++) {
          const activeDepths = getLaneDepths(x, true);
          if (activeDepths === 0 && !settings.showInvalidSections) continue;

          const blackW = keyW * settings.blackKeyWidthRatio;
          const center = (x + 1) * keyW;
          const blackLeft = center - blackW / 2;
          const blackRight = center + blackW / 2;

          if (relX >= blackLeft && relX <= blackRight) {
            return encodeAddress(
              x,
              true,
              calculateDepthFromRatio(x, true, relY / blackH, activeDepths, layout, settings),
            );
          }
        }
      }

      const whiteXIndex = Math.floor(relX / keyW);
      if (whiteXIndex >= 0 && whiteXIndex < visibleCols) {
        const activeDepths = getLaneDepths(whiteXIndex, false);
        return encodeAddress(
          whiteXIndex,
          false,
          calculateDepthFromRatio(whiteXIndex, false, relY / totalHeight, activeDepths, layout, settings),
        );
      }

      return null;
    },
    [layout, settings],
  );

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
        onSelectAddress?.(address);
        return;
      }

      const {pitchDef, octaveShift: tuningOctaveShift} = resolvePitch(pitchId, tuning);
      if (!pitchDef) return;

      const freq = calculateFrequency(pitchDef, tuning, octaveShift + tuningOctaveShift + octOffset);
      const voiceId = await globalAudioEngine.noteOn(address, pitchId, freq, velocity, pointerKey);

      setPressedPointers((prev) => {
        const next = new Map(prev);
        next.set(pointerKey, {address, voiceId});
        return next;
      });

      onSelectAddress?.(address);
    },
    [layout, octaveShift, onSelectAddress, tuning],
  );

  const triggerNoteOff = useCallback((pointerKey: string) => {
    setPressedPointers((prev) => {
      const next = new Map(prev);
      const item = next.get(pointerKey);
      if (item) {
        globalAudioEngine.noteOff(item.voiceId);
        next.delete(pointerKey);
      }
      return next;
    });
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pointerKey = `pointer_${e.pointerId}`;
    const addr = getAddressFromCoordinates(e.clientX, e.clientY);
    if (addr !== null) {
      const pressure = e.pressure && e.pressure > 0 ? e.pressure : 1.0;
      void triggerNoteOn(addr, pointerKey, pressure);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!e.buttons && e.pointerType === 'mouse') return;

    const pointerKey = `pointer_${e.pointerId}`;
    const currentItem = pressedPointers.get(pointerKey);
    const newAddr = getAddressFromCoordinates(e.clientX, e.clientY);

    if (newAddr !== null) {
      if (!currentItem || currentItem.address !== newAddr) {
        if (currentItem) {
          triggerNoteOff(pointerKey);
        }
        const pressure = e.pressure && e.pressure > 0 ? e.pressure : 1.0;
        void triggerNoteOn(newAddr, pointerKey, pressure);
      }
    } else if (currentItem) {
      triggerNoteOff(pointerKey);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    triggerNoteOff(`pointer_${e.pointerId}`);
  };

  const [visibleColumns, setVisibleColumns] = useState(16);

  React.useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        setVisibleColumns(Math.max(16, Math.ceil(width / settings.keyWidth) + 1));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [settings.keyWidth]);

  const renderWhiteKey = (x: number) => {
    const activeDepths = getLaneDepths(x, false);
    const period = layout.horizontalCount || 16;
    const octOffset = Math.floor(x / period);
    const baseX = x % period;

    return (
      <div
        key={`white_${x}`}
        className="relative flex flex-col border-r border-slate-400/80 bg-white select-none h-full shadow-[inset_-1px_0_2px_rgba(0,0,0,0.1)] rounded-b-md"
        style={{width: `${settings.keyWidth}px`, flexShrink: 0}}
      >
        {Array.from({length: 8}, (_, idx) => {
          const depth = 7 - idx;
          const isInvalid = depth >= activeDepths;
          const address = encodeAddress(x, false, depth);
          const baseAddress = encodeAddress(baseX, false, depth);
          const pitchId = layout.mapping[baseAddress];
          const isPressed = heldAddressSet.has(address);
          const isSelected = selectedAddress === address;

          if (isInvalid && !settings.showInvalidSections) {
            return null;
          }

          const {pitchDef, octaveShift: tuningOctaveShift} = resolvePitch(pitchId, tuning);
          const totalOctaveShift = octaveShift + tuningOctaveShift + octOffset;
          const formattedLabel = pitchDef
            ? getFormattedPitchLabel(pitchDef, tuning, settings.pitchLabelMode, totalOctaveShift)
            : '';

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

  const renderBlackKeys = () =>
    Array.from({length: visibleColumns}, (_, x) => {
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
          {Array.from({length: 8}, (_, idx) => {
            const depth = 7 - idx;
            const isInvalid = depth >= activeDepths;
            const address = encodeAddress(x, true, depth);
            const baseAddress = encodeAddress(baseX, true, depth);
            const pitchId = layout.mapping[baseAddress];
            const isPressed = heldAddressSet.has(address);
            const isSelected = selectedAddress === address;

            if (isInvalid && !settings.showInvalidSections) {
              return null;
            }

            const {pitchDef, octaveShift: tuningOctaveShift} = resolvePitch(pitchId, tuning);
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

  return (
    <div className="w-full flex flex-col h-full bg-[#0d1117] overflow-hidden">
      <div
        ref={containerRef}
        className="relative flex-1 flex overflow-x-hidden overflow-y-hidden touch-none select-none p-0 cursor-pointer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="relative flex h-full w-full">
          {Array.from({length: visibleColumns}, (_, x) => renderWhiteKey(x))}
          {renderBlackKeys()}
        </div>
      </div>
    </div>
  );
};

function calculateDepthFromRatio(
  x: number,
  isBlack: boolean,
  topRatio: number,
  activeDepths: number,
  layout: LayoutPreset,
  settings: AppSettings,
): number {
  if (activeDepths <= 0) return 0;

  const clampedTopRatio = Math.max(0, Math.min(0.9999, topRatio));

  if (settings.showInvalidSections) {
    const idxFromTop = Math.floor(clampedTopRatio * 8);
    return Math.max(0, Math.min(7, 7 - idxFromTop));
  }

  const idxFromTop = Math.floor(clampedTopRatio * activeDepths);
  return Math.max(0, Math.min(activeDepths - 1, activeDepths - 1 - idxFromTop));
}
