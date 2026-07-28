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

type PointerPressState = {
  address: number;
  token: number;
  voiceId?: string;
};

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
  const pressTokenRef = useRef(0);
  const [pressedPointers, setPressedPointers] = useState<Map<string, PointerPressState>>(new Map());
  const [visibleColumns, setVisibleColumns] = useState(16);

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
      if (!containerRef.current) {
        return null;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const scrollLeft = containerRef.current.scrollLeft;
      const relX = clientX - rect.left + scrollLeft;
      const relY = clientY - rect.top;
      const totalHeight = rect.height;
      const keyWidth = settings.keyWidth;
      const blackHeight = totalHeight * settings.blackKeyHeightRatio;
      const visibleCols = Math.max(16, Math.ceil(rect.width / keyWidth) + 1);

      if (relY <= blackHeight) {
        for (let x = 0; x < visibleCols; x += 1) {
          const activeDepths = getLaneDepths(x, true);
          if (activeDepths === 0 && !settings.showInvalidSections) {
            continue;
          }

          const blackWidth = keyWidth * settings.blackKeyWidthRatio;
          const center = (x + 1) * keyWidth;
          const blackLeft = center - blackWidth / 2;
          const blackRight = center + blackWidth / 2;

          if (relX >= blackLeft && relX <= blackRight) {
            return encodeAddress(
              x,
              true,
              calculateDepthFromRatio(relY / blackHeight, activeDepths, settings.showInvalidSections),
            );
          }
        }
      }

      const whiteXIndex = Math.floor(relX / keyWidth);
      if (whiteXIndex >= 0 && whiteXIndex < visibleCols) {
        const activeDepths = getLaneDepths(whiteXIndex, false);
        return encodeAddress(
          whiteXIndex,
          false,
          calculateDepthFromRatio(relY / totalHeight, activeDepths, settings.showInvalidSections),
        );
      }

      return null;
    },
    [layout, settings.blackKeyHeightRatio, settings.blackKeyWidthRatio, settings.keyWidth, settings.showInvalidSections],
  );

  const triggerNoteOn = useCallback(
    async (address: number, pointerKey: string, velocity: number = 1.0) => {
      const period = layout.horizontalCount || 16;
      const x = Math.floor(address / 16);
      const isBlack = address % 16 >= 8;
      const depth = address % 8;
      const baseAddress = encodeAddress(x % period, isBlack, depth);
      const octOffset = Math.floor(x / period);
      const pitchId = layout.mapping[baseAddress];

      if (pitchId === undefined || pitchId === -1) {
        onSelectAddress?.(address);
        return;
      }

      const {pitchDef, octaveShift: tuningOctaveShift} = resolvePitch(pitchId, tuning);
      if (!pitchDef) {
        return;
      }

      const token = ++pressTokenRef.current;
      setPressedPointers((prev) => {
        const next = new Map(prev);
        next.set(pointerKey, {address, token});
        return next;
      });

      onSelectAddress?.(address);

      const frequency = calculateFrequency(pitchDef, tuning, octaveShift + tuningOctaveShift + octOffset);
      const voiceId = await globalAudioEngine.noteOn(address, pitchId, frequency, velocity, pointerKey);

      setPressedPointers((prev) => {
        const current = prev.get(pointerKey);
        if (!current || current.token !== token) {
          globalAudioEngine.noteOff(voiceId);
          return prev;
        }

        const next = new Map(prev);
        next.set(pointerKey, {...current, voiceId});
        return next;
      });
    },
    [layout, octaveShift, onSelectAddress, tuning],
  );

  const triggerNoteOff = useCallback((pointerKey: string) => {
    setPressedPointers((prev) => {
      const current = prev.get(pointerKey);
      if (!current) {
        return prev;
      }

      if (current.voiceId) {
        globalAudioEngine.noteOff(current.voiceId);
      }

      const next = new Map(prev);
      next.delete(pointerKey);
      return next;
    });
  }, []);

  const handlePointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerKey = `pointer_${event.pointerId}`;
    const address = getAddressFromCoordinates(event.clientX, event.clientY);
    if (address !== null) {
      const pressure = event.pressure && event.pressure > 0 ? event.pressure : 1.0;
      void triggerNoteOn(address, pointerKey, pressure);
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!event.buttons && event.pointerType === 'mouse') {
      return;
    }

    const pointerKey = `pointer_${event.pointerId}`;
    const currentItem = pressedPointers.get(pointerKey);
    const newAddress = getAddressFromCoordinates(event.clientX, event.clientY);

    if (newAddress !== null) {
      if (!currentItem || currentItem.address !== newAddress) {
        if (currentItem) {
          triggerNoteOff(pointerKey);
        }
        const pressure = event.pressure && event.pressure > 0 ? event.pressure : 1.0;
        void triggerNoteOn(newAddress, pointerKey, pressure);
      }
    } else if (currentItem) {
      triggerNoteOff(pointerKey);
    }
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    triggerNoteOff(`pointer_${event.pointerId}`);
  };

  React.useEffect(() => {
    if (!containerRef.current) {
      return;
    }

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
        className="relative flex h-full flex-col select-none rounded-b-md border-r border-slate-400/80 bg-white shadow-[inset_-1px_0_2px_rgba(0,0,0,0.1)]"
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
              className={`relative flex flex-1 flex-col justify-between border-b border-slate-200 p-1 transition-colors ${
                isPressed
                  ? 'bg-gradient-to-b from-amber-300 to-amber-400 text-amber-950 shadow-inner'
                  : isSelected
                    ? 'border-sky-400 bg-sky-100 text-sky-900'
                    : isInvalid
                      ? 'border-slate-300 bg-slate-200/80 text-slate-400'
                      : 'text-slate-800 hover:bg-slate-100'
              }`}
            >
              <div className="flex items-center justify-between text-[8px] font-mono opacity-50">
                <span>d{depth}</span>
                {settings.showAddressBinary && <span>{`0x${address.toString(16).padStart(2, '0').toUpperCase()}`}</span>}
              </div>

              <div className="mb-1 flex justify-center">
                {formattedLabel && (
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] font-extrabold leading-none tracking-tight shadow-sm ${badgeBg}`}>
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
      if (activeDepths === 0 && !settings.showInvalidSections) {
        return null;
      }

      const period = layout.horizontalCount || 16;
      const octOffset = Math.floor(x / period);
      const baseX = x % period;
      const blackWidth = settings.keyWidth * settings.blackKeyWidthRatio;
      const center = (x + 1) * settings.keyWidth;
      const blackLeft = center - blackWidth / 2;

      return (
        <div
          key={`black_lane_${x}`}
          className="absolute top-0 z-10 flex select-none flex-col overflow-hidden rounded-b-md border-x border-b border-slate-800 bg-gradient-to-b from-slate-900 to-black shadow-2xl"
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
                className={`relative flex flex-1 flex-col justify-between border-b border-slate-800 p-0.5 transition-colors ${
                  isPressed
                    ? 'border-amber-500 bg-amber-400 text-amber-950 shadow-inner'
                    : isSelected
                      ? 'border-sky-400 bg-sky-500 text-white'
                      : isInvalid
                        ? 'border-slate-800 bg-slate-900/60 text-slate-700'
                        : 'bg-slate-900 text-slate-200 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-[7px] font-mono opacity-40">
                  <span>d{depth}</span>
                  {settings.showAddressBinary && <span>{`0x${address.toString(16).padStart(2, '0').toUpperCase()}`}</span>}
                </div>

                <div className="mb-0.5 flex justify-center">
                  {formattedLabel && (
                    <span className="rounded border border-slate-700 bg-slate-800 px-1 py-[1px] text-[9px] font-extrabold text-amber-300">
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
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0d1117]">
      <div
        ref={containerRef}
        className="relative flex flex-1 cursor-pointer select-none overflow-x-hidden overflow-y-hidden p-0 touch-none"
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

function calculateDepthFromRatio(topRatio: number, activeDepths: number, showInvalidSections: boolean): number {
  if (activeDepths <= 0) {
    return 0;
  }

  const clampedTopRatio = Math.max(0, Math.min(0.9999, topRatio));

  if (showInvalidSections) {
    const idxFromTop = Math.floor(clampedTopRatio * 8);
    return Math.max(0, Math.min(7, 7 - idxFromTop));
  }

  const idxFromTop = Math.floor(clampedTopRatio * activeDepths);
  return Math.max(0, Math.min(activeDepths - 1, activeDepths - 1 - idxFromTop));
}
