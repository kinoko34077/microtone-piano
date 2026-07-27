import React, {useRef} from 'react';
import {LayoutPreset, TuningPreset, AppSettings} from '../types/keyboard';
import {Download, Upload, Copy, Save, VolumeX, Keyboard, Edit3, X} from 'lucide-react';
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
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const noteDecayMs = settings.noteDecayMs ?? 0;

  if (!isOpen) return null;

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

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
        alert('未対応のファイル形式です。');
      }
    } catch (err: any) {
      alert(`読み込みエラー: ${err.message}`);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-[320px] bg-[#0d1117] border-l border-[#30363d] shadow-2xl z-50 flex flex-col overflow-y-auto overflow-x-hidden text-slate-200">
        <div className="sticky top-0 bg-[#0d1117] border-b border-[#30363d] p-3 flex justify-between items-center z-10">
          <div className="flex flex-col">
            <h2 className="font-bold text-sky-400 flex items-center gap-2">
              <span>多段微分音Web鍵盤</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-sky-950 text-sky-300 border border-sky-800 rounded">v1.2</span>
            </h2>
            <p className="text-[10px] text-slate-400">微分音鍵盤の設定</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#21262d] rounded-md transition-colors text-slate-300">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-6">
          <div className="flex bg-[#010409] p-1 rounded-lg border border-[#30363d]">
            <button
              onClick={() => {
                onChangeMode('keyboard');
                onClose();
              }}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-md text-xs font-bold ${activeMode === 'keyboard' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-[#161b22]'}`}
            >
              <Keyboard size={16} /> 鍵盤
            </button>
            <button
              onClick={() => {
                onChangeMode('editor');
                onClose();
              }}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-md text-xs font-bold ${activeMode === 'editor' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-[#161b22]'}`}
            >
              <Edit3 size={16} /> 編集
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold text-slate-400 tracking-wider border-b border-[#30363d] pb-1">音声</h3>

            <button
              onClick={() => globalAudioEngine.allNotesOff()}
              className="px-3 py-2 bg-rose-900/50 hover:bg-rose-900 text-rose-300 rounded-lg flex items-center justify-center gap-2"
              title="全音停止"
            >
              <VolumeX size={18} />
              <span className="text-xs font-bold">全音停止</span>
            </button>

            <label className="text-xs font-bold text-slate-200 mt-2">音源</label>
            <select
              value={settings.soundSource}
              onChange={(e) => {
                const src = e.target.value as AppSettings['soundSource'];
                onUpdateSettings({...settings, soundSource: src});
                globalAudioEngine.setSoundSource(src);
              }}
              className="px-3 py-2 bg-[#161b22] border border-[#30363d] focus:border-sky-500 rounded outline-none"
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
                onChange={(e) => {
                  const next = Number(e.target.value);
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
            <h3 className="text-xs font-bold text-slate-400 tracking-wider border-b border-[#30363d] pb-1">プリセット</h3>

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400">配置</label>
              <div className="flex gap-1">
                <select
                  value={currentLayout.id}
                  onChange={(e) => {
                    const sel = allLayouts.find((layout) => layout.id === e.target.value);
                    if (sel) onSelectLayout(sel);
                  }}
                  className="flex-1 bg-[#161b22] text-xs px-2 py-1.5 rounded border border-[#30363d] outline-none focus:border-sky-500"
                >
                  {allLayouts.map((layout) => (
                    <option key={layout.id} value={layout.id}>
                      {layout.isStandard ? `[標準] ${layout.name}` : layout.name}
                    </option>
                  ))}
                </select>
                <button onClick={onDuplicateLayout} className="p-1.5 bg-[#21262d] hover:bg-[#30363d] rounded">
                  <Copy size={14} />
                </button>
                {!currentLayout.isStandard && (
                  <button onClick={onSaveLayout} className="p-1.5 bg-sky-600 hover:bg-sky-500 rounded">
                    <Save size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1 mt-1">
              <label className="text-[10px] font-bold text-slate-400">音律</label>
              <div className="flex gap-1">
                <select
                  value={currentTuning.id}
                  onChange={(e) => {
                    const sel = allTunings.find((tuning) => tuning.id === e.target.value);
                    if (sel) onSelectTuning(sel);
                  }}
                  className="flex-1 bg-[#161b22] text-xs px-2 py-1.5 rounded border border-[#30363d] outline-none focus:border-sky-500"
                >
                  {allTunings.map((tuning) => (
                    <option key={tuning.id} value={tuning.id}>
                      {tuning.isStandard ? `[標準] ${tuning.name}` : tuning.name}
                    </option>
                  ))}
                </select>
                <button onClick={onDuplicateTuning} className="p-1.5 bg-[#21262d] hover:bg-[#30363d] rounded">
                  <Copy size={14} />
                </button>
                {!currentTuning.isStandard && (
                  <button onClick={onSaveTuning} className="p-1.5 bg-sky-600 hover:bg-sky-500 rounded">
                    <Save size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-2 mt-2">
              <button onClick={handleExportJsonPackage} className="flex-1 p-1 bg-[#21262d] hover:bg-[#30363d] rounded text-[10px] flex items-center justify-center gap-1">
                <Download size={12} /> JSON出力
              </button>
              <button onClick={handleExportBinaryPackage} className="flex-1 p-1 bg-[#21262d] hover:bg-[#30363d] rounded text-[10px] flex items-center justify-center gap-1 text-amber-400">
                <Download size={12} /> BIN出力
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 p-1 bg-[#21262d] hover:bg-[#30363d] rounded text-[10px] flex items-center justify-center gap-1 text-sky-400">
                <Upload size={12} /> 読込
              </button>
              <input ref={fileInputRef} type="file" accept=".json,.bin" onChange={handleFileImport} className="hidden" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-400 tracking-wider border-b border-[#30363d] pb-1">鍵盤表示</h3>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-200">音名表示</label>
              <select
                value={settings.pitchLabelMode}
                onChange={(e) => onUpdateSettings({...settings, pitchLabelMode: e.target.value as any})}
                className="bg-[#161b22] text-xs px-2 py-1.5 rounded border border-[#30363d] outline-none"
              >
                <option value="note">音名</option>
                <option value="doremi">ドレミ</option>
                <option value="step">ステップ</option>
                <option value="freq">周波数</option>
                <option value="none">なし</option>
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-200 mt-2">
              <input
                type="checkbox"
                checked={settings.showTwoRows}
                onChange={(e) => onUpdateSettings({...settings, showTwoRows: e.target.checked})}
                className="w-4 h-4 rounded bg-[#161b22] border-[#30363d] text-sky-600 focus:ring-sky-500"
              />
              上下2段表示
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-200">
              <input
                type="checkbox"
                checked={!!settings.showAddressBinary}
                onChange={(e) => onUpdateSettings({...settings, showAddressBinary: e.target.checked})}
                className="w-4 h-4 rounded bg-[#161b22] border-[#30363d] text-sky-600 focus:ring-sky-500"
              />
              番地を2進/16進で表示
            </label>

            <div className="flex flex-col gap-1 mt-2">
              <div className="flex justify-between text-xs">
                <span>黒鍵幅</span>
                <span>{Math.round(settings.blackKeyWidthRatio * 100)}%</span>
              </div>
              <input type="range" min="0.3" max="1.0" step="0.05" value={settings.blackKeyWidthRatio} onChange={(e) => onUpdateSettings({...settings, blackKeyWidthRatio: Number(e.target.value)})} className="w-full" />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span>黒鍵高さ</span>
                <span>{Math.round(settings.blackKeyHeightRatio * 100)}%</span>
              </div>
              <input type="range" min="0.3" max="0.9" step="0.05" value={settings.blackKeyHeightRatio} onChange={(e) => onUpdateSettings({...settings, blackKeyHeightRatio: Number(e.target.value)})} className="w-full" />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span>鍵盤幅</span>
                <span>{settings.keyWidth}px</span>
              </div>
              <input type="range" min="30" max="120" step="1" value={settings.keyWidth} onChange={(e) => onUpdateSettings({...settings, keyWidth: Number(e.target.value)})} className="w-full" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold text-slate-400 tracking-wider border-b border-[#30363d] pb-1">無効区画</h3>
            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-200">
              <input type="checkbox" checked={settings.showInvalidSections} onChange={(e) => onUpdateSettings({...settings, showInvalidSections: e.target.checked})} className="w-4 h-4 rounded bg-[#161b22] border-[#30363d]" />
              無効区画を表示
            </label>
            <label className="text-xs font-bold text-slate-200 mt-1">無効区画モード</label>
            <select
              value={currentLayout.invalidSectionMode}
              onChange={(e) => onUpdateLayout({...currentLayout, invalidSectionMode: e.target.value as any})}
              className="px-2 py-1.5 bg-[#161b22] text-xs rounded border border-[#30363d] outline-none"
            >
              <option value="fixed">固定</option>
              <option value="compressed">圧縮</option>
            </select>
          </div>

          <div className="flex flex-col gap-2 pb-10">
            <h3 className="text-xs font-bold text-slate-400 tracking-wider border-b border-[#30363d] pb-1">PCキーボード</h3>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span>depthオフセット</span>
                <span>{settings.pcDepthOffset}</span>
              </div>
              <input type="range" min="0" max="4" value={settings.pcDepthOffset} onChange={(e) => onUpdateSettings({...settings, pcDepthOffset: Number(e.target.value)})} className="w-full" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
