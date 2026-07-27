/**
 * 多段微分音Web鍵盤App - メインアプリケーション
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  LayoutPreset,
  TuningPreset,
  AppSettings,
  ActiveVoice,
  OutOfRangeNotice,
} from './types/keyboard';
import {
  ALL_STANDARD_LAYOUTS,
  ALL_STANDARD_TUNINGS,
  STANDARD_LAYOUT_12EDO,
  STANDARD_TUNING_12EDO,
} from './core/presets';
import { storageService, DEFAULT_APP_SETTINGS } from './core/storage';
import { globalAudioEngine } from './core/audio';
import { calculateFrequency, getPitchLabel, formatFrequency, resolvePitch } from './core/pitch';
import { keyToAddress } from './core/pcKeyboard';
import { Sidebar } from './components/Sidebar';
import { InteractiveKeyboard } from './components/Keyboard/InteractiveKeyboard';
import { OctaveBar } from './components/Keyboard/OctaveBar';
import { PresetEditor } from './components/Editor/PresetEditor';
import { NoticeToast } from './components/NoticeToast';
import { decodeAddress } from './core/address';
import { Menu } from 'lucide-react';

export default function App() {
  const [allLayouts, setAllLayouts] = useState<LayoutPreset[]>(ALL_STANDARD_LAYOUTS);
  const [allTunings, setAllTunings] = useState<TuningPreset[]>(ALL_STANDARD_TUNINGS);

  const [currentLayout, setCurrentLayout] = useState<LayoutPreset>(STANDARD_LAYOUT_12EDO);
  const [currentTuning, setCurrentTuning] = useState<TuningPreset>(STANDARD_TUNING_12EDO);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);

  const [activeMode, setActiveMode] = useState<'keyboard' | 'editor'>('keyboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<number | null>(null);

  const [activeVoices, setActiveVoices] = useState<ActiveVoice[]>([]);
  const [notices, setNotices] = useState<OutOfRangeNotice[]>([]);

  // PCキーボード押下中キー追跡 (key -> voiceId)
  const [pcPressedMap, setPcPressedMap] = useState<Map<string, string>>(new Map());

  // 初期化ロード
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
      globalAudioEngine.setSustain(loadedSettings.sustainLatch);
    };

    initData();

    // 音声エンジンの範囲外通知リスナー登録
    globalAudioEngine.setOutOfRangeNoticeCallback((notice) => {
      setNotices((prev) => [...prev.slice(-4), notice]); // 最大5件
    });

    // アクティブボイスの周期更新 (UI描画用)
    const interval = setInterval(() => {
      setActiveVoices(globalAudioEngine.getActiveVoices());
    }, 50);

    return () => clearInterval(interval);
  }, []);

  // 設定保存
  const handleUpdateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    storageService.saveSettings(newSettings);
  };

  // 配置プリセット複製 (標準プリセット編集保護用)
  const handleDuplicateLayout = useCallback(() => {
    const dup: LayoutPreset = {
      ...currentLayout,
      id: `layout_custom_${Date.now()}`,
      name: `${currentLayout.name} (複製)`,
      isStandard: false,
    };
    setAllLayouts((prev) => [...prev, dup]);
    setCurrentLayout(dup);
    storageService.saveLayoutPreset(dup);
  }, [currentLayout]);

  // 配置プリセット保存
  const handleSaveLayout = useCallback(() => {
    if (currentLayout.isStandard) {
      handleDuplicateLayout();
    } else {
      storageService.saveLayoutPreset(currentLayout);
      alert(`配置プリセット「${currentLayout.name}」を保存しました。`);
    }
  }, [currentLayout, handleDuplicateLayout]);

  // 音高プリセット複製
  const handleDuplicateTuning = useCallback(() => {
    const dup: TuningPreset = {
      ...currentTuning,
      id: `tuning_custom_${Date.now()}`,
      name: `${currentTuning.name} (複製)`,
      isStandard: false,
    };
    setAllTunings((prev) => [...prev, dup]);
    setCurrentTuning(dup);
    storageService.saveTuningPreset(dup);
  }, [currentTuning]);

  // 音高プリセット保存
  const handleSaveTuning = useCallback(() => {
    if (currentTuning.isStandard) {
      handleDuplicateTuning();
    } else {
      storageService.saveTuningPreset(currentTuning);
      alert(`音高プリセット「${currentTuning.name}」を保存しました。`);
    }
  }, [currentTuning, handleDuplicateTuning]);

  // 配置プリセット選択
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

  // 音高プリセット選択
  const handleSelectTuning = (tuning: TuningPreset) => {
    globalAudioEngine.allNotesOff();
    setCurrentTuning(tuning);
  };

  // 配置プリセット更新 (カスタム作成または既存更新)
  const handleUpdateLayout = useCallback((newLayout: LayoutPreset) => {
    if (newLayout.isStandard) {
      const dup: LayoutPreset = storageService.deepClone({
        ...newLayout,
        id: `layout_custom_${Date.now()}`,
        name: `${newLayout.name} (カスタム)`,
        isStandard: false,
      });
      setAllLayouts((prev) => [...prev, dup]);
      setCurrentLayout(dup);
      storageService.saveLayoutPreset(dup);
    } else {
      setCurrentLayout(newLayout);
      setAllLayouts((prev) => prev.map((l) => (l.id === newLayout.id ? newLayout : l)));
      storageService.saveLayoutPreset(newLayout);
    }
  }, []);

  // 音高プリセット更新 (カスタム作成または既存更新)
  const handleUpdateTuning = useCallback((newTuning: TuningPreset) => {
    if (newTuning.isStandard) {
      const dup: TuningPreset = storageService.deepClone({
        ...newTuning,
        id: `tuning_custom_${Date.now()}`,
        name: `${newTuning.name} (カスタム)`,
        isStandard: false,
      });
      setAllTunings((prev) => [...prev, dup]);
      setCurrentTuning(dup);
      storageService.saveTuningPreset(dup);
    } else {
      setCurrentTuning(newTuning);
      setAllTunings((prev) => prev.map((t) => (t.id === newTuning.id ? newTuning : t)));
      storageService.saveTuningPreset(newTuning);
    }
  }, []);

  // PCキーボード イベントリッスン
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      // Spaceキー: サステイン モーメンタリ
      if (e.code === 'Space') {
        e.preventDefault();
        globalAudioEngine.setSustainMomentary(true);
        return;
      }

      const addr = keyToAddress(e.key, settings.pcDepthOffset);
      if (addr !== null) {
        e.preventDefault();
        const pitchId = currentLayout.mapping[addr];
        if (pitchId !== undefined && pitchId !== -1) {
          // PCキーボードは基準オクターブ(下段相当)で発音
          const { pitchDef, octaveShift } = resolvePitch(pitchId, currentTuning);
          if (pitchDef) {
            const freq = calculateFrequency(pitchDef, currentTuning, octaveShift);
            const voiceId = await globalAudioEngine.noteOn(
              addr,
              pitchId,
              freq,
              1.0,
              `pc_${e.key}`
            );
            setPcPressedMap((prev) => new Map(prev).set(e.key, voiceId));
            setSelectedAddress(addr);
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        globalAudioEngine.setSustainMomentary(false);
        return;
      }

      const voiceId = pcPressedMap.get(e.key);
      if (voiceId) {
        globalAudioEngine.noteOff(voiceId);
        setPcPressedMap((prev) => {
          const next = new Map(prev);
          next.delete(e.key);
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [settings, currentLayout, currentTuning, pcPressedMap]);

  return (
    <div className="app-shell relative flex flex-col overflow-hidden bg-[#0d1117] text-slate-100 font-sans">
      {/* フローティング・ハンバーガーメニューボタン */}
      <button
        onClick={() => setIsSidebarOpen(true)}
        className="app-menu-button fixed z-30 p-2.5 bg-[#161b22]/90 hover:bg-[#21262d] rounded-lg border border-[#30363d] text-slate-200 shadow-2xl transition-all backdrop-blur-sm"
        title="設定・メニューを開く"
      >
        <Menu size={20} />
      </button>

      {/* サイドバー */}
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

      {/* メイン画面表示 */}
      <main className={`flex-1 flex flex-col h-full w-full ${activeMode === 'keyboard' ? 'overflow-hidden' : 'p-3 overflow-y-auto'}`}>
        {activeMode === 'keyboard' && (
          <div className="flex flex-col h-full w-full">
            {/* 上段鍵盤 (2段表示がオンの場合) */}
            {settings.showTwoRows && (
              <div className="flex-1 flex flex-col min-h-0 border-b border-[#30363d]">
                <OctaveBar
                  label="上段"
                  octaveOffset={settings.upperOctaveOffset ?? 1}
                  onChangeOctaveOffset={(off) => handleUpdateSettings({ ...settings, upperOctaveOffset: off })}
                  keyWidth={settings.keyWidth}
                  onChangeKeyWidth={(w) => handleUpdateSettings({ ...settings, keyWidth: w })}
                />
                <div className="flex-1 relative min-h-0">
                  <InteractiveKeyboard
                    layout={currentLayout}
                    tuning={currentTuning}
                    settings={settings}
                    octaveShift={settings.upperOctaveOffset ?? 1}
                    selectedAddress={selectedAddress}
                    onSelectAddress={setSelectedAddress}
                    activeVoices={activeVoices}
                  />
                </div>
              </div>
            )}

            {/* 下段/メイン鍵盤 */}
            <div className="flex-1 flex flex-col min-h-0">
              <OctaveBar
                label={settings.showTwoRows ? "下段" : undefined}
                octaveOffset={settings.lowerOctaveOffset ?? 0}
                onChangeOctaveOffset={(off) => handleUpdateSettings({ ...settings, lowerOctaveOffset: off })}
                keyWidth={settings.keyWidth}
                onChangeKeyWidth={(w) => handleUpdateSettings({ ...settings, keyWidth: w })}
              />
              <div className="flex-1 relative min-h-0">
                <InteractiveKeyboard
                  layout={currentLayout}
                  tuning={currentTuning}
                  settings={settings}
                  octaveShift={settings.lowerOctaveOffset ?? 0}
                  selectedAddress={selectedAddress}
                  onSelectAddress={setSelectedAddress}
                  activeVoices={activeVoices}
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

      {/* 範囲外音高非遮断トースト通知 */}
      <NoticeToast
        notices={notices}
        onDismiss={(id) => setNotices((prev) => prev.filter((n) => n.id !== id))}
      />
    </div>
  );
}
