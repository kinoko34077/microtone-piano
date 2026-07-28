import React, {useRef} from 'react';
import {AlertTriangle, Copy, Download, Edit3, Keyboard, Save, Upload, VolumeX, X} from 'lucide-react';
import {LayoutPreset, TuningPreset, AppSettings, OutOfRangeNotice} from '../types/keyboard';
import {storageService} from '../core/storage';
import {globalAudioEngine} from '../core/audio';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  currentLayout: LayoutPreset;
  allLayouts: LayoutPreset[];
  onSelectLayout: (layout: LayoutPreset) => void;
  onDuplicateLayout: () => void;
  onSaveLayout: () => void;
  currentTuning: TuningPreset;
  allTunings: TuningPreset[];
  onSelectTuning: (tuning: TuningPreset) => void;
  onDuplicateTuning: () => void;
  onSaveTuning: () => void;
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onUpdateLayout: (newLayout: LayoutPreset) => void;
  activeMode: 'keyboard' | 'editor';
  onChangeMode: (mode: 'keyboard' | 'editor') => void;
  notices: OutOfRangeNotice[];
  onDismissNotice: (id: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  currentLayout,
  allLayouts,
  onSelectLayout,
  onDuplicateLayout,
  onSaveLayout,
  currentTuning,
  allTunings,
  onSelectTuning,
  onDuplicateTuning,
  onSaveTuning,
  settings,
  onUpdateSettings,
  onUpdateLayout,
  activeMode,
  onChangeMode,
  notices,
  onDismissNotice,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noteDecayMs = settings.noteDecayMs ?? 0;

  if (!isOpen) {
    return null;
  }

  const handleExportJsonPackage = () => {
    const pkg = {
      type: 'MultiMicrotonalPackage',
      version: '1.0',
      timestamp: new Date().toISOString(),
      layoutPreset: currentLayout,
      tuningPreset: currentTuning,
    };
    storageService.exportAsJson(pkg, `microtonal_${currentLayout.name}_${currentTuning.name}.json`);
  };

  const handleExportBinaryPackage = () => {
    const pkg = {
      type: 'MultiMicrotonalPackage',
      version: '1.0',
      timestamp: new Date().toISOString(),
      layoutPreset: currentLayout,
      tuningPreset: currentTuning,
    };
    storageService.exportAsBinaryPackage(pkg, `microtonal_${currentLayout.name}_${currentTuning.name}.bin`);
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const data = (await storageService.importFromFile(file)) as any;
      if (data?.layoutPreset) {
        onSelectLayout(data.layoutPreset);
        if (data.tuningPreset) {
          onSelectTuning(data.tuningPreset);
        }
      } else if (data?.lanes && data?.mapping) {
        onSelectLayout(data);
      } else if (data?.pitches) {
        onSelectTuning(data);
      } else {
        alert('対応していないファイル形式です。');
      }
    } catch (error: any) {
      alert(`読み込みエラー: ${error.message}`);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed right-0 top-0 z-50 flex h-full w-[320px] flex-col overflow-x-hidden overflow-y-auto border-l border-[#30363d] bg-[#0d1117] text-slate-200 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#30363d] bg-[#0d1117] p-3">
          <div className="flex flex-col">
            <h2 className="flex items-center gap-2 font-bold text-sky-400">
              <span>多段微分音 Web 鍵盤</span>
              <span className="rounded border border-sky-800 bg-sky-950 px-1.5 py-0.5 text-[10px] text-sky-300">v1.2</span>
            </h2>
            <p className="text-[10px] text-slate-400">微分音鍵盤の設定</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-300 transition-colors hover:bg-[#21262d]">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col gap-6 p-4">
          {notices.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-amber-700/70 bg-amber-950/40 p-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                音域外の通知
              </div>
              {notices.map((notice) => (
                <div key={notice.id} className="rounded-lg border border-amber-800/70 bg-[#161b22] p-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-amber-200">{notice.frequency.toFixed(1)} Hz</div>
                      <div className="mt-1 break-words text-[11px] leading-tight text-amber-300/90">{notice.message}</div>
                    </div>
                    <button
                      onClick={() => onDismissNotice(notice.id)}
                      className="shrink-0 rounded p-1 text-amber-400 hover:bg-amber-900/40 hover:text-amber-100"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex rounded-lg border border-[#30363d] bg-[#010409] p-1">
            <button
              onClick={() => {
                onChangeMode('keyboard');
                onClose();
              }}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md py-2 text-xs font-bold ${
                activeMode === 'keyboard' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-[#161b22]'
              }`}
            >
              <Keyboard size={16} />
              鍵盤
            </button>
            <button
              onClick={() => {
                onChangeMode('editor');
                onClose();
              }}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md py-2 text-xs font-bold ${
                activeMode === 'editor' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-[#161b22]'
              }`}
            >
              <Edit3 size={16} />
              編集
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="border-b border-[#30363d] pb-1 text-xs font-bold tracking-wider text-slate-400">音声</h3>

            <button
              onClick={() => globalAudioEngine.allNotesOff()}
              className="flex items-center justify-center gap-2 rounded-lg bg-rose-900/50 px-3 py-2 text-rose-300 hover:bg-rose-900"
              title="全発音停止"
            >
              <VolumeX size={18} />
              <span className="text-xs font-bold">全発音停止</span>
            </button>

            <label className="mt-2 text-xs font-bold text-slate-200">音源</label>
            <select
              value={settings.soundSource}
              onChange={(event) => {
                const source = event.target.value as AppSettings['soundSource'];
                onUpdateSettings({...settings, soundSource: source});
                globalAudioEngine.setSoundSource(source);
              }}
              className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 outline-none focus:border-sky-500"
            >
              <option value="piano">ピアノ</option>
              <option value="sawtooth">ノコギリ波</option>
              <option value="square">矩形波</option>
            </select>

            <div className="mt-2 flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                <span>減衰</span>
                <span className="font-mono text-sky-300">{noteDecayMs === 0 ? 'なし' : `${noteDecayMs} ms`}</span>
              </div>
              <input
                type="range"
                min="0"
                max="5000"
                step="50"
                value={noteDecayMs}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  onUpdateSettings({...settings, noteDecayMs: next});
                  globalAudioEngine.setNoteDecayMs(next);
                }}
                className="h-1.5 w-full cursor-pointer appearance-none rounded bg-[#30363d] accent-sky-500"
              />
              <div className="flex justify-between text-[10px] text-slate-500">
                <span>0</span>
                <span>5000</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="border-b border-[#30363d] pb-1 text-xs font-bold tracking-wider text-slate-400">プリセット</h3>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400">配置</label>
              <div className="flex gap-1">
                <select
                  value={currentLayout.id}
                  onChange={(event) => {
                    const selected = allLayouts.find((layout) => layout.id === event.target.value);
                    if (selected) {
                      onSelectLayout(selected);
                    }
                  }}
                  className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs outline-none focus:border-sky-500"
                >
                  {allLayouts.map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {layout.isStandard ? `[標準] ${layout.name}` : layout.name}
                    </option>
                  ))}
                </select>
                <button onClick={onDuplicateLayout} className="rounded bg-[#21262d] p-1.5 hover:bg-[#30363d]">
                  <Copy size={14} />
                </button>
                {!currentLayout.isStandard && (
                  <button onClick={onSaveLayout} className="rounded bg-sky-600 p-1.5 hover:bg-sky-500">
                    <Save size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-1 flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400">音律</label>
              <div className="flex gap-1">
                <select
                  value={currentTuning.id}
                  onChange={(event) => {
                    const selected = allTunings.find((tuning) => tuning.id === event.target.value);
                    if (selected) {
                      onSelectTuning(selected);
                    }
                  }}
                  className="flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs outline-none focus:border-sky-500"
                >
                  {allTunings.map((tuning) => (
                    <option key={tuning.id} value={tuning.id}>
                      {tuning.isStandard ? `[標準] ${tuning.name}` : tuning.name}
                    </option>
                  ))}
                </select>
                <button onClick={onDuplicateTuning} className="rounded bg-[#21262d] p-1.5 hover:bg-[#30363d]">
                  <Copy size={14} />
                </button>
                {!currentTuning.isStandard && (
                  <button onClick={onSaveTuning} className="rounded bg-sky-600 p-1.5 hover:bg-sky-500">
                    <Save size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-2 flex gap-2">
              <button
                onClick={handleExportJsonPackage}
                className="flex flex-1 items-center justify-center gap-1 rounded bg-[#21262d] p-1 text-[10px] hover:bg-[#30363d]"
              >
                <Download size={12} />
                JSON出力
              </button>
              <button
                onClick={handleExportBinaryPackage}
                className="flex flex-1 items-center justify-center gap-1 rounded bg-[#21262d] p-1 text-[10px] text-amber-400 hover:bg-[#30363d]"
              >
                <Download size={12} />
                BIN出力
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1 rounded bg-[#21262d] p-1 text-[10px] text-sky-400 hover:bg-[#30363d]"
              >
                <Upload size={12} />
                読込
              </button>
              <input ref={fileInputRef} type="file" accept=".json,.bin" onChange={handleFileImport} className="hidden" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="border-b border-[#30363d] pb-1 text-xs font-bold tracking-wider text-slate-400">鍵盤表示</h3>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-200">音名表示</label>
              <select
                value={settings.pitchLabelMode}
                onChange={(event) => onUpdateSettings({...settings, pitchLabelMode: event.target.value as any})}
                className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs outline-none"
              >
                <option value="note">音名</option>
                <option value="doremi">ドレミ</option>
                <option value="step">ステップ</option>
                <option value="freq">周波数</option>
                <option value="none">なし</option>
              </select>
            </div>

            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-200">
              <input
                type="checkbox"
                checked={settings.showTwoRows}
                onChange={(event) => onUpdateSettings({...settings, showTwoRows: event.target.checked})}
                className="h-4 w-4 rounded border-[#30363d] bg-[#161b22] text-sky-600 focus:ring-sky-500"
              />
              2段表示
            </label>

            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-200">
              <input
                type="checkbox"
                checked={!!settings.showAddressBinary}
                onChange={(event) => onUpdateSettings({...settings, showAddressBinary: event.target.checked})}
                className="h-4 w-4 rounded border-[#30363d] bg-[#161b22] text-sky-600 focus:ring-sky-500"
              />
              番地を16進で表示
            </label>

            <RangeBlock
              label="黒鍵幅"
              valueLabel={`${Math.round(settings.blackKeyWidthRatio * 100)}%`}
            >
              <input
                type="range"
                min="0.3"
                max="1.0"
                step="0.05"
                value={settings.blackKeyWidthRatio}
                onChange={(event) => onUpdateSettings({...settings, blackKeyWidthRatio: Number(event.target.value)})}
                className="w-full"
              />
            </RangeBlock>

            <RangeBlock
              label="黒鍵高さ"
              valueLabel={`${Math.round(settings.blackKeyHeightRatio * 100)}%`}
            >
              <input
                type="range"
                min="0.3"
                max="0.9"
                step="0.05"
                value={settings.blackKeyHeightRatio}
                onChange={(event) => onUpdateSettings({...settings, blackKeyHeightRatio: Number(event.target.value)})}
                className="w-full"
              />
            </RangeBlock>

            <RangeBlock label="鍵盤幅" valueLabel={`${settings.keyWidth}px`}>
              <input
                type="range"
                min="30"
                max="120"
                step="1"
                value={settings.keyWidth}
                onChange={(event) => onUpdateSettings({...settings, keyWidth: Number(event.target.value)})}
                className="w-full"
              />
            </RangeBlock>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="border-b border-[#30363d] pb-1 text-xs font-bold tracking-wider text-slate-400">無効区画</h3>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-200">
              <input
                type="checkbox"
                checked={settings.showInvalidSections}
                onChange={(event) => onUpdateSettings({...settings, showInvalidSections: event.target.checked})}
                className="h-4 w-4 rounded border-[#30363d] bg-[#161b22]"
              />
              無効区画を表示
            </label>
            <label className="mt-1 text-xs font-bold text-slate-200">無効区画モード</label>
            <select
              value={currentLayout.invalidSectionMode}
              onChange={(event) => onUpdateLayout({...currentLayout, invalidSectionMode: event.target.value as any})}
              className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-xs outline-none"
            >
              <option value="fixed">固定</option>
              <option value="compressed">圧縮</option>
              <option value="custom">カスタム</option>
            </select>
          </div>

          <div className="flex flex-col gap-2 pb-10">
            <h3 className="border-b border-[#30363d] pb-1 text-xs font-bold tracking-wider text-slate-400">PCキーボード</h3>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span>depth オフセット</span>
                <span>{settings.pcDepthOffset}</span>
              </div>
              <input
                type="range"
                min="0"
                max="4"
                value={settings.pcDepthOffset}
                onChange={(event) => onUpdateSettings({...settings, pcDepthOffset: Number(event.target.value)})}
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

const RangeBlock: React.FC<{
  label: string;
  valueLabel: string;
  children: React.ReactNode;
}> = ({label, valueLabel, children}) => (
  <div className="flex flex-col gap-1">
    <div className="flex justify-between text-xs">
      <span>{label}</span>
      <span>{valueLabel}</span>
    </div>
    {children}
  </div>
);
