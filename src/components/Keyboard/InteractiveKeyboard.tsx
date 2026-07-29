import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {LayoutPreset, TuningPreset, AppSettings, LaneConfig} from '../../types/keyboard';
import {encodeAddress} from '../../core/address';
import {calculateFrequency, getFormattedPitchLabel, resolvePitch} from '../../core/pitch';
import {globalAudioEngine} from '../../core/audio';
import {getDepthFromBoundaries, getLaneBoundaries, getSegmentHeightsFromBoundaries} from '../../core/laneBoundaries';
import {getKeyboardColumnRange} from '../../core/keyboardRange';

interface InteractiveKeyboardProps {
  layout: LayoutPreset;
  tuning: TuningPreset;
  settings: AppSettings;
  octaveShift?: number;
  scrollOffsetColumns?: number;
  onChangeScrollOffsetColumns?: (offset: number) => void;
  externalPressedAddresses?: Set<number>;
}

type PointerPressState = {
  address: number;
  token: number;
  voiceId?: string;
};

type SegmentRenderInfo = {
  depth: number;
  heightPercent: number;
  isInvalid: boolean;
};

const OVERSCAN_COLUMNS = 1;

export const InteractiveKeyboard: React.FC<InteractiveKeyboardProps> = ({
  layout,
  tuning,
  settings,
  octaveShift = 0,
  scrollOffsetColumns = 0,
  onChangeScrollOffsetColumns,
  externalPressedAddresses,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pressTokenRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);
  const [pressedPointers, setPressedPointers] = useState<Map<string, PointerPressState>>(new Map());
  const [viewportWidth, setViewportWidth] = useState(0);
  const columnRange = useMemo(() => getKeyboardColumnRange(layout, tuning, octaveShift), [layout, tuning, octaveShift]);
  const {period, startRepeat, totalColumns} = columnRange;

  const heldAddressSet = useMemo(() => {
    const set = new Set<number>(externalPressedAddresses ?? []);
    pressedPointers.forEach(({address}) => set.add(address));
    return set;
  }, [externalPressedAddresses, pressedPointers]);

  const visibleColumnRange = useMemo(() => {
    const keyWidth = settings.keyWidth;
    const start = Math.max(0, Math.floor((scrollOffsetColumns * keyWidth) / keyWidth) - OVERSCAN_COLUMNS);
    const end = Math.min(
      totalColumns - 1,
      Math.ceil(((scrollOffsetColumns * keyWidth) + viewportWidth) / keyWidth) + OVERSCAN_COLUMNS,
    );
    return {start, end};
  }, [scrollOffsetColumns, settings.keyWidth, totalColumns, viewportWidth]);

  const getLane = useCallback(
    (x: number, isBlack: boolean): LaneConfig | undefined => {
      const laneIdx = (x % period) * 2 + (isBlack ? 1 : 0);
      return layout.lanes[laneIdx];
    },
    [layout, period],
  );

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

      if (relY <= blackHeight) {
        const roughX = Math.floor(relX / keyWidth);
        const startX = Math.max(0, roughX - 2);
        const endX = Math.min(totalColumns - 1, roughX + 2);

        for (let x = startX; x <= endX; x += 1) {
          const lane = getLane(x, true);
          const activeDepths = lane?.activeDepths ?? 0;
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
              calculateDepthFromRatio(
                relY / blackHeight,
                activeDepths,
                lane ? getLaneBoundaries(layout, lane, true) : [0, 1],
                settings.showInvalidSections,
              ),
            );
          }
        }
      }

      const whiteXIndex = Math.floor(relX / keyWidth);
      if (whiteXIndex >= 0 && whiteXIndex < totalColumns) {
        const lane = getLane(whiteXIndex, false);
        const activeDepths = lane?.activeDepths ?? 0;
        return encodeAddress(
          whiteXIndex,
          false,
          calculateDepthFromRatio(
            relY / totalHeight,
            activeDepths,
            lane ? getLaneBoundaries(layout, lane, false) : [0, 1],
            settings.showInvalidSections,
          ),
        );
      }

      return null;
    },
    [getLane, layout, period, settings.blackKeyHeightRatio, settings.blackKeyWidthRatio, settings.keyWidth, settings.showInvalidSections, totalColumns],
  );

  const triggerNoteOn = useCallback(
    async (address: number, pointerKey: string, velocity: number = 1.0) => {
      const x = Math.floor(address / 16);
      const isBlack = address % 16 >= 8;
      const depth = address % 8;
      const baseX = x % period;
      const baseAddress = encodeAddress(baseX, isBlack, depth);
      const octOffset = startRepeat + Math.floor(x / period);
      const pitchRef = layout.mapping[baseAddress];

      if (pitchRef === undefined || pitchRef === -1) {
        return;
      }

      const {pitchDef, octaveShift: tuningOctaveShift} = resolvePitch(pitchRef, tuning);
      if (!pitchDef) {
        return;
      }

      const token = ++pressTokenRef.current;
      setPressedPointers((prev) => new Map(prev).set(pointerKey, {address, token}));

      const frequency = calculateFrequency(pitchDef, tuning, octaveShift + tuningOctaveShift + octOffset);
      const voiceId = await globalAudioEngine.noteOn(address, pitchRef, frequency, velocity, pointerKey);

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
    [layout, octaveShift, period, startRepeat, tuning],
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

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? 0;
      setViewportWidth(nextWidth);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    containerRef.current.scrollLeft = Math.max(0, scrollOffsetColumns) * settings.keyWidth;
  }, [scrollOffsetColumns, settings.keyWidth]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current || !onChangeScrollOffsetColumns) {
      return;
    }
    if (scrollRafRef.current !== null) {
      return;
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (!containerRef.current) {
        return;
      }
      onChangeScrollOffsetColumns(containerRef.current.scrollLeft / settings.keyWidth);
    });
  }, [onChangeScrollOffsetColumns, settings.keyWidth]);

  const renderWhiteKey = (x: number) => {
    const lane = getLane(x, false);
    const activeDepths = lane?.activeDepths ?? 0;
    const octOffset = startRepeat + Math.floor(x / period);
    const baseX = x % period;
    const segments = getRenderedSegments(activeDepths, lane, layout, false, settings.showInvalidSections);

    return (
      <div
        key={`white_${x}`}
        className="relative flex h-full flex-col select-none rounded-b-md border-r border-slate-400/80 bg-white shadow-[inset_-1px_0_2px_rgba(0,0,0,0.1)]"
        style={{width: `${settings.keyWidth}px`, flexShrink: 0}}
      >
        {segments.map(({depth, heightPercent, isInvalid}) => {
          const address = encodeAddress(x, false, depth);
          const baseAddress = encodeAddress(baseX, false, depth);
          const pitchRef = layout.mapping[baseAddress];
          const isPressed = heldAddressSet.has(address);
          const {pitchDef, octaveShift: tuningOctaveShift} = resolvePitch(pitchRef, tuning);
          const totalOctaveShift = octaveShift + tuningOctaveShift + octOffset;
          const formattedLabel = pitchDef
            ? getFormattedPitchLabel(pitchDef, tuning, settings.pitchLabelMode, totalOctaveShift)
            : '';

          return (
            <div
              key={`white_${x}_depth_${depth}`}
              className={`relative flex flex-col justify-between border-b border-slate-200 p-1 transition-colors ${
                isPressed
                  ? 'bg-gradient-to-b from-amber-300 to-amber-400 text-amber-950 shadow-inner'
                  : isInvalid
                    ? 'border-slate-300 bg-slate-200/80 text-slate-400'
                    : 'text-slate-800 hover:bg-slate-100'
              }`}
              style={{height: `${heightPercent}%`, flex: '0 0 auto'}}
            >
              {settings.showAddressBinary && (
                <div className="flex items-center justify-between text-[8px] font-mono opacity-50">
                  <span>d{depth}</span>
                  <span>{`0x${address.toString(16).padStart(2, '0').toUpperCase()}`}</span>
                </div>
              )}

              <div className="mb-1 flex justify-center">
                {formattedLabel && (
                  <span className="px-1 text-[10px] font-medium leading-none tracking-tight text-slate-500">
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

  const renderBlackKeyLane = (x: number) => {
    const lane = getLane(x, true);
    const activeDepths = lane?.activeDepths ?? 0;
    if (activeDepths === 0 && !settings.showInvalidSections) {
      return null;
    }

    const octOffset = Math.floor(x / period);
    const logicalOctaveOffset = startRepeat + octOffset;
    const baseX = x % period;
    const blackWidth = settings.keyWidth * settings.blackKeyWidthRatio;
    const center = (x + 1) * settings.keyWidth;
    const blackLeft = center - blackWidth / 2;
    const segments = getRenderedSegments(activeDepths, lane, layout, true, settings.showInvalidSections);

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
        {segments.map(({depth, heightPercent, isInvalid}) => {
          const address = encodeAddress(x, true, depth);
          const baseAddress = encodeAddress(baseX, true, depth);
          const pitchRef = layout.mapping[baseAddress];
          const isPressed = heldAddressSet.has(address);
          const {pitchDef, octaveShift: tuningOctaveShift} = resolvePitch(pitchRef, tuning);
          const totalOctaveShift = octaveShift + tuningOctaveShift + logicalOctaveOffset;
          const formattedLabel = pitchDef
            ? getFormattedPitchLabel(pitchDef, tuning, settings.pitchLabelMode, totalOctaveShift)
            : '';

          return (
            <div
              key={`black_${x}_depth_${depth}`}
              className={`relative flex flex-col justify-between border-b border-slate-800 p-0.5 transition-colors ${
                isPressed
                  ? 'border-amber-500 bg-amber-400 text-amber-950 shadow-inner'
                  : isInvalid
                    ? 'border-slate-800 bg-slate-900/60 text-slate-700'
                    : 'bg-slate-900 text-slate-200 hover:bg-slate-800'
              }`}
              style={{height: `${heightPercent}%`, flex: '0 0 auto'}}
            >
              {settings.showAddressBinary && (
                <div className="flex items-center justify-between text-[7px] font-mono opacity-40">
                  <span>d{depth}</span>
                  <span>{`0x${address.toString(16).padStart(2, '0').toUpperCase()}`}</span>
                </div>
              )}

              <div className="mb-0.5 flex justify-center">
                {formattedLabel && (
                  <span className="px-1 text-[9px] font-medium text-slate-500">
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

  const visibleWhiteKeys = [];
  for (let x = visibleColumnRange.start; x <= visibleColumnRange.end; x += 1) {
    visibleWhiteKeys.push(renderWhiteKey(x));
  }

  const visibleBlackKeys = [];
  for (let x = visibleColumnRange.start; x <= visibleColumnRange.end; x += 1) {
    const key = renderBlackKeyLane(x);
    if (key) {
      visibleBlackKeys.push(key);
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#0d1117]">
      <div
        ref={containerRef}
        className="relative flex flex-1 cursor-pointer select-none overflow-x-auto overflow-y-hidden p-0 touch-none"
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(event) => triggerNoteOff(`pointer_${event.pointerId}`)}
        onPointerCancel={(event) => triggerNoteOff(`pointer_${event.pointerId}`)}
      >
        <div
          className="relative h-full"
          style={{
            width: `${settings.keyWidth * totalColumns + settings.keyWidth * settings.blackKeyWidthRatio}px`,
            minWidth: `${settings.keyWidth * totalColumns + settings.keyWidth * settings.blackKeyWidthRatio}px`,
            paddingRight: `${(settings.keyWidth * settings.blackKeyWidthRatio) / 2}px`,
          }}
        >
          <div
            className="absolute inset-y-0 flex"
            style={{
              left: `${visibleColumnRange.start * settings.keyWidth}px`,
            }}
          >
            {visibleWhiteKeys}
          </div>
          {visibleBlackKeys}
        </div>
      </div>
    </div>
  );
};

function getRenderedSegments(
  activeDepths: number,
  lane: LaneConfig | undefined,
  layout: LayoutPreset,
  isBlack: boolean,
  showInvalidSections: boolean,
): SegmentRenderInfo[] {
  if (showInvalidSections) {
    return Array.from({length: 8}, (_, index) => ({
      depth: 7 - index,
      heightPercent: 12.5,
      isInvalid: 7 - index >= activeDepths,
    }));
  }

  if (activeDepths <= 0) {
    return [];
  }

  const heights = getSegmentHeightsFromBoundaries(getLaneBoundaries(layout, lane, isBlack));
  return Array.from({length: activeDepths}, (_, index) => ({
    depth: activeDepths - 1 - index,
    heightPercent: heights[index] * 100,
    isInvalid: false,
  }));
}

function calculateDepthFromRatio(
  topRatio: number,
  activeDepths: number,
  boundaries: number[],
  showInvalidSections: boolean,
): number {
  if (activeDepths <= 0) {
    return 0;
  }

  const clampedTopRatio = Math.max(0, Math.min(0.9999, topRatio));

  if (showInvalidSections) {
    const idxFromTop = Math.floor(clampedTopRatio * 8);
    return Math.max(0, Math.min(7, 7 - idxFromTop));
  }

  return getDepthFromBoundaries(clampedTopRatio, activeDepths, boundaries);
}
