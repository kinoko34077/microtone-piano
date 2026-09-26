import React, {useEffect, useState} from 'react';
import {AudioContextStatus, globalAudioEngine} from '../core/audio';

export const AudioContextStatusBadge: React.FC = () => {
  const [status, setStatus] = useState<AudioContextStatus | null>(null);

  useEffect(() => {
    globalAudioEngine.setAudioContextStatusCallback(setStatus);
    return () => globalAudioEngine.setAudioContextStatusCallback(() => {});
  }, []);

  if (!status) {
    return null;
  }

  const label =
    status.kind === 'starting' ? '音声準備中' : status.kind === 'ready' ? '音声準備済' : '音声エラー';

  return (
    <span
      role="status"
      aria-live="polite"
      title={status.message}
      className="flex max-w-56 items-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[10px] text-slate-300"
    >
      <span className="truncate" aria-hidden="true">
        {label}
      </span>
      <span className="sr-only">{status.message}</span>
      {status.kind === 'failed' && (
        <button
          type="button"
          onClick={() => {
            void globalAudioEngine.retryAudioContext().catch(() => {});
          }}
          className="shrink-0 rounded border border-rose-700/70 bg-rose-950/40 px-1.5 py-0.5 text-[10px] font-bold text-rose-200 hover:bg-rose-900/50"
        >
          再試行
        </button>
      )}
    </span>
  );
};
