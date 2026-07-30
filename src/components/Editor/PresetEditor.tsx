import React, {useEffect, useMemo, useState} from 'react';
import {
  Copy,
  Edit3,
  Layers3,
  Minus,
  Music2,
  PlayCircle,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react';
import {AppSettings, LayoutPreset, PitchDefinition, PitchType, TuningPreset} from '../../types/keyboard';
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

const WHITE_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_NAMES = ['C#', 'D#', '', 'F#', 'G#', 'A#', ''];
const MIN_SEGMENT_SIZE = 0.05;
const SNAP_DISTANCE = 0.025;
const KEYBOARD_HEIGHT = 520;
const WHITE_TOP = 144;
const WHITE_HEIGHT = 360;
const BLACK_TOP = 0;
const BLACK_HEIGHT = 260;
const KEY_HEADER_HEIGHT = 36;

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
  const [selectedPitchRef, setSelectedPitchRef] = useState<number | null>(null);
  const [assignOctaveShift, setAssignOctaveShift] = useState(0);
  const [editorKeyWidth, setEditorKeyWidth] = useState(78);
  const [boundaryDrag, setBoundaryDrag] = useState<BoundaryDragState | null>(null);
  const [boundaryPreview, setBoundaryPreview] = useState<BoundaryPreview | null>(null);

  const displayHorizontalCount = Math.max(1, Math.min(16, layout.horizontalCount ?? 7));
  const selectionCount = selectedAddresses.size || (selectedAddress !== null ? 1 : 0);

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

    const previousBodyTouchAction = document.body.style.touchAction;
    document.body.style.touchAction = 'none';

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const base =
        boundaryPreview &&
        boundaryPreview.isBlack === boundaryDrag.isBlack &&
        boundaryPreview.activeDepths === boundaryDrag.activeDepths
          ? boundaryPreview.boundaries
          : getTemplateBoundaries(layout, boundaryDrag.activeDepths, boundaryDrag.isBlack);
      const boundaries = [...base];
      const minValue = boundaries[boundaryDrag.boundaryIndex - 1] + MIN_SEGMENT_SIZE;
      const maxValue = boundaries[boundaryDrag.boundaryIndex + 1] - MIN_SEGMENT_SIZE;
      const deltaRatio = (event.clientY - boundaryDrag.startY) / 260;
      let nextValue = Math.max(minValue, Math.min(maxValue, boundaryDrag.startValue + deltaRatio));

      const templates = boundaryDrag.isBlack
        ? layout.blackBoundaryTemplates ?? layout.boundaryTemplates
        : layout.whiteBoundaryTemplates ?? layout.boundaryTemplates;
      const snapValues = (Object.values(templates) as number[][])
        .flatMap((template) => template.slice(1, -1))
        .filter((value) => value > minValue && value < maxValue);

      for (const snapValue of snapValues) {
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

    const handlePointerUp = () => {
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
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      document.body.style.touchAction = previousBodyTouchAction;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [boundaryDrag, boundaryPreview, layout, onUpdateLayout]);

  const pitchRows = useMemo(
    () =>
      Array.from({length: Math.ceil(tuning.pitches.length / 8)}, (_, rowIndex) =>
        tuning.pitches.slice(rowIndex * 8, rowIndex * 8 + 8),
      ),
    [tuning.pitches],
  );

  const selectedDecoded = selectedAddress !== null ? decodeAddress(selectedAddress) : null;
  const selectedLane =
    selectedDecoded !== null
      ? layout.lanes[selectedDecoded.x * 2 + (selectedDecoded.isBlack ? 1 : 0)]
      : undefined;
  const selectedPitch = selectedAddress !== null ? resolvePitch(layout.mapping[selectedAddress], tuning) : null;

  const usedTemplateGroups = useMemo(() => {
    const white = new Set<number>();
    const black = new Set<number>();
    for (let x = 0; x < displayHorizontalCount; x += 1) {
      const whiteDepths = layout.lanes[x * 2]?.activeDepths ?? 0;
      const blackDepths = layout.lanes[x * 2 + 1]?.activeDepths ?? 0;
      if (whiteDepths >= 2) white.add(whiteDepths);
      if (blackDepths >= 2) black.add(blackDepths);
    }
    return {
      white: Array.from(white).sort((a, b) => a - b),
      black: Array.from(black).sort((a, b) => a - b),
    };
  }, [displayHorizontalCount, layout.lanes]);

  const previewAddress = async (address: number) => {
    const pitchRef = layout.mapping[address];
    const {pitchDef, octaveShift} = resolvePitch(pitchRef, tuning);
    if (!pitchDef) {
      return;
    }
    const frequency = calculateFrequency(pitchDef, tuning, octaveShift);
    await globalAudioEngine.noteOn(address, pitchRef, frequency, 0.8, 'editor_preview');
    window.setTimeout(() => globalAudioEngine.noteOffByAddress(address), 220);
  };

  const handleSegmentSelect = (address: number, multi: boolean) => {
    onSelectAddress(address);
    setSelectedAddresses((prev) => {
      if (!multi) {
        return new Set([address]);
      }
      const next = new Set(prev);
      if (next.has(address)) {
        next.delete(address);
      } else {
        next.add(address);
      }
      return next;
    });
    if (keyboardMode === 'play') {
      void previewAddress(address);
    }
  };

  const getSelectionTargets = () => {
    if (selectedAddresses.size > 0) {
      return Array.from(selectedAddresses);
    }
    return selectedAddress !== null ? [selectedAddress] : [];
  };

  const assignPitchToSelection = () => {
    if (selectedPitchRef === null) {
      return;
    }
    const targets = getSelectionTargets();
    if (targets.length === 0) {
      return;
    }
    const mapping = [...layout.mapping];
    targets.forEach((address) => {
      mapping[address] = selectedPitchRef;
    });
    onUpdateLayout({...layout, mapping});
    void previewAddress(targets[0]);
  };

  const clearSelectionMapping = () => {
    const targets = getSelectionTargets();
    if (targets.length === 0) {
      return;
    }
    const mapping = [...layout.mapping];
    targets.forEach((address) => {
      mapping[address] = -1;
    });
    onUpdateLayout({...layout, mapping});
  };

  const updateLaneDepths = (column: number, isBlack: boolean, nextDepths: number) => {
    const laneIndex = column * 2 + (isBlack ? 1 : 0);
    const cleanDepths = Math.max(0, Math.min(8, nextDepths));
    const lanes = [...layout.lanes];
    lanes[laneIndex] = {
      ...(lanes[laneIndex] ?? {activeDepths: 0}),
      activeDepths: cleanDepths,
    };

    const mapping = [...layout.mapping];
    if (cleanDepths === 0) {
      for (let depth = 0; depth < 8; depth += 1) {
        mapping[encodeAddress(column, isBlack, depth)] = -1;
      }
      onSelectAddress(null);
    }

    onUpdateLayout({...layout, lanes, mapping});
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
        for (const isBlack of [false, true]) {
          const sourceAddress = encodeAddress(sourceX, isBlack, depth);
          const resolved = resolvePitch(layout.mapping[sourceAddress], tuning);
          if (resolved.pitchDef) {
            mapping[encodeAddress(x, isBlack, depth)] = encodePitchReference(
              resolved.pitchDef.id,
              resolved.octaveShift + octaveOffset,
            );
          }
        }
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

  const handleUpdatePitch = (updatedPitch: PitchDefinition) => {
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

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#273241] bg-[#0a0f16] text-slate-100 shadow-2xl">
      <div className="border-b border-[#273241] bg-[#101821] px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">鍵盤編集</h2>
            <div className="mt-1 truncate text-xs text-slate-400">{layout.name}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <WorkspaceTabButton active={workspaceTab === 'keyboard'} label="鍵盤配置" icon={<Layers3 className="h-4 w-4" />} onClick={() => setWorkspaceTab('keyboard')} />
            <WorkspaceTabButton active={workspaceTab === 'pitches'} label="音高" icon={<Music2 className="h-4 w-4" />} onClick={() => setWorkspaceTab('pitches')} />
            <WorkspaceTabButton active={workspaceTab === 'samples'} label="外部音源" icon={<Edit3 className="h-4 w-4" />} onClick={() => setWorkspaceTab('samples')} />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {workspaceTab === 'keyboard' && (
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="min-w-0 rounded-lg border border-[#273241] bg-[#0d141d]">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#273241] px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  <ModeButton active={keyboardMode === 'select'} label="選択" onClick={() => setKeyboardMode('select')} />
                  <ModeButton active={keyboardMode === 'assign'} label="音高割当" onClick={() => setKeyboardMode('assign')} />
                  <ModeButton active={keyboardMode === 'boundary'} label="境界調整" onClick={() => setKeyboardMode('boundary')} />
                  <ModeButton active={keyboardMode === 'play'} label="試奏" onClick={() => setKeyboardMode('play')} />
                </div>
                <div className="flex items-center gap-2">
                  <Metric label="選択" value={`${selectionCount}`} />
                  <div className="flex items-center gap-1 rounded-md border border-[#344457] bg-[#111b26] px-2 py-1">
                    <button type="button" className="rounded p-1 hover:bg-[#1a2734]" onClick={() => setEditorKeyWidth((value) => Math.max(56, value - 4))} aria-label="鍵幅を狭くする">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-12 text-center text-xs font-bold text-sky-300">{editorKeyWidth}px</span>
                    <button type="button" className="rounded p-1 hover:bg-[#1a2734]" onClick={() => setEditorKeyWidth((value) => Math.min(116, value + 4))} aria-label="鍵幅を広くする">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-3">
                <EditorKeyboardSurface
                  layout={layout}
                  tuning={tuning}
                  settings={settings}
                  displayHorizontalCount={displayHorizontalCount}
                  keyWidth={editorKeyWidth}
                  selectedAddress={selectedAddress}
                  selectedAddresses={selectedAddresses}
                  keyboardMode={keyboardMode}
                  boundaryPreview={boundaryPreview}
                  onSegmentClick={handleSegmentSelect}
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

              <div className="border-t border-[#273241] p-3">
                {keyboardMode === 'assign' && (
                  <PitchPalette
                    tuning={tuning}
                    pitchRows={pitchRows}
                    selectedPitchRef={selectedPitchRef}
                    assignOctaveShift={assignOctaveShift}
                    onChangeOctaveShift={setAssignOctaveShift}
                    onSelectPitch={setSelectedPitchRef}
                    onApply={assignPitchToSelection}
                    disabled={selectionCount === 0 || selectedPitchRef === null}
                  />
                )}
                {keyboardMode === 'boundary' && (
                  <div className="grid gap-3 lg:grid-cols-2">
                    <BoundaryTemplateStrip
                      title="白鍵テンプレート"
                      isBlack={false}
                      groups={usedTemplateGroups.white}
                      layout={layout}
                      boundaryPreview={boundaryPreview}
                      onReset={(isBlack, activeDepths) => onUpdateLayout(replaceBoundaryTemplate(layout, isBlack, activeDepths, undefined))}
                    />
                    <BoundaryTemplateStrip
                      title="黒鍵テンプレート"
                      isBlack
                      groups={usedTemplateGroups.black}
                      layout={layout}
                      boundaryPreview={boundaryPreview}
                      onReset={(isBlack, activeDepths) => onUpdateLayout(replaceBoundaryTemplate(layout, isBlack, activeDepths, undefined))}
                    />
                  </div>
                )}
                {keyboardMode === 'select' && (
                  <div className="grid gap-2 sm:grid-cols-4">
                    <ActionButton onClick={() => setSelectedAddresses(new Set())} icon={<XCircle className="h-4 w-4" />} label="選択解除" />
                    <ActionButton onClick={clearSelectionMapping} icon={<Trash2 className="h-4 w-4" />} label="割当解除" />
                    <ActionButton onClick={handleOctaveRepeatFill} icon={<Copy className="h-4 w-4" />} label="周期複製" />
                    <ActionButton onClick={handleAutoMapping} icon={<Wand2 className="h-4 w-4" />} label="自動配置" />
                  </div>
                )}
                {keyboardMode === 'play' && (
                  <div className="rounded-md border border-[#344457] bg-[#101821] px-3 py-2 text-sm text-slate-300">
                    鍵盤クリックで試奏します。
                  </div>
                )}
              </div>
            </section>

            <aside className="space-y-3">
              <Panel title="選択中">
                {selectedDecoded ? (
                  <>
                    <InfoRow label="鍵" value={`${selectedDecoded.isBlack ? '黒鍵' : '白鍵'} ${selectedDecoded.x}`} />
                    <InfoRow label="段" value={`${selectedDecoded.depth + 1} / ${selectedLane?.activeDepths ?? 0}`} />
                    <InfoRow label="番地" value={getAddressLabel(selectedDecoded.address)} />
                    <InfoRow
                      label="音高"
                      value={selectedPitch?.pitchDef ? `${selectedPitch.pitchDef.name} (ID ${selectedPitch.pitchDef.id})` : '未割当'}
                    />
                    {selectedPitch?.pitchDef && (
                      <InfoRow
                        label="周波数"
                        value={formatFrequency(calculateFrequency(selectedPitch.pitchDef, tuning, selectedPitch.octaveShift))}
                      />
                    )}
                  </>
                ) : (
                  <div className="rounded-md border border-dashed border-[#344457] px-3 py-8 text-center text-sm text-slate-500">
                    未選択
                  </div>
                )}
              </Panel>

              <Panel title="段数">
                {selectedDecoded ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {Array.from({length: 9}, (_, value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateLaneDepths(selectedDecoded.x, selectedDecoded.isBlack, value)}
                          className={`rounded-md border px-2 py-2 text-sm font-semibold ${
                            (selectedLane?.activeDepths ?? 0) === value
                              ? 'border-sky-400 bg-sky-600 text-white'
                              : 'border-[#344457] bg-[#101821] text-slate-300 hover:bg-[#162230]'
                          }`}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    <div className="text-xs leading-relaxed text-slate-500">0段にすると、そのレーンの割当は全て解除され、鍵盤上には復帰用の薄いスロットだけ残ります。</div>
                  </>
                ) : (
                  <div className="text-sm text-slate-500">レーンを選択してください。</div>
                )}
              </Panel>

              <Panel title="補助操作">
                <div className="grid gap-2">
                  <ActionButton onClick={clearSelectionMapping} icon={<Trash2 className="h-4 w-4" />} label="選択範囲の割当解除" />
                  <ActionButton
                    onClick={() => selectedAddress !== null && void previewAddress(selectedAddress)}
                    icon={<PlayCircle className="h-4 w-4" />}
                    label="選択音を試聴"
                  />
                </div>
              </Panel>
            </aside>
          </div>
        )}

        {workspaceTab === 'pitches' && (
          <PitchEditor
            tuning={tuning}
            onAddPitch={handleAddPitch}
            onDeletePitch={handleDeletePitch}
            onUpdatePitch={handleUpdatePitch}
          />
        )}

        {workspaceTab === 'samples' && (
          <section className="rounded-lg border border-[#273241] bg-[#0d141d] p-3">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold">
              <Edit3 className="h-4 w-4 text-sky-300" />
              外部音源マッピング
            </div>
            <SampleMappingEditor tuning={tuning} settings={settings} onUpdateSettings={onUpdateSettings} />
          </section>
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
  const source = isBlack ? layout.blackBoundaryTemplates ?? layout.boundaryTemplates : layout.whiteBoundaryTemplates ?? layout.boundaryTemplates;
  const nextTemplates = {...source};
  if (boundaries) {
    nextTemplates[activeDepths] = boundaries;
  } else {
    delete nextTemplates[activeDepths];
  }
  return {...layout, [key]: nextTemplates};
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
  boundaryPreview: BoundaryPreview | null;
  onSegmentClick: (address: number, multi: boolean) => void;
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
  boundaryPreview,
  onSegmentClick,
  onAdjustLaneDepth,
  onBoundaryHandlePointerDown,
}) => {
  const width = displayHorizontalCount * keyWidth;
  const blackWidth = Math.round(keyWidth * settings.blackKeyWidthRatio);

  return (
    <div className={`overflow-x-auto rounded-lg border border-[#273241] bg-[#111820] p-4 ${keyboardMode === 'boundary' ? 'touch-none' : 'touch-pan-x'}`}>
      <div className="relative mx-auto" style={{width, height: KEYBOARD_HEIGHT}}>
        {Array.from({length: displayHorizontalCount}, (_, x) => {
          const lane = layout.lanes[x * 2];
          return (
            <PianoLane
              key={`white_${x}`}
              column={x}
              isBlack={false}
              lane={lane}
              layout={layout}
              tuning={tuning}
              settings={settings}
              selectedAddress={selectedAddress}
              selectedAddresses={selectedAddresses}
              keyboardMode={keyboardMode}
              boundaryPreview={boundaryPreview}
              left={x * keyWidth}
              top={WHITE_TOP}
              width={keyWidth}
              height={WHITE_HEIGHT}
              name={WHITE_NAMES[x % 7]}
              onSegmentClick={onSegmentClick}
              onAdjustLaneDepth={onAdjustLaneDepth}
              onBoundaryHandlePointerDown={onBoundaryHandlePointerDown}
            />
          );
        })}

        {Array.from({length: displayHorizontalCount}, (_, x) => {
          const name = BLACK_NAMES[x % 7];
          const lane = layout.lanes[x * 2 + 1];
          const activeDepths = lane?.activeDepths ?? 0;
          const showLane = Boolean(name) || activeDepths > 0 || settings.showInvalidSections;
          if (!showLane) {
            return null;
          }

          return (
            <PianoLane
              key={`black_${x}`}
              column={x}
              isBlack
              lane={lane}
              layout={layout}
              tuning={tuning}
              settings={settings}
              selectedAddress={selectedAddress}
              selectedAddresses={selectedAddresses}
              keyboardMode={keyboardMode}
              boundaryPreview={boundaryPreview}
              left={x * keyWidth + keyWidth - blackWidth / 2}
              top={BLACK_TOP}
              width={blackWidth}
              height={BLACK_HEIGHT}
              name={name}
              onSegmentClick={onSegmentClick}
              onAdjustLaneDepth={onAdjustLaneDepth}
              onBoundaryHandlePointerDown={onBoundaryHandlePointerDown}
            />
          );
        })}
      </div>
    </div>
  );
};

const PianoLane: React.FC<{
  column: number;
  isBlack: boolean;
  lane: LayoutPreset['lanes'][number] | undefined;
  layout: LayoutPreset;
  tuning: TuningPreset;
  settings: AppSettings;
  selectedAddress: number | null;
  selectedAddresses: Set<number>;
  keyboardMode: KeyboardMode;
  boundaryPreview: BoundaryPreview | null;
  left: number;
  top: number;
  width: number;
  height: number;
  name: string;
  onSegmentClick: (address: number, multi: boolean) => void;
  onAdjustLaneDepth: (column: number, isBlack: boolean, nextDepths: number) => void;
  onBoundaryHandlePointerDown: (state: BoundaryDragState) => void;
}> = ({
  column,
  isBlack,
  lane,
  layout,
  tuning,
  settings,
  selectedAddress,
  selectedAddresses,
  keyboardMode,
  boundaryPreview,
  left,
  top,
  width,
  height,
  name,
  onSegmentClick,
  onAdjustLaneDepth,
  onBoundaryHandlePointerDown,
}) => {
  const activeDepths = Math.max(0, Math.min(8, lane?.activeDepths ?? 0));
  const selectedLane =
    selectedAddress !== null && decodeAddress(selectedAddress).x === column && decodeAddress(selectedAddress).isBlack === isBlack;
  const boundaries = getDisplayBoundaries(layout, lane, isBlack, activeDepths, boundaryPreview);
  const bodyHeight = height - KEY_HEADER_HEIGHT;
  const segments = activeDepths > 0 ? getSegmentHeightsFromBoundaries(boundaries) : [];

  return (
    <div
      className={`absolute overflow-visible ${isBlack ? 'z-20' : 'z-10'}`}
      style={{left, top, width, height}}
    >
      <div
        className={`relative h-full overflow-hidden rounded-b-md border shadow-lg ${
          isBlack
            ? 'border-[#080a0d] bg-gradient-to-b from-[#3b3f46] to-[#080a0d] text-slate-100'
            : 'border-slate-400 bg-gradient-to-b from-white to-slate-200 text-slate-800'
        } ${selectedLane ? 'ring-2 ring-sky-400' : ''}`}
      >
        <div
          className={`flex h-9 items-center justify-between border-b px-2 ${
            isBlack ? 'border-white/10 bg-black/25' : 'border-slate-300 bg-white/70'
          }`}
        >
          <div className="min-w-0">
            <div className="truncate text-xs font-bold">{name || '-'}</div>
            <div className="text-[10px] opacity-60">{activeDepths}段</div>
          </div>
          {(keyboardMode === 'select' || keyboardMode === 'boundary') && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onAdjustLaneDepth(column, isBlack, activeDepths - 1)}
                className="rounded border border-current/20 px-1 text-[10px] hover:bg-current/10"
                aria-label="段数を減らす"
              >
                -
              </button>
              <button
                type="button"
                onClick={() => onAdjustLaneDepth(column, isBlack, activeDepths + 1)}
                className="rounded border border-current/20 px-1 text-[10px] hover:bg-current/10"
                aria-label="段数を増やす"
              >
                +
              </button>
            </div>
          )}
        </div>

        {activeDepths === 0 ? (
          <button
            type="button"
            onClick={() => onAdjustLaneDepth(column, isBlack, 1)}
            className={`flex w-full items-center justify-center border-t border-dashed text-xs ${
              isBlack ? 'border-slate-600 bg-black/25 text-slate-500 hover:text-slate-200' : 'border-slate-300 bg-slate-200/80 text-slate-500 hover:text-slate-800'
            }`}
            style={{height: bodyHeight}}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            復帰
          </button>
        ) : (
          <div className="flex flex-col" style={{height: bodyHeight}}>
            {segments.map((heightRatio, index) => {
              const depth = activeDepths - 1 - index;
              const address = encodeAddress(column, isBlack, depth);
              return (
                <KeySegment
                  key={address}
                  address={address}
                  layout={layout}
                  tuning={tuning}
                  isBlack={isBlack}
                  selected={selectedAddresses.has(address) || selectedAddress === address}
                  showAddress={!!settings.showAddressBinary}
                  pitchLabelMode={settings.pitchLabelMode}
                  height={heightRatio * bodyHeight}
                  onClick={onSegmentClick}
                />
              );
            })}
          </div>
        )}
      </div>

      {keyboardMode === 'boundary' && activeDepths >= 2 && (
        <BoundaryHandles
          boundaries={boundaries}
          top={KEY_HEADER_HEIGHT}
          height={bodyHeight}
          side={isBlack ? 'right' : 'left'}
          isBlack={isBlack}
          onPointerDown={(boundaryIndex, startY, startValue) =>
            onBoundaryHandlePointerDown({
              isBlack,
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
};

function getDisplayBoundaries(
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

const KeySegment: React.FC<{
  address: number;
  layout: LayoutPreset;
  tuning: TuningPreset;
  isBlack: boolean;
  selected: boolean;
  showAddress: boolean;
  pitchLabelMode: AppSettings['pitchLabelMode'];
  height: number;
  onClick: (address: number, multi: boolean) => void;
}> = ({address, layout, tuning, isBlack, selected, showAddress, pitchLabelMode, height, onClick}) => {
  const pitchRef = layout.mapping[address];
  const resolved = resolvePitch(pitchRef, tuning);
  const label = resolved.pitchDef?.name ?? '未割当';

  return (
    <button
      type="button"
      onClick={(event) => onClick(address, event.ctrlKey || event.metaKey || event.shiftKey)}
      className={`min-h-[28px] border-b px-2 py-1 text-left transition-colors ${
        isBlack
          ? selected
            ? 'bg-sky-500/40 text-white'
            : 'border-white/10 text-slate-300 hover:bg-white/10'
          : selected
            ? 'bg-sky-300/70 text-slate-950'
            : 'border-slate-300 text-slate-700 hover:bg-sky-100'
      }`}
      style={{height}}
    >
      <div className="truncate text-[11px] font-semibold">{label}</div>
      {resolved.pitchDef && (
        <div className={`truncate text-[10px] ${isBlack ? 'text-slate-500' : 'text-slate-500'}`}>
          {pitchLabelMode === 'freq'
            ? formatFrequency(calculateFrequency(resolved.pitchDef, tuning, resolved.octaveShift))
            : getPitchLabel(resolved.pitchDef)}
        </div>
      )}
      {showAddress && <div className="truncate font-mono text-[10px] opacity-50">{getAddressLabel(address)}</div>}
    </button>
  );
};

const BoundaryHandles: React.FC<{
  boundaries: number[];
  top: number;
  height: number;
  side: 'left' | 'right';
  isBlack: boolean;
  onPointerDown: (boundaryIndex: number, startY: number, startValue: number) => void;
}> = ({boundaries, top, height, side, isBlack, onPointerDown}) => (
  <>
    {boundaries.slice(1, -1).map((value, index) => {
      const boundaryIndex = index + 1;
      const handleTop = top + value * height;
      return (
        <button
          key={boundaryIndex}
          type="button"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onPointerDown(boundaryIndex, event.clientY, value);
          }}
          className={`absolute z-40 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border bg-[#0a0f16] shadow-md ${
            isBlack ? 'border-sky-300' : 'border-sky-500'
          } ${side === 'left' ? '-left-3' : '-right-3'}`}
          style={{top: handleTop, touchAction: 'none'}}
          aria-label="段境界を調整"
          title="段境界を調整"
        >
          <span
            className={`block h-0 w-0 ${
              side === 'left'
                ? 'border-y-[5px] border-r-[8px] border-y-transparent border-r-sky-400'
                : 'border-y-[5px] border-l-[8px] border-y-transparent border-l-sky-400'
            }`}
          />
        </button>
      );
    })}
  </>
);

const PitchPalette: React.FC<{
  tuning: TuningPreset;
  pitchRows: PitchDefinition[][];
  selectedPitchRef: number | null;
  assignOctaveShift: number;
  onChangeOctaveShift: (value: number) => void;
  onSelectPitch: (pitchRef: number) => void;
  onApply: () => void;
  disabled: boolean;
}> = ({
  tuning,
  pitchRows,
  selectedPitchRef,
  assignOctaveShift,
  onChangeOctaveShift,
  onSelectPitch,
  onApply,
  disabled,
}) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm font-bold">音高パレット</div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">octaveShift</span>
        <BlurCommitNumberInput
          value={assignOctaveShift}
          step={1}
          onCommit={(value) => onChangeOctaveShift(Math.trunc(value))}
          className="w-20 rounded-md border border-[#344457] bg-[#0a0f16] px-2 py-1 text-xs text-slate-100 outline-none focus:border-sky-500"
        />
        <button
          type="button"
          onClick={onApply}
          disabled={disabled}
          className="rounded-md border border-sky-500 bg-sky-600 px-3 py-1.5 text-xs font-bold text-white disabled:cursor-not-allowed disabled:border-[#344457] disabled:bg-[#182230] disabled:text-slate-500"
        >
          選択へ割当
        </button>
      </div>
    </div>
    <div className="space-y-2">
      {pitchRows.map((row, rowIndex) => (
        <div key={rowIndex} className="grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {row.map((pitch) => {
            const pitchRef = encodePitchReference(pitch.id, assignOctaveShift);
            const active = selectedPitchRef === pitchRef;
            return (
              <button
                key={pitch.id}
                type="button"
                onClick={() => onSelectPitch(pitchRef)}
                className={`rounded-md border p-2 text-left ${
                  active
                    ? 'border-sky-400 bg-sky-900/60'
                    : 'border-[#344457] bg-[#101821] hover:border-sky-700 hover:bg-[#162230]'
                }`}
              >
                <div className="truncate text-sm font-bold">{pitch.name}</div>
                <div className="mt-1 text-[11px] text-slate-400">ID {pitch.id}</div>
                <div className="mt-1 truncate text-[10px] text-slate-500">{getPitchLabel(pitch)}</div>
                <div className="mt-1 truncate font-mono text-[10px] text-sky-300">
                  {formatFrequency(calculateFrequency(pitch, tuning, assignOctaveShift))}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  </div>
);

const BoundaryTemplateStrip: React.FC<{
  title: string;
  isBlack: boolean;
  groups: number[];
  layout: LayoutPreset;
  boundaryPreview: BoundaryPreview | null;
  onReset: (isBlack: boolean, activeDepths: number) => void;
}> = ({title, isBlack, groups, layout, boundaryPreview, onReset}) => (
  <div className="rounded-md border border-[#344457] bg-[#101821] p-3">
    <div className="mb-2 flex items-center justify-between">
      <div className="text-sm font-bold">{title}</div>
      <SlidersHorizontal className="h-4 w-4 text-slate-500" />
    </div>
    {groups.length === 0 ? (
      <div className="rounded-md border border-dashed border-[#344457] px-3 py-4 text-center text-xs text-slate-500">
        使用中の段数がありません
      </div>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map((activeDepths) => {
          const boundaries =
            boundaryPreview && boundaryPreview.isBlack === isBlack && boundaryPreview.activeDepths === activeDepths
              ? boundaryPreview.boundaries
              : getTemplateBoundaries(layout, activeDepths, isBlack);
          const segments = getSegmentHeightsFromBoundaries(boundaries);
          return (
            <div key={activeDepths} className="rounded-md border border-[#273241] bg-[#0a0f16] p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold">{activeDepths}段</span>
                <button
                  type="button"
                  onClick={() => onReset(isBlack, activeDepths)}
                  className="inline-flex items-center gap-1 rounded border border-[#344457] px-2 py-1 text-[11px] text-slate-300 hover:bg-[#162230]"
                >
                  <RotateCcw className="h-3 w-3" />
                  既定
                </button>
              </div>
              <div className="flex h-10 overflow-hidden rounded border border-[#273241]">
                {segments.map((ratio, index) => (
                  <div
                    key={index}
                    className={`${isBlack ? 'bg-slate-700' : 'bg-slate-300'} border-r border-[#273241]`}
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

const PitchEditor: React.FC<{
  tuning: TuningPreset;
  onAddPitch: () => void;
  onDeletePitch: (pitchId: number) => void;
  onUpdatePitch: (pitch: PitchDefinition) => void;
}> = ({tuning, onAddPitch, onDeletePitch, onUpdatePitch}) => (
  <section className="rounded-lg border border-[#273241] bg-[#0d141d]">
    <div className="flex items-center justify-between border-b border-[#273241] px-3 py-2">
      <div className="text-sm font-bold">{tuning.name}</div>
      <button
        type="button"
        onClick={onAddPitch}
        className="inline-flex items-center gap-1 rounded-md border border-sky-500 bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-500"
      >
        <Plus className="h-4 w-4" />
        追加
      </button>
    </div>
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#101821] text-xs text-slate-400">
          <tr>
            <th className="px-3 py-2">ID</th>
            <th className="px-3 py-2">名前</th>
            <th className="px-3 py-2">方式</th>
            <th className="px-3 py-2">値</th>
            <th className="px-3 py-2">周波数</th>
            <th className="px-3 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody>
          {tuning.pitches.map((pitch) => (
            <tr key={pitch.id} className="border-t border-[#273241]">
              <td className="px-3 py-2 font-mono text-sky-300">{pitch.id}</td>
              <td className="px-3 py-2">
                <input
                  value={pitch.name}
                  onChange={(event) => onUpdatePitch({...pitch, name: event.target.value})}
                  className="w-40 rounded-md border border-[#344457] bg-[#0a0f16] px-2 py-1 text-sm outline-none focus:border-sky-500"
                />
              </td>
              <td className="px-3 py-2">
                <select
                  value={pitch.type}
                  onChange={(event) => onUpdatePitch({...pitch, type: event.target.value as PitchType})}
                  className="rounded-md border border-[#344457] bg-[#0a0f16] px-2 py-1 text-sm outline-none focus:border-sky-500"
                >
                  <option value="edo">EDO</option>
                  <option value="cents">Cent</option>
                  <option value="ratio">Ratio</option>
                  <option value="frequency">Frequency</option>
                </select>
              </td>
              <td className="px-3 py-2">{renderPitchValueEditor(pitch, onUpdatePitch)}</td>
              <td className="px-3 py-2 font-mono text-slate-300">{formatFrequency(calculateFrequency(pitch, tuning))}</td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onDeletePitch(pitch.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-800 bg-rose-950/60 px-2 py-1 text-xs text-rose-200 hover:bg-rose-900"
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
);

function renderPitchValueEditor(pitch: PitchDefinition, onUpdatePitch: (pitch: PitchDefinition) => void) {
  if (pitch.type === 'edo') {
    return (
      <div className="flex items-center gap-2">
        <BlurCommitNumberInput
          value={pitch.edo ?? 12}
          step={1}
          onCommit={(value) => onUpdatePitch({...pitch, edo: Math.max(1, Math.round(value))})}
          className="w-20 rounded-md border border-[#344457] bg-[#0a0f16] px-2 py-1 text-sm outline-none focus:border-sky-500"
        />
        <BlurCommitNumberInput
          value={pitch.step ?? 0}
          step={1}
          onCommit={(value) => onUpdatePitch({...pitch, step: Math.round(value)})}
          className="w-20 rounded-md border border-[#344457] bg-[#0a0f16] px-2 py-1 text-sm outline-none focus:border-sky-500"
        />
      </div>
    );
  }

  if (pitch.type === 'cents') {
    return (
      <BlurCommitNumberInput
        value={pitch.cents ?? 0}
        step={1}
        onCommit={(value) => onUpdatePitch({...pitch, cents: value})}
        className="w-28 rounded-md border border-[#344457] bg-[#0a0f16] px-2 py-1 text-sm outline-none focus:border-sky-500"
      />
    );
  }

  if (pitch.type === 'ratio') {
    return (
      <div className="flex items-center gap-2">
        <BlurCommitNumberInput
          value={pitch.numerator ?? 1}
          step={1}
          onCommit={(value) => onUpdatePitch({...pitch, numerator: Math.max(1, Math.round(value))})}
          className="w-20 rounded-md border border-[#344457] bg-[#0a0f16] px-2 py-1 text-sm outline-none focus:border-sky-500"
        />
        <span>/</span>
        <BlurCommitNumberInput
          value={pitch.denominator ?? 1}
          step={1}
          onCommit={(value) => onUpdatePitch({...pitch, denominator: Math.max(1, Math.round(value))})}
          className="w-20 rounded-md border border-[#344457] bg-[#0a0f16] px-2 py-1 text-sm outline-none focus:border-sky-500"
        />
      </div>
    );
  }

  return (
    <BlurCommitNumberInput
      value={pitch.frequency ?? 440}
      step={0.01}
      onCommit={(value) => onUpdatePitch({...pitch, frequency: Math.max(0, value)})}
      className="w-28 rounded-md border border-[#344457] bg-[#0a0f16] px-2 py-1 text-sm outline-none focus:border-sky-500"
    />
  );
}

const WorkspaceTabButton: React.FC<{active: boolean; label: string; icon: React.ReactNode; onClick: () => void}> = ({
  active,
  label,
  icon,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold ${
      active ? 'border-sky-400 bg-sky-600 text-white' : 'border-[#344457] bg-[#111b26] text-slate-300 hover:bg-[#162230]'
    }`}
  >
    {icon}
    {label}
  </button>
);

const ModeButton: React.FC<{active: boolean; label: string; onClick: () => void}> = ({active, label, onClick}) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-md border px-3 py-1.5 text-xs font-bold ${
      active ? 'border-sky-400 bg-sky-600 text-white' : 'border-[#344457] bg-[#111b26] text-slate-300 hover:bg-[#162230]'
    }`}
  >
    {label}
  </button>
);

const Metric: React.FC<{label: string; value: string}> = ({label, value}) => (
  <div className="rounded-md border border-[#344457] bg-[#111b26] px-2 py-1 text-xs">
    <span className="text-slate-500">{label}</span>
    <span className="ml-2 font-mono font-bold text-sky-300">{value}</span>
  </div>
);

const Panel: React.FC<{title: string; children: React.ReactNode}> = ({title, children}) => (
  <section className="rounded-lg border border-[#273241] bg-[#0d141d] p-3">
    <div className="mb-3 text-sm font-bold">{title}</div>
    <div className="space-y-2">{children}</div>
  </section>
);

const InfoRow: React.FC<{label: string; value: string}> = ({label, value}) => (
  <div className="flex items-center justify-between gap-3 rounded-md border border-[#273241] bg-[#101821] px-2 py-1.5 text-sm">
    <span className="text-xs text-slate-500">{label}</span>
    <span className="truncate text-right text-slate-200">{value}</span>
  </div>
);

const ActionButton: React.FC<{onClick: () => void; icon: React.ReactNode; label: string}> = ({onClick, icon, label}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center justify-center gap-2 rounded-md border border-[#344457] bg-[#111b26] px-3 py-2 text-xs font-bold text-slate-200 hover:bg-[#162230]"
  >
    {icon}
    {label}
  </button>
);
