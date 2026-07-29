import React, {useEffect, useMemo, useState} from 'react';
import {LayoutPreset} from '../../types/keyboard';
import {getSegmentHeightsFromBoundaries, getTemplateBoundaries, sanitizeBoundaries} from '../../core/laneBoundaries';

interface LaneBoundaryEditorProps {
  layout: LayoutPreset;
  displayHorizontalCount: number;
  onUpdateLayout: (newLayout: LayoutPreset) => void;
}

type DragState = {
  isBlack: boolean;
  activeDepths: number;
  boundaryIndex: number;
  startY: number;
  startValue: number;
};

const MIN_SEGMENT_SIZE = 0.04;
const SNAP_DISTANCE = 0.03;

export const LaneBoundaryEditor: React.FC<LaneBoundaryEditorProps> = ({
  layout,
  displayHorizontalCount,
  onUpdateLayout,
}) => {
  const [dragState, setDragState] = useState<DragState | null>(null);

  const usedDepthGroups = useMemo(() => {
    const white = new Set<number>();
    const black = new Set<number>();

    for (let x = 0; x < displayHorizontalCount; x += 1) {
      const whiteDepths = layout.lanes[x * 2]?.activeDepths ?? 0;
      const blackDepths = layout.lanes[x * 2 + 1]?.activeDepths ?? 0;
      if (whiteDepths >= 2) {
        white.add(whiteDepths);
      }
      if (blackDepths >= 2) {
        black.add(blackDepths);
      }
    }

    return {
      white: Array.from(white).sort((a, b) => a - b),
      black: Array.from(black).sort((a, b) => a - b),
    };
  }, [displayHorizontalCount, layout.lanes]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const deltaRatio = (event.clientY - dragState.startY) / 220;
      const boundaries = [...getTemplateBoundaries(layout, dragState.activeDepths, dragState.isBlack)];
      const minValue = boundaries[dragState.boundaryIndex - 1] + MIN_SEGMENT_SIZE;
      const maxValue = boundaries[dragState.boundaryIndex + 1] - MIN_SEGMENT_SIZE;
      let nextValue = Math.max(minValue, Math.min(maxValue, dragState.startValue + deltaRatio));

      const templateMap: Record<number, number[]> =
        dragState.isBlack
          ? layout.blackBoundaryTemplates ?? layout.boundaryTemplates
          : layout.whiteBoundaryTemplates ?? layout.boundaryTemplates;
      const snapSources = Object.values(templateMap)
        .flatMap((template) => {
          if (!template || template.length < 3) {
            return [];
          }
          return template.slice(1, -1);
        })
        .filter((value) => value > minValue && value < maxValue);

      for (const snapValue of snapSources) {
        if (Math.abs(snapValue - nextValue) <= SNAP_DISTANCE) {
          nextValue = snapValue;
          break;
        }
      }

      boundaries[dragState.boundaryIndex] = nextValue;
      updateTemplate(layout, dragState.isBlack, dragState.activeDepths, sanitizeBoundaries(boundaries, dragState.activeDepths), onUpdateLayout);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-xs text-slate-300">
        使用中の段数ごとに、高さテンプレートを白鍵用・黒鍵用で調整します。上側が黒鍵プレビューです。既存の境界位置に近づくと吸い付きます。
      </div>

      <TemplateGroup
        title="黒鍵側テンプレート"
        isBlack
        layout={layout}
        depthGroups={usedDepthGroups.black}
        onStartDrag={setDragState}
        onReset={(activeDepths) =>
          updateTemplate(layout, true, activeDepths, undefined, onUpdateLayout)
        }
      />

      <TemplateGroup
        title="白鍵側テンプレート"
        isBlack={false}
        layout={layout}
        depthGroups={usedDepthGroups.white}
        onStartDrag={setDragState}
        onReset={(activeDepths) =>
          updateTemplate(layout, false, activeDepths, undefined, onUpdateLayout)
        }
      />
    </div>
  );
};

