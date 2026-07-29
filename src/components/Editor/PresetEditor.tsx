import React, {useMemo, useState} from 'react';
import {Copy, Edit3, Layers, Music2, Plus, Sliders, Trash2, Wand2, XCircle} from 'lucide-react';
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
type LaneEditTab = 'count' | 'height';

type LaneSelection = {
  column: number;
  isBlack: boolean;
};

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
  const [laneEditTab, setLaneEditTab] = useState<LaneEditTab>('count');
  const [assignOctaveShift, setAssignOctaveShift] = useState(0);
  const [showAllDepthSlots, setShowAllDepthSlots] = useState(false);
  const [selectedLane, setSelectedLane] = useState<LaneSelection>({column: 0, isBlack: false});

  const displayHorizontalCount = Math.max(1, Math.min(16, layout.horizontalCount ?? 16));
  const pitchRows = useMemo(
    () =>
      Array.from({length: Math.ceil(tuning.pitches.length / 8)}, (_, rowIndex) =>
        tuning.pitches.slice(rowIndex * 8, rowIndex * 8 + 8),
      ),
    [tuning.pitches],
  );

  const currentLaneIndex = selectedLane.column * 2 + (selectedLane.isBlack ? 1 : 0);
  const currentLane = layout.lanes[currentLaneIndex];
  const currentLaneDepths = currentLane?.activeDepths ?? 0;

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
    window.setTimeout(() => globalAudioEngine.noteOffByAddress(addr), 220);
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

  const updateLaneDepths = (column: number, isBlack: boolean, value: number) => {
    const laneIndex = column * 2 + (isBlack ? 1 : 0);
    const lanes = [...layout.lanes];
    lanes[laneIndex] = {
      ...lanes[laneIndex],
      activeDepths: Math.max(0, Math.min(8, value)),
    };
    onUpdateLayout({...layout, lanes});
    setSelectedLane({column, isBlack});
  };

  const selectedPitchPreview = useMemo(() => {
    if (selectedAddress === null) {
      return null;
    }
    const pitchRef = layout.mapping[selectedAddress];
    const resolved = resolvePitch(pitchRef, tuning);
    return {
      address: selectedAddress,
      pitchRef,
      resolved,
    };
  }, [layout.mapping, selectedAddress, tuning]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#30363d] bg-[#0d1117] px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <TabButton active={activeTab === 'grid'} onClick={() => setActiveTab('grid')} icon={<Layers className="h-3.5 w-3.5" />} label="配置" />
          <TabButton active={activeTab === 'tuning'} onClick={() => setActiveTab('tuning')} icon={<Music2 className="h-3.5 w-3.5" />} label="音高" />
          <TabButton active={activeTab === 'lanes'} onClick={() => setActiveTab('lanes')} icon={<Sliders className="h-3.5 w-3.5" />} label="段数 / 高さ" />
          <TabButton active={activeTab === 'samples'} onClick={() => setActiveTab('samples')} icon={<Edit3 className="h-3.5 w-3.5" />} label="音源" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <InfoChip label="横列" value={`${displayHorizontalCount}`} />
          <InfoChip label="選択" value={`${selectedAddresses.size || (selectedAddress !== null ? 1 : 0)}`} />
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#0d1117] p-3 md:p-4">
        {activeTab === 'grid' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
            <EditorCanvasCard
              title="鍵盤配置キャンバス"
              helper="左の鍵盤を直接選択して、右から音高を割り当てます。複数選択は Ctrl / Shift / Meta で追加できます。"
              actions={
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={showAllDepthSlots}
                    onChange={(event) => setShowAllDepthSlots(event.target.checked)}
                    className="rounded border-[#30363d] bg-[#0d1117] text-sky-500 focus:ring-0"
                  />
                  無効 depth も表示
                </label>
              }
            >
              <AddressKeyboardCanvas
                layout={layout}
                tuning={tuning}
                displayHorizontalCount={displayHorizontalCount}
                showAllDepthSlots={showAllDepthSlots}
                selectedAddresses={selectedAddresses}
                selectedAddress={selectedAddress}
                onSelectAddress={toggleAddressSelection}
              />
            </EditorCanvasCard>

            <InspectorCard title="割り当てインスペクタ" helper="現在の選択先だけをここで操作します。">
              <SelectionSummary
                selectedAddress={selectedAddress}
                selectedCount={selectedAddresses.size}
                selectedPitchPreview={selectedPitchPreview}
              />

              <div className="grid grid-cols-2 gap-2">
                <SmallActionButton onClick={() => setSelectedAddresses(new Set(Array.from({length: 256}, (_, idx) => idx)))}>
                  全選択
                </SmallActionButton>
                <SmallActionButton onClick={() => setSelectedAddresses(new Set())}>
                  選択解除
                </SmallActionButton>
                <SmallActionButton onClick={handleOctaveRepeatFill} accent="primary">
                  <Copy className="h-3.5 w-3.5" />
                  オクターブ複製
                </SmallActionButton>
                <SmallActionButton onClick={handleAutoMapping} accent="warning">
                  <Wand2 className="h-3.5 w-3.5" />
                  自動配置
                </SmallActionButton>
              </div>

              <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold text-slate-100">割り当てオクターブ</div>
                    <div className="mt-1 text-[11px] text-slate-500">ピッチ ID に対する octaveShift をここで指定します。</div>
                  </div>
                  <BlurCommitNumberInput
                    value={assignOctaveShift}
                    step={1}
                    onCommit={(value) => setAssignOctaveShift(Math.trunc(value))}
                    className="w-20 rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-xs text-slate-200 outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <button
                onClick={clearPitchForSelected}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-900"
              >
                <XCircle className="h-4 w-4" />
                選択先を未割当てにする
              </button>

              <div className="space-y-2">
                {pitchRows.map((row, rowIndex) => (
                  <div key={`pitch_row_${rowIndex}`} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {row.map((pitch) => {
                      const freq = calculateFrequency(pitch, tuning, assignOctaveShift);
                      const assignRef = encodePitchReference(pitch.id, assignOctaveShift);

                      return (
                        <button
                          key={`assign_pitch_${pitch.id}`}
                          onClick={() => assignPitchToSelected(assignRef)}
                          className="flex min-h-[92px] flex-col justify-between rounded-lg border border-[#30363d] bg-[#11161d] p-2 text-left transition-colors hover:border-sky-500 hover:bg-sky-950/30"
                        >
                          <span className="truncate text-xs font-bold text-slate-100">{pitch.name}</span>
                          <span className="text-[10px] font-mono text-slate-400">
                            ID {pitch.id} / {assignOctaveShift >= 0 ? '+' : ''}{assignOctaveShift}oct
                          </span>
                          <span className="text-[10px] font-mono text-slate-500">{getPitchLabel(pitch)}</span>
                          <span className="text-[10px] font-mono text-sky-300">{formatFrequency(freq)}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </InspectorCard>
          </div>
        )}

        {activeTab === 'tuning' && (
          <div className="grid gap-4">
            <InspectorCard title={`音高プリセット: ${tuning.name}`} helper="基準設定と各音高の定義をここで編集します。">
              <div className="grid gap-3 md:grid-cols-3">
                <StatCard label="基準番地" value={`0x${tuning.baseAddress.toString(16).toUpperCase()}`} />
                <StatCard label="基準周波数" value={`${tuning.baseFrequency} Hz`} />
                <StatCard label="周期" value={`${tuning.periodCents} cent`} />
              </div>
              <button
                onClick={handleAddPitch}
                className="inline-flex items-center gap-2 rounded-lg border border-sky-400 bg-sky-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-sky-500"
              >
                <Plus className="h-4 w-4" />
                音高を追加
              </button>
            </InspectorCard>

            <div className="overflow-x-auto rounded-xl border border-[#30363d] bg-[#161b22]">
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
                      <td className="p-2.5 text-slate-300">{renderTuningTypeEditor(pitch, handleUpdatePitchItem)}</td>
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
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
            <EditorCanvasCard
              title="段数 / 高さキャンバス"
              helper={laneEditTab === 'count' ? '左の鍵盤列を選んで、右から白鍵側・黒鍵側の段数を調整します。' : '現在使用中の段数テンプレートを直接ドラッグして高さを調整します。'}
              actions={
                <div className="flex gap-1.5">
                  <TabButton active={laneEditTab === 'count'} onClick={() => setLaneEditTab('count')} label="段数" small />
                  <TabButton active={laneEditTab === 'height'} onClick={() => setLaneEditTab('height')} label="高さ" small />
                </div>
              }
            >
              {laneEditTab === 'count' ? (
                <LaneKeyboardCanvas
                  layout={layout}
                  tuning={tuning}
                  displayHorizontalCount={displayHorizontalCount}
                  selectedLane={selectedLane}
                  onSelectLane={setSelectedLane}
                />
              ) : (
                <LaneBoundaryEditor layout={layout} displayHorizontalCount={displayHorizontalCount} onUpdateLayout={onUpdateLayout} />
              )}
            </EditorCanvasCard>

            <InspectorCard
              title={laneEditTab === 'count' ? '段数インスペクタ' : '高さインスペクタ'}
              helper={
                laneEditTab === 'count'
                  ? '列と鍵種ごとの activeDepths を調整します。変更は即座に左の鍵盤へ反映されます。'
                  : '使用中の段数テンプレートにだけ編集対象を絞っています。'
              }
            >
              {laneEditTab === 'count' ? (
                <>
                  <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
                    <div className="text-xs font-bold text-slate-100">
                      列 {selectedLane.column.toString(16).toUpperCase()} / {selectedLane.isBlack ? '黒鍵側' : '白鍵側'}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      現在の段数: {currentLaneDepths}
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({length: 9}, (_, value) => (
                      <button
                        key={`depth_${value}`}
                        onClick={() => updateLaneDepths(selectedLane.column, selectedLane.isBlack, value)}
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                          currentLaneDepths === value
                            ? 'border-sky-500 bg-sky-600 text-white'
                            : 'border-[#30363d] bg-[#11161d] text-slate-200 hover:bg-[#1b2531]'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <SmallActionButton onClick={() => updateLaneDepths(selectedLane.column, false, Math.max(0, (layout.lanes[selectedLane.column * 2]?.activeDepths ?? 0) - 1))}>
                      白鍵 -1
                    </SmallActionButton>
                    <SmallActionButton onClick={() => updateLaneDepths(selectedLane.column, false, Math.min(8, (layout.lanes[selectedLane.column * 2]?.activeDepths ?? 0) + 1))}>
                      白鍵 +1
                    </SmallActionButton>
                    <SmallActionButton onClick={() => updateLaneDepths(selectedLane.column, true, Math.max(0, (layout.lanes[selectedLane.column * 2 + 1]?.activeDepths ?? 0) - 1))}>
                      黒鍵 -1
                    </SmallActionButton>
                    <SmallActionButton onClick={() => updateLaneDepths(selectedLane.column, true, Math.min(8, (layout.lanes[selectedLane.column * 2 + 1]?.activeDepths ?? 0) + 1))}>
                      黒鍵 +1
                    </SmallActionButton>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-xs leading-relaxed text-slate-300">
                  黒鍵側を上、白鍵側を下に分けたテンプレートを直接ドラッグできます。既存テンプレートに近い位置へ吸い付くので、
                  近い高さを揃えながら調整できます。
                </div>
              )}
            </InspectorCard>
          </div>
        )}

        {activeTab === 'samples' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
            <EditorCanvasCard
              title="音源対応づけ"
              helper="Grand Piano 配下のサンプルを、現在の音高 ID リストへ割り当てます。"
            >
              <SampleMappingEditor tuning={tuning} settings={settings} onUpdateSettings={onUpdateSettings} />
            </EditorCanvasCard>
            <InspectorCard title="音源メモ" helper="調律自体を変えるのではなく、各サンプルがどの音高を基準にするかを編集します。">
              <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3 text-xs leading-relaxed text-slate-300">
                音程は現在の音高プリセットから計算されます。ここではサンプルごとに
                「どの pitch ID / octave を基準として再生倍率を求めるか」だけを調整します。
              </div>
            </InspectorCard>
          </div>
        )}
      </div>
    </div>
  );
};

const AddressKeyboardCanvas: React.FC<{
  layout: LayoutPreset;
  tuning: TuningPreset;
  displayHorizontalCount: number;
  showAllDepthSlots: boolean;
  selectedAddresses: Set<number>;
  selectedAddress: number | null;
  onSelectAddress: (addr: number, multi: boolean) => void;
}> = ({
  layout,
  tuning,
  displayHorizontalCount,
  showAllDepthSlots,
  selectedAddresses,
  selectedAddress,
  onSelectAddress,
}) => (
  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
    {Array.from({length: displayHorizontalCount}, (_, x) => {
      const whiteLane = layout.lanes[x * 2];
      const blackLane = layout.lanes[x * 2 + 1];
      const whiteDepths = showAllDepthSlots ? 8 : Math.max(whiteLane?.activeDepths ?? 0, 0);
      const blackDepths = showAllDepthSlots ? 8 : Math.max(blackLane?.activeDepths ?? 0, 0);

      return (
        <div key={`column_${x}`} className="rounded-xl border border-[#30363d] bg-[#0b1016] p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-bold text-sky-300">列 {x.toString(16).toUpperCase()}</div>
            <div className="text-[10px] text-slate-500">黒鍵上 / 白鍵下</div>
          </div>

          <div className="space-y-3">
            <KeyboardStackSection title="黒鍵側" dark>
              {Array.from({length: blackDepths}, (_, idx) => {
                const depth = showAllDepthSlots ? idx : blackDepths - 1 - idx;
                const addr = encodeAddress(x, true, depth);
                return (
                  <AddressCell
                    key={addr}
                    addr={addr}
                    layout={layout}
                    tuning={tuning}
                    isSelected={selectedAddresses.has(addr) || selectedAddress === addr}
                    isInvalid={depth >= (blackLane?.activeDepths ?? 0)}
                    dark
                    onSelect={onSelectAddress}
                  />
                );
              })}
            </KeyboardStackSection>

            <KeyboardStackSection title="白鍵側">
              {Array.from({length: whiteDepths}, (_, idx) => {
                const depth = showAllDepthSlots ? idx : whiteDepths - 1 - idx;
                const addr = encodeAddress(x, false, depth);
                return (
                  <AddressCell
                    key={addr}
                    addr={addr}
                    layout={layout}
                    tuning={tuning}
                    isSelected={selectedAddresses.has(addr) || selectedAddress === addr}
                    isInvalid={depth >= (whiteLane?.activeDepths ?? 0)}
                    onSelect={onSelectAddress}
                  />
                );
              })}
            </KeyboardStackSection>
          </div>
        </div>
      );
    })}
  </div>
);

const LaneKeyboardCanvas: React.FC<{
  layout: LayoutPreset;
  tuning: TuningPreset;
  displayHorizontalCount: number;
  selectedLane: LaneSelection;
  onSelectLane: (lane: LaneSelection) => void;
}> = ({layout, tuning, displayHorizontalCount, selectedLane, onSelectLane}) => (
  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
    {Array.from({length: displayHorizontalCount}, (_, x) => {
      const whiteDepths = layout.lanes[x * 2]?.activeDepths ?? 0;
      const blackDepths = layout.lanes[x * 2 + 1]?.activeDepths ?? 0;
      const whiteSelected = selectedLane.column === x && !selectedLane.isBlack;
      const blackSelected = selectedLane.column === x && selectedLane.isBlack;
      return (
        <div key={`lane_canvas_${x}`} className="rounded-xl border border-[#30363d] bg-[#0b1016] p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-bold text-sky-300">列 {x.toString(16).toUpperCase()}</div>
            <div className="text-[10px] text-slate-500">直接選択</div>
          </div>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => onSelectLane({column: x, isBlack: true})}
              className={`w-full rounded-lg border p-2 text-left transition-colors ${
                blackSelected ? 'border-amber-400 bg-amber-900/30' : 'border-slate-700 bg-slate-950 hover:bg-slate-900'
              }`}
            >
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-200">
                <span>黒鍵側</span>
                <span>{blackDepths} 段</span>
              </div>
              <MiniLanePreview activeDepths={blackDepths} dark />
              <div className="mt-2 text-[10px] text-slate-500">
                {resolveLaneSummary(layout, tuning, x, true)}
              </div>
            </button>

            <button
              type="button"
              onClick={() => onSelectLane({column: x, isBlack: false})}
              className={`w-full rounded-lg border p-2 text-left transition-colors ${
                whiteSelected ? 'border-sky-400 bg-sky-950/30' : 'border-slate-700 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-slate-200">
                <span>白鍵側</span>
                <span>{whiteDepths} 段</span>
              </div>
              <MiniLanePreview activeDepths={whiteDepths} />
              <div className="mt-2 text-[10px] text-slate-500">
                {resolveLaneSummary(layout, tuning, x, false)}
              </div>
            </button>
          </div>
        </div>
      );
    })}
  </div>
);

const AddressCell: React.FC<{
  addr: number;
  layout: LayoutPreset;
  tuning: TuningPreset;
  isSelected: boolean;
  isInvalid: boolean;
  dark?: boolean;
  onSelect: (addr: number, multi: boolean) => void;
}> = ({addr, layout, tuning, isSelected, isInvalid, dark = false, onSelect}) => {
  const pitchRef = layout.mapping[addr];
  const resolved = resolvePitch(pitchRef, tuning);
  const label = resolved.pitchDef?.name ?? '未割当て';
  const subtitle = pitchRef === -1 ? '-1' : resolved.pitchDef ? `ID ${resolved.pitchDef.id}` : `Ref ${pitchRef}`;

  return (
    <button
      key={addr}
      onClick={(event) => onSelect(addr, event.ctrlKey || event.metaKey || event.shiftKey)}
      className={`flex min-h-[56px] flex-col justify-between rounded-lg border px-2 py-1.5 text-left transition-colors ${
        isSelected
          ? 'border-sky-400 bg-sky-900/50 text-sky-50'
          : dark
            ? 'border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-900'
            : 'border-slate-300 bg-slate-100 text-slate-800 hover:bg-white'
      } ${isInvalid ? 'opacity-45' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[10px] font-mono ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{getAddressLabel(addr)}</span>
        <span className={`text-[10px] font-mono ${dark ? 'text-slate-500' : 'text-slate-400'}`}>d{decodeAddress(addr).depth}</span>
      </div>
      <span className="truncate text-xs font-semibold">{label}</span>
      <span className={`text-[10px] font-mono ${dark ? 'text-slate-500' : 'text-slate-500'}`}>{subtitle}</span>
    </button>
  );
};

const SelectionSummary: React.FC<{
  selectedAddress: number | null;
  selectedCount: number;
  selectedPitchPreview: {
    address: number;
    pitchRef: number;
    resolved: ReturnType<typeof resolvePitch>;
  } | null;
}> = ({selectedAddress, selectedCount, selectedPitchPreview}) => (
  <div className="rounded-lg border border-[#30363d] bg-[#0d1117] p-3">
    <div className="text-xs font-bold text-slate-100">現在の選択</div>
    {selectedAddress === null ? (
      <div className="mt-2 text-[11px] text-slate-500">左の鍵盤から番地を選択してください。</div>
    ) : (
      <div className="mt-2 grid gap-2 text-xs text-slate-300">
        <div>主選択: <span className="font-mono text-sky-300">{getAddressLabel(selectedAddress)}</span></div>
        <div>複数選択数: <span className="font-mono text-sky-300">{selectedCount || 1}</span></div>
        {selectedPitchPreview && (
          <div>
            割当:
            <span className="ml-1 font-mono text-slate-200">
              {selectedPitchPreview.resolved.pitchDef?.name ?? '未割当て'}
            </span>
          </div>
        )}
      </div>
    )}
  </div>
);

function renderTuningTypeEditor(
  pitch: PitchDefinition,
  handleUpdatePitchItem: (updatedPitch: PitchDefinition) => void,
) {
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
}

function resolveLaneSummary(layout: LayoutPreset, tuning: TuningPreset, column: number, isBlack: boolean): string {
  const lane = layout.lanes[column * 2 + (isBlack ? 1 : 0)];
  const depth = Math.max(0, (lane?.activeDepths ?? 1) - 1);
  const pitchRef = layout.mapping[encodeAddress(column, isBlack, depth)];
  const resolved = resolvePitch(pitchRef, tuning);
  return resolved.pitchDef?.name ?? '未割当て';
}

const MiniLanePreview: React.FC<{activeDepths: number; dark?: boolean}> = ({activeDepths, dark = false}) => {
  if (activeDepths <= 0) {
    return <div className="rounded border border-dashed border-slate-700 px-2 py-5 text-center text-[10px] text-slate-500">0 段</div>;
  }

  return (
    <div className="overflow-hidden rounded border border-[#30363d]">
      {Array.from({length: activeDepths}, (_, index) => (
        <div
          key={`lane_preview_${index}`}
          className={`flex h-5 items-center justify-center border-b text-[10px] font-semibold ${
            dark ? 'border-slate-800 bg-slate-900 text-slate-300' : 'border-slate-300 bg-white text-slate-700'
          }`}
        >
          d{activeDepths - 1 - index}
        </div>
      ))}
    </div>
  );
};

const EditorCanvasCard: React.FC<{
  title: string;
  helper?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({title, helper, actions, children}) => (
  <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-sm">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[#30363d] pb-3">
      <div>
        <h3 className="text-sm font-bold text-slate-100">{title}</h3>
        {helper && <p className="mt-1 text-xs leading-relaxed text-slate-400">{helper}</p>}
      </div>
      {actions}
    </div>
    {children}
  </div>
);

const InspectorCard: React.FC<{
  title: string;
  helper?: string;
  children: React.ReactNode;
}> = ({title, helper, children}) => (
  <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-4 shadow-sm">
    <div className="mb-4 border-b border-[#30363d] pb-3">
      <h3 className="text-sm font-bold text-slate-100">{title}</h3>
      {helper && <p className="mt-1 text-xs leading-relaxed text-slate-400">{helper}</p>}
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

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

const SmallActionButton: React.FC<{
  onClick: () => void;
  accent?: 'default' | 'primary' | 'warning';
  children: React.ReactNode;
}> = ({onClick, accent = 'default', children}) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
      accent === 'primary'
        ? 'border-sky-500 bg-sky-600 text-white hover:bg-sky-500'
        : accent === 'warning'
          ? 'border-amber-500 bg-amber-600 text-white hover:bg-amber-500'
          : 'border-[#30363d] bg-[#11161d] text-slate-200 hover:bg-[#1b2531]'
    }`}
  >
    {children}
  </button>
);

const KeyboardStackSection: React.FC<{
  title: string;
  dark?: boolean;
  children: React.ReactNode;
}> = ({title, dark = false, children}) => (
  <div>
    <div className={`mb-1 text-[11px] font-semibold ${dark ? 'text-amber-300' : 'text-slate-300'}`}>{title}</div>
    <div className="grid gap-1">{children}</div>
  </div>
);

const InfoChip: React.FC<{label: string; value: string}> = ({label, value}) => (
  <div className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[10px] font-medium text-slate-300">
    {label}: <span className="font-mono text-sky-300">{value}</span>
  </div>
);

const StatCard: React.FC<{label: string; value: string}> = ({label, value}) => (
  <div className="rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-3">
    <div className="text-[11px] font-semibold text-slate-400">{label}</div>
    <div className="mt-1 text-sm font-mono font-bold text-sky-300">{value}</div>
  </div>
);
