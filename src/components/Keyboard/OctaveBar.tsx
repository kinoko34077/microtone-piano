import React from 'react';
import {ChevronLeft, ChevronRight, ZoomIn, ZoomOut} from 'lucide-react';

interface OctaveBarProps {
  label?: string;
  octaveOffset: number;
  onChangeOctaveOffset: (offset: number) => void;
  keyWidth: number;
  onChangeKeyWidth: (width: number) => void;
}

export const OctaveBar: React.FC<OctaveBarProps> = ({
  label,
  octaveOffset,
  onChangeOctaveOffset,
  keyWidth,
  onChangeKeyWidth,
}) => {
  return (
    <div className="flex select-none items-center justify-between border-b border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs">
      <div className="flex items-center gap-1.5">
        {label && <span className="mr-1 text-[11px] font-bold text-sky-400">{label}</span>}
        <span className="text-[10px] font-medium text-slate-400">オクターブ</span>

        <button
          onClick={() => onChangeOctaveOffset(octaveOffset - 1)}
          className="rounded border border-[#30363d] bg-[#21262d] p-1 text-slate-200 transition-colors hover:bg-slate-700"
          title="1オクターブ下げる"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>

        <div className="flex min-w-[50px] items-center justify-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5 font-mono font-bold text-sky-300">
          {octaveOffset > 0 ? `+${octaveOffset}` : octaveOffset} oct
        </div>

        <button
          onClick={() => onChangeOctaveOffset(octaveOffset + 1)}
          className="rounded border border-[#30363d] bg-[#21262d] p-1 text-slate-200 transition-colors hover:bg-slate-700"
          title="1オクターブ上げる"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>

        <div className="ml-1 hidden items-center gap-1 sm:flex">
          {[-2, -1, 0, 1, 2].map((value) => (
            <button
              key={`quick_oct_${value}`}
              onClick={() => onChangeOctaveOffset(value)}
              className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-semibold transition-colors ${
                octaveOffset === value
                  ? 'bg-sky-600 font-bold text-white'
                  : 'border border-[#30363d] bg-[#161b22] text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {value > 0 ? `+${value}` : value}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="hidden text-[10px] font-medium text-slate-400 sm:inline">鍵盤幅</span>
        <div className="flex items-center gap-1.5 rounded border border-[#30363d] bg-[#161b22] px-2 py-0.5">
          <button
            onClick={() => onChangeKeyWidth(Math.max(30, keyWidth - 5))}
            className="text-slate-400 transition-colors hover:text-white"
            title="鍵盤幅を狭くする"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <input
            type="range"
            min="30"
            max="120"
            value={keyWidth}
            onChange={(event) => onChangeKeyWidth(Number(event.target.value))}
            className="h-1 w-16 cursor-pointer appearance-none rounded bg-[#30363d] accent-sky-500"
          />
          <button
            onClick={() => onChangeKeyWidth(Math.min(120, keyWidth + 5))}
            className="text-slate-400 transition-colors hover:text-white"
            title="鍵盤幅を広くする"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <span className="w-7 text-right text-[10px] font-bold text-sky-400">{keyWidth}px</span>
        </div>
      </div>
    </div>
  );
};
