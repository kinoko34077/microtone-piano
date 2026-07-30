import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Menu, VolumeX} from 'lucide-react';
import {LayoutPreset, TuningPreset, AppSettings, OutOfRangeNotice} from './types/keyboard';
import {
  ALL_STANDARD_LAYOUTS,
  ALL_STANDARD_TUNINGS,
  STANDARD_LAYOUT_12EDO,
  STANDARD_TUNING_12EDO,
} from './core/presets';
import {storageService, DEFAULT_APP_SETTINGS} from './core/storage';
import {globalAudioEngine} from './core/audio';
import {calculateFrequency, resolvePitch} from './core/pitch';
import {keyToAddress} from './core/pcKeyboard';
import {getKeyboardColumnRange} from './core/keyboardRange';
import {setPianoSampleOverrides} from './core/pianoSamples';
import {Sidebar} from './components/Sidebar';
import {InteractiveKeyboard} from './components/Keyboard/InteractiveKeyboard';
import {OctaveBar} from './components/Keyboard/OctaveBar';
import {PresetEditor} from './components/Editor/PresetEditor';

type PressedPcKey = {
  voiceId: string;
  address: number;
};

const MAX_OCTAVE_OFFSET = 5;

function clampOctaveOffset(value: number): number {
  return Math.max(-MAX_OCTAVE_OFFSET, Math.min(MAX_OCTAVE_OFFSET, value));
}

function clampScrollOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value ?? 0);
}

function getC4FocusColumn(range: ReturnType<typeof getKeyboardColumnRange>): number {
  return Math.max(0, Math.min(range.totalColumns - 1, (0 - range.startRepeat) * range.period));
}

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    ...settings,
    upperKeyWidth: settings.upperKeyWidth ?? settings.keyWidth ?? DEFAULT_APP_SETTINGS.upperKeyWidth,
    lowerKeyWidth: settings.lowerKeyWidth ?? settings.keyWidth ?? DEFAULT_APP_SETTINGS.lowerKeyWidth,
    upperOctaveOffset: clampOctaveOffset(settings.upperOctaveOffset ?? DEFAULT_APP_SETTINGS.upperOctaveOffset),
    lowerOctaveOffset: clampOctaveOffset(settings.lowerOctaveOffset ?? DEFAULT_APP_SETTINGS.lowerOctaveOffset),
    upperScrollOffset: clampScrollOffset(settings.upperScrollOffset),
    lowerScrollOffset: clampScrollOffset(settings.lowerScrollOffset),
  };
}

