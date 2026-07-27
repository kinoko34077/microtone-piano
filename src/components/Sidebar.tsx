import React, { useRef } from 'react';
import {
  LayoutPreset,
  TuningPreset,
  AppSettings,
} from '../types/keyboard';
import {
  Download,
  Upload,
  Copy,
  Save,
  VolumeX,
  Keyboard,
  Settings as SettingsIcon,
  Edit3,
  X,
  HelpCircle
} from 'lucide-react';
import { storageService } from '../core/storage';
import { globalAudioEngine } from '../core/audio';

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

  if (!isOpen) return null;

  // File import/export logic
  const handleExportJsonPackage = () => {
    const pkg = { type: 'MultiMicrotonalPackage', version: '1.0', timestamp: new Date().toISOString(), layoutPreset: currentLayout, tuningPreset: currentTuning };
    storageService.exportAsJson(pkg, `microtonal_${currentLayout.name}_${currentTuning.name}.json`);
  };

  const handleExportBinaryPackage = () => {
    const pkg = { type: 'MultiMicrotonalPackage', version: '1.0', timestamp: new Date().toISOString(), layoutPreset: currentLayout, tuningPreset: currentTuning };
    storageService.exportAsBinaryPackage(pkg, `microtonal_${currentLayout.name}_${currentTuning.name}.bin`);
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = (await storageService.importFromFile(file)) as any;
      if (data && data.layoutPreset) {
        onSelectLayout(data.layoutPreset);
        if (data.tuningPreset) onSelectTuning(data.tuningPreset);
        alert('プリセットパッケージを読み込みました。');
      } else if (data && data.lanes && data.mapping) {
        onSelectLayout(data);
        alert('配置プリセットを読み込みました。');
      } else if (data && data.pitches) {
        onSelectTuning(data);
        alert('音高プリセットを読み込みました。');
      } else {
        alert('未対応のファイルフォーマットです。');
      }
    } catch (err: any) {
      alert(`読み込みエラー: ${err.message}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40" 
        onClick={onClose}
      />
      {/* Sidebar Content */}
      <div className="fixed top-0 right-0 h-full w-[320px] bg-[#0d1117] border-l border-[#30363d] shadow-2xl z-50 flex flex-col overflow-y-auto overflow-x-hidden text-slate-200">
        <div className="sticky top-0 bg-[#0d1117] border-b border-[#30363d] p-3 flex justify-between items-center z-10">
          <div className="flex flex-col">
            <h2 className="font-bold text-sky-400 flex items-center gap-2">
              <span>8D IsoMorphic Keys</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-sky-950 text-sky-300 border border-sky-800 rounded">v1.2</span>
            </h2>
            <p className="text-[10px] text-slate-400">多段微分音イソモーフィック鍵盤</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-[#21262d] rounded-md transition-colors text-slate-300">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-6">
          {/* Mode Switch */}
          <div className="flex bg-[#010409] p-1 rounded-lg border border-[#30363d]">
            <button
              onClick={() => { onChangeMode('keyboard'); onClose(); }}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-md text-xs font-bold ${activeMode === 'keyboard' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-[#161b22]'}`}
            >
              <Keyboard size={16} /> 鍵盤演奏
            </button>
            <button
              onClick={() => { onChangeMode('editor'); onClose(); }}
              className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-md text-xs font-bold ${activeMode === 'editor' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-[#161b22]'}`}
            >
              <Edit3 size={16} /> マップ編集
            </button>
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-[#30363d] pb-1">オーディオ & サステイン</h3>
            
            <div className="flex gap-2 mb-1">
              <button
                onClick={() => {
                  const next = !settings.sustainLatch;
                  onUpdateSettings({ ...settings, sustainLatch: next });
                  globalAudioEngine.setSustainLatch(next);
                }}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                  settings.sustainLatch ? 'bg-amber-500 text-slate-950' : 'bg-[#21262d] text-slate-300 hover:bg-slate-700'
                }`}
              >
                Sustain Latch
              </button>
              <button
                onClick={() => globalAudioEngine.allNotesOff()}
                className="px-3 bg-rose-900/50 hover:bg-rose-900 text-rose-300 rounded-lg flex items-center justify-center"
                title="全音停止 (All Notes Off)"
              >
                <VolumeX size={18} />
              </button>
            </div>

            <label className="text-xs font-bold text-slate-200 mt-2">音色ソース</label>
            <select
              value={settings.soundSource}
              onChange={(e) => {
                const src = e.target.value as any;
                onUpdateSettings({ ...settings, soundSource: src });
                globalAudioEngine.setSoundSource(src);
              }}
              className="px-3 py-2 bg-[#161b22] border border-[#30363d] focus:border-sky-500 rounded outline-none"
            >
              <option value="piano">FM Piano (減衰/ベロシティ反応)</option>
              <option value="sawtooth">Sawtooth (鋸波/持続音)</option>
              <option value="square">Square (矩形波/持続音)</option>
            </select>
          </div>

          {/* Presets */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-[#30363d] pb-1">プリセット</h3>
            
            {/* Layout Preset */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-slate-400">配置 (Layout):</label>
              <div className="flex gap-1">
                <select
                  value={currentLayout.id}
                  onChange={(e) => {
                    const sel = allLayouts.find((l) => l.id === e.target.value);
                    if (sel) onSelectLayout(sel);
                  }}
                  className="flex-1 bg-[#161b22] text-xs px-2 py-1.5 rounded border border-[#30363d] outline-none focus:border-sky-500"
                >
                  {allLayouts.map((l) => (
                    <option key={l.id} value={l.id}>{l.isStandard ? `[標準] ${l.name}` : l.name}</option>
                  ))}
                </select>
                <button onClick={onDuplicateLayout} className="p-1.5 bg-[#21262d] hover:bg-[#30363d] rounded"><Copy size={14}/></button>
                {!currentLayout.isStandard && (
                  <button onClick={onSaveLayout} className="p-1.5 bg-sky-600 hover:bg-sky-500 rounded"><Save size={14}/></button>
                )}
              </div>
            </div>

            {/* Tuning Preset */}
            <div className="flex flex-col gap-1 mt-1">
              <label className="text-[10px] font-bold text-slate-400">音高 (Tuning):</label>
              <div className="flex gap-1">
                <select
                  value={currentTuning.id}
                  onChange={(e) => {
                    const sel = allTunings.find((t) => t.id === e.target.value);
                    if (sel) onSelectTuning(sel);
                  }}
                  className="flex-1 bg-[#161b22] text-xs px-2 py-1.5 rounded border border-[#30363d] outline-none focus:border-sky-500"
                >
                  {allTunings.map((t) => (
                    <option key={t.id} value={t.id}>{t.isStandard ? `[標準] ${t.name}` : t.name}</option>
                  ))}
                </select>
                <button onClick={onDuplicateTuning} className="p-1.5 bg-[#21262d] hover:bg-[#30363d] rounded"><Copy size={14}/></button>
                {!currentTuning.isStandard && (
                  <button onClick={onSaveTuning} className="p-1.5 bg-sky-600 hover:bg-sky-500 rounded"><Save size={14}/></button>
                )}
              </div>
            </div>
            
            {/* Import / Export */}
            <div className="flex gap-2 mt-2">
              <button onClick={handleExportJsonPackage} className="flex-1 p-1 bg-[#21262d] hover:bg-[#30363d] rounded text-[10px] flex items-center justify-center gap-1"><Download size={12}/> JSON</button>
              <button onClick={handleExportBinaryPackage} className="flex-1 p-1 bg-[#21262d] hover:bg-[#30363d] rounded text-[10px] flex items-center justify-center gap-1 text-amber-400"><Download size={12}/> BIN</button>
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 p-1 bg-[#21262d] hover:bg-[#30363d] rounded text-[10px] flex items-center justify-center gap-1 text-sky-400"><Upload size={12}/> 読込</button>
              <input ref={fileInputRef} type="file" accept=".json,.bin" onChange={handleFileImport} className="hidden" />
            </div>
          </div>

          {/* Keyboard Settings */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-[#30363d] pb-1">鍵盤設定</h3>
            
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-200">表示名 (Label Mode)</label>
              <select
                value={settings.pitchLabelMode}
                onChange={(e) => onUpdateSettings({ ...settings, pitchLabelMode: e.target.value as any })}
                className="bg-[#161b22] text-xs px-2 py-1.5 rounded border border-[#30363d] outline-none"
              >
                <option value="note">音名 (C4, D4...)</option>
                <option value="doremi">ドレミ (ド, レ...)</option>
                <option value="step">ステップ (S0, S1...)</option>
                <option value="freq">周波数 (Hz)</option>
                <option value="none">非表示</option>
              </select>
            </div>

            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-200 mt-2">
              <input type="checkbox" checked={settings.showTwoRows} onChange={(e) => onUpdateSettings({ ...settings, showTwoRows: e.target.checked })} className="w-4 h-4 rounded bg-[#161b22] border-[#30363d] text-sky-600 focus:ring-sky-500" />
              上下二段鍵盤表示
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-200">
              <input
                type="checkbox"
                checked={!!settings.showAddressBinary}
                onChange={(e) => onUpdateSettings({ ...settings, showAddressBinary: e.target.checked })}
                className="w-4 h-4 rounded bg-[#161b22] border-[#30363d] text-sky-600 focus:ring-sky-500"
              />
              鍵盤上にバイナリ(16進番地 0xXX)を表示
            </label>

            {/* Black Key Width */}
            <div className="flex flex-col gap-1 mt-2">
              <div className="flex justify-between text-xs">
                <span>黒鍵の横幅 (白鍵比)</span>
                <span>{Math.round(settings.blackKeyWidthRatio * 100)}%</span>
              </div>
              <input type="range" min="0.3" max="1.0" step="0.05" value={settings.blackKeyWidthRatio} onChange={(e) => onUpdateSettings({ ...settings, blackKeyWidthRatio: Number(e.target.value) })} className="w-full" />
            </div>

            {/* Black Key Height */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span>黒鍵の縦幅 (白鍵比)</span>
                <span>{Math.round(settings.blackKeyHeightRatio * 100)}%</span>
              </div>
              <input type="range" min="0.3" max="0.9" step="0.05" value={settings.blackKeyHeightRatio} onChange={(e) => onUpdateSettings({ ...settings, blackKeyHeightRatio: Number(e.target.value) })} className="w-full" />
            </div>
            
            {/* White Key Width */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span>白鍵のベース幅</span>
                <span>{settings.keyWidth}px</span>
              </div>
              <input type="range" min="30" max="120" step="1" value={settings.keyWidth} onChange={(e) => onUpdateSettings({ ...settings, keyWidth: Number(e.target.value) })} className="w-full" />
            </div>
          </div>

          {/* Invalid Sections Mode */}
          <div className="flex flex-col gap-2">
             <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-[#30363d] pb-1">無効区画 & 配置</h3>
             <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-200">
               <input type="checkbox" checked={settings.showInvalidSections} onChange={(e) => onUpdateSettings({ ...settings, showInvalidSections: e.target.checked })} className="w-4 h-4 rounded bg-[#161b22] border-[#30363d]" />
               無効区画も表示する
             </label>
             <label className="text-xs font-bold text-slate-200 mt-1">無効段配置モード</label>
             <select value={currentLayout.invalidSectionMode} onChange={(e) => {
               const newLayout = { ...currentLayout, invalidSectionMode: e.target.value as any };
               onUpdateLayout(newLayout);
             }} className="px-2 py-1.5 bg-[#161b22] text-xs rounded border border-[#30363d] outline-none">
               <option value="fixed">固定配置 (Fixed: 8段枠保持)</option>
               <option value="compressed">圧縮配置 (Compressed: 有効段のみ等分)</option>
             </select>
          </div>

          <div className="flex flex-col gap-2 pb-10">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-[#30363d] pb-1">PCキーボード</h3>
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-xs">
                <span>対象4段のdepthオフセット</span>
                <span>{settings.pcDepthOffset}</span>
              </div>
              <input type="range" min="0" max="4" value={settings.pcDepthOffset} onChange={(e) => onUpdateSettings({ ...settings, pcDepthOffset: Number(e.target.value) })} className="w-full" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
