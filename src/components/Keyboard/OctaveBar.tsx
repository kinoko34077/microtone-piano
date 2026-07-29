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
  actions?: React.ReactNode;
}

const SCROLL_STEP = 1;

export const OctaveBar: React.FC<OctaveBarProps> = ({
  label,
  octaveOffset,
  onChangeOctaveOffset,
  scrollOffset,
  onChangeScrollOffset,
  maxScrollOffset,
  keyWidth,
  onChangeKeyWidth,
  actions,
}) => {
  const clampedScroll = Math.max(0, Math.min(maxScrollOffset, scrollOffset));

  return (
    <div className="flex select-none items-center justify-between gap-2 border-b border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
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

        <span className="ml-1 text-[10px] font-medium text-slate-400">表示位置</span>
        <button
          onClick={() => onChangeScrollOffset(clampedScroll - SCROLL_STEP)}
          className="rounded border border-[#30363d] bg-[#21262d] px-1.5 py-1 text-[10px] text-slate-200 transition-colors hover:bg-slate-700"
          title="左へ1つ"
        >
          -1
        </button>
        <input
          type="range"
          min="0"
          max={Math.max(0, maxScrollOffset)}
          step={SCROLL_STEP}
          value={Math.round(clampedScroll)}
          onChange={(event) => onChangeScrollOffset(Number(event.target.value))}
          className="h-1 w-24 min-w-0 flex-1 cursor-pointer appearance-none rounded bg-[#30363d] accent-emerald-500"
        />
        <button
          onClick={() => onChangeScrollOffset(clampedScroll + SCROLL_STEP)}
          className="rounded border border-[#30363d] bg-[#21262d] px-1.5 py-1 text-[10px] text-slate-200 transition-colors hover:bg-slate-700"
          title="右へ1つ"
        >
          +1
        </button>
        <div className="flex min-w-[48px] items-center justify-center rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 font-mono font-bold text-emerald-300">
          {Math.round(clampedScroll)}
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
            className="h-1 w-14 cursor-pointer appearance-none rounded bg-[#30363d] accent-sky-500"
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

      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
};
