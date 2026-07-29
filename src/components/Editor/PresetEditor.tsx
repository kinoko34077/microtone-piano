import React, {useEffect, useMemo, useState} from 'react';
import {
  Copy,
  Edit3,
  Layers3,
  Minus,
  Music2,
  PlayCircle,
  Plus,
  SlidersHorizontal,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react';
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
import {
  getLaneBoundaries,
  getSegmentHeightsFromBoundaries,
  getTemplateBoundaries,
  sanitizeBoundaries,
} from '../../core/laneBoundaries';
import {BlurCommitNumberInput} from '../BlurCommitNumberInput';
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

type WorkspaceTab = 'keyboard' | 'pitches' | 'samples';
type KeyboardMode = 'select' | 'assign' | 'boundary' | 'play';

type BoundaryDragState = {
  isBlack: boolean;
  activeDepths: number;
  boundaryIndex: number;
  startY: number;
  startValue: number;
};

type BoundaryPreview = {
  isBlack: boolean;
  activeDepths: number;
  boundaries: number[];
};

const WHITE_NOTE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_NOTE_NAMES = ['C#', 'D#', '', 'F#', 'G#', 'A#', ''];
const MIN_SEGMENT_SIZE = 0.05;
const SNAP_DISTANCE = 0.025;

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
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('keyboard');
  const [keyboardMode, setKeyboardMode] = useState<KeyboardMode>('select');
  const [selectedAddresses, setSelectedAddresses] = useState<Set<number>>(new Set());
  const [armedPitchRef, setArmedPitchRef] = useState<number | null>(null);
  const [assignOctaveShift, setAssignOctaveShift] = useState(0);
  const [editorKeyWidth, setEditorKeyWidth] = useState(72);
  const [boundaryDrag, setBoundaryDrag] = useState<BoundaryDragState | null>(null);
  const [boundaryPreview, setBoundaryPreview] = useState<BoundaryPreview | null>(null);

  const displayHorizontalCount = Math.max(1, Math.min(16, layout.horizontalCount ?? 7));
  const selectedCount = selectedAddresses.size || (selectedAddress !== null ? 1 : 0);

  useEffect(() => {
    if (selectedAddress === null) {
      setSelectedAddresses(new Set());
      return;
    }
    setSelectedAddresses((prev) => (prev.size > 1 ? prev : new Set([selectedAddress])));
  }, [selectedAddress]);

  useEffect(() => {
    if (!boundaryDrag) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const baseBoundaries =
        boundaryPreview &&
        boundaryPreview.isBlack === boundaryDrag.isBlack &&
        boundaryPreview.activeDepths === boundaryDrag.activeDepths
          ? boundaryPreview.boundaries
          : getTemplateBoundaries(layout, boundaryDrag.activeDepths, boundaryDrag.isBlack);
      const boundaries = [...baseBoundaries];
      const deltaRatio = (event.clientY - boundaryDrag.startY) / 300;
      const minValue = boundaries[boundaryDrag.boundaryIndex - 1] + MIN_SEGMENT_SIZE;
      const maxValue = boundaries[boundaryDrag.boundaryIndex + 1] - MIN_SEGMENT_SIZE;
      let nextValue = Math.max(minValue, Math.min(maxValue, boundaryDrag.startValue + deltaRatio));

      const templateMap = boundaryDrag.isBlack
        ? layout.blackBoundaryTemplates ?? layout.boundaryTemplates
        : layout.whiteBoundaryTemplates ?? layout.boundaryTemplates;
      const snapSources = (Object.values(templateMap) as number[][])
        .flatMap((template) => template.slice(1, -1))
        .filter((value) => value > minValue && value < maxValue);

      for (const snapValue of snapSources) {
        if (Math.abs(snapValue - nextValue) <= SNAP_DISTANCE) {
          nextValue = snapValue;
          break;
        }
      }

      boundaries[boundaryDrag.boundaryIndex] = nextValue;
      setBoundaryPreview({
        isBlack: boundaryDrag.isBlack,
        activeDepths: boundaryDrag.activeDepths,
        boundaries: sanitizeBoundaries(boundaries, boundaryDrag.activeDepths),
      });
    };

    const commitDrag = () => {
      if (boundaryPreview) {
        onUpdateLayout(
          replaceBoundaryTemplate(
            layout,
            boundaryPreview.isBlack,
            boundaryPreview.activeDepths,
            boundaryPreview.boundaries,
          ),
        );
      }
      setBoundaryDrag(null);
      setBoundaryPreview(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', commitDrag);
    window.addEventListener('pointercancel', commitDrag);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', commitDrag);
      window.removeEventListener('pointercancel', commitDrag);
    };
  }, [boundaryDrag, boundaryPreview, layout, onUpdateLayout]);

  const selectedPitchPreview = useMemo(() => {
    if (selectedAddress === null) {
      return null;
    }
    const pitchRef = layout.mapping[selectedAddress];
    return {pitchRef, resolved: resolvePitch(pitchRef, tuning)};
  }, [layout.mapping, selectedAddress, tuning]);

  const usedTemplateGroups = useMemo(() => {
    const white = new Set<number>();
    const black = new Set<number>();
    for (let x = 0; x < displayHorizontalCount; x += 1) {
      const whiteDepths = layout.lanes[x * 2]?.activeDepths ?? 0;
      const blackDepths = layout.lanes[x * 2 + 1]?.activeDepths ?? 0;
      if (whiteDepths >= 2) {
        white.add(whiteDepths);
      }
      if (blackDepths >= 2) {
        black.add(blackDepths);
      }
    }
    return {
      white: Array.from(white).sort((a, b) => a - b),
      black: Array.from(black).sort((a, b) => a - b),
    };
  }, [displayHorizontalCount, layout.lanes]);

  const pitchRows = useMemo(
    () => Array.from({length: Math.ceil(tuning.pitches.length / 8)}, (_, index) => tuning.pitches.slice(index * 8, index * 8 + 8)),
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
    await globalAudioEngine.noteOn(addr, pitchRef, frequency, 0.8, 'editor_preview');
    window.setTimeout(() => globalAudioEngine.noteOffByAddress(addr), 220);
  };

  const getAssignmentTargets = () => {
    if (selectedAddresses.size > 0) {
      return Array.from(selectedAddresses);
    }
    return selectedAddress !== null ? [selectedAddress] : [];
  };

  const assignPitchToTargets = (targets: number[], pitchRef: number) => {
    if (targets.length === 0) {
      return;
    }
    const mapping = [...layout.mapping];
    targets.forEach((addr) => {
      mapping[addr] = pitchRef;
    });
    onUpdateLayout({...layout, mapping});
  };

  const handleSegmentInteraction = (addr: number, multi: boolean) => {
    onSelectAddress(addr);
    setSelectedAddresses((prev) => {
      if (!multi) {
        return new Set([addr]);
      }
      const next = new Set(prev);
      if (next.has(addr)) {
        next.delete(addr);
      } else {
        next.add(addr);
      }
      return next;
    });

    if (keyboardMode === 'play') {
      void previewAddress(addr);
      return;
    }

    if (keyboardMode === 'assign' && armedPitchRef !== null) {
      const targets: number[] = multi
        ? selectedAddresses.size > 0
          ? Array.from(selectedAddresses)
          : [addr]
        : [addr];
      assignPitchToTargets(targets, armedPitchRef);
      void previewAddress(addr);
      return;
    }

    void previewAddress(addr);
  };

  const updateLaneDepths = (column: number, isBlack: boolean, nextDepths: number) => {
    const laneIndex = column * 2 + (isBlack ? 1 : 0);
    const lanes = [...layout.lanes];
    lanes[laneIndex] = {
      ...lanes[laneIndex],
      activeDepths: Math.max(0, Math.min(8, nextDepths)),
    };
    onUpdateLayout({...layout, lanes});
  };

  const resetBoundaryTemplate = (isBlack: boolean, activeDepths: number) => {
    onUpdateLayout(replaceBoundaryTemplate(layout, isBlack, activeDepths, undefined));
  };

  const handleAutoMapping = () => {
    onUpdateLayout({
      ...layout,
      mapping: applyAutoMapping(layout, tuning.pitches, settings.autoMappingDirection),
    });
  };

  const handleOctaveRepeatFill = () => {
    const mapping = [...layout.mapping];
    const period = layout.horizontalCount || 7;
    for (let x = period; x < 16; x += 1) {
      const sourceX = x % period;
      const octaveOffset = Math.floor(x / period);
      for (let depth = 0; depth < 8; depth += 1) {
        const copyLane = (isBlack: boolean) => {
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
        copyLane(false);
        copyLane(true);
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
          name: `音高 ${maxId + 1}`,
          type: 'edo',
          edo: tuning.pitches[0]?.edo ?? 12,
          step: maxId + 1,
        },
      ],
    });
  };

  const selectedDecoded = selectedAddress !== null ? decodeAddress(selectedAddress) : null;
  const selectedLaneDepths =
    selectedDecoded !== null ? layout.lanes[selectedDecoded.x * 2 + (selectedDecoded.isBlack ? 1 : 0)]?.activeDepths ?? 0 : 0;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#243041] bg-[#08101b] shadow-[0_18px_60px_rgba(0,0,0,0.35)]">
      <div className="border-b border-[#1d2a3a] bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.18),_transparent_42%),linear-gradient(180deg,#0b1422_0%,#09111c_100%)] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300/90">
              <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5">Editor</span>
              <span>{layout.name}</span>
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">鍵盤を直接編集する</h2>
            <p className="mt-1 text-sm text-slate-400">
              鍵盤配置・音高割当・段境界調整を、同じ鍵盤上で切り替えながら編集します。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <WorkspaceTabButton
              active={workspaceTab === 'keyboard'}
              label="鍵盤配置"
              icon={<Layers3 className="h-4 w-4" />}
              onClick={() => setWorkspaceTab('keyboard')}
            />
            <WorkspaceTabButton
              active={workspaceTab === 'pitches'}
              label="音高プリセット"
              icon={<Music2 className="h-4 w-4" />}
              onClick={() => setWorkspaceTab('pitches')}
            />
            <WorkspaceTabButton
              active={workspaceTab === 'samples'}
              label="外部音源"
              icon={<Edit3 className="h-4 w-4" />}
              onClick={() => setWorkspaceTab('samples')}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {workspaceTab === 'keyboard' && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_340px]">
            <section className="flex min-h-[760px] flex-col rounded-2xl border border-[#243041] bg-[#0b1420]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1d2a3a] px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <ModePill active={keyboardMode === 'select'} label="選択" onClick={() => setKeyboardMode('select')} />
                  <ModePill active={keyboardMode === 'assign'} label="音高割当" onClick={() => setKeyboardMode('assign')} />
                  <ModePill active={keyboardMode === 'boundary'} label="境界調整" onClick={() => setKeyboardMode('boundary')} />
                  <ModePill active={keyboardMode === 'play'} label="試奏" onClick={() => setKeyboardMode('play')} />
                </div>

                <div className="flex items-center gap-2">
                  <MiniMetric label="選択" value={`${selectedCount}`} />
                  <MiniMetric label="周期" value={`${displayHorizontalCount}鍵`} />
                  <div className="flex items-center gap-1 rounded-lg border border-[#243041] bg-[#0c1724] px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => setEditorKeyWidth((prev) => Math.max(52, prev - 4))}
                      className="rounded border border-[#2f4158] bg-[#111d2b] px-1.5 py-1 text-slate-300 hover:bg-[#172537]"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-12 text-center text-[11px] font-bold text-sky-300">{editorKeyWidth}px</span>
                    <button
                      type="button"
                      onClick={() => setEditorKeyWidth((prev) => Math.min(108, prev + 4))}
                      className="rounded border border-[#2f4158] bg-[#111d2b] px-1.5 py-1 text-slate-300 hover:bg-[#172537]"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex-1 p-4">
                <EditorKeyboardSurface
                  layout={layout}
                  tuning={tuning}
                  settings={settings}
                  displayHorizontalCount={displayHorizontalCount}
                  keyWidth={editorKeyWidth}
                  selectedAddress={selectedAddress}
                  selectedAddresses={selectedAddresses}
                  keyboardMode={keyboardMode}
                  armedPitchRef={armedPitchRef}
                  boundaryPreview={boundaryPreview}
                  onSegmentClick={handleSegmentInteraction}
                  onAdjustLaneDepth={updateLaneDepths}
                  onBoundaryHandlePointerDown={(state) => {
                    setBoundaryDrag(state);
                    setBoundaryPreview({
                      isBlack: state.isBlack,
                      activeDepths: state.activeDepths,
                      boundaries: getTemplateBoundaries(layout, state.activeDepths, state.isBlack),
                    });
                  }}
                />
              </div>

              <div className="border-t border-[#1d2a3a] px-4 py-4">
                {keyboardMode === 'assign' && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">音高パレット</div>
                        <div className="mt-1 text-xs text-slate-400">
                          音高を選んでから鍵盤をタップすると割り当てます。複数選択中はまとめて適用できます。
                        </div>
                      </div>
                      <div className="flex items-center gap-2 rounded-xl border border-[#243041] bg-[#0c1724] px-3 py-2">
                        <span className="text-xs text-slate-400">octaveShift</span>
                        <BlurCommitNumberInput
                          value={assignOctaveShift}
                          step={1}
                          onCommit={(value) => setAssignOctaveShift(Math.trunc(value))}
                          className="w-20 rounded border border-[#33475e] bg-[#08101b] px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      {pitchRows.map((row, rowIndex) => (
                        <div key={`row_${rowIndex}`} className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
                          {row.map((pitch) => {
                            const pitchRef = encodePitchReference(pitch.id, assignOctaveShift);
                            const active = armedPitchRef === pitchRef;
                            return (
                              <button
                                key={pitch.id}
                                type="button"
                                onClick={() => setArmedPitchRef(pitchRef)}
                                className={`rounded-xl border p-3 text-left transition-colors ${
                                  active
                                    ? 'border-sky-400 bg-sky-500/20'
                                    : 'border-[#243041] bg-[#0c1724] hover:border-sky-600 hover:bg-[#102034]'
                                }`}
                              >
                                <div className="text-sm font-bold text-white">{pitch.name}</div>
                                <div className="mt-1 text-[11px] text-slate-400">ID {pitch.id}</div>
                                <div className="mt-2 text-[11px] text-slate-500">{getPitchLabel(pitch)}</div>
                                <div className="mt-2 text-[11px] font-mono text-sky-300">
                                  {formatFrequency(calculateFrequency(pitch, tuning, assignOctaveShift))}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {keyboardMode === 'boundary' && (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <BoundaryTemplateStrip
                      title="白鍵テンプレート"
                      isBlack={false}
                      depthGroups={usedTemplateGroups.white}
                      layout={layout}
                      boundaryPreview={boundaryPreview}
                      onReset={resetBoundaryTemplate}
                    />
                    <BoundaryTemplateStrip
                      title="黒鍵テンプレート"
                      isBlack
                      depthGroups={usedTemplateGroups.black}
                      layout={layout}
                      boundaryPreview={boundaryPreview}
                      onReset={resetBoundaryTemplate}
                    />
                  </div>
                )}

                {keyboardMode === 'select' && (
                  <div className="grid gap-3 md:grid-cols-4">
                    <QuickActionCard
                      title="全選択"
                      helper="現在周期の全区画を選択します。"
                      onClick={() =>
                        setSelectedAddresses(
                          new Set(
                            Array.from({length: displayHorizontalCount}, (_, x) =>
                              Array.from({length: 16}, (_, offset) => x * 16 + offset),
                            ).flat(),
                          ),
                        )
                      }
                    />
                    <QuickActionCard title="選択解除" helper="複数選択を解除します。" onClick={() => setSelectedAddresses(new Set())} />
                    <QuickActionCard
                      title="オクターブ複製"
                      helper="1周期の割当を後続オクターブへ複製します。"
                      onClick={handleOctaveRepeatFill}
                    />
                    <QuickActionCard
                      title="自動配置"
                      helper="現在の並び方向に従って音高を自動配置します。"
                      onClick={handleAutoMapping}
                    />
                  </div>
                )}

                {keyboardMode === 'play' && (
                  <div className="rounded-2xl border border-[#243041] bg-[#0c1724] px-4 py-3 text-sm text-slate-300">
                    鍵盤を直接タップして試奏します。選択は保持しつつ、同じ鍵盤上で音の確認だけを続けられます。
                  </div>
                )}
              </div>
            </section>

            <aside className="flex flex-col gap-4">
              <InspectorPanel title="選択中" helper="鍵盤上の対象を選ぶと、ここで詳細確認と補助操作ができます。">
                {selectedDecoded ? (
                  <>
                    <InfoRow label="鍵種" value={selectedDecoded.isBlack ? '黒鍵' : '白鍵'} />
                    <InfoRow label="列" value={`${WHITE_NOTE_NAMES[selectedDecoded.x % 7] ?? selectedDecoded.x} / ${selectedDecoded.x}`} />
                    <InfoRow label="段" value={`${selectedDecoded.depth + 1} / ${Math.max(selectedLaneDepths, 1)}`} />
                    <InfoRow label="番地" value={getAddressLabel(selectedAddress!)} />
                    <InfoRow
                      label="音高"
                      value={
                        selectedPitchPreview?.resolved.pitchDef
                          ? `${selectedPitchPreview.resolved.pitchDef.name} (ID ${selectedPitchPreview.resolved.pitchDef.id})`
                          : '未割当'
                      }
                    />
                    {selectedPitchPreview?.resolved.pitchDef && (
                      <InfoRow
                        label="周波数"
                        value={formatFrequency(
                          calculateFrequency(
                            selectedPitchPreview.resolved.pitchDef,
                            tuning,
                            selectedPitchPreview.resolved.octaveShift,
                          ),
                        )}
                      />
                    )}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-[#33475e] bg-[#0c1724] px-3 py-5 text-center text-sm text-slate-500">
                    まだ鍵盤が選択されていません。
                  </div>
                )}
              </InspectorPanel>

              <InspectorPanel title="補助操作" helper="精密入力や一括操作は右側から行います。">
                <div className="grid gap-2">
                  <button
                    type="button"
                    onClick={() => assignPitchToTargets(getAssignmentTargets(), -1)}
                    className="flex items-center justify-center gap-2 rounded-xl border border-rose-800/80 bg-rose-950/50 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-900/70"
                  >
                    <XCircle className="h-4 w-4" />
                    選択範囲の割当を解除
                  </button>
                  <button
                    type="button"
                    onClick={() => void (selectedAddress !== null && previewAddress(selectedAddress))}
                    disabled={selectedAddress === null}
                    className="flex items-center justify-center gap-2 rounded-xl border border-[#33475e] bg-[#0c1724] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-[#102034] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <PlayCircle className="h-4 w-4" />
                    選択音を試聴
                  </button>
                </div>

                {selectedDecoded && (
                  <div className="rounded-2xl border border-[#243041] bg-[#0c1724] p-3">
                    <div className="mb-2 text-xs font-semibold text-slate-300">段数調整</div>
                    <div className="grid grid-cols-3 gap-2">
                      {Array.from({length: 9}, (_, value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateLaneDepths(selectedDecoded.x, selectedDecoded.isBlack, value)}
                          className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                            selectedLaneDepths === value
                              ? 'border-sky-400 bg-sky-500/20 text-sky-100'
                              : 'border-[#33475e] bg-[#08101b] text-slate-300 hover:bg-[#102034]'
                          }`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-2">
                  <SmallUtilityButton onClick={handleOctaveRepeatFill}>
                    <Copy className="h-3.5 w-3.5" />
                    周期複製
                  </SmallUtilityButton>
                  <SmallUtilityButton onClick={handleAutoMapping}>
                    <Wand2 className="h-3.5 w-3.5" />
                    自動配置
                  </SmallUtilityButton>
                </div>
              </InspectorPanel>
            </aside>
          </div>
        )}

        {workspaceTab === 'pitches' && (
          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_320px]">
              <section className="rounded-2xl border border-[#243041] bg-[#0b1420]">
                <div className="flex items-center justify-between border-b border-[#1d2a3a] px-4 py-3">
                  <div>
                    <div className="text-lg font-bold text-white">音高プリセット</div>
                    <div className="mt-1 text-sm text-slate-400">
                      音高定義そのものを編集します。鍵盤画面で行うのは割当だけです。
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddPitch}
                    className="inline-flex items-center gap-2 rounded-xl border border-sky-500 bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-500"
                  >
                    <Plus className="h-4 w-4" />
                    音高を追加
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-[#0c1724] text-slate-300">
                      <tr>
                        <th className="px-3 py-2">ID</th>
                        <th className="px-3 py-2">名前</th>
                        <th className="px-3 py-2">方式</th>
                        <th className="px-3 py-2">パラメータ</th>
                        <th className="px-3 py-2">周波数</th>
                        <th className="px-3 py-2 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tuning.pitches.map((pitch) => (
                        <tr key={pitch.id} className="border-t border-[#1d2a3a]">
                          <td className="px-3 py-2 font-mono text-sky-300">{pitch.id}</td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={pitch.name}
                              onChange={(event) => handleUpdatePitchItem({...pitch, name: event.target.value})}
                              className="w-44 rounded-lg border border-[#33475e] bg-[#08101b] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={pitch.type}
                              onChange={(event) => handleUpdatePitchItem({...pitch, type: event.target.value as PitchType})}
                              className="rounded-lg border border-[#33475e] bg-[#08101b] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
                            >
                              <option value="edo">EDO</option>
                              <option value="cents">Cent</option>
                              <option value="ratio">Ratio</option>
                              <option value="frequency">Frequency</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">{renderTuningTypeEditor(pitch, handleUpdatePitchItem)}</td>
                          <td className="px-3 py-2 font-mono text-slate-300">
                            {formatFrequency(calculateFrequency(pitch, tuning))}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeletePitch(pitch.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-800 bg-rose-950/50 px-2 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/70"
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
              </section>

              <InspectorPanel title="基準情報" helper="ここでは基準周波数と1周期の情報だけ確認できます。">
                <InfoRow label="プリセット" value={tuning.name} />
                <InfoRow label="基準周波数" value={`${tuning.baseFrequency} Hz`} />
                <InfoRow label="1周期" value={`${tuning.periodCents} cent`} />
                <InfoRow label="基準番地" value={`0x${tuning.baseAddress.toString(16).toUpperCase()}`} />
              </InspectorPanel>
            </div>
          </div>
        )}

        {workspaceTab === 'samples' && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_320px]">
            <section className="rounded-2xl border border-[#243041] bg-[#0b1420] p-4">
              <div className="mb-4">
                <div className="text-lg font-bold text-white">外部音源マッピング</div>
                <div className="mt-1 text-sm text-slate-400">
                  `Grand Piano` サンプルの基準 pitch ID とオクターブ対応を確認・修正します。
                </div>
              </div>
              <SampleMappingEditor tuning={tuning} settings={settings} onUpdateSettings={onUpdateSettings} />
            </section>

            <InspectorPanel title="音源メモ" helper="鍵盤側ではなく、ここで外部音源の参照だけを整理します。">
              <div className="space-y-2 text-sm leading-relaxed text-slate-300">
                <p>外部音源の割当は、各サンプルがどの pitch ID / オクターブを基準にするかで決まります。</p>
                <p>鍵盤側の音高配置を変えても、サンプル基準はここで個別に維持されます。</p>
              </div>
            </InspectorPanel>
          </div>
        )}
      </div>
    </div>
  );
};

function replaceBoundaryTemplate(
  layout: LayoutPreset,
  isBlack: boolean,
  activeDepths: number,
  boundaries: number[] | undefined,
): LayoutPreset {
  const key = isBlack ? 'blackBoundaryTemplates' : 'whiteBoundaryTemplates';
  const nextTemplates = {
    ...(isBlack ? layout.blackBoundaryTemplates ?? layout.boundaryTemplates : layout.whiteBoundaryTemplates ?? layout.boundaryTemplates),
  };

  if (boundaries) {
    nextTemplates[activeDepths] = boundaries;
  } else {
    delete nextTemplates[activeDepths];
  }

  return {
    ...layout,
    [key]: nextTemplates,
  };
}

const EditorKeyboardSurface: React.FC<{
  layout: LayoutPreset;
  tuning: TuningPreset;
  settings: AppSettings;
  displayHorizontalCount: number;
  keyWidth: number;
  selectedAddress: number | null;
  selectedAddresses: Set<number>;
  keyboardMode: KeyboardMode;
  armedPitchRef: number | null;
  boundaryPreview: BoundaryPreview | null;
  onSegmentClick: (addr: number, multi: boolean) => void;
  onAdjustLaneDepth: (column: number, isBlack: boolean, nextDepths: number) => void;
  onBoundaryHandlePointerDown: (state: BoundaryDragState) => void;
}> = ({
  layout,
  tuning,
  settings,
  displayHorizontalCount,
  keyWidth,
  selectedAddress,
  selectedAddresses,
  keyboardMode,
  armedPitchRef,
  boundaryPreview,
  onSegmentClick,
  onAdjustLaneDepth,
  onBoundaryHandlePointerDown,
}) => {
  const blackWidth = Math.round(keyWidth * 0.62);
  const keyboardWidth = displayHorizontalCount * keyWidth;

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#243041] bg-[linear-gradient(180deg,#0c1724_0%,#0a1320_100%)] p-4">
      <div className="mx-auto" style={{width: `${keyboardWidth}px`}}>
        <div className="relative h-[520px]">
          <div className="absolute inset-x-0 bottom-0 flex h-[68%]">
            {Array.from({length: displayHorizontalCount}, (_, x) => {
              const lane = layout.lanes[x * 2];
              const activeDepths = lane?.activeDepths ?? 0;
              const boundaries = getPreviewBoundaries(layout, lane, false, activeDepths, boundaryPreview);
              const segments = getSegmentHeightsFromBoundaries(boundaries);
              const isLaneSelected =
                selectedAddress !== null && decodeAddress(selectedAddress).x === x && !decodeAddress(selectedAddress).isBlack;

              return (
                <div
                  key={`white_${x}`}
                  className="relative border-r border-slate-300/70 bg-[linear-gradient(180deg,#fbfbfd_0%,#dfe5eb_100%)] shadow-[inset_-1px_0_0_rgba(0,0,0,0.08)]"
                  style={{width: `${keyWidth}px`}}
                >
                  <KeyHeader
                    name={WHITE_NOTE_NAMES[x % 7] ?? `${x}`}
                    isBlack={false}
                    activeDepths={activeDepths}
                    selected={isLaneSelected}
                    onMinus={() => onAdjustLaneDepth(x, false, activeDepths - 1)}
                    onPlus={() => onAdjustLaneDepth(x, false, activeDepths + 1)}
                    showControls={keyboardMode === 'select' || keyboardMode === 'boundary'}
                  />
                  <div className="absolute inset-x-0 bottom-0 top-11 flex flex-col overflow-hidden rounded-b-[18px]">
                    {segments.map((heightRatio, index) => {
                      const depth = Math.max(activeDepths - 1 - index, 0);
                      const addr = encodeAddress(x, false, depth);
                      const isInvalid = depth >= activeDepths;
                      return (
                        <KeySegment
                          key={addr}
                          addr={addr}
                          tuning={tuning}
                          layout={layout}
                          isBlack={false}
                          isInvalid={isInvalid}
                          heightPercent={heightRatio * 100}
                          selected={selectedAddresses.has(addr) || selectedAddress === addr}
                          armedPitchRef={armedPitchRef}
                          pitchLabelMode={settings.pitchLabelMode}
                          showAddress={!!settings.showAddressBinary}
                          onClick={onSegmentClick}
                        />
                      );
                    })}
                  </div>
                  {keyboardMode === 'boundary' && activeDepths >= 2 && (
                    <BoundaryHandles
                      boundaries={boundaries}
                      activeDepths={activeDepths}
                      isBlack={false}
                      offsetTop={44}
                      onPointerDown={(boundaryIndex, startY, startValue) =>
                        onBoundaryHandlePointerDown({
                          isBlack: false,
                          activeDepths,
                          boundaryIndex,
                          startY,
                          startValue,
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="absolute inset-x-0 top-0 flex h-[44%]">
            {Array.from({length: displayHorizontalCount}, (_, x) => {
              const lane = layout.lanes[x * 2 + 1];
              const activeDepths = lane?.activeDepths ?? 0;
              const hasBlack = activeDepths > 0 || settings.showInvalidSections;
              if (!hasBlack) {
                return <div key={`black_gap_${x}`} style={{width: `${keyWidth}px`}} />;
              }

              const boundaries = getPreviewBoundaries(layout, lane, true, activeDepths, boundaryPreview);
              const segments = getSegmentHeightsFromBoundaries(boundaries);
              const isLaneSelected =
                selectedAddress !== null && decodeAddress(selectedAddress).x === x && decodeAddress(selectedAddress).isBlack;

              return (
                <div key={`black_wrap_${x}`} className="relative" style={{width: `${keyWidth}px`}}>
                  <div
                    className="absolute left-1/2 top-0 h-full -translate-x-1/2 overflow-hidden rounded-b-[16px] border border-[#0f1115] bg-[linear-gradient(180deg,#30343a_0%,#0f1218_100%)] shadow-[0_14px_24px_rgba(0,0,0,0.32)]"
                    style={{width: `${blackWidth}px`}}
                  >
                    <KeyHeader
                      name={BLACK_NOTE_NAMES[x % 7] || ' '}
                      isBlack
                      activeDepths={activeDepths}
                      selected={isLaneSelected}
                      onMinus={() => onAdjustLaneDepth(x, true, activeDepths - 1)}
                      onPlus={() => onAdjustLaneDepth(x, true, activeDepths + 1)}
                      showControls={keyboardMode === 'select' || keyboardMode === 'boundary'}
                    />
                    <div className="absolute inset-x-0 bottom-0 top-11 flex flex-col overflow-hidden rounded-b-[16px]">
                      {segments.map((heightRatio, index) => {
                        const depth = Math.max(activeDepths - 1 - index, 0);
                        const addr = encodeAddress(x, true, depth);
                        const isInvalid = depth >= activeDepths;
                        return (
                          <KeySegment
                            key={addr}
                            addr={addr}
                            tuning={tuning}
                            layout={layout}
                            isBlack
                            isInvalid={isInvalid}
                            heightPercent={heightRatio * 100}
                            selected={selectedAddresses.has(addr) || selectedAddress === addr}
                            armedPitchRef={armedPitchRef}
                            pitchLabelMode={settings.pitchLabelMode}
                            showAddress={!!settings.showAddressBinary}
                            onClick={onSegmentClick}
                          />
                        );
                      })}
                    </div>
                    {keyboardMode === 'boundary' && activeDepths >= 2 && (
                      <BoundaryHandles
                        boundaries={boundaries}
                        activeDepths={activeDepths}
                        isBlack
                        offsetTop={44}
                        onPointerDown={(boundaryIndex, startY, startValue) =>
                          onBoundaryHandlePointerDown({
                            isBlack: true,
                            activeDepths,
                            boundaryIndex,
                            startY,
                            startValue,
                          })
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

function getPreviewBoundaries(
  layout: LayoutPreset,
  lane: LayoutPreset['lanes'][number] | undefined,
  isBlack: boolean,
  activeDepths: number,
  boundaryPreview: BoundaryPreview | null,
) {
  if (
    boundaryPreview &&
    boundaryPreview.isBlack === isBlack &&
    boundaryPreview.activeDepths === activeDepths
  ) {
    return boundaryPreview.boundaries;
  }
  return getLaneBoundaries(layout, lane, isBlack);
}

const KeyHeader: React.FC<{
  name: string;
  isBlack: boolean;
  activeDepths: number;
  selected: boolean;
  onMinus: () => void;
  onPlus: () => void;
  showControls: boolean;
}> = ({name, isBlack, activeDepths, selected, onMinus, onPlus, showControls}) => (
  <div
    className={`flex h-11 items-center justify-between border-b px-2 ${
      isBlack
        ? 'border-white/10 bg-black/20 text-slate-200'
        : 'border-slate-300/80 bg-white/70 text-slate-700'
    } ${selected ? (isBlack ? 'ring-1 ring-sky-400/80' : 'ring-1 ring-sky-500/70') : ''}`}
  >
    <div className="min-w-0">
      <div className="truncate text-xs font-bold">{name}</div>
      <div className={`text-[10px] ${isBlack ? 'text-slate-500' : 'text-slate-500'}`}>{activeDepths}段</div>
    </div>
    {showControls && (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onMinus}
          className={`rounded border px-1 py-0.5 text-[10px] ${
            isBlack ? 'border-white/10 bg-black/30 text-slate-200' : 'border-slate-300 bg-white/80 text-slate-600'
          }`}
        >
          -
        </button>
        <button
          type="button"
          onClick={onPlus}
          className={`rounded border px-1 py-0.5 text-[10px] ${
            isBlack ? 'border-white/10 bg-black/30 text-slate-200' : 'border-slate-300 bg-white/80 text-slate-600'
          }`}
        >
          +
        </button>
      </div>
    )}
  </div>
);

const KeySegment: React.FC<{
  addr: number;
  tuning: TuningPreset;
  layout: LayoutPreset;
  isBlack: boolean;
  isInvalid: boolean;
  heightPercent: number;
  selected: boolean;
  armedPitchRef: number | null;
  pitchLabelMode: AppSettings['pitchLabelMode'];
  showAddress: boolean;
  onClick: (addr: number, multi: boolean) => void;
}> = ({
  addr,
  tuning,
  layout,
  isBlack,
  isInvalid,
  heightPercent,
  selected,
  armedPitchRef,
  pitchLabelMode,
  showAddress,
  onClick,
}) => {
  const pitchRef = layout.mapping[addr];
  const resolved = resolvePitch(pitchRef, tuning);
  const isArmed = armedPitchRef !== null && pitchRef === armedPitchRef;

  return (
    <button
      type="button"
      onClick={(event) => onClick(addr, event.ctrlKey || event.metaKey || event.shiftKey)}
      className={`group relative flex flex-col justify-between border-b px-2 py-1.5 text-left transition-colors ${
        isBlack
          ? selected
            ? 'bg-sky-500/30 text-sky-50'
            : isInvalid
              ? 'bg-slate-900/50 text-slate-600'
              : 'bg-transparent text-slate-200 hover:bg-white/8'
          : selected
            ? 'bg-sky-400/30 text-sky-950'
            : isInvalid
              ? 'bg-slate-300/70 text-slate-400'
              : 'bg-transparent text-slate-800 hover:bg-sky-100/50'
      }`}
      style={{height: `${heightPercent}%`}}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`text-[10px] font-medium ${isBlack ? 'text-slate-500' : 'text-slate-500'}`}>
          {resolved.pitchDef?.name ?? '未割当'}
        </span>
        {isArmed && <span className="text-[10px] font-semibold text-sky-300">選択中</span>}
      </div>

      <div className={`text-[10px] leading-tight ${isBlack ? 'text-slate-400' : 'text-slate-500'}`}>
        {resolved.pitchDef ? getPitchLabel(resolved.pitchDef) : ' '}
      </div>

      {showAddress && (
        <div className={`text-[10px] font-mono ${isBlack ? 'text-slate-600' : 'text-slate-400'}`}>
          {getAddressLabel(addr)}
        </div>
      )}

      {pitchLabelMode === 'freq' && resolved.pitchDef && (
        <div className={`text-[10px] font-mono ${isBlack ? 'text-slate-500' : 'text-slate-500'}`}>
          {formatFrequency(calculateFrequency(resolved.pitchDef, tuning, resolved.octaveShift))}
        </div>
      )}
    </button>
  );
};

const BoundaryHandles: React.FC<{
  boundaries: number[];
  activeDepths: number;
  isBlack: boolean;
  offsetTop: number;
  onPointerDown: (boundaryIndex: number, startY: number, startValue: number) => void;
}> = ({boundaries, activeDepths, isBlack, offsetTop, onPointerDown}) => {
  const usableHeight = 100 - (offsetTop / 5.2);

  return (
    <>
      {Array.from({length: Math.max(activeDepths - 1, 0)}, (_, index) => {
        const boundaryIndex = index + 1;
        const top = boundaries[boundaryIndex] * usableHeight + offsetTop;
        return (
          <button
            key={`boundary_${boundaryIndex}`}
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onPointerDown(boundaryIndex, event.clientY, boundaries[boundaryIndex]);
            }}
            className={`absolute -left-2 z-20 h-4 w-4 -translate-y-1/2 rounded-full border ${
              isBlack
                ? 'border-sky-400 bg-sky-500/90 text-sky-950'
                : 'border-sky-500 bg-white text-sky-600'
            }`}
            style={{top: `${top}px`}}
            title="段境界をドラッグ"
            aria-label="段境界をドラッグ"
          >
            ▲
          </button>
        );
      })}
    </>
  );
};

const BoundaryTemplateStrip: React.FC<{
  title: string;
  isBlack: boolean;
  depthGroups: number[];
  layout: LayoutPreset;
  boundaryPreview: BoundaryPreview | null;
  onReset: (isBlack: boolean, activeDepths: number) => void;
}> = ({title, isBlack, depthGroups, layout, boundaryPreview, onReset}) => (
  <div className="rounded-2xl border border-[#243041] bg-[#0c1724] p-3">
    <div className="mb-3 flex items-center justify-between gap-2">
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-xs text-slate-400">同じ段数の鍵は、ここで共通テンプレートとして連動します。</div>
      </div>
    </div>
    {depthGroups.length === 0 ? (
      <div className="rounded-xl border border-dashed border-[#33475e] px-3 py-5 text-center text-sm text-slate-500">
        現在このテンプレートは使われていません。
      </div>
    ) : (
      <div className="grid gap-2 md:grid-cols-2">
        {depthGroups.map((depths) => {
          const boundaries =
            boundaryPreview && boundaryPreview.isBlack === isBlack && boundaryPreview.activeDepths === depths
              ? boundaryPreview.boundaries
              : getTemplateBoundaries(layout, depths, isBlack);
          const segments = getSegmentHeightsFromBoundaries(boundaries);
          return (
            <div key={`${isBlack ? 'black' : 'white'}_${depths}`} className="rounded-xl border border-[#33475e] bg-[#08101b] p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-100">{depths}段</div>
                <button
                  type="button"
                  onClick={() => onReset(isBlack, depths)}
                  className="rounded-lg border border-[#33475e] bg-[#0c1724] px-2 py-1 text-xs text-slate-300 hover:bg-[#102034]"
                >
                  既定に戻す
                </button>
              </div>
              <div className="flex h-16 overflow-hidden rounded-lg border border-[#243041]">
                {segments.map((ratio, index) => (
                  <div
                    key={index}
                    className={`${isBlack ? 'bg-slate-700' : 'bg-slate-200'} border-r border-[#243041]`}
                    style={{width: `${ratio * 100}%`}}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

const QuickActionCard: React.FC<{
  title: string;
  helper: string;
  onClick: () => void;
}> = ({title, helper, onClick}) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded-2xl border border-[#243041] bg-[#0c1724] p-4 text-left transition-colors hover:bg-[#102034]"
  >
    <div className="text-sm font-semibold text-white">{title}</div>
    <div className="mt-1 text-xs leading-relaxed text-slate-400">{helper}</div>
  </button>
);

const InspectorPanel: React.FC<{
  title: string;
  helper?: string;
  children: React.ReactNode;
}> = ({title, helper, children}) => (
  <section className="rounded-2xl border border-[#243041] bg-[#0b1420] p-4">
    <div className="border-b border-[#1d2a3a] pb-3">
      <div className="text-lg font-bold text-white">{title}</div>
      {helper && <div className="mt-1 text-sm text-slate-400">{helper}</div>}
    </div>
    <div className="mt-4 space-y-3">{children}</div>
  </section>
);

const InfoRow: React.FC<{label: string; value: string}> = ({label, value}) => (
  <div className="flex items-start justify-between gap-3 rounded-xl border border-[#243041] bg-[#0c1724] px-3 py-2">
    <span className="text-xs font-semibold text-slate-400">{label}</span>
    <span className="text-right text-sm text-slate-100">{value}</span>
  </div>
);

const SmallUtilityButton: React.FC<{
  onClick: () => void;
  children: React.ReactNode;
}> = ({onClick, children}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#33475e] bg-[#0c1724] px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-[#102034]"
  >
    {children}
  </button>
);

const WorkspaceTabButton: React.FC<{
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}> = ({active, label, icon, onClick}) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${
      active
        ? 'border-sky-400 bg-sky-500/20 text-sky-100'
        : 'border-[#2c4058] bg-[#0c1724] text-slate-300 hover:bg-[#102034]'
    }`}
  >
    {icon}
    {label}
  </button>
);

const ModePill: React.FC<{
  active: boolean;
  label: string;
  onClick: () => void;
}> = ({active, label, onClick}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
      active
        ? 'border-sky-400 bg-sky-500/20 text-sky-100'
        : 'border-[#33475e] bg-[#0c1724] text-slate-300 hover:bg-[#102034]'
    }`}
  >
    {label}
  </button>
);

const MiniMetric: React.FC<{label: string; value: string}> = ({label, value}) => (
  <div className="rounded-lg border border-[#243041] bg-[#0c1724] px-2 py-1.5">
    <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="text-xs font-bold text-sky-300">{value}</div>
  </div>
);

function renderTuningTypeEditor(
  pitch: PitchDefinition,
  onChange: (pitch: PitchDefinition) => void,
) {
  if (pitch.type === 'edo') {
    return (
      <div className="flex items-center gap-2">
        <BlurCommitNumberInput
          value={pitch.edo ?? 12}
          step={1}
          onCommit={(value) => onChange({...pitch, edo: Math.max(1, Math.round(value))})}
          className="w-20 rounded-lg border border-[#33475e] bg-[#08101b] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        <span className="text-slate-400">EDO</span>
        <BlurCommitNumberInput
          value={pitch.step ?? 0}
          step={1}
          onCommit={(value) => onChange({...pitch, step: Math.round(value)})}
          className="w-20 rounded-lg border border-[#33475e] bg-[#08101b] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
      </div>
    );
  }

  if (pitch.type === 'cents') {
    return (
      <BlurCommitNumberInput
        value={pitch.cents ?? 0}
        step={1}
        onCommit={(value) => onChange({...pitch, cents: value})}
        className="w-28 rounded-lg border border-[#33475e] bg-[#08101b] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
      />
    );
  }

  if (pitch.type === 'ratio') {
    return (
      <div className="flex items-center gap-2">
        <BlurCommitNumberInput
          value={pitch.numerator ?? 1}
          step={1}
          onCommit={(value) => onChange({...pitch, numerator: Math.max(1, Math.round(value))})}
          className="w-20 rounded-lg border border-[#33475e] bg-[#08101b] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        <span className="text-slate-400">/</span>
        <BlurCommitNumberInput
          value={pitch.denominator ?? 1}
          step={1}
          onCommit={(value) => onChange({...pitch, denominator: Math.max(1, Math.round(value))})}
          className="w-20 rounded-lg border border-[#33475e] bg-[#08101b] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
        />
      </div>
    );
  }

  return (
    <BlurCommitNumberInput
      value={pitch.frequency ?? 440}
      step={0.01}
      onCommit={(value) => onChange({...pitch, frequency: Math.max(0, value)})}
      className="w-28 rounded-lg border border-[#33475e] bg-[#08101b] px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
    />
  );
}
