import React from 'react';
import {ChevronLeft, ChevronRight, ZoomIn, ZoomOut} from 'lucide-react';

interface OctaveBarProps {
  label?: string;
  octaveOffset: number;
  onChangeOctaveOffset: (offset: number) => void;
  scrollOffset: number;
  onChangeScrollOffset: (offset: number) => void;
  maxScrollOffset: number;
  keyWidth: number;
  onChangeKeyWidth: (width: number) => void;
}

const SCROLL_STEP = 0.25;

export const OctaveBar: React.FC<OctaveBarProps> = ({
  label,
  octaveOffset,
  onChangeOctaveOffset,
  scrollOffset,
  onChangeScrollOffset,
  maxScrollOffset,
  keyWidth,
  onChangeKeyWidth,
}) => {
  const clampedScroll = Math.max(0, Math.min(maxScrollOffset, scrollOffset));

  return (
    <div className="flex select-none flex-wrap items-center justify-between gap-2 border-b border-[#30363d] bg-[#0d1117] px-2 py-1 pr-[8.5rem] text-xs md:pr-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {label && <span className="mr-1 text-[11px] font-bold text-sky-400">{label}</span>}

        <span className="text-[10px] font-medium text-slate-400">オクターブ</span>
        <button
          onClick={() => onChangeOctaveOffset(octaveOffset - 1)}
          className="rounded border border-[#30363d] bg-[#21262d] p-1 text-slate-200 transition-colors hover:bg-slate-700"
          title="1オクターブ下げる"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-[52px] items-center justify-center rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 font-mono font-bold text-sky-300">
          {octaveOffset > 0 ? `+${octaveOffset}` : octaveOffset} oct
        </div>
        <button
          onClick={() => onChangeOctaveOffset(octaveOffset + 1)}
          className="rounded border border-[#30363d] bg-[#21262d] p-1 text-slate-200 transition-colors hover:bg-slate-700"
          title="1オクターブ上げる"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-medium text-slate-400">表示位置</span>
        <button
          onClick={() => onChangeScrollOffset(clampedScroll - SCROLL_STEP)}
          className="rounded border border-[#30363d] bg-[#21262d] px-1.5 py-1 text-[10px] text-slate-200 transition-colors hover:bg-slate-700"
          title="少し左へ"
        >
          -0.25
        </button>
        <input
          type="range"
          min="0"
          max={Math.max(0, maxScrollOffset)}
          step={SCROLL_STEP}
          value={clampedScroll}
          onChange={(event) => onChangeScrollOffset(Number(event.target.value))}
          className="h-1 w-28 cursor-pointer appearance-none rounded bg-[#30363d] accent-emerald-500"
        />
        <button
          onClick={() => onChangeScrollOffset(clampedScroll + SCROLL_STEP)}
          className="rounded border border-[#30363d] bg-[#21262d] px-1.5 py-1 text-[10px] text-slate-200 transition-colors hover:bg-slate-700"
          title="少し右へ"
        >
          +0.25
        </button>
        <div className="flex min-w-[60px] items-center justify-center rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 font-mono font-bold text-emerald-300">
          {clampedScroll.toFixed(2)}
        </div>

        <span className="hidden text-[10px] font-medium text-slate-400 sm:inline">鍵盤幅</span>
        <div className="flex items-center gap-1.5 rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5">
          <button
            onClick={() => onChangeKeyWidth(Math.max(24, keyWidth - 4))}
            className="text-slate-400 transition-colors hover:text-white"
            title="鍵盤幅を狭くする"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <input
            type="range"
            min="24"
            max="120"
            value={keyWidth}
            onChange={(event) => onChangeKeyWidth(Number(event.target.value))}
            className="h-1 w-16 cursor-pointer appearance-none rounded bg-[#30363d] accent-sky-500"
          />
          <button
            onClick={() => onChangeKeyWidth(Math.min(120, keyWidth + 4))}
            className="text-slate-400 transition-colors hover:text-white"
            title="鍵盤幅を広くする"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <span className="w-8 text-right text-[10px] font-bold text-sky-400">{keyWidth}px</span>
        </div>
      </div>
    </div>
  );
};
