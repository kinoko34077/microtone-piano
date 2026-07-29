import React, {useMemo} from 'react';
import {RefreshCcw} from 'lucide-react';
import {AppSettings, TuningPreset} from '../../types/keyboard';
import {
  getDefaultPianoSampleOverrideMap,
  getPianoSampleCatalog,
  PianoSampleOverrideMap,
  findClosestPitchReferenceForFrequency,
} from '../../core/pianoSamples';
import {calculateFrequency, getFormattedPitchLabel} from '../../core/pitch';

interface SampleMappingEditorProps {
  tuning: TuningPreset;
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
}

const OCTAVE_OPTIONS = Array.from({length: 17}, (_, index) => index - 8);

export const SampleMappingEditor: React.FC<SampleMappingEditorProps> = ({
  tuning,
  settings,
  onUpdateSettings,
}) => {
  const catalog = useMemo(() => getPianoSampleCatalog(), []);
  const defaults = useMemo(() => getDefaultPianoSampleOverrideMap(tuning), [tuning]);
  const overrides = settings.pianoSampleOverrides ?? {};

  const updateOverrides = (nextOverrides: PianoSampleOverrideMap) => {
    onUpdateSettings({
      ...settings,
      pianoSampleOverrides: nextOverrides,
    });
  };

  const updateSample = (fileName: string, patch: {pitchId?: number; octaveShift?: number}) => {
    const current = overrides[fileName] ?? defaults[fileName] ?? {};
    updateOverrides({
      ...overrides,
      [fileName]: {
        pitchId: patch.pitchId ?? current.pitchId,
        octaveShift: patch.octaveShift ?? current.octaveShift ?? 0,
      },
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100">外部音源マッピング</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            `Grand Piano/` 配下のサンプルに対して、基準 pitch ID とオクターブを対応づけます。
          </p>
        </div>

        <button
          onClick={() => updateOverrides({})}
          className="flex items-center gap-1 rounded border border-[#30363d] bg-[#21262d] px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          既定に戻す
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#30363d] bg-[#0d1117] text-slate-300">
              <th className="p-2.5">ファイル</th>
              <th className="p-2.5">基準 pitch ID</th>
              <th className="p-2.5">オクターブ</th>
              <th className="p-2.5">対応音名</th>
              <th className="p-2.5">対応周波数</th>
              <th className="p-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((sample) => {
              const fallback = defaults[sample.fileName] ?? {};
              const current = overrides[sample.fileName] ?? fallback;
              const fallbackGuess = findClosestPitchReferenceForFrequency(sample.baseFrequency, tuning);
              const pitchId = current.pitchId ?? fallbackGuess?.pitchId ?? tuning.pitches[0]?.id ?? 0;
              const octaveShift = current.octaveShift ?? fallbackGuess?.octaveShift ?? 0;
              const pitchDef = tuning.pitches.find((pitch) => pitch.id === pitchId) ?? tuning.pitches[0];
              const resolvedLabel = pitchDef ? getFormattedPitchLabel(pitchDef, tuning, 'note', octaveShift) : '-';
              const resolvedFreq = pitchDef ? calculateFrequency(pitchDef, tuning, octaveShift) : 0;
              const isOverridden = Boolean(overrides[sample.fileName]);

              return (
                <tr key={sample.fileName} className="border-b border-[#30363d]/60 hover:bg-[#0d1117]/40">
                  <td className="p-2.5 font-mono text-[11px] text-slate-200">{sample.fileName}</td>
                  <td className="p-2.5">
                    <select
                      value={pitchId}
                      onChange={(event) => updateSample(sample.fileName, {pitchId: Number(event.target.value)})}
                      className="w-44 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
                    >
                      {tuning.pitches.map((pitch) => (
                        <option key={pitch.id} value={pitch.id}>
                          ID {pitch.id} / {pitch.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2.5">
                    <select
                      value={octaveShift}
                      onChange={(event) => updateSample(sample.fileName, {octaveShift: Number(event.target.value)})}
                      className="w-24 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
                    >
                      {OCTAVE_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {value >= 0 ? `+${value}` : value}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2.5 font-mono text-slate-300">{resolvedLabel}</td>
                  <td className="p-2.5 font-mono text-slate-400">{resolvedFreq > 0 ? `${resolvedFreq.toFixed(2)} Hz` : '-'}</td>
                  <td className="p-2.5 text-right">
                    <button
                      onClick={() => {
                        const next = {...overrides};
                        delete next[sample.fileName];
                        updateOverrides(next);
                      }}
                      disabled={!isOverridden}
                      className={`rounded border px-2 py-1 text-[11px] font-semibold transition-colors ${
                        isOverridden
                          ? 'border-amber-700 bg-amber-950/70 text-amber-200 hover:bg-amber-900'
                          : 'cursor-not-allowed border-[#30363d] bg-[#161b22] text-slate-500'
                      }`}
                    >
                      個別設定を解除
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
