import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Copy,
  Download,
  Edit3,
  Keyboard,
  Save,
  Settings2,
  SlidersHorizontal,
  Upload,
  VolumeX,
  X,
} from 'lucide-react';
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

type SectionId = 'mode' | 'audio' | 'preset' | 'display' | 'advanced';

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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    mode: true,
    audio: true,
    preset: true,
    display: true,
    advanced: false,
  });
  const noteDecayMs = settings.noteDecayMs ?? 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const toggleSection = (sectionId: SectionId) => {
    setOpenSections((prev) => ({...prev, [sectionId]: !prev[sectionId]}));
  };

  const sortedLayoutOptions = useMemo(
    () => [...allLayouts].sort((a, b) => Number(Boolean(a.isStandard)) - Number(Boolean(b.isStandard)) || a.name.localeCompare(b.name, 'ja')),
    [allLayouts],
  );
  const sortedTuningOptions = useMemo(
    () => [...allTunings].sort((a, b) => Number(Boolean(a.isStandard)) - Number(Boolean(b.isStandard)) || a.name.localeCompare(b.name, 'ja')),
    [allTunings],
  );

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
        window.alert('読み込めるプリセット形式ではありません。');
      }
    } catch (error: any) {
      window.alert(`読み込みに失敗しました: ${error.message}`);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="設定メニュー"
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[360px] flex-col overflow-hidden border-l border-[#30363d] bg-[#0d1117] text-slate-200 shadow-2xl"
      >
        <div className="sticky top-0 z-10 border-b border-[#30363d] bg-[#0d1117] px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-sm font-bold text-sky-300">多段微分音 Web 鍵盤</h2>
                <span className="rounded border border-sky-800 bg-sky-950 px-1.5 py-0.5 text-[10px] text-sky-300">v1.2</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                演奏・表示・プリセット管理をここで切り替えます。
              </p>
            </div>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              aria-label="設定メニューを閉じる"
              className="rounded-md border border-[#30363d] bg-[#161b22] p-1.5 text-slate-300 transition-colors hover:bg-[#21262d]"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {notices.length > 0 && (
            <section
              aria-live="polite"
              className="mb-4 flex flex-col gap-2 rounded-xl border border-amber-700/70 bg-amber-950/40 p-3"
            >
              <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
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
                      aria-label={`${notice.frequency.toFixed(1)}Hz の通知を閉じる`}
                      className="shrink-0 rounded p-1 text-amber-400 hover:bg-amber-900/40 hover:text-amber-100"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          <div className="space-y-3">
            <DisclosureSection
              title="画面モード"
              helper="演奏と編集を切り替えます。"
              icon={<Settings2 className="h-4 w-4" />}
              open={openSections.mode}
              onToggle={() => toggleSection('mode')}
            >
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
                  <Keyboard size={16} aria-hidden="true" />
                  演奏
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
                  <Edit3 size={16} aria-hidden="true" />
                  編集
                </button>
              </div>
            </DisclosureSection>

            <DisclosureSection
              title="演奏"
              helper="音色と減衰、緊急停止をまとめています。"
              icon={<VolumeX className="h-4 w-4" />}
              open={openSections.audio}
              onToggle={() => toggleSection('audio')}
            >
              <button
                onClick={() => globalAudioEngine.allNotesOff()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-rose-200 transition-colors hover:bg-rose-900"
              >
                <VolumeX size={16} aria-hidden="true" />
                <span className="text-xs font-bold">全発音停止</span>
              </button>

              <Field>
                <FieldLabel htmlFor="sound-source">音源</FieldLabel>
                <select
                  id="sound-source"
                  value={settings.soundSource}
                  onChange={(event) => {
                    const source = event.target.value as AppSettings['soundSource'];
                    onUpdateSettings({...settings, soundSource: source});
                    globalAudioEngine.setSoundSource(source);
                  }}
                  className="rounded border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs outline-none focus:border-sky-500"
                >
                  <option value="piano">ピアノ</option>
                  <option value="sawtooth">ノコギリ波</option>
                  <option value="square">矩形波</option>
                </select>
              </Field>

              <RangeBlock
                label="減衰"
                helper="0ms なら減衰なしです。"
                valueLabel={noteDecayMs === 0 ? 'なし' : `${noteDecayMs} ms`}
              >
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
              </RangeBlock>
            </DisclosureSection>

            <DisclosureSection
              title="プリセット"
              helper="配置・音高の切り替え、複製、保存、入出力を行います。"
              icon={<Copy className="h-4 w-4" />}
              open={openSections.preset}
              onToggle={() => toggleSection('preset')}
            >
              <Field>
                <FieldLabel htmlFor="layout-select">配置プリセット</FieldLabel>
                <div className="flex gap-2">
                  <select
                    id="layout-select"
                    value={currentLayout.id}
                    onChange={(event) => {
                      const selected = allLayouts.find((layout) => layout.id === event.target.value);
                      if (selected) {
                        onSelectLayout(selected);
                      }
                    }}
                    className="min-w-0 flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-2 text-xs outline-none focus:border-sky-500"
                  >
                    {sortedLayoutOptions.map((layout) => (
                      <option key={layout.id} value={layout.id}>
                        {layout.isStandard ? `[標準] ${layout.name}` : layout.name}
                      </option>
                    ))}
                  </select>
                  <IconActionButton onClick={onDuplicateLayout} label="配置プリセットを複製">
                    <Copy size={14} />
                  </IconActionButton>
                  {!currentLayout.isStandard && (
                    <IconActionButton onClick={onSaveLayout} label="配置プリセットを保存" accent="primary">
                      <Save size={14} />
                    </IconActionButton>
                  )}
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="tuning-select">音高プリセット</FieldLabel>
                <div className="flex gap-2">
                  <select
                    id="tuning-select"
                    value={currentTuning.id}
                    onChange={(event) => {
                      const selected = allTunings.find((tuning) => tuning.id === event.target.value);
                      if (selected) {
                        onSelectTuning(selected);
                      }
                    }}
                    className="min-w-0 flex-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-2 text-xs outline-none focus:border-sky-500"
                  >
                    {sortedTuningOptions.map((tuning) => (
                      <option key={tuning.id} value={tuning.id}>
                        {tuning.isStandard ? `[標準] ${tuning.name}` : tuning.name}
                      </option>
                    ))}
                  </select>
                  <IconActionButton onClick={onDuplicateTuning} label="音高プリセットを複製">
                    <Copy size={14} />
                  </IconActionButton>
                  {!currentTuning.isStandard && (
                    <IconActionButton onClick={onSaveTuning} label="音高プリセットを保存" accent="primary">
                      <Save size={14} />
                    </IconActionButton>
                  )}
                </div>
              </Field>

              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handleExportJsonPackage}
                  className="flex items-center justify-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-2 text-[11px] text-slate-200 hover:bg-[#21262d]"
                >
                  <Download size={12} aria-hidden="true" />
                  JSON
                </button>
                <button
                  onClick={handleExportBinaryPackage}
                  className="flex items-center justify-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-2 text-[11px] text-amber-300 hover:bg-[#21262d]"
                >
                  <Download size={12} aria-hidden="true" />
                  BIN
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-1 rounded border border-[#30363d] bg-[#161b22] px-2 py-2 text-[11px] text-sky-300 hover:bg-[#21262d]"
                >
                  <Upload size={12} aria-hidden="true" />
                  読み込み
                </button>
                <input ref={fileInputRef} type="file" accept=".json,.bin" onChange={handleFileImport} className="hidden" />
              </div>
            </DisclosureSection>

            <DisclosureSection
              title="表示"
              helper="演奏中に見た目や表示量を変える項目です。"
              icon={<SlidersHorizontal className="h-4 w-4" />}
              open={openSections.display}
              onToggle={() => toggleSection('display')}
            >
              <Field>
                <FieldLabel htmlFor="pitch-label-mode">鍵盤ラベル</FieldLabel>
                <select
                  id="pitch-label-mode"
                  value={settings.pitchLabelMode}
                  onChange={(event) => onUpdateSettings({...settings, pitchLabelMode: event.target.value as any})}
                  className="rounded border border-[#30363d] bg-[#161b22] px-2 py-2 text-xs outline-none focus:border-sky-500"
                >
                  <option value="note">音名</option>
                  <option value="doremi">ドレミ</option>
                  <option value="step">ステップ</option>
                  <option value="freq">周波数</option>
                  <option value="none">表示しない</option>
                </select>
              </Field>

              <ToggleField
                checked={settings.showTwoRows}
                onChange={(checked) => onUpdateSettings({...settings, showTwoRows: checked})}
                label="上下2段で表示する"
                helper="上下で別の幅とスクロール位置を持てます。"
              />

              <ToggleField
                checked={!!settings.showAddressBinary}
                onChange={(checked) => onUpdateSettings({...settings, showAddressBinary: checked})}
                label="番地と depth を表示する"
                helper="編集やデバッグ向けです。通常演奏では非表示を推奨します。"
              />

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
                  className="h-1.5 w-full cursor-pointer appearance-none rounded bg-[#30363d] accent-amber-500"
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
                  className="h-1.5 w-full cursor-pointer appearance-none rounded bg-[#30363d] accent-amber-500"
                />
              </RangeBlock>

              <RangeBlock
                label="共通鍵盤幅"
                helper="個別幅を触ると、演奏画面側のバーで上下別に変えられます。"
                valueLabel={`${settings.keyWidth}px`}
              >
                <input
                  type="range"
                  min="24"
                  max="120"
                  step="1"
                  value={settings.keyWidth}
                  onChange={(event) => {
                    const width = Number(event.target.value);
                    onUpdateSettings({...settings, keyWidth: width, upperKeyWidth: width, lowerKeyWidth: width});
                  }}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded bg-[#30363d] accent-sky-500"
                />
              </RangeBlock>
            </DisclosureSection>

            <DisclosureSection
              title="詳細設定"
              helper="頻繁には使わない表示・配置の補助設定です。"
              icon={<Settings2 className="h-4 w-4" />}
              open={openSections.advanced}
              onToggle={() => toggleSection('advanced')}
            >
              <ToggleField
                checked={settings.showInvalidSections}
                onChange={(checked) => onUpdateSettings({...settings, showInvalidSections: checked})}
                label="無効領域を表示する"
                helper="配置の確認用です。通常演奏ではオフ推奨です。"
              />

              <Field>
                <FieldLabel htmlFor="invalid-section-mode">無効領域の扱い</FieldLabel>
                <select
                  id="invalid-section-mode"
                  value={currentLayout.invalidSectionMode}
                  onChange={(event) => onUpdateLayout({...currentLayout, invalidSectionMode: event.target.value as any})}
                  className="rounded border border-[#30363d] bg-[#161b22] px-2 py-2 text-xs outline-none focus:border-sky-500"
                >
                  <option value="fixed">固定</option>
                  <option value="compressed">圧縮</option>
                  <option value="custom">カスタム</option>
                </select>
              </Field>

              <RangeBlock label="PC鍵盤 depth オフセット" valueLabel={`${settings.pcDepthOffset}`}>
                <input
                  type="range"
                  min="0"
                  max="4"
                  value={settings.pcDepthOffset}
                  onChange={(event) => onUpdateSettings({...settings, pcDepthOffset: Number(event.target.value)})}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded bg-[#30363d] accent-sky-500"
                />
              </RangeBlock>
            </DisclosureSection>
          </div>
        </div>
      </aside>
    </>
  );
};

const DisclosureSection: React.FC<{
  title: string;
  helper?: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({title, helper, icon, open, onToggle, children}) => (
  <section className="rounded-xl border border-[#30363d] bg-[#11161d]">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left"
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="mt-0.5 text-sky-300" aria-hidden="true">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold text-slate-100">{title}</div>
          {helper && <div className="mt-1 text-[11px] leading-relaxed text-slate-400">{helper}</div>}
        </div>
      </div>
      <ChevronDown
        className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        aria-hidden="true"
      />
    </button>
    {open && <div className="space-y-3 border-t border-[#30363d] px-3 py-3">{children}</div>}
  </section>
);

const Field: React.FC<{children: React.ReactNode}> = ({children}) => (
  <div className="flex flex-col gap-1.5">{children}</div>
);

const FieldLabel: React.FC<{htmlFor: string; children: React.ReactNode}> = ({htmlFor, children}) => (
  <label htmlFor={htmlFor} className="text-[11px] font-bold text-slate-300">
    {children}
  </label>
);

const RangeBlock: React.FC<{
  label: string;
  valueLabel: string;
  helper?: string;
  children: React.ReactNode;
}> = ({label, valueLabel, helper, children}) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="font-semibold text-slate-200">{label}</span>
      <span className="font-mono text-sky-300">{valueLabel}</span>
    </div>
    {children}
    {helper && <div className="text-[11px] text-slate-500">{helper}</div>}
  </div>
);

const ToggleField: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  helper?: string;
}> = ({checked, onChange, label, helper}) => (
  <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[#222934] bg-[#0d1117] px-3 py-2">
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="mt-0.5 h-4 w-4 rounded border-[#30363d] bg-[#161b22] text-sky-600 focus:ring-sky-500"
    />
    <span className="min-w-0">
      <span className="block text-xs font-semibold text-slate-200">{label}</span>
      {helper && <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{helper}</span>}
    </span>
  </label>
);

const IconActionButton: React.FC<{
  onClick: () => void;
  label: string;
  accent?: 'default' | 'primary';
  children: React.ReactNode;
}> = ({onClick, label, accent = 'default', children}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`rounded border p-2 transition-colors ${
      accent === 'primary'
        ? 'border-sky-500 bg-sky-600 text-white hover:bg-sky-500'
        : 'border-[#30363d] bg-[#161b22] text-slate-200 hover:bg-[#21262d]'
    }`}
  >
    {children}
  </button>
);
