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
  return Math.min(MAX_OCTAVE_OFFSET, value);
}

function clampScrollOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value ?? 0);
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
  const saveTimerRef = useRef<number | null>(null);
  const upperColumnRange = useMemo(
    () => getKeyboardColumnRange(currentLayout, currentTuning, settings.upperOctaveOffset ?? 1),
    [currentLayout, currentTuning, settings.upperOctaveOffset],
  );
  const lowerColumnRange = useMemo(
    () => getKeyboardColumnRange(currentLayout, currentTuning, settings.lowerOctaveOffset ?? 0),
    [currentLayout, currentTuning, settings.lowerOctaveOffset],
  );

  useEffect(() => {
    const initData = async () => {
      const layouts = await storageService.getAllLayoutPresets();
      const tunings = await storageService.getAllTuningPresets();
      const rawSettings = await storageService.getSettings();
      const loadedSettings = normalizeSettings(rawSettings);

      setAllLayouts(layouts);
      setAllTunings(tunings);
      setSettings(loadedSettings);

      globalAudioEngine.setSoundSource(loadedSettings.soundSource);
      globalAudioEngine.setMasterVolume(loadedSettings.masterVolume);
      globalAudioEngine.setNoteDecayMs(loadedSettings.noteDecayMs ?? 0);
      globalAudioEngine.setSustain(loadedSettings.sustainLatch);
      setPianoSampleOverrides(loadedSettings.pianoSampleOverrides);
      setSettingsReady(true);

      if (JSON.stringify(loadedSettings) !== JSON.stringify(rawSettings)) {
        void storageService.saveSettings(loadedSettings);
      }
    };

    void initData();

    globalAudioEngine.setOutOfRangeNoticeCallback((notice) => {
      setNotices((prev) => [...prev.slice(-7), notice]);
    });
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
    const nextUpper = Math.min(settings.upperScrollOffset ?? 0, upperColumnRange.maxScrollOffset);
    const nextLower = Math.min(settings.lowerScrollOffset ?? 0, lowerColumnRange.maxScrollOffset);
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
  }, [lowerColumnRange.maxScrollOffset, settings.lowerScrollOffset, settings.upperScrollOffset, upperColumnRange.maxScrollOffset]);

  const handleUpdateSettings = useCallback((newSettings: AppSettings) => {
    const normalized = normalizeSettings(newSettings);
    setSettings(normalized);
    setPianoSampleOverrides(normalized.pianoSampleOverrides);
  }, []);

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
      if (layout.defaultTuningId) {
        const matched = allTunings.find((tuning) => tuning.id === layout.defaultTuningId);
        if (matched) {
          setCurrentTuning(matched);
        }
      }
    },
    [allTunings],
  );

  const handleSelectTuning = useCallback((tuning: TuningPreset) => {
    globalAudioEngine.allNotesOff();
    setCurrentTuning(tuning);
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
        prev.forEach(({voiceId}) => globalAudioEngine.noteOff(voiceId));
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
      if (address === null || pcPressedMap.has(event.key)) {
        return;
      }

      event.preventDefault();
      const pitchRef = currentLayout.mapping[address];
      if (pitchRef === undefined || pitchRef === -1) {
        return;
      }

      const {pitchDef, octaveShift} = resolvePitch(pitchRef, currentTuning);
      if (!pitchDef) {
        return;
      }

      const frequency = calculateFrequency(pitchDef, currentTuning, octaveShift);
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

      const pressed = pcPressedMap.get(event.key);
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
  }, [currentLayout, currentTuning, pcPressedMap, settings.pcDepthOffset]);

  const pressedAddressSet = useMemo(() => {
    const next = new Set<number>();
    pcPressedMap.forEach(({address}) => next.add(address));
    return next;
  }, [pcPressedMap]);
  const upperScrollOffset = Math.min(settings.upperScrollOffset ?? 0, upperColumnRange.maxScrollOffset);
  const lowerScrollOffset = Math.min(settings.lowerScrollOffset ?? 0, lowerColumnRange.maxScrollOffset);

  return (
    <div className="app-shell relative flex flex-col overflow-hidden bg-[#0d1117] font-sans text-slate-100">
      <button
        onClick={handleToggleSustainLatch}
        className={`app-sustain-button fixed z-30 rounded-md border px-2 py-1 text-[11px] font-bold uppercase tracking-wide shadow-xl transition-all backdrop-blur-sm ${
          settings.sustainLatch
            ? 'border-amber-400 bg-amber-400/95 text-slate-950'
            : 'border-[#30363d] bg-[#161b22]/90 text-slate-300 hover:bg-[#21262d]'
        }`}
        title="サステイン固定"
      >
        Sus
      </button>

      <button
        onClick={handleAllNotesOff}
        className="app-allnotes-button fixed z-30 rounded-md border border-[#30363d] bg-[#161b22]/90 px-2 py-1 text-[11px] text-slate-300 shadow-xl transition-all backdrop-blur-sm hover:bg-[#21262d]"
        title="発音リセット"
      >
        <VolumeX size={12} />
      </button>

      <button
        onClick={() => setIsSidebarOpen(true)}
        className="app-menu-button fixed z-30 rounded-lg border border-[#30363d] bg-[#161b22]/90 p-2.5 text-slate-200 shadow-2xl transition-all backdrop-blur-sm hover:bg-[#21262d]"
        title="設定を開く"
      >
        <Menu size={20} />
      </button>

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
                  octaveOffset={settings.upperOctaveOffset ?? 1}
                  onChangeOctaveOffset={(offset) => handleUpdateSettings({...settings, upperOctaveOffset: offset})}
                  scrollOffset={upperScrollOffset}
                  onChangeScrollOffset={(offset) => handleUpdateSettings({...settings, upperScrollOffset: offset})}
                  maxScrollOffset={upperColumnRange.maxScrollOffset}
                  keyWidth={settings.upperKeyWidth ?? settings.keyWidth}
                  onChangeKeyWidth={(width) => handleUpdateSettings({...settings, keyWidth: width, upperKeyWidth: width})}
                />
                <div className="relative min-h-0 flex-1">
                  <InteractiveKeyboard
                    layout={currentLayout}
                    tuning={currentTuning}
                    settings={{...settings, keyWidth: settings.upperKeyWidth ?? settings.keyWidth}}
                    octaveShift={settings.upperOctaveOffset ?? 1}
                    scrollOffsetColumns={upperScrollOffset}
                    onChangeScrollOffsetColumns={(offset) => handleUpdateSettings({...settings, upperScrollOffset: offset})}
                    externalPressedAddresses={pressedAddressSet}
                  />
                </div>
              </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col">
              <OctaveBar
                label={settings.showTwoRows ? '下段' : undefined}
                octaveOffset={settings.lowerOctaveOffset ?? 0}
                onChangeOctaveOffset={(offset) => handleUpdateSettings({...settings, lowerOctaveOffset: offset})}
                scrollOffset={lowerScrollOffset}
                onChangeScrollOffset={(offset) => handleUpdateSettings({...settings, lowerScrollOffset: offset})}
                maxScrollOffset={lowerColumnRange.maxScrollOffset}
                keyWidth={settings.lowerKeyWidth ?? settings.keyWidth}
                onChangeKeyWidth={(width) => handleUpdateSettings({...settings, keyWidth: width, lowerKeyWidth: width})}
              />
              <div className="relative min-h-0 flex-1">
                <InteractiveKeyboard
                  layout={currentLayout}
                  tuning={currentTuning}
                  settings={{...settings, keyWidth: settings.lowerKeyWidth ?? settings.keyWidth}}
                  octaveShift={settings.lowerOctaveOffset ?? 0}
                  scrollOffsetColumns={lowerScrollOffset}
                  onChangeScrollOffsetColumns={(offset) => handleUpdateSettings({...settings, lowerScrollOffset: offset})}
                  externalPressedAddresses={pressedAddressSet}
                />
              </div>
            </div>
          </div>
        )}

        {activeMode === 'editor' && (
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
        )}
      </main>
    </div>
  );
}
