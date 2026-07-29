import React, {useMemo, useState} from 'react';
import {Copy, Edit3, Layers, Music2, Plus, Sliders, Trash2, Zap} from 'lucide-react';
import {LayoutPreset, TuningPreset, PitchDefinition, AppSettings, PitchType} from '../../types/keyboard';
import {decodeAddress, encodeAddress, getAddressLabel} from '../../core/address';
import {
  calculateFrequency,
  encodePitchReference,
  formatFrequency,
  getPitchLabel,
  resolvePitch,
} from '../../core/pitch';
import {applyAutoMapping} from '../../core/mapping';
import {globalAudioEngine} from '../../core/audio';
import {BlurCommitNumberInput} from '../BlurCommitNumberInput';
import {LaneBoundaryEditor} from './LaneBoundaryEditor';
import {SampleMappingEditor} from './SampleMappingEditor';

interface PresetEditorProps {
  layout: LayoutPreset;
  tuning: TuningPreset;
  settings: AppSettings;
  onUpdateLayout: (newLayout: LayoutPreset) => void;
  onUpdateTuning: (newTuning: TuningPreset) => void;
  onUpdateSettings: (newSettings: AppSettings) => void;
  selectedAddress: number | null;
  onSelectAddress: (addr: number | null) => void;
}

type EditorTab = 'grid' | 'tuning' | 'lanes' | 'samples';

