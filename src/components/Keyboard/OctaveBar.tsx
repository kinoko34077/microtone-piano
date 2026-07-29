import React from 'react';
import {MoveHorizontal, ZoomIn, ZoomOut} from 'lucide-react';

interface OctaveBarProps {
  label?: string;
  scrollOffset: number;
  onChangeScrollOffset: (offset: number) => void;
  maxScrollOffset: number;
  octaveSpan: number;
  keyWidth: number;
  onChangeKeyWidth: (width: number) => void;
  actions?: React.ReactNode;
}

const SCROLL_STEP = 1;

export const OctaveBar: React.FC<OctaveBarProps> = ({
  label,
  scrollOffset,
  onChangeScrollOffset,
  maxScrollOffset,
  octaveSpan,
  keyWidth,
  onChangeKeyWidth,
  actions,
}) => {
  const clampedScroll = Math.max(0, Math.min(maxScrollOffset, scrollOffset));

  return (
    <div className="border-b border-[#30363d] bg-[#0d1117] px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {label && (
          <div className="rounded border border-sky-800/80 bg-sky-950/60 px-2 py-1 text-[11px] font-bold text-sky-300">
            {label}
          </div>
        )}

        <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2 rounded-lg border border-[#30363d] bg-[#11161d] px-2 py-1.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <MoveHorizontal className="h-3.5 w-3.5" />
            表示位置
          </div>
          <div className="flex items-center gap-1">
            <StepButton label="1オクターブ左へ" onClick={() => onChangeScrollOffset(clampedScroll - octaveSpan)}>
              -1oct
            </StepButton>
            <StepButton label="左へ1つ" onClick={() => onChangeScrollOffset(clampedScroll - SCROLL_STEP)}>
              -1
            </StepButton>
          </div>
          <input
            aria-label="表示位置"
            type="range"
            min="0"
            max={Math.max(0, maxScrollOffset)}
            step={SCROLL_STEP}
            value={Math.round(clampedScroll)}
            onChange={(event) => onChangeScrollOffset(Number(event.target.value))}
            className="h-1.5 min-w-[110px] flex-1 cursor-pointer appearance-none rounded bg-[#30363d] accent-emerald-500"
          />
          <div className="flex items-center gap-1">
            <StepButton label="右へ1つ" onClick={() => onChangeScrollOffset(clampedScroll + SCROLL_STEP)}>
              +1
            </StepButton>
            <StepButton label="1オクターブ右へ" onClick={() => onChangeScrollOffset(clampedScroll + octaveSpan)}>
              +1oct
            </StepButton>
          </div>
          <div className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[10px] font-mono font-bold text-emerald-300">
            {Math.round(clampedScroll)}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-[#30363d] bg-[#11161d] px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">鍵幅</div>
          <button
            type="button"
            onClick={() => onChangeKeyWidth(Math.max(24, keyWidth - 4))}
            aria-label="鍵幅を狭くする"
            title="鍵幅を狭くする"
            className="rounded border border-[#30363d] bg-[#161b22] p-1 text-slate-300 transition-colors hover:bg-[#21262d] hover:text-white"
          >
            <ZoomOut className="h-3 w-3" />
          </button>
          <input
            aria-label="鍵幅"
            type="range"
            min="24"
            max="120"
            value={keyWidth}
            onChange={(event) => onChangeKeyWidth(Number(event.target.value))}
            className="h-1.5 w-20 cursor-pointer appearance-none rounded bg-[#30363d] accent-sky-500"
          />
          <button
            type="button"
            onClick={() => onChangeKeyWidth(Math.min(120, keyWidth + 4))}
            aria-label="鍵幅を広くする"
            title="鍵幅を広くする"
            className="rounded border border-[#30363d] bg-[#161b22] p-1 text-slate-300 transition-colors hover:bg-[#21262d] hover:text-white"
          >
            <ZoomIn className="h-3 w-3" />
          </button>
          <span className="w-10 text-right text-[10px] font-bold text-sky-300">{keyWidth}px</span>
        </div>

        {actions && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
};

const StepButton: React.FC<{
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}> = ({label, onClick, children}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="rounded border border-[#30363d] bg-[#161b22] px-1.5 py-1 text-[10px] text-slate-200 transition-colors hover:bg-slate-700"
  >
    {children}
  </button>
);
