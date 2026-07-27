import React, {useCallback, useEffect, useState} from 'react';
import {
  LayoutPreset,
  TuningPreset,
  AppSettings,
  OutOfRangeNotice,
} from './types/keyboard';
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
import {Sidebar} from './components/Sidebar';
import {InteractiveKeyboard} from './components/Keyboard/InteractiveKeyboard';
import {OctaveBar} from './components/Keyboard/OctaveBar';
import {PresetEditor} from './components/Editor/PresetEditor';
import {NoticeToast} from './components/NoticeToast';
import {Menu} from 'lucide-react';

type PressedPcKey = {
  voiceId: string;
  address: number;
};

export default function App() {
  const [allLayouts, setAllLayouts] = useState<LayoutPreset[]>(ALL_STANDARD_LAYOUTS);
  const [allTunings, setAllTunings] = useState<TuningPreset[]>(ALL_STANDARD_TUNINGS);
  const [currentLayout, setCurrentLayout] = useState<LayoutPreset>(STANDARD_LAYOUT_12EDO);
  const [currentTuning, setCurrentTuning] = useState<TuningPreset>(STANDARD_TUNING_12EDO);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [activeMode, setActiveMode] = useState<'keyboard' | 'editor'>('keyboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<number | null>(null);
  const [notices, setNotices] = useState<OutOfRangeNotice[]>([]);
  const [pcPressedMap, setPcPressedMap] = useState<Map<string, PressedPcKey>>(new Map());

  useEffect(() => {
    const initData = async () => {
      const layouts = await storageService.getAllLayoutPresets();
      const tunings = await storageService.getAllTuningPresets();
      const loadedSettings = await storageService.getSettings();

      setAllLayouts(layouts);
      setAllTunings(tunings);
      setSettings(loadedSettings);

      globalAudioEngine.setSoundSource(loadedSettings.soundSource);
      globalAudioEngine.setMasterVolume(loadedSettings.masterVolume);
      globalAudioEngine.setNoteDecayMs(loadedSettings.noteDecayMs ?? 0);
      globalAudioEngine.setSustain(loadedSettings.sustainLatch);
    };

    void initData();

    globalAudioEngine.setOutOfRangeNoticeCallback((notice) => {
      setNotices((prev) => [...prev.slice(-4), notice]);
    });
  }, []);

  const handleUpdateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    void storageService.saveSettings(newSettings);
  };

  const handleToggleSustainLatch = useCallback(() => {
    const next = !settings.sustainLatch;
    handleUpdateSettings({...settings, sustainLatch: next});
    globalAudioEngine.setSustainLatch(next);
  }, [settings]);

  const handleDuplicateLayout = useCallback(() => {
    const dup: LayoutPreset = {
      ...currentLayout,
      id: `layout_custom_${Date.now()}`,
      name: `${currentLayout.name}（複製）`,
      isStandard: false,
    };
    setAllLayouts((prev) => [...prev, dup]);
    setCurrentLayout(dup);
    void storageService.saveLayoutPreset(dup);
  }, [currentLayout]);

  const handleSaveLayout = useCallback(() => {
    if (currentLayout.isStandard) {
      handleDuplicateLayout();
      return;
    }
    void storageService.saveLayoutPreset(currentLayout);
  }, [currentLayout, handleDuplicateLayout]);

  const handleDuplicateTuning = useCallback(() => {
    const dup: TuningPreset = {
      ...currentTuning,
      id: `tuning_custom_${Date.now()}`,
      name: `${currentTuning.name}（複製）`,
      isStandard: false,
    };
    setAllTunings((prev) => [...prev, dup]);
    setCurrentTuning(dup);
    void storageService.saveTuningPreset(dup);
  }, [currentTuning]);

  const handleSaveTuning = useCallback(() => {
    if (currentTuning.isStandard) {
      handleDuplicateTuning();
      return;
    }
    void storageService.saveTuningPreset(currentTuning);
  }, [currentTuning, handleDuplicateTuning]);

  const handleSelectLayout = (layout: LayoutPreset) => {
    globalAudioEngine.allNotesOff();
    setCurrentLayout(layout);
    if (layout.defaultTuningId) {
      const matched = allTunings.find((t) => t.id === layout.defaultTuningId);
      if (matched) {
        setCurrentTuning(matched);
      }
    }
  };

  const handleSelectTuning = (tuning: TuningPreset) => {
    globalAudioEngine.allNotesOff();
    setCurrentTuning(tuning);
  };

  const handleUpdateLayout = useCallback((newLayout: LayoutPreset) => {
    if (newLayout.isStandard) {
      const dup: LayoutPreset = storageService.deepClone({
        ...newLayout,
        id: `layout_custom_${Date.now()}`,
        name: `${newLayout.name}（カスタム）`,
        isStandard: false,
      });
      setAllLayouts((prev) => [...prev, dup]);
      setCurrentLayout(dup);
      void storageService.saveLayoutPreset(dup);
      return;
    }

    setCurrentLayout(newLayout);
    setAllLayouts((prev) => prev.map((layout) => (layout.id === newLayout.id ? newLayout : layout)));
    void storageService.saveLayoutPreset(newLayout);
  }, []);

  const handleUpdateTuning = useCallback((newTuning: TuningPreset) => {
    if (newTuning.isStandard) {
      const dup: TuningPreset = storageService.deepClone({
        ...newTuning,
        id: `tuning_custom_${Date.now()}`,
        name: `${newTuning.name}（カスタム）`,
        isStandard: false,
      });
      setAllTunings((prev) => [...prev, dup]);
      setCurrentTuning(dup);
      void storageService.saveTuningPreset(dup);
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

    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.repeat || isEditableTarget(e.target)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        globalAudioEngine.setSustainMomentary(true);
        return;
      }

      const addr = keyToAddress(e.key, settings.pcDepthOffset);
      if (addr === null) {
        return;
      }

      e.preventDefault();
      const pitchId = currentLayout.mapping[addr];
      if (pitchId === undefined || pitchId === -1) {
        return;
      }

      const {pitchDef, octaveShift} = resolvePitch(pitchId, currentTuning);
      if (!pitchDef) {
        return;
      }

      const freq = calculateFrequency(pitchDef, currentTuning, octaveShift);
      const voiceId = await globalAudioEngine.noteOn(addr, pitchId, freq, 1.0, `pc_${e.key}`);
      setPcPressedMap((prev) => new Map(prev).set(e.key, {voiceId, address: addr}));
      setSelectedAddress(addr);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        globalAudioEngine.setSustainMomentary(false);
        return;
      }

      const pressed = pcPressedMap.get(e.key);
      if (!pressed) {
        return;
      }

      globalAudioEngine.noteOff(pressed.voiceId);
      setPcPressedMap((prev) => {
        const next = new Map(prev);
        next.delete(e.key);
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
  }, [settings, currentLayout, currentTuning, pcPressedMap]);

  const pressedAddressSet = new Set<number>();
  pcPressedMap.forEach(({address}) => {
    pressedAddressSet.add(address);
  });

  return (
    <div className="app-shell relative flex flex-col overflow-hidden bg-[#0d1117] text-slate-100 font-sans">
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
        onClick={() => setIsSidebarOpen(true)}
        className="app-menu-button fixed z-30 p-2.5 bg-[#161b22]/90 hover:bg-[#21262d] rounded-lg border border-[#30363d] text-slate-200 shadow-2xl transition-all backdrop-blur-sm"
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
      />

      <main className={`flex-1 flex flex-col h-full w-full ${activeMode === 'keyboard' ? 'overflow-hidden' : 'p-3 overflow-y-auto'}`}>
        {activeMode === 'keyboard' && (
          <div className="flex flex-col h-full w-full">
            {settings.showTwoRows && (
              <div className="flex-1 flex flex-col min-h-0 border-b border-[#30363d]">
                <OctaveBar
                  label="上段"
                  octaveOffset={settings.upperOctaveOffset ?? 1}
                  onChangeOctaveOffset={(off) => handleUpdateSettings({...settings, upperOctaveOffset: off})}
                  keyWidth={settings.keyWidth}
                  onChangeKeyWidth={(w) => handleUpdateSettings({...settings, keyWidth: w})}
                />
                <div className="flex-1 relative min-h-0">
                  <InteractiveKeyboard
                    layout={currentLayout}
                    tuning={currentTuning}
                    settings={settings}
                    octaveShift={settings.upperOctaveOffset ?? 1}
                    selectedAddress={selectedAddress}
                    onSelectAddress={setSelectedAddress}
                    externalPressedAddresses={pressedAddressSet}
                  />
                </div>
              </div>
            )}

            <div className="flex-1 flex flex-col min-h-0">
              <OctaveBar
                label={settings.showTwoRows ? '下段' : undefined}
                octaveOffset={settings.lowerOctaveOffset ?? 0}
                onChangeOctaveOffset={(off) => handleUpdateSettings({...settings, lowerOctaveOffset: off})}
                keyWidth={settings.keyWidth}
                onChangeKeyWidth={(w) => handleUpdateSettings({...settings, keyWidth: w})}
              />
              <div className="flex-1 relative min-h-0">
                <InteractiveKeyboard
                  layout={currentLayout}
                  tuning={currentTuning}
                  settings={settings}
                  octaveShift={settings.lowerOctaveOffset ?? 0}
                  selectedAddress={selectedAddress}
                  onSelectAddress={setSelectedAddress}
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
            selectedAddress={selectedAddress}
            onSelectAddress={setSelectedAddress}
          />
        )}
      </main>

      <NoticeToast
        notices={notices}
        onDismiss={(id) => setNotices((prev) => prev.filter((notice) => notice.id !== id))}
      />
    </div>
  );
}