export default function App() {
  const [allLayouts, setAllLayouts] = useState<LayoutPreset[]>(ALL_STANDARD_LAYOUTS);
  const [allTunings, setAllTunings] = useState<TuningPreset[]>(ALL_STANDARD_TUNINGS);
  const [currentLayout, setCurrentLayout] = useState<LayoutPreset>(STANDARD_LAYOUT_12EDO);
  const [currentTuning, setCurrentTuning] = useState<TuningPreset>(STANDARD_TUNING_12EDO);
  const [settings, setSettings] = useState<AppSettings>(normalizeSettings(DEFAULT_APP_SETTINGS));
  const [activeMode, setActiveMode] = useState<'keyboard' | 'editor'>('keyboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [editorSelectedAddress, setEditorSelectedAddress] = useState<number | null>(null);
  const [notices, setNotices] = useState<OutOfRangeNotice[]>([]);
  const [pcPressedMap, setPcPressedMap] = useState<Map<string, PressedPcKey>>(new Map());
  const [settingsReady, setSettingsReady] = useState(false);
  const [upperMaxScrollOffset, setUpperMaxScrollOffset] = useState(0);
  const [lowerMaxScrollOffset, setLowerMaxScrollOffset] = useState(0);
  const saveTimerRef = useRef<number | null>(null);
  const currentLayoutRef = useRef<LayoutPreset>(STANDARD_LAYOUT_12EDO);
  const currentTuningRef = useRef<TuningPreset>(STANDARD_TUNING_12EDO);
  const pcPressedMapRef = useRef<Map<string, PressedPcKey>>(new Map());

  const upperColumnRange = useMemo(
    () => getKeyboardColumnRange(currentLayout, currentTuning, 0),
    [currentLayout, currentTuning],
  );
  const lowerColumnRange = useMemo(
    () => getKeyboardColumnRange(currentLayout, currentTuning, 0),
    [currentLayout, currentTuning],
  );

  useEffect(() => {
    const initData = async () => {
      const layouts = await storageService.getAllLayoutPresets();
      const tunings = await storageService.getAllTuningPresets();
      const rawSettings = await storageService.getSettings();
      const loadedSettings = normalizeSettings(rawSettings);
      const initialLayout =
        layouts.find((layout) => layout.id === loadedSettings.defaultLayoutPresetId) ?? STANDARD_LAYOUT_12EDO;
      const initialTuning =
        tunings.find((tuning) => tuning.id === loadedSettings.defaultPitchPresetId) ??
        tunings.find((tuning) => tuning.id === initialLayout.defaultTuningId) ??
        STANDARD_TUNING_12EDO;

      setAllLayouts(layouts);
      setAllTunings(tunings);
      setCurrentLayout(initialLayout);
      setCurrentTuning(initialTuning);
      setSettings(loadedSettings);

      globalAudioEngine.setSoundSource(loadedSettings.soundSource);
      globalAudioEngine.setMasterVolume(loadedSettings.masterVolume);
      globalAudioEngine.setNoteDecayMs(loadedSettings.noteDecayMs ?? 0);
      globalAudioEngine.setSustain(loadedSettings.sustainLatch);
      setPianoSampleOverrides(initialTuning, loadedSettings.pianoSampleOverrides);
      setSettingsReady(true);

      if (JSON.stringify(loadedSettings) !== JSON.stringify(rawSettings)) {
        void storageService.saveSettings(loadedSettings);
      }
    };

    void initData();

    globalAudioEngine.setOutOfRangeNoticeCallback((notice) => {
      setNotices((prev) => [...prev.slice(-7), notice]);
    });

    return () => {
      globalAudioEngine.setOutOfRangeNoticeCallback(() => {});
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) {
      return;
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void storageService.saveSettings(settings);
      saveTimerRef.current = null;
    }, 180);

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [settings, settingsReady]);

  useEffect(() => {
    const nextUpper = Math.min(settings.upperScrollOffset ?? 0, upperMaxScrollOffset);
    const nextLower = Math.min(settings.lowerScrollOffset ?? 0, lowerMaxScrollOffset);
    if (nextUpper === (settings.upperScrollOffset ?? 0) && nextLower === (settings.lowerScrollOffset ?? 0)) {
      return;
    }

    setSettings((prev) =>
      normalizeSettings({
        ...prev,
        upperScrollOffset: nextUpper,
        lowerScrollOffset: nextLower,
      }),
    );
  }, [lowerMaxScrollOffset, settings.lowerScrollOffset, settings.upperScrollOffset, upperMaxScrollOffset]);

  const handleUpdateSettings = useCallback((newSettings: AppSettings) => {
    setSettings(normalizeSettings(newSettings));
  }, []);

  useEffect(() => {
    setPianoSampleOverrides(currentTuning, settings.pianoSampleOverrides);
  }, [currentTuning, settings.pianoSampleOverrides]);

  useEffect(() => {
    currentLayoutRef.current = currentLayout;
  }, [currentLayout]);

  useEffect(() => {
    currentTuningRef.current = currentTuning;
  }, [currentTuning]);

  useEffect(() => {
    pcPressedMapRef.current = pcPressedMap;
  }, [pcPressedMap]);

  const handleToggleSustainLatch = useCallback(() => {
    const next = !settings.sustainLatch;
    handleUpdateSettings({...settings, sustainLatch: next});
    globalAudioEngine.setSustainLatch(next);
  }, [handleUpdateSettings, settings]);

  const handleAllNotesOff = useCallback(() => {
    globalAudioEngine.allNotesOff();
    setPcPressedMap(new Map());
  }, []);

  const handleDuplicateLayout = useCallback(() => {
    const duplicate: LayoutPreset = {
      ...currentLayout,
      id: `layout_custom_${Date.now()}`,
      name: `${currentLayout.name} コピー`,
      isStandard: false,
    };
    setAllLayouts((prev) => [...prev, duplicate]);
    setCurrentLayout(duplicate);
    setSettings((prev) => normalizeSettings({...prev, defaultLayoutPresetId: duplicate.id}));
    void storageService.saveLayoutPreset(duplicate);
  }, [currentLayout]);

  const handleDuplicateTuning = useCallback(() => {
    const duplicate: TuningPreset = {
      ...currentTuning,
      id: `tuning_custom_${Date.now()}`,
      name: `${currentTuning.name} コピー`,
      isStandard: false,
    };
    setAllTunings((prev) => [...prev, duplicate]);
    setCurrentTuning(duplicate);
    setSettings((prev) => normalizeSettings({...prev, defaultPitchPresetId: duplicate.id}));
    void storageService.saveTuningPreset(duplicate);
  }, [currentTuning]);

  const handleSaveLayout = useCallback(() => {
    if (currentLayout.isStandard) {
      handleDuplicateLayout();
      return;
    }
    void storageService.saveLayoutPreset(currentLayout);
  }, [currentLayout, handleDuplicateLayout]);

  const handleSaveTuning = useCallback(() => {
    if (currentTuning.isStandard) {
      handleDuplicateTuning();
      return;
    }
    void storageService.saveTuningPreset(currentTuning);
  }, [currentTuning, handleDuplicateTuning]);

  const handleSelectLayout = useCallback(
    (layout: LayoutPreset) => {
      globalAudioEngine.allNotesOff();
      setCurrentLayout(layout);
      const matched = layout.defaultTuningId
        ? allTunings.find((tuning) => tuning.id === layout.defaultTuningId)
        : undefined;
      if (matched) {
        setCurrentTuning(matched);
      }
      setSettings((prev) =>
        normalizeSettings({
          ...prev,
          defaultLayoutPresetId: layout.id,
          defaultPitchPresetId: matched?.id ?? prev.defaultPitchPresetId,
        }),
      );
    },
    [allTunings],
  );

  const handleSelectTuning = useCallback((tuning: TuningPreset) => {
    globalAudioEngine.allNotesOff();
    setCurrentTuning(tuning);
    setSettings((prev) => normalizeSettings({...prev, defaultPitchPresetId: tuning.id}));
  }, []);

  const handleUpdateLayout = useCallback((newLayout: LayoutPreset) => {
    if (newLayout.isStandard) {
      const duplicate: LayoutPreset = storageService.deepClone({
        ...newLayout,
        id: `layout_custom_${Date.now()}`,
        name: `${newLayout.name} カスタム`,
        isStandard: false,
      });
      setAllLayouts((prev) => [...prev, duplicate]);
      setCurrentLayout(duplicate);
      setSettings((prev) => normalizeSettings({...prev, defaultLayoutPresetId: duplicate.id}));
      void storageService.saveLayoutPreset(duplicate);
      return;
    }

    setCurrentLayout(newLayout);
    setAllLayouts((prev) => prev.map((layout) => (layout.id === newLayout.id ? newLayout : layout)));
    void storageService.saveLayoutPreset(newLayout);
  }, []);

  const handleUpdateTuning = useCallback((newTuning: TuningPreset) => {
    if (newTuning.isStandard) {
      const duplicate: TuningPreset = storageService.deepClone({
        ...newTuning,
        id: `tuning_custom_${Date.now()}`,
        name: `${newTuning.name} カスタム`,
        isStandard: false,
      });
      setAllTunings((prev) => [...prev, duplicate]);
      setCurrentTuning(duplicate);
      setSettings((prev) => normalizeSettings({...prev, defaultPitchPresetId: duplicate.id}));
      void storageService.saveTuningPreset(duplicate);
      return;
    }

    setCurrentTuning(newTuning);
    setAllTunings((prev) => prev.map((tuning) => (tuning.id === newTuning.id ? newTuning : tuning)));
    void storageService.saveTuningPreset(newTuning);
  }, []);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLButtonElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    const releasePcHeldNotes = () => {
      globalAudioEngine.setSustainMomentary(false);
      setPcPressedMap((prev) => {
        pcPressedMapRef.current.forEach(({voiceId}) => globalAudioEngine.noteOff(voiceId));
        return new Map();
      });
    };

    const handleKeyDown = async (event: KeyboardEvent) => {
      if (event.repeat || isEditableTarget(event.target)) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        globalAudioEngine.setSustainMomentary(true);
        return;
      }

      const address = keyToAddress(event.key, settings.pcDepthOffset);
      if (address === null || pcPressedMapRef.current.has(event.key)) {
        return;
      }

      event.preventDefault();
      const activeLayout = currentLayoutRef.current;
      const activeTuning = currentTuningRef.current;
      const pitchRef = activeLayout.mapping[address];
      if (pitchRef === undefined || pitchRef === -1) {
        return;
      }

      const {pitchDef, octaveShift} = resolvePitch(pitchRef, activeTuning);
      if (!pitchDef) {
        return;
      }

      const frequency = calculateFrequency(pitchDef, activeTuning, octaveShift);
      const voiceId = await globalAudioEngine.noteOn(address, pitchRef, frequency, 1.0, `pc_${event.key}`);
      setPcPressedMap((prev) => new Map(prev).set(event.key, {voiceId, address}));
      setEditorSelectedAddress(address);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        globalAudioEngine.setSustainMomentary(false);
        return;
      }

      const pressed = pcPressedMapRef.current.get(event.key);
      if (!pressed) {
        return;
      }

      globalAudioEngine.noteOff(pressed.voiceId);
      setPcPressedMap((prev) => {
        const next = new Map(prev);
        next.delete(event.key);
        return next;
      });
    };

    const handleWindowBlur = () => {
      releasePcHeldNotes();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        releasePcHeldNotes();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [settings.pcDepthOffset]);

  const pressedAddressSet = useMemo(() => {
    const next = new Set<number>();
    pcPressedMap.forEach(({address}) => next.add(address));
    return next;
  }, [pcPressedMap]);

  const upperScrollOffset = Math.min(settings.upperScrollOffset ?? 0, upperMaxScrollOffset);
  const lowerScrollOffset = Math.min(settings.lowerScrollOffset ?? 0, lowerMaxScrollOffset);
  const upperInitialFocusColumn = getC4FocusColumn(upperColumnRange);
  const lowerInitialFocusColumn = getC4FocusColumn(lowerColumnRange);

  const headerActions = (
    <HeaderActions
      sustainLatch={settings.sustainLatch}
      onToggleSustainLatch={handleToggleSustainLatch}
      onAllNotesOff={handleAllNotesOff}
      onOpenMenu={() => setIsSidebarOpen(true)}
    />
  );

  return (
    <div className="app-shell relative flex flex-col overflow-hidden bg-[#0d1117] font-sans text-slate-100">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        currentLayout={currentLayout}
        allLayouts={allLayouts}
        onSelectLayout={handleSelectLayout}
        onDuplicateLayout={handleDuplicateLayout}
        onSaveLayout={handleSaveLayout}
        currentTuning={currentTuning}
        allTunings={allTunings}
        onSelectTuning={handleSelectTuning}
        onDuplicateTuning={handleDuplicateTuning}
        onSaveTuning={handleSaveTuning}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
        onUpdateLayout={handleUpdateLayout}
        activeMode={activeMode}
        onChangeMode={setActiveMode}
        notices={notices}
        onDismissNotice={(id) => setNotices((prev) => prev.filter((notice) => notice.id !== id))}
      />

      <main className={`flex h-full w-full flex-1 flex-col ${activeMode === 'keyboard' ? 'overflow-hidden' : 'overflow-y-auto p-3'}`}>
        {activeMode === 'keyboard' && (
          <div className="flex h-full w-full flex-col">
            {settings.showTwoRows && (
              <div className="flex min-h-0 flex-1 flex-col border-b border-[#30363d]">
                <OctaveBar
                  label="上段"
                  scrollOffset={upperScrollOffset}
                  onChangeScrollOffset={(offset) => handleUpdateSettings({...settings, upperScrollOffset: offset})}
                  maxScrollOffset={upperMaxScrollOffset}
                  octaveSpan={upperColumnRange.period}
                  keyWidth={settings.upperKeyWidth ?? settings.keyWidth}
                  onChangeKeyWidth={(width) => handleUpdateSettings({...settings, keyWidth: width, upperKeyWidth: width})}
                  actions={headerActions}
                />
                <div className="relative min-h-0 flex-1">
                  <InteractiveKeyboard
                    layout={currentLayout}
                    tuning={currentTuning}
                    settings={{...settings, keyWidth: settings.upperKeyWidth ?? settings.keyWidth}}
                    scrollOffsetColumns={upperScrollOffset}
                    onChangeScrollOffsetColumns={(offset) => handleUpdateSettings({...settings, upperScrollOffset: offset})}
                    onMaxScrollOffsetChange={setUpperMaxScrollOffset}
                    externalPressedAddresses={pressedAddressSet}
                    initialFocusColumn={upperInitialFocusColumn}
                  />
                </div>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col">
              <OctaveBar
                label={settings.showTwoRows ? '下段' : undefined}
                scrollOffset={lowerScrollOffset}
                onChangeScrollOffset={(offset) => handleUpdateSettings({...settings, lowerScrollOffset: offset})}
                maxScrollOffset={lowerMaxScrollOffset}
                octaveSpan={lowerColumnRange.period}
                keyWidth={settings.lowerKeyWidth ?? settings.keyWidth}
                onChangeKeyWidth={(width) => handleUpdateSettings({...settings, keyWidth: width, lowerKeyWidth: width})}
                actions={!settings.showTwoRows ? headerActions : undefined}
              />
              <div className="relative min-h-0 flex-1">
                <InteractiveKeyboard
                  layout={currentLayout}
                  tuning={currentTuning}
                  settings={{...settings, keyWidth: settings.lowerKeyWidth ?? settings.keyWidth}}
                  scrollOffsetColumns={lowerScrollOffset}
                  onChangeScrollOffsetColumns={(offset) => handleUpdateSettings({...settings, lowerScrollOffset: offset})}
                  onMaxScrollOffsetChange={setLowerMaxScrollOffset}
                  externalPressedAddresses={pressedAddressSet}
                  initialFocusColumn={lowerInitialFocusColumn}
                />
              </div>
            </div>
          </div>
        )}

        {activeMode === 'editor' && (
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-center justify-between rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2">
              <button
                type="button"
                onClick={() => setActiveMode('keyboard')}
                className="rounded border border-[#30363d] bg-[#0d1117] px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#21262d]"
              >
                演奏へ戻る
              </button>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="rounded border border-[#30363d] bg-[#0d1117] p-1.5 text-slate-200 transition-colors hover:bg-[#21262d]"
                title="メニュー"
                aria-label="メニューを開く"
              >
                <Menu size={14} />
              </button>
            </div>

            <PresetEditor
              layout={currentLayout}
              tuning={currentTuning}
              settings={settings}
              onUpdateLayout={handleUpdateLayout}
              onUpdateTuning={handleUpdateTuning}
              onUpdateSettings={handleUpdateSettings}
              selectedAddress={editorSelectedAddress}
              onSelectAddress={setEditorSelectedAddress}
            />
          </div>
        )}
      </main>
    </div>
  );
}

const HeaderActions: React.FC<{
  sustainLatch: boolean;
  onToggleSustainLatch: () => void;
  onAllNotesOff: () => void;
  onOpenMenu: () => void;
}> = ({sustainLatch, onToggleSustainLatch, onAllNotesOff, onOpenMenu}) => (
  <>
    <button
      type="button"
      onClick={onToggleSustainLatch}
      className={`rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors ${
        sustainLatch
          ? 'border-amber-400 bg-amber-400/95 text-slate-950'
          : 'border-[#30363d] bg-[#161b22] text-slate-300 hover:bg-[#21262d]'
      }`}
      title="サステイン保持"
      aria-label="サステイン保持"
    >
      Sus
    </button>
    <button
      type="button"
      onClick={onAllNotesOff}
      className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1 text-[10px] text-slate-300 transition-colors hover:bg-[#21262d]"
      title="音を止める"
      aria-label="音を止める"
    >
      <VolumeX size={12} />
    </button>
    <button
      type="button"
      onClick={onOpenMenu}
      className="rounded border border-[#30363d] bg-[#161b22] p-1.5 text-slate-200 transition-colors hover:bg-[#21262d]"
      title="メニュー"
      aria-label="メニューを開く"
    >
      <Menu size={14} />
    </button>
  </>
);
