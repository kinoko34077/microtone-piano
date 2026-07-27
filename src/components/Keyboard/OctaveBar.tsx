/**
 * オクターブ操作＆鍵盤ナビゲーションバー
 */

import React from 'react';
import { AppSettings } from '../../types/keyboard';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

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
    <div className="flex items-center justify-between bg-[#0d1117] border-b border-[#30363d] px-2 py-1 text-xs select-none">
      {/* 左側: オクターブ(周期)シフト */}
      <div className="flex items-center gap-1.5">
        {label && <span className="font-bold text-sky-400 text-[11px] mr-1">{label}</span>}
        <span className="text-[10px] text-slate-400 font-medium">オクターブ:</span>

        <button
          onClick={() => onChangeOctaveOffset(octaveOffset - 1)}
          className="p-1 bg-[#21262d] hover:bg-slate-700 text-slate-200 rounded border border-[#30363d] transition-colors"
          title="1オクターブ下げる"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-1 font-mono font-bold bg-[#161b22] px-2 py-0.5 rounded border border-[#30363d] text-sky-300 min-w-[50px] justify-center">
          {octaveOffset > 0 ? `+${octaveOffset}` : octaveOffset} oct
        </div>

        <button
          onClick={() => onChangeOctaveOffset(octaveOffset + 1)}
          className="p-1 bg-[#21262d] hover:bg-slate-700 text-slate-200 rounded border border-[#30363d] transition-colors"
          title="1オクターブ上げる"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {/* クイックセットボタン */}
        <div className="hidden sm:flex items-center gap-1 ml-1">
          {[-2, -1, 0, 1, 2].map((val) => (
            <button
              key={`quick_oct_${val}`}
              onClick={() => onChangeOctaveOffset(val)}
              className={`px-1.5 py-0.5 text-[10px] font-mono rounded font-semibold transition-colors ${
                octaveOffset === val
                  ? 'bg-sky-600 text-white font-bold'
                  : 'bg-[#161b22] text-slate-400 hover:bg-slate-800 hover:text-slate-200 border border-[#30363d]'
              }`}
            >
              {val > 0 ? `+${val}` : val}
            </button>
          ))}
        </div>
      </div>

      {/* 右側: 鍵幅ズーム・スライダー */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">鍵幅:</span>
        <div className="flex items-center gap-1.5 bg-[#161b22] px-2 py-0.5 rounded border border-[#30363d]">
          <button
            onClick={() => onChangeKeyWidth(Math.max(30, keyWidth - 5))}
            className="text-slate-400 hover:text-white transition-colors"
            title="鍵幅を狭くする"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <input
            type="range"
            min="30"
            max="120"
            value={keyWidth}
            onChange={(e) => onChangeKeyWidth(Number(e.target.value))}
            className="w-16 h-1 bg-[#30363d] accent-sky-500 rounded appearance-none cursor-pointer"
          />
          <button
            onClick={() => onChangeKeyWidth(Math.min(120, keyWidth + 5))}
            className="text-slate-400 hover:text-white transition-colors"
            title="鍵幅を広くする"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
          <span className="text-[10px] font-mono text-sky-400 font-bold w-7 text-right">{keyWidth}px</span>
        </div>
      </div>
    </div>
  );
};