function updateTemplate(
  layout: LayoutPreset,
  isBlack: boolean,
  activeDepths: number,
  boundaries: number[] | undefined,
  onUpdateLayout: (newLayout: LayoutPreset) => void,
) {
  const targetKey = isBlack ? 'blackBoundaryTemplates' : 'whiteBoundaryTemplates';
  const nextTemplates = {
    ...(isBlack ? layout.blackBoundaryTemplates ?? layout.boundaryTemplates : layout.whiteBoundaryTemplates ?? layout.boundaryTemplates),
  };

  if (boundaries) {
    nextTemplates[activeDepths] = boundaries;
  } else {
    delete nextTemplates[activeDepths];
  }

  const nextLanes = layout.lanes.map((lane, laneIndex) => {
    const laneIsBlack = laneIndex % 2 === 1;
    if (laneIsBlack !== isBlack || lane.activeDepths !== activeDepths) {
      return lane;
    }
    return {
      ...lane,
      customBoundaries: undefined,
    };
  });

  onUpdateLayout({
    ...layout,
    lanes: nextLanes,
    [targetKey]: nextTemplates,
  });
}

interface TemplateGroupProps {
  title: string;
  isBlack: boolean;
  layout: LayoutPreset;
  depthGroups: number[];
  onStartDrag: (state: DragState) => void;
  onReset: (activeDepths: number) => void;
}

const TemplateGroup: React.FC<TemplateGroupProps> = ({
  title,
  isBlack,
  layout,
  depthGroups,
  onStartDrag,
  onReset,
}) => (
  <div className="flex flex-col gap-3 rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-sm">
    <div className="border-b border-[#30363d] pb-2">
      <h3 className="text-sm font-bold text-slate-100">{title}</h3>
    </div>

    {depthGroups.length === 0 ? (
      <div className="rounded border border-[#30363d] bg-[#0d1117] px-3 py-5 text-center text-[11px] text-slate-500">
        2段以上で使われているテンプレートはありません。
      </div>
    ) : (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {depthGroups.map((activeDepths) => (
          <TemplateCard
            key={`${isBlack ? 'black' : 'white'}_${activeDepths}`}
            isBlack={isBlack}
            activeDepths={activeDepths}
            boundaries={getTemplateBoundaries(layout, activeDepths, isBlack)}
            onStartDrag={onStartDrag}
            onReset={() => onReset(activeDepths)}
          />
        ))}
      </div>
    )}
  </div>
);

interface TemplateCardProps {
  isBlack: boolean;
  activeDepths: number;
  boundaries: number[];
  onStartDrag: (state: DragState) => void;
  onReset: () => void;
}

const TemplateCard: React.FC<TemplateCardProps> = ({
  isBlack,
  activeDepths,
  boundaries,
  onStartDrag,
  onReset,
}) => {
  const segmentHeights = getSegmentHeightsFromBoundaries(boundaries);
  const accentClass = isBlack ? 'bg-slate-900 text-slate-300 border-slate-700' : 'bg-slate-200 text-slate-600 border-slate-300';

  return (
    <div className="rounded border border-[#30363d] bg-[#0d1117] p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-slate-300">
        <span>{activeDepths} 段</span>
        <button onClick={onReset} className="rounded border border-[#30363d] px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-[#161b22]">
          リセット
        </button>
      </div>

      <div className="relative h-48 overflow-hidden rounded border border-[#30363d] bg-[#161b22]">
        <div className="absolute inset-0 flex flex-col">
          {segmentHeights.map((heightRatio, index) => {
            const depth = activeDepths - 1 - index;
            return (
              <div
                key={`segment_${activeDepths}_${depth}`}
                className={`relative flex items-center justify-center border-b text-[10px] font-bold ${accentClass}`}
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
              key={`handle_${activeDepths}_${boundaryIndex}`}
              type="button"
              onPointerDown={(event) => {
                onStartDrag({
                  isBlack,
                  activeDepths,
                  boundaryIndex,
                  startY: event.clientY,
                  startValue: value,
                });
              }}
              className="absolute left-0 z-10 h-4 w-full -translate-y-1/2 cursor-row-resize touch-none"
              style={{top: `${value * 100}%`}}
              title="境界を調整"
            >
              <span className="absolute left-2 right-2 top-1/2 h-[2px] -translate-y-1/2 rounded bg-white/90 shadow-[0_0_0_1px_rgba(15,23,42,0.6)]" />
              <span className="absolute left-1/2 top-1/2 h-3 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-950/60 bg-white/90" />
            </button>
          );
        })}
      </div>
    </div>
  );
};