export const PresetEditor: React.FC<PresetEditorProps> = ({
  layout,
  tuning,
  settings,
  onUpdateLayout,
  onUpdateTuning,
  onUpdateSettings,
  selectedAddress,
  onSelectAddress,
}) => {
  const [selectedAddresses, setSelectedAddresses] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<EditorTab>('grid');
  const [laneEditTab, setLaneEditTab] = useState<'count' | 'height'>('count');
  const [assignOctaveShift, setAssignOctaveShift] = useState(0);
  const [showAllDepthSlots, setShowAllDepthSlots] = useState(false);

  const displayHorizontalCount = Math.max(1, Math.min(16, layout.horizontalCount ?? 16));
  const pitchRows = useMemo(
    () =>
      Array.from({length: Math.ceil(tuning.pitches.length / 8)}, (_, rowIndex) =>
        tuning.pitches.slice(rowIndex * 8, rowIndex * 8 + 8),
      ),
    [tuning.pitches],
  );

  const previewAddress = async (addr: number) => {
    const pitchRef = layout.mapping[addr];
    if (pitchRef === undefined || pitchRef === -1) {
      return;
    }

    const {pitchDef, octaveShift} = resolvePitch(pitchRef, tuning);
    if (!pitchDef) {
      return;
    }

    const frequency = calculateFrequency(pitchDef, tuning, octaveShift);
    await globalAudioEngine.noteOn(addr, pitchRef, frequency, 0.8, 'editor_test');
    window.setTimeout(() => globalAudioEngine.noteOffByAddress(addr), 250);
  };

  const toggleAddressSelection = (addr: number, multi: boolean) => {
    onSelectAddress(addr);
    void previewAddress(addr);

    if (multi) {
      setSelectedAddresses((prev) => {
        const next = new Set(prev);
        if (next.has(addr)) {
          next.delete(addr);
        } else {
          next.add(addr);
        }
        return next;
      });
      return;
    }

    setSelectedAddresses(new Set([addr]));
  };

  const getAssignmentTargets = () => {
    if (selectedAddresses.size > 0) {
      return Array.from(selectedAddresses);
    }
    return selectedAddress !== null ? [selectedAddress] : [];
  };

  const assignPitchToSelected = (pitchRef: number) => {
    const targets = getAssignmentTargets();
    if (targets.length === 0) {
      return;
    }

    const mapping = [...layout.mapping];
    targets.forEach((addr) => {
      mapping[addr] = pitchRef;
    });
    onUpdateLayout({...layout, mapping});
  };

  const clearPitchForSelected = () => {
    assignPitchToSelected(-1);
  };

  const handleAutoMapping = () => {
    onUpdateLayout({
      ...layout,
      mapping: applyAutoMapping(layout, tuning.pitches, settings.autoMappingDirection),
    });
  };

  const handleOctaveRepeatFill = () => {
    const mapping = [...layout.mapping];
    const period = layout.horizontalCount || 16;

    for (let x = period; x < displayHorizontalCount; x += 1) {
      const sourceX = x % period;
      const octaveOffset = Math.floor(x / period);

      for (let depth = 0; depth < 8; depth += 1) {
        const transfer = (isBlack: boolean) => {
          const sourceAddress = encodeAddress(sourceX, isBlack, depth);
          const resolved = resolvePitch(layout.mapping[sourceAddress], tuning);
          if (!resolved.pitchDef) {
            return;
          }
          mapping[encodeAddress(x, isBlack, depth)] = encodePitchReference(
            resolved.pitchDef.id,
            resolved.octaveShift + octaveOffset,
          );
        };

        transfer(false);
        transfer(true);
      }
    }

    onUpdateLayout({...layout, mapping});
  };

  const handleDeletePitch = (pitchId: number) => {
    const pitches = tuning.pitches.filter((pitch) => pitch.id !== pitchId);
    const mapping = layout.mapping.map((pitchRef) => {
      const resolved = resolvePitch(pitchRef, tuning);
      return resolved.pitchDef?.id === pitchId ? -1 : pitchRef;
    });
    onUpdateTuning({...tuning, pitches});
    onUpdateLayout({...layout, mapping});
  };

  const handleUpdatePitchItem = (updatedPitch: PitchDefinition) => {
    onUpdateTuning({
      ...tuning,
      pitches: tuning.pitches.map((pitch) => (pitch.id === updatedPitch.id ? updatedPitch : pitch)),
    });
  };

  const handleAddPitch = () => {
    const maxId = tuning.pitches.reduce((max, pitch) => Math.max(max, pitch.id), -1);
    onUpdateTuning({
      ...tuning,
      pitches: [
        ...tuning.pitches,
        {
          id: maxId + 1,
          name: `Pitch ${maxId + 1}`,
          type: 'edo',
          edo: 12,
          step: maxId + 1,
        },
      ],
    });
  };

  const renderAddressButton = (addr: number) => {
    const pitchRef = layout.mapping[addr];
    const resolved = resolvePitch(pitchRef, tuning);
    const decoded = decodeAddress(addr);
    const isSelected = selectedAddresses.has(addr) || selectedAddress === addr;
    const laneLimit = layout.lanes[decoded.laneIndex]?.activeDepths ?? 0;
    const isInvalid = decoded.depth >= laneLimit;

    return (
      <button
        key={addr}
        onClick={(event) => toggleAddressSelection(addr, event.ctrlKey || event.metaKey || event.shiftKey)}
        className={`flex min-h-[54px] flex-col rounded border px-2 py-1 text-left transition-colors ${
          isSelected
            ? 'border-sky-400 bg-sky-950/60 text-sky-100'
            : isInvalid
              ? 'border-[#30363d] bg-[#0d1117] text-slate-500'
              : 'border-[#30363d] bg-[#161b22] text-slate-200 hover:border-sky-700 hover:bg-slate-900'
        }`}
      >
        <span className="text-[10px] font-mono opacity-70">{getAddressLabel(addr)}</span>
        <span className="truncate text-xs font-semibold">{resolved.pitchDef?.name ?? '(未割当)'}</span>
        <span className="text-[10px] font-mono opacity-70">
          {pitchRef === -1
            ? '-1'
            : resolved.pitchDef
              ? `ID ${resolved.pitchDef.id} / ${resolved.octaveShift >= 0 ? '+' : ''}${resolved.octaveShift}oct`
              : `Ref ${pitchRef}`}
        </span>
      </button>
    );
  };

  const renderTuningTypeEditor = (pitch: PitchDefinition) => {
    switch (pitch.type) {
      case 'edo':
        return (
          <div className="flex items-center gap-2">
            <span>EDO</span>
            <BlurCommitNumberInput
              value={pitch.edo ?? 12}
              step={1}
              min={1}
              onCommit={(value) => handleUpdatePitchItem({...pitch, edo: Math.max(1, Math.trunc(value))})}
              className="w-16 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-slate-200"
            />
            <span>Step</span>
            <BlurCommitNumberInput
              value={pitch.step ?? 0}
              step={1}
              onCommit={(value) => handleUpdatePitchItem({...pitch, step: Math.trunc(value)})}
              className="w-16 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-slate-200"
            />
          </div>
        );
      case 'cents':
        return (
          <BlurCommitNumberInput
            value={pitch.cents ?? 0}
            step="0.1"
            onCommit={(value) => handleUpdatePitchItem({...pitch, cents: value})}
            className="w-24 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-slate-200"
          />
        );
      case 'ratio':
        return (
          <div className="flex items-center gap-1">
            <BlurCommitNumberInput
              value={pitch.numerator ?? 1}
              step={1}
              min={1}
              onCommit={(value) => handleUpdatePitchItem({...pitch, numerator: Math.max(1, Math.trunc(value))})}
              className="w-16 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-slate-200"
            />
            <span>/</span>
            <BlurCommitNumberInput
              value={pitch.denominator ?? 1}
              step={1}
              min={1}
              onCommit={(value) => handleUpdatePitchItem({...pitch, denominator: Math.max(1, Math.trunc(value))})}
              className="w-16 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-slate-200"
            />
          </div>
        );
      case 'frequency':
        return (
          <BlurCommitNumberInput
            value={pitch.frequency ?? 440}
            step="0.1"
            min={0.01}
            onCommit={(value) => handleUpdatePitchItem({...pitch, frequency: Math.max(0.01, value)})}
            className="w-24 rounded border border-[#30363d] bg-[#0d1117] px-1.5 py-0.5 font-mono text-slate-200"
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] bg-[#0d1117] px-4 py-2">
        <div className="flex gap-1.5">
          <TabButton active={activeTab === 'grid'} onClick={() => setActiveTab('grid')} icon={<Layers className="h-3.5 w-3.5" />} label="配置" />
          <TabButton active={activeTab === 'tuning'} onClick={() => setActiveTab('tuning')} icon={<Music2 className="h-3.5 w-3.5" />} label="音高" />
          <TabButton active={activeTab === 'lanes'} onClick={() => setActiveTab('lanes')} icon={<Sliders className="h-3.5 w-3.5" />} label="段数・高さ" />
          <TabButton active={activeTab === 'samples'} onClick={() => setActiveTab('samples')} icon={<Edit3 className="h-3.5 w-3.5" />} label="外部音源" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden text-xs text-slate-400 sm:inline">
            選択中 <strong className="font-mono text-sky-400">{selectedAddresses.size}</strong>
          </span>
          <button
            onClick={() => setSelectedAddresses(new Set(Array.from({length: 256}, (_, idx) => idx)))}
            className="rounded border border-[#30363d] bg-slate-800 px-2.5 py-1 text-xs text-slate-200 transition-colors hover:bg-slate-700"
          >
            全選択
          </button>
          <button
            onClick={() => setSelectedAddresses(new Set())}
            className="rounded border border-[#30363d] bg-slate-800 px-2.5 py-1 text-xs text-slate-200 transition-colors hover:bg-slate-700"
          >
            解除
          </button>
          <button
            onClick={handleOctaveRepeatFill}
            className="flex items-center gap-1 rounded border border-sky-400 bg-sky-600 px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-sky-500"
          >
            <Copy className="h-3 w-3" />
            オクターブ複製
          </button>
          <button
            onClick={handleAutoMapping}
            className="flex items-center gap-1 rounded border border-amber-500 bg-amber-600 px-3 py-1 text-xs font-bold text-white transition-colors hover:bg-amber-500"
          >
            <Zap className="h-3 w-3" />
            自動割当
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#0d1117] p-3 md:p-4">
        {activeTab === 'grid' && (
          <div className="flex h-full flex-col gap-4 lg:flex-row">
            <div className="flex-1 rounded-lg border border-[#30363d] bg-[#161b22] p-3 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] pb-2">
                <h3 className="text-sm font-bold text-slate-100">アドレス配置</h3>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={showAllDepthSlots}
                    onChange={(event) => setShowAllDepthSlots(event.target.checked)}
                    className="rounded border-[#30363d] bg-[#0d1117] text-sky-500 focus:ring-0"
                  />
                  無効 depth も表示
                </label>
              </div>

              <div className="grid gap-3" style={{gridTemplateColumns: `repeat(${Math.min(displayHorizontalCount, 4)}, minmax(0, 1fr))`}}>
                {Array.from({length: displayHorizontalCount}, (_, x) => {
                  const whiteLane = layout.lanes[x * 2];
                  const blackLane = layout.lanes[x * 2 + 1];
                  const whiteDepths = showAllDepthSlots ? 8 : Math.max(whiteLane?.activeDepths ?? 0, 0);
                  const blackDepths = showAllDepthSlots ? 8 : Math.max(blackLane?.activeDepths ?? 0, 0);

                  return (
                    <div key={`col_${x}`} className="rounded-lg border border-[#30363d] bg-[#0d1117] p-2">
                      <div className="mb-2 text-xs font-bold text-sky-300">列 {x.toString(16).toUpperCase()}</div>
                      <div className="space-y-2">
                        <div>
                          <div className="mb-1 text-[11px] font-semibold text-slate-300">白鍵</div>
                          <div className="grid gap-1">
                            {Array.from({length: blackDepths}, (_, idx) => renderAddressButton(encodeAddress(x, true, showAllDepthSlots ? idx : blackDepths - 1 - idx)))}
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 text-[11px] font-semibold text-amber-300">黒鍵</div>
                          <div className="grid gap-1">
                            {Array.from({length: whiteDepths}, (_, idx) => renderAddressButton(encodeAddress(x, false, showAllDepthSlots ? idx : whiteDepths - 1 - idx)))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex w-full flex-col rounded-lg border border-[#30363d] bg-[#161b22] p-3 shadow-sm lg:max-w-[420px]">
              <div className="mb-3 flex items-center justify-between border-b border-[#30363d] pb-2">
                <h3 className="text-sm font-bold text-slate-100">音高割当</h3>
                <button
                  onClick={clearPitchForSelected}
                  className="rounded border border-rose-800 bg-rose-950/70 px-2 py-1 text-[11px] font-semibold text-rose-200 transition-colors hover:bg-rose-900"
                >
                  クリア (-1)
                </button>
              </div>

              <div className="mb-3 flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-300">割当オクターブ補正</span>
                <BlurCommitNumberInput
                  value={assignOctaveShift}
                  step={1}
                  onCommit={(value) => setAssignOctaveShift(Math.trunc(value))}
                  className="w-16 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex-1 space-y-2 overflow-auto pr-1">
                {pitchRows.map((row, rowIndex) => (
                  <div key={`pitch_row_${rowIndex}`} className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                    {row.map((pitch) => {
                      const freq = calculateFrequency(pitch, tuning, assignOctaveShift);
                      const assignRef = encodePitchReference(pitch.id, assignOctaveShift);

                      return (
                        <button
                          key={`assign_pitch_${pitch.id}`}
                          onClick={() => assignPitchToSelected(assignRef)}
                          className="flex min-h-[84px] flex-col justify-between rounded border border-[#30363d] bg-[#0d1117] p-2 text-left transition-colors hover:border-sky-500 hover:bg-sky-950/40"
                        >
                          <span className="truncate text-xs font-bold text-slate-100">{pitch.name}</span>
                          <span className="text-[10px] font-mono text-slate-400">ID {pitch.id} / {assignOctaveShift >= 0 ? '+' : ''}{assignOctaveShift}oct</span>
                          <span className="text-[10px] font-mono text-slate-400">{getPitchLabel(pitch)}</span>
                          <span className="text-[10px] font-mono text-sky-300">{formatFrequency(freq)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tuning' && (
          <div className="flex flex-col gap-4 rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">音高設定 ({tuning.name})</h3>
                <p className="mt-0.5 text-xs font-mono text-slate-400">
                  基準番地 0x{tuning.baseAddress.toString(16).toUpperCase()} / 基準周波数 {tuning.baseFrequency} Hz / 周期 {tuning.periodCents} cent
                </p>
              </div>
              <button
                onClick={handleAddPitch}
                className="flex items-center gap-1 rounded border border-sky-400 bg-sky-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-sky-500"
              >
                <Plus className="h-4 w-4" />
                音高追加
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[#30363d] bg-[#0d1117] text-slate-300">
                    <th className="p-2.5">ID</th>
                    <th className="p-2.5">名前</th>
                    <th className="p-2.5">方式</th>
                    <th className="p-2.5">パラメータ</th>
                    <th className="p-2.5">周波数</th>
                    <th className="p-2.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tuning.pitches.map((pitch) => (
                    <tr key={pitch.id} className="border-b border-[#30363d]/60 hover:bg-[#0d1117]/40">
                      <td className="p-2.5 font-mono font-bold text-sky-400">{pitch.id}</td>
                      <td className="p-2.5">
                        <input
                          type="text"
                          value={pitch.name}
                          onChange={(event) => handleUpdatePitchItem({...pitch, name: event.target.value})}
                          className="w-40 rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
                        />
                      </td>
                      <td className="p-2.5">
                        <select
                          value={pitch.type}
                          onChange={(event) => handleUpdatePitchItem({...pitch, type: event.target.value as PitchType})}
                          className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
                        >
                          <option value="edo">EDO</option>
                          <option value="cents">Cent</option>
                          <option value="ratio">Ratio</option>
                          <option value="frequency">Frequency</option>
                        </select>
                      </td>
                      <td className="p-2.5 text-slate-300">{renderTuningTypeEditor(pitch)}</td>
                      <td className="p-2.5 font-mono text-slate-300">{formatFrequency(calculateFrequency(pitch, tuning))}</td>
                      <td className="p-2.5 text-right">
                        <button
                          onClick={() => handleDeletePitch(pitch.id)}
                          className="inline-flex items-center gap-1 rounded border border-rose-800 bg-rose-950/70 px-2 py-1 text-[11px] font-semibold text-rose-200 transition-colors hover:bg-rose-900"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'lanes' && (
          <div className="flex flex-col gap-4 rounded-lg border border-[#30363d] bg-[#161b22] p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#30363d] pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-100">段数と高さ</h3>
                <p className="mt-0.5 text-xs text-slate-400">段数は数値、高さはドラッグで調整します。</p>
              </div>
              <div className="flex gap-1.5">
                <TabButton active={laneEditTab === 'count'} onClick={() => setLaneEditTab('count')} label="段数" small />
                <TabButton active={laneEditTab === 'height'} onClick={() => setLaneEditTab('height')} label="高さ" small />
              </div>
            </div>

            {laneEditTab === 'count' ? (
              <div className="grid gap-3" style={{gridTemplateColumns: `repeat(${Math.min(displayHorizontalCount, 4)}, minmax(0, 1fr))`}}>
                {Array.from({length: displayHorizontalCount}, (_, x) => {
                  const whiteIndex = x * 2;
                  const blackIndex = x * 2 + 1;
                  const whiteDepths = layout.lanes[whiteIndex]?.activeDepths ?? 0;
                  const blackDepths = layout.lanes[blackIndex]?.activeDepths ?? 0;

                  return (
                    <div key={`lane_${x}`} className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                      <div className="mb-2 text-xs font-bold text-sky-300">列 {x.toString(16).toUpperCase()}</div>
                      <div className="space-y-3">
                        <RangeRow
                          label="白鍵"
                          value={whiteDepths}
                          accent="accent-sky-500"
                          onChange={(value) => {
                            const lanes = [...layout.lanes];
                            lanes[whiteIndex] = {...lanes[whiteIndex], activeDepths: value};
                            onUpdateLayout({...layout, lanes});
                          }}
                        />
                        <RangeRow
                          label="黒鍵"
                          value={blackDepths}
                          accent="accent-amber-500"
                          valueClassName="text-amber-300"
                          onChange={(value) => {
                            const lanes = [...layout.lanes];
                            lanes[blackIndex] = {...lanes[blackIndex], activeDepths: value};
                            onUpdateLayout({...layout, lanes});
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <LaneBoundaryEditor
                layout={layout}
                displayHorizontalCount={displayHorizontalCount}
                onUpdateLayout={onUpdateLayout}
              />
            )}
          </div>
        )}

        {activeTab === 'samples' && (
          <SampleMappingEditor tuning={tuning} settings={settings} onUpdateSettings={onUpdateSettings} />
        )}
      </div>
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
  small?: boolean;
}> = ({active, onClick, label, icon, small = false}) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-1.5 rounded-md border transition-all ${
      small ? 'px-3 py-1.5 text-xs' : 'px-3 py-1.5 text-xs font-semibold'
    } ${
      active
        ? 'border-sky-500 bg-sky-600/90 text-white shadow-sm'
        : 'border-[#30363d] bg-[#161b22] text-slate-300 hover:bg-slate-800 hover:text-white'
    }`}
  >
    {icon}
    {label}
  </button>
);

const RangeRow: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  accent: string;
  valueClassName?: string;
}> = ({label, value, onChange, accent, valueClassName = 'text-sky-300'}) => (
  <div>
    <div className="mb-1 flex items-center justify-between text-[11px] text-slate-300">
      <span>{label}</span>
      <span className={`font-mono ${valueClassName}`}>{value}</span>
    </div>
    <input
      type="range"
      min="0"
      max="8"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className={`h-1 w-full cursor-pointer appearance-none rounded bg-[#30363d] ${accent}`}
    />
  </div>
);
