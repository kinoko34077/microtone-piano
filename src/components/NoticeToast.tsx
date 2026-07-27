/**
 * 非遮断型 範囲外音高通知トースト (20Hz未満 / 20kHz超)
 */

import React from 'react';
import { OutOfRangeNotice } from '../types/keyboard';
import { AlertTriangle, X } from 'lucide-react';

interface NoticeToastProps {
  notices: OutOfRangeNotice[];
  onDismiss: (id: string) => void;
}

export const NoticeToast: React.FC<NoticeToastProps> = ({ notices, onDismiss }) => {
  if (notices.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {notices.map((n) => (
        <div
          key={n.id}
          className="pointer-events-auto bg-amber-900/90 backdrop-blur text-amber-100 border border-amber-600 p-3 rounded-xl shadow-xl flex items-start justify-between gap-2 animate-slide-up"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-amber-200">
                発音推奨範囲外通知 ({n.frequency.toFixed(1)} Hz)
              </span>
              <span className="text-[11px] text-amber-300/90 leading-tight">
                {n.message}
              </span>
            </div>
          </div>
          <button
            onClick={() => onDismiss(n.id)}
            className="text-amber-400 hover:text-amber-100 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
