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
import {globalAudioEngine, PianoSampleStatus} from './core/audio';
import {calculateFrequency, resolvePitch} from './core/pitch';
import {keyToAddress} from './core/pcKeyboard';
import {PcKeyPressRegistry} from './core/pcKeyPressRegistry';
import {DebouncedSettingsSaver} from './core/debouncedSettingsSaver';
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
  return Math.max(0, Math.min(range.totalColumns - 1, -range.startColumn));
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
  const [pianoSampleStatus, setPianoSampleStatus] = useState<PianoSampleStatus | null>(null);
  const [pcPressedMap, setPcPressedMap] = useState<Map<string, PressedPcKey>>(new Map());
  const [settingsReady, setSettingsReady] = useState(false);
  const [upperMaxScrollOffset, setUpperMaxScrollOffset] = useState(0);
  const [lowerMaxScrollOffset, setLowerMaxScrollOffset] = useState(0);
  const currentLayoutRef = useRef<LayoutPreset>(STANDARD_LAYOUT_12EDO);
  const currentTuningRef = useRef<TuningPreset>(STANDARD_TUNING_12EDO);
  const pcKeyRegistryRef = useRef<PcKeyPressRegistry | null>(null);
  const settingsSaverRef = useRef<DebouncedSettingsSaver<AppSettings> | null>(null);
  const pcKeyRegistry =
    pcKeyRegistryRef.current ??
    (pcKeyRegistryRef.current = new PcKeyPressRegistry((voiceId) => globalAudioEngine.noteOff(voiceId)));
  const settingsSaver =
    settingsSaverRef.current ??
    (settingsSaverRef.current = new DebouncedSettingsSaver<AppSettings>(
      (value) => storageService.saveSettings(value),
      (callback, delayMs) => window.setTimeout(callback, delayMs),
      (timerId) => window.clearTimeout(timerId),
      180,
    ));

  const upperColumnRange = useMemo(
    () => getKeyboardColumnRange(currentLayout, currentTuning, 0),
    [currentLayout, currentTuning],
  );
  const lowerColumnRange = useMemo(
    () => getKeyboardColumnRange(currentLayout, currentTuning, 0),
    [currentLayout, currentTuning],
  );
  const keyboardVisualSettings = useMemo(
    () => ({
      ...settings,
      keyWidth: settings.keyWidth,
    }),
    [
      settings.blackKeyHeightRatio,
      settings.blackKeyWidthRatio,
      settings.keyWidth,
      settings.pitchLabelMode,
      settings.showAddressBinary,
      settings.showInvalidSections,
    ],
  );
  const upperKeyboardSettings = useMemo(
    () => ({...keyboardVisualSettings, keyWidth: settings.upperKeyWidth ?? settings.keyWidth}),
    [keyboardVisualSettings, settings.keyWidth, settings.upperKeyWidth],
  );
  const lowerKeyboardSettings = useMemo(
    () => ({...keyboardVisualSettings, keyWidth: settings.lowerKeyWidth ?? settings.keyWidth}),
    [keyboardVisualSettings, settings.keyWidth, settings.lowerKeyWidth],
  );

  useEffect(() => {
    const initData = async () => {
      const layouts = await storageService.getAllLayoutPresets();
      const tunings = await storageService.getAllTuningPresets();
      const settingsResult = await storageService.loadSettings();
      if (settingsResult.status === 'read_failed') {
        return;
      }

      const rawSettings = settingsResult.settings;
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

      if (
        settingsResult.status === 'present' &&
        JSON.stringify(loadedSettings) !== JSON.stringify(rawSettings)
      ) {
        void storageService.saveSettings(loadedSettings);
      }
    };

    void initData();

    globalAudioEngine.setOutOfRangeNoticeCallback((notice) => {
      setNotices((prev) => [...prev.slice(-7), notice]);
    });
    globalAudioEngine.setPianoSampleStatusCallback((status) => {
      setPianoSampleStatus(status);
    });

    return () => {
      globalAudioEngine.setOutOfRangeNoticeCallback(() => {});
      globalAudioEngine.setPianoSampleStatusCallback(() => {});
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) {
      return;
    }

    settingsSaver.schedule(settings);
  }, [settings, settingsReady, settingsSaver]);

  useEffect(() => {
    const flushPendingSettings = () => {
      settingsSaver.flush();
    };

    window.addEventListener('pagehide', flushPendingSettings);
    return () => {
      window.removeEventListener('pagehide', flushPendingSettings);
      settingsSaver.flush();
    };
  }, [settingsSaver]);

  useEffect(() => {
    const nextUpper = Math.min(settings.upperScrollOffset ?? 0, upperMaxScrollOffset);
    const nextLower = Math.min(settings.lowerScrollOffset ?? 0, lowerMaxScrollOffset);
    if (nextUpper === (settings.upperScrollOffset ?? 0) && nextLower === (settings.lowerScrollOffset ?? 0)) {
      return;