import React, {useMemo} from 'react';
import {RefreshCcw} from 'lucide-react';
import {AppSettings} from '../../types/keyboard';
import {
  getDefaultPianoSampleOverrideMap,
  getPianoSampleCatalog,
  PianoSampleOverrideMap,
} from '../../core/pianoSamples';
import {BlurCommitNumberInput} from '../BlurCommitNumberInput';

interface SampleMappingEditorProps {
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
}

export const SampleMappingEditor: React.FC<SampleMappingEditorProps> = ({
  settings,
  onUpdateSettings,
}) => {
  const catalog = useMemo(() => getPianoSampleCatalog(), []);
  const defaults = useMemo(() => getDefaultPianoSampleOverrideMap(), []);
  const overrides = settings.pianoSampleOverrides ?? {};

  const updateOverrides = (nextOverrides: PianoSampleOverrideMap) => {
    onUpdateSettings({
      ...settings,
      pianoSampleOverrides: nextOverrides,
    });
  };

  const updateSample = (fileName: string, patch: {baseFrequency?: number; noteLabel?: string}) => {
    const current = overrides[fileName] ?? defaults[fileName];
    updateOverrides({
      ...overrides,
      [fileName]: {
        baseFrequency: patch.baseFrequency ?? current.baseFrequency,
        noteLabel: patch.noteLabel ?? current.noteLabel,
      },
    });
  };

  const resetSample = (fileName: string) => {
    const next = {...overrides};
    delete next[fileName];
    updateOverrides(next);
  };

  const resetAll = () => {
    updateOverrides({});
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100">外部音源マッピング</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            `Grand Piano/` の各 wav がどの音高として扱われるかをここで調整できます。
          </p>
        </div>

        <button
          onClick={resetAll}
          className="flex items-center gap-1 rounded border border-[#30363d] bg-[#21262d] px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          全件を既定値に戻す
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#30363d] bg-[#0d1117] text-slate-300">
              <th className="p-2.5">ファイル</th>
              <th className="p-2.5">音名</th>
              <th className="p-2.5">基準周波数 (Hz)</th>
              <th className="p-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((sample) => {
              const current = overrides[sample.fileName] ?? defaults[sample.fileName];
              const isOverridden = Boolean(overrides[sample.fileName]);

              return (
                <tr key={sample.fileName} className="border-b border-[#30363d]/60 hover:bg-[#0d1117]/40">
                  <td className="p-2.5 font-mono text-[11px] text-slate-200">{sample.fileName}</td>
                  <td className="p-2.5">
                    <input
                      type="text"
                      value={current.noteLabel}
                      onChange={(event) => updateSample(sample.fileName, {noteLabel: event.target.value})}
                      className="w-24 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
                    />
                  </td>
                  <td className="p-2.5">
                    <BlurCommitNumberInput
                      value={current.baseFrequency}
                      step="0.01"
                      min={0.01}
                      onCommit={(value) => updateSample(sample.fileName, {baseFrequency: Math.max(0.01, value)})}
                      className="w-28 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs font-mono text-slate-200 outline-none focus:border-sky-500"
                    />
                  </td>
                  <td className="p-2.5 text-right">
                    <button
                      onClick={() => resetSample(sample.fileName)}
                      disabled={!isOverridden}
                      className={`rounded border px-2 py-1 text-[11px] font-semibold transition-colors ${
                        isOverridden
                          ? 'border-amber-700 bg-amber-950/70 text-amber-200 hover:bg-amber-900'
                          : 'cursor-not-allowed border-[#30363d] bg-[#161b22] text-slate-500'
                      }`}
                    >
                      行を戻す
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
