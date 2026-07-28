import React, {useEffect, useMemo, useState} from 'react';
import {LayoutPreset} from '../../types/keyboard';
import {getLaneBoundaries, getSegmentHeightsFromBoundaries, sanitizeBoundaries} from '../../core/laneBoundaries';

interface LaneBoundaryEditorProps {
  layout: LayoutPreset;
  displayHorizontalCount: number;
  onUpdateLayout: (newLayout: LayoutPreset) => void;
}

type DragState = {
  laneIndex: number;
  boundaryIndex: number;
  startY: number;
  startValue: number;
};

const MIN_SEGMENT_SIZE = 0.04;

export const LaneBoundaryEditor: React.FC<LaneBoundaryEditorProps> = ({
  layout,
  displayHorizontalCount,
  onUpdateLayout,
}) => {
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const lane = layout.lanes[dragState.laneIndex];
      const activeDepths = lane?.activeDepths ?? 0;
      if (activeDepths < 2) {
        return;
      }

      const deltaRatio = (event.clientY - dragState.startY) / 180;
      const boundaries = [...getLaneBoundaries(layout, lane)];
      const minValue = boundaries[dragState.boundaryIndex - 1] + MIN_SEGMENT_SIZE;
      const maxValue = boundaries[dragState.boundaryIndex + 1] - MIN_SEGMENT_SIZE;
      boundaries[dragState.boundaryIndex] = Math.max(minValue, Math.min(maxValue, dragState.startValue + deltaRatio));

      const nextLanes = [...layout.lanes];
      nextLanes[dragState.laneIndex] = {
        ...nextLanes[dragState.laneIndex],
        customBoundaries: sanitizeBoundaries(boundaries, activeDepths),
      };
      onUpdateLayout({...layout, lanes: nextLanes});
    };

    const handlePointerUp = () => {
      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [dragState, layout, onUpdateLayout]);

  const laneCards = useMemo(
    () =>
      Array.from({length: displayHorizontalCount}, (_, x) => {
        const whiteLaneIndex = x * 2;
        const blackLaneIndex = x * 2 + 1;
        return {
          x,
          whiteLaneIndex,
          blackLaneIndex,
          whiteLane: layout.lanes[whiteLaneIndex],
          blackLane: layout.lanes[blackLaneIndex],
        };
      }),
    [displayHorizontalCount, layout.lanes],
  );

  const resetLaneBoundaries = (laneIndex: number) => {
    const nextLanes = [...layout.lanes];
    const lane = nextLanes[laneIndex];
    nextLanes[laneIndex] = {
      ...lane,
      customBoundaries: undefined,
    };
    onUpdateLayout({...layout, lanes: nextLanes});
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-xs text-slate-300">
        段境界をドラッグして各段の高さ比率を調整します。各バーは 100% 積み上げで、上から順に段が並びます。
      </div>

      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        }}
      >
        {laneCards.map(({x, whiteLaneIndex, blackLaneIndex, whiteLane, blackLane}) => (
          <div key={`lane_boundary_${x}`} className="flex flex-col gap-3 rounded border border-[#30363d] bg-[#0d1117] p-3">
            <div className="border-b border-[#30363d] pb-2 text-center font-mono text-xs font-bold text-sky-400">
              x = {x.toString(16).toUpperCase()}
            </div>

            <LaneBoundaryBar
              label="白鍵"
              accentClass="bg-sky-500"
              lane={whiteLane}
              boundaries={getLaneBoundaries(layout, whiteLane)}
              laneIndex={whiteLaneIndex}
              onStartDrag={setDragState}
              onReset={() => resetLaneBoundaries(whiteLaneIndex)}
            />

            <LaneBoundaryBar
              label="黒鍵"
              accentClass="bg-amber-500"
              lane={blackLane}
              boundaries={getLaneBoundaries(layout, blackLane)}
              laneIndex={blackLaneIndex}
              onStartDrag={setDragState}
              onReset={() => resetLaneBoundaries(blackLaneIndex)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

interface LaneBoundaryBarProps {
  label: string;
  accentClass: string;
  lane: LayoutPreset['lanes'][number] | undefined;
  boundaries: number[];
  laneIndex: number;
  onStartDrag: (state: DragState) => void;
  onReset: () => void;
}

const LaneBoundaryBar: React.FC<LaneBoundaryBarProps> = ({
  label,
  accentClass,
  lane,
  boundaries,
  laneIndex,
  onStartDrag,
  onReset,
}) => {
  const activeDepths = lane?.activeDepths ?? 0;
  const segmentHeights = getSegmentHeightsFromBoundaries(boundaries);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
        <span>{label}</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-slate-400">{activeDepths}段</span>
          <button onClick={onReset} className="rounded border border-[#30363d] px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-[#161b22]">
            リセット
          </button>
        </div>
      </div>

      {activeDepths < 2 ? (
        <div className="rounded border border-[#30363d] bg-[#161b22] px-3 py-5 text-center text-[11px] text-slate-500">
          2段以上で調整できます
        </div>
      ) : (
        <div className="relative h-44 overflow-hidden rounded border border-[#30363d] bg-[#161b22]">
          <div className="absolute inset-0 flex flex-col">
            {segmentHeights.map((heightRatio, index) => {
              const depth = activeDepths - 1 - index;
              return (
                <div
                  key={`segment_${laneIndex}_${depth}`}
                  className={`relative flex items-center justify-center border-b border-[#0d1117] text-[10px] font-bold text-white ${accentClass}`}
                  style={{height: `${heightRatio * 100}%`}}
                >
                  d{depth}
                </div>
              );
            })}
          </div>

          {boundaries.slice(1, -1).map((value, offset) => {
            const boundaryIndex = offset + 1;
            return (
              <button
                key={`handle_${laneIndex}_${boundaryIndex}`}
                type="button"
                onPointerDown={(event) => {
                  onStartDrag({
                    laneIndex,
                    boundaryIndex,
                    startY: event.clientY,
                    startValue: value,
                  });
                }}
                className="absolute left-0 z-10 h-3 w-full -translate-y-1/2 cursor-row-resize touch-none"
                style={{top: `${value * 100}%`}}
                title="境界をドラッグ"
              >
                <span className="absolute left-2 right-2 top-1/2 h-[2px] -translate-y-1/2 rounded bg-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.6)]" />
                <span className="absolute left-1/2 top-1/2 h-3 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-950/60 bg-white/90" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
