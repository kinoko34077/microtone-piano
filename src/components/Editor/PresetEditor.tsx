/**
 * プリセット＆全256区画編集コンポーネント
 */

import React, { useState } from 'react';
import {
  LayoutPreset,
  TuningPreset,
  PitchDefinition,
  AppSettings,
  InvalidSectionMode,
  PitchType,
} from '../../types/keyboard';
import { decodeAddress, encodeAddress, getAddressLabel } from '../../core/address';
import { calculateFrequency, getPitchLabel, formatFrequency, resolvePitch } from '../../core/pitch';
import { applyAutoMapping } from '../../core/mapping';
import { globalAudioEngine } from '../../core/audio';
import { Plus, Minus, Trash2, Zap, Copy, Check, Music2, Sliders, Layers, Edit3, Type } from 'lucide-react';

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
  const [selectedAddresses, setSelectedAddresses] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<'grid' | 'tuning' | 'lanes'>('grid');
  const [assignOctaveShift, setAssignOctaveShift] = useState<number>(0);
  const [showAllDepthSlots, setShowAllDepthSlots] = useState<boolean>(false);

  // Terpstra風一括名前編集状態
  const [showBulkEditor, setShowBulkEditor] = useState<boolean>(false);
  const [bulkPitchNamesText, setBulkPitchNamesText] = useState<string>('');
  const [bulkNoteNamesText, setBulkNoteNamesText] = useState<string>('');
  const [bulkDoremiNamesText, setBulkDoremiNamesText] = useState<string>('');

  // 横位置数の計算 (1 ~ 16, デフォルト 16)
  const displayHorizontalCount = Math.max(1, Math.min(16, layout.horizontalCount ?? 16));

  const handleAddHorizontalColumn = () => {
    if (displayHorizontalCount >= 16) {
      alert('横位置数は最大16列までです。');
      return;
    }
    onUpdateLayout({ ...layout, horizontalCount: displayHorizontalCount + 1 });
  };

  const handleRemoveHorizontalColumn = () => {
    if (displayHorizontalCount <= 1) {
      alert('横位置数は最小1列以上必要です。');
      return;
    }
    onUpdateLayout({ ...layout, horizontalCount: displayHorizontalCount - 1 });
  };

  // 単一/複数選択ハンドラ
  const toggleAddressSelection = (addr: number, isMulti: boolean) => {
    onSelectAddress(addr);

    // 試聴発音
    const pitchId = layout.mapping[addr];
    if (pitchId !== undefined && pitchId !== -1) {
      const { pitchDef: p, octaveShift } = resolvePitch(pitchId, tuning);
      if (p) {
        const freq = calculateFrequency(p, tuning, octaveShift);
        globalAudioEngine.noteOn(addr, pitchId, freq, 0.8, 'editor_test');
        setTimeout(() => globalAudioEngine.noteOffByAddress(addr), 300);
      }
    }

    if (isMulti) {
      setSelectedAddresses((prev) => {
        const next = new Set(prev);
        if (next.has(addr)) {
          next.delete(addr);
        } else {
          next.add(addr);
        }
        return next;
      });
    } else {
      setSelectedAddresses(new Set([addr]));
    }
  };

  // 全選択 / 選択解除
  const handleSelectAll = () => {
    const all = new Set<number>();
    for (let i = 0; i < 256; i++) all.add(i);
    setSelectedAddresses(all);
  };

  const handleClearSelection = () => {
    setSelectedAddresses(new Set());
  };

  // 音高の割当て (選択された区画へ)
  const assignPitchToSelected = (pitchId: number) => {
    const newMapping = [...layout.mapping];
    const targets = selectedAddresses.size > 0 ? Array.from(selectedAddresses) : (selectedAddress !== null ? [selectedAddress] : []);

    targets.forEach((addr) => {
      newMapping[addr] = pitchId;
    });

    onUpdateLayout({ ...layout, mapping: newMapping });
  };

  // 割り当て解除 (-1)
  const clearPitchForSelected = () => {
    assignPitchToSelected(-1);
  };

  // 自動マッピング実行
  const handleAutoMapping = () => {
    const newMapping = applyAutoMapping(layout, tuning.pitches, settings.autoMappingDirection);
    onUpdateLayout({ ...layout, mapping: newMapping });
  };

  // 1オクターブ/周期の繰り返し自動充填
  const handleOctaveRepeatFill = () => {
    const newMapping = [...layout.mapping];
    const N = tuning.pitches.length;
    const period = layout.horizontalCount || 16;
    
    for (let x = period; x < displayHorizontalCount; x++) {
      const srcX = x % period;
      const oct = Math.floor(x / period);
      
      for (let d = 0; d < 8; d++) {
        const wAddrSrc = encodeAddress(srcX, false, d);
        const wPitch = layout.mapping[wAddrSrc];
        if (wPitch !== -1) {
          newMapping[encodeAddress(x, false, d)] = wPitch + oct * N;
        }

        const bAddrSrc = encodeAddress(srcX, true, d);
        const bPitch = layout.mapping[bAddrSrc];
        if (bPitch !== -1) {
          newMapping[encodeAddress(x, true, d)] = bPitch + oct * N;
        }
      }
    }
    onUpdateLayout({ ...layout, mapping: newMapping });
  };

  // レーンの有効段数一括変更
  const setAllLanesActiveDepths = (depth: number) => {
    const newLanes = layout.lanes.map((l) => ({ ...l, activeDepths: depth }));
    onUpdateLayout({ ...layout, lanes: newLanes });
  };

  // 新規音高の追加
  const handleAddPitch = () => {
    const maxId = tuning.pitches.reduce((m, p) => Math.max(m, p.id), -1);
    if (maxId >= 254) {
      alert('音高数は最大255個までです。');
      return;
    }
    const newId = maxId + 1;
    const newPitch: PitchDefinition = {
      id: newId,
      name: `${tuning.name} Pitch ${newId}`,
      type: 'edo',
      edo: 12,
      step: newId,
    };
    onUpdateTuning({
      ...tuning,
      pitches: [...tuning.pitches, newPitch],
    });
  };

  // 音高の削除
  const handleDeletePitch = (pitchId: number) => {
    const newPitches = tuning.pitches.filter((p) => p.id !== pitchId);
    const newMapping = layout.mapping.map((id) => (id === pitchId ? -1 : id));
    onUpdateTuning({ ...tuning, pitches: newPitches });
    onUpdateLayout({ ...layout, mapping: newMapping });
  };

  // 音高データの変更
  const handleUpdatePitchItem = (updated: PitchDefinition) => {
    const newPitches = tuning.pitches.map((p) => (p.id === updated.id ? updated : p));
    onUpdateTuning({ ...tuning, pitches: newPitches });
  };

  // Terpstra風一括名前更新処理
  const handleApplyBulkPitchNames = () => {
    if (!bulkPitchNamesText.trim()) return;
    const names = bulkPitchNamesText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const newPitches = tuning.pitches.map((p, idx) => {
      if (idx < names.length) {
        return { ...p, name: names[idx] };
      }
      return p;
    });
    onUpdateTuning({ ...tuning, pitches: newPitches });
    alert(`${names.length} 個の音高名を一括更新しました。`);
  };

  const handleApplyBulkNoteNames = () => {
    if (!bulkNoteNamesText.trim()) return;
    const names = bulkNoteNamesText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    onUpdateTuning({ ...tuning, noteNames: names });
    alert(`音名表記リスト (${names.length}個) を設定しました。`);
  };

  const handleApplyBulkDoremiNames = () => {
    if (!bulkDoremiNamesText.trim()) return;
    const names = bulkDoremiNamesText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    onUpdateTuning({ ...tuning, doremiNames: names });
    alert(`ドレミ表記リスト (${names.length}個) を設定しました。`);
  };

  return (
    <div className="flex flex-col h-full bg-[#161b22] rounded-xl shadow-xl border border-[#30363d] overflow-hidden">
      {/* タブヘッダー */}
      <div className="flex flex-wrap items-center justify-between border-b border-[#30363d] bg-[#0d1117] px-4 py-2 gap-2">
        <div className="flex gap-1.5">
          <button
            onClick={() => setActiveTab('grid')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all border ${
              activeTab === 'grid'
                ? 'bg-sky-600/90 text-white border-sky-500 shadow-sm'
                : 'bg-[#161b22] text-slate-300 border-[#30363d] hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            区間マップ表 ({displayHorizontalCount}列)
          </button>
          <button
            onClick={() => setActiveTab('tuning')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all border ${
              activeTab === 'tuning'
                ? 'bg-sky-600/90 text-white border-sky-500 shadow-sm'
                : 'bg-[#161b22] text-slate-300 border-[#30363d] hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Music2 className="w-3.5 h-3.5" />
            音高・表記管理 ({tuning.pitches.length}音)
          </button>
          <button
            onClick={() => setActiveTab('lanes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all border ${
              activeTab === 'lanes'
                ? 'bg-sky-600/90 text-white border-sky-500 shadow-sm'
                : 'bg-[#161b22] text-slate-300 border-[#30363d] hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            レーン段数・列数設定
          </button>
        </div>

        {/* 選択操作・列数変更ボタン */}
        <div className="flex items-center gap-2">
          {/* 横位置数(列数)の追加・削除 */}
          <div className="flex items-center bg-[#161b22] px-2 py-0.5 rounded border border-[#30363d] text-xs gap-1.5 mr-2">
            <span className="text-slate-400 font-bold">横列数:</span>
            <span className="font-mono text-sky-400 font-bold">{displayHorizontalCount}</span>
            <button
              onClick={handleRemoveHorizontalColumn}
              className="p-1 hover:bg-slate-800 text-rose-400 rounded transition-colors"
              title="横列を削除"
            >
              <Minus className="w-3 h-3" />
            </button>
            <button
              onClick={handleAddHorizontalColumn}
              className="p-1 hover:bg-slate-800 text-sky-400 rounded transition-colors"
              title="横列を追加"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          <span className="text-xs text-slate-400 font-medium hidden sm:inline">
            選択中: <strong className="text-sky-400 font-mono">{selectedAddresses.size}</strong> 区画
          </span>
          <button
            onClick={handleSelectAll}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#30363d] text-xs rounded font-medium transition-colors"
          >
            全選択
          </button>
          <button
            onClick={handleClearSelection}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-[#30363d] text-xs rounded font-medium transition-colors"
          >
            解除
          </button>
          <button
            onClick={handleOctaveRepeatFill}
            className="flex items-center gap-1 px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs rounded font-bold shadow-sm transition-colors border border-sky-400"
            title="1周期分のパターンを残りの横区画へオクターブ加算して一括反復充填"
          >
            <Copy className="w-3 h-3" />
            オクターブ巡回充填
          </button>
          <button
            onClick={handleAutoMapping}
            className="flex items-center gap-1 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded font-bold shadow-sm transition-colors border border-amber-500"
            title="現在のレーン段数と音高一覧から自動順次割り当て"
          >
            <Zap className="w-3 h-3" />
            自動割り当て
          </button>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="flex-1 overflow-auto p-3 md:p-4 bg-[#0d1117]">
        {/* --- 1. 区間マップ表 (黒鍵が上の配置) --- */}
        {activeTab === 'grid' && (
          <div className="flex flex-col md:flex-row gap-4 h-full">
            {/* 区画グリッド */}
            <div className="flex-1 bg-[#161b22] p-3 rounded-lg border border-[#30363d] shadow-sm overflow-auto">
              <div className="flex flex-wrap items-center justify-between border-b border-[#30363d] pb-2 mb-2 gap-2">
                <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                  <span>区間マップ表 ({displayHorizontalCount}横位置 x 白黒2 x 有効段)</span>
                </h3>

                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAllDepthSlots}
                    onChange={(e) => setShowAllDepthSlots(e.target.checked)}
                    className="rounded bg-[#0d1117] border-[#30363d] text-sky-500 focus:ring-0"
                  />
                  <span>無効段スロット(d0~d7)も全表示</span>
                </label>
              </div>

              <div
                className="grid gap-1.5 min-w-[320px]"
                style={{
                  gridTemplateColumns: `repeat(${displayHorizontalCount}, minmax(48px, 1fr))`,
                }}
              >
                {Array.from({ length: displayHorizontalCount }, (_, x) => {
                  const whiteLane = layout.lanes[x * 2];
                  const blackLane = layout.lanes[x * 2 + 1];

                  const wActiveDepths = whiteLane ? whiteLane.activeDepths : 1;
                  const bActiveDepths = blackLane ? blackLane.activeDepths : 0;

                  // 黒鍵の段数生成 (上に黒を配置)
                  const bDepths = showAllDepthSlots
                    ? Array.from({ length: 8 }, (_, i) => 7 - i)
                    : Array.from({ length: bActiveDepths }, (_, i) => bActiveDepths - 1 - i);

                  // 白鍵の段数生成 (下に白を配置)
                  const wDepths = showAllDepthSlots
                    ? Array.from({ length: 8 }, (_, i) => 7 - i)
                    : Array.from({ length: wActiveDepths }, (_, i) => wActiveDepths - 1 - i);

                  return (
                    <div key={`col_${x}`} className="flex flex-col gap-1 border-r border-[#30363d]/60 pr-1">
                      <div className="text-center font-bold font-mono text-[10px] bg-[#21262d] text-sky-300 py-0.5 rounded border border-[#30363d]">
                        x={x.toString(16).toUpperCase()}
                      </div>

                      {/* 1. 黒鍵 (上に黒鍵を配置!) */}
                      <div className="flex flex-col gap-0.5 bg-[#010409] p-0.5 rounded border border-[#30363d]">
                        <div className="text-[9px] text-amber-400 font-bold text-center border-b border-[#21262d] pb-0.5 mb-0.5 flex items-center justify-between px-1">
                          <span>黒</span>
                          <span className="text-[8px] font-mono opacity-80">{bActiveDepths}段</span>
                        </div>

                        {bDepths.length === 0 ? (
                          <div className="text-[8px] text-slate-600 text-center py-1 font-mono">(なし)</div>
                        ) : (
                          bDepths.map((depth) => {
                            const addr = encodeAddress(x, true, depth);
                            const pitchId = layout.mapping[addr];
                            const isInvalid = depth >= bActiveDepths;
                            const isSelected = selectedAddresses.has(addr) || selectedAddress === addr;

                            return (
                              <button
                                key={`grid_b_${x}_${depth}`}
                                onClick={(e) => toggleAddressSelection(addr, e.ctrlKey || e.metaKey || e.shiftKey)}
                                className={`p-1 text-[8px] font-mono rounded border text-left flex flex-col justify-between h-8 transition-all ${
                                  isSelected
                                    ? 'bg-sky-600 text-white border-sky-400 ring-1 ring-sky-300 font-bold'
                                    : isInvalid
                                    ? 'bg-[#0d1117] text-slate-700 border-[#161b22]'
                                    : pitchId !== undefined && pitchId !== -1
                                    ? 'bg-amber-950 text-amber-200 border-amber-800 font-medium hover:border-amber-600'
                                    : 'bg-[#161b22] text-slate-400 border-[#30363d] hover:bg-slate-800'
                                }`}
                              >
                                <div className="flex justify-between items-center opacity-70">
                                  <span>d{depth}</span>
                                </div>
                                <div className="truncate font-bold text-[9px]">
                                  {pitchId !== undefined && pitchId !== -1 ? `P${pitchId}` : '-'}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>

                      {/* 2. 白鍵 (下に白鍵を配置!) */}
                      <div className="flex flex-col gap-0.5 bg-[#0d1117] p-0.5 rounded border border-[#30363d]">
                        <div className="text-[9px] text-sky-300 font-bold text-center border-b border-[#21262d] pb-0.5 mb-0.5 flex items-center justify-between px-1">
                          <span>白</span>
                          <span className="text-[8px] font-mono opacity-80">{wActiveDepths}段</span>
                        </div>

                        {wDepths.length === 0 ? (
                          <div className="text-[8px] text-slate-600 text-center py-1 font-mono">(なし)</div>
                        ) : (
                          wDepths.map((depth) => {
                            const addr = encodeAddress(x, false, depth);
                            const pitchId = layout.mapping[addr];
                            const isInvalid = depth >= wActiveDepths;
                            const isSelected = selectedAddresses.has(addr) || selectedAddress === addr;

                            return (
                              <button
                                key={`grid_w_${x}_${depth}`}
                                onClick={(e) => toggleAddressSelection(addr, e.ctrlKey || e.metaKey || e.shiftKey)}
                                className={`p-1 text-[8px] font-mono rounded border text-left flex flex-col justify-between h-8 transition-all ${
                                  isSelected
                                    ? 'bg-sky-600 text-white border-sky-400 ring-1 ring-sky-300 font-bold'
                                    : isInvalid
                                    ? 'bg-[#161b22]/50 text-slate-600 border-[#21262d]'
                                    : pitchId !== undefined && pitchId !== -1
                                    ? 'bg-amber-950/80 text-amber-200 border-amber-700/80 font-medium hover:border-amber-500'
                                    : 'bg-[#21262d] text-slate-300 border-[#30363d] hover:bg-slate-800'
                                }`}
                              >
                                <div className="flex justify-between items-center opacity-70">
                                  <span>d{depth}</span>
                                </div>
                                <div className="truncate font-bold text-[9px]">
                                  {pitchId !== undefined && pitchId !== -1 ? `P${pitchId}` : '-'}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 音高割り当てサイドパネル */}
            <div className="w-full md:w-80 bg-[#161b22] p-3 rounded-lg border border-[#30363d] shadow-sm flex flex-col gap-3">
              <h3 className="text-xs font-bold text-slate-200 pb-2 border-b border-[#30363d] flex items-center justify-between">
                <span>音高割り当て</span>
                <button
                  onClick={clearPitchForSelected}
                  className="text-[10px] px-2 py-0.5 bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-200 rounded font-semibold transition-colors"
                >
                  割当解除 (-1)
                </button>
              </h3>

              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-bold text-slate-400">割当オクターブ(周期)シフト:</span>
                <input
                  type="number"
                  value={assignOctaveShift}
                  onChange={(e) => setAssignOctaveShift(Number(e.target.value))}
                  className="w-16 px-1 py-0.5 bg-[#0d1117] text-slate-200 border border-[#30363d] rounded text-xs outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex-1 overflow-auto max-h-[420px] flex flex-col gap-1.5 pr-1">
                {tuning.pitches.map((p, idx) => {
                  const freq = calculateFrequency(p, tuning, assignOctaveShift);
                  const assignId = idx + assignOctaveShift * tuning.pitches.length;

                  return (
                    <button
                      key={`assign_pitch_${p.id}`}
                      onClick={() => assignPitchToSelected(assignId)}
                      className="p-2 rounded border border-[#30363d] bg-[#0d1117] hover:border-sky-500 hover:bg-sky-950/40 text-left flex items-center justify-between transition-colors group"
                    >
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-slate-200 group-hover:text-sky-300">
                          {p.name} (ID: {assignId})
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {getPitchLabel(p)} ({formatFrequency(freq)})
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-1 bg-sky-950 text-sky-300 border border-sky-800 font-bold rounded group-hover:bg-sky-600 group-hover:text-white group-hover:border-sky-500 transition-colors">
                        割当
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* --- 2. 音高テーブル＆Terpstra風一括名前・表記管理 --- */}
        {activeTab === 'tuning' && (
          <div className="flex flex-col gap-4 bg-[#161b22] p-4 rounded-lg border border-[#30363d] shadow-sm">
            <div className="flex flex-wrap justify-between items-center pb-3 border-b border-[#30363d] gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-100">音高プリセット詳細 ({tuning.name})</h3>
                <p className="text-xs font-mono text-slate-400 mt-0.5">
                  基準キー: 0x{tuning.baseAddress.toString(16).toUpperCase()} | 基準周波数: {tuning.baseFrequency} Hz | 周期: {tuning.periodCents} cent
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowBulkEditor(!showBulkEditor)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[#21262d] hover:bg-slate-700 text-sky-300 text-xs font-bold rounded border border-sky-800 transition-colors"
                >
                  <Type className="w-3.5 h-3.5" />
                  {showBulkEditor ? '一括編集を閉じる' : 'Terpstra方式 一括名前・表記編集'}
                </button>
                <button
                  onClick={handleAddPitch}
                  className="flex items-center gap-1 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded border border-sky-400 shadow-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  音高追加
                </button>
              </div>
            </div>

            {/* Terpstra方式 一括名前・表記編集パネル */}
            {showBulkEditor && (
              <div className="bg-[#0d1117] p-3 rounded-lg border border-[#30363d] flex flex-col gap-3">
                <h4 className="text-xs font-bold text-sky-400 flex items-center gap-1.5 border-b border-[#30363d] pb-1.5">
                  <Type className="w-4 h-4" />
                  一括名前・音名・ドレミ表記エディタ (改行/カンマ区切り入力)
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* 1. 音高名 (pitch.name) 一括入力 */}
                  <div className="flex flex-col gap-1.5 bg-[#161b22] p-2.5 rounded border border-[#30363d]">
                    <label className="text-xs font-bold text-slate-200">全音高名の一括入力</label>

                    <textarea
                      value={bulkPitchNamesText}
                      onChange={(e) => setBulkPitchNamesText(e.target.value)}
                      placeholder="例:&#10;C&#10;C#&#10;D&#10;D#..."
                      className="w-full h-24 p-2 bg-[#0d1117] text-slate-200 border border-[#30363d] rounded text-xs font-mono outline-none focus:border-sky-500"
                    />
                    <button
                      onClick={handleApplyBulkPitchNames}
                      className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded transition-colors"
                    >
                      音高名に反映
                    </button>
                  </div>

                  {/* 2. カスタム音名リスト (noteNames) 一括入力 */}
                  <div className="flex flex-col gap-1.5 bg-[#161b22] p-2.5 rounded border border-[#30363d]">
                    <label className="text-xs font-bold text-slate-200">音名(Note)リスト (1周期分)</label>
                    <p className="text-[10px] text-slate-400">表示モード「音名(C4)」で参照されます</p>
                    <textarea
                      value={bulkNoteNamesText}
                      onChange={(e) => setBulkNoteNamesText(e.target.value)}
                      placeholder="例: C, C+, D-, D, D+, E-, E, F, F+, G-, G..."
                      className="w-full h-20 p-2 bg-[#0d1117] text-slate-200 border border-[#30363d] rounded text-xs font-mono outline-none focus:border-sky-500"
                    />
                    <button
                      onClick={handleApplyBulkNoteNames}
                      className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded transition-colors"
                    >
                      音名リスト保存
                    </button>
                  </div>

                  {/* 3. カスタムドレミ表記リスト (doremiNames) 一括入力 */}
                  <div className="flex flex-col gap-1.5 bg-[#161b22] p-2.5 rounded border border-[#30363d]">
                    <label className="text-xs font-bold text-slate-200">ドレミ(DoReMi)リスト (1周期分)</label>
                    <p className="text-[10px] text-slate-400">表示モード「ドレミ(ド)」で参照されます</p>
                    <textarea
                      value={bulkDoremiNamesText}
                      onChange={(e) => setBulkDoremiNamesText(e.target.value)}
                      placeholder="例: ド, ド#, レ, レ#, ミ, ファ, ファ#, ソ..."
                      className="w-full h-20 p-2 bg-[#0d1117] text-slate-200 border border-[#30363d] rounded text-xs font-mono outline-none focus:border-sky-500"
                    />
                    <button
                      onClick={handleApplyBulkDoremiNames}
                      className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded transition-colors"
                    >
                      ドレミリスト保存
                    </button>
                  </div>
                </div>

                {/* テンプレートプリセットボタン */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#30363d]">
                  <span className="text-xs text-slate-400 font-bold">テンプレート一括挿入:</span>
                  <button
                    onClick={() => {
                      setBulkNoteNamesText('C, C#, D, D#, E, F, F#, G, G#, A, A#, B');
                      setBulkDoremiNamesText('ド, ド#, レ, レ#, ミ, ファ, ファ#, ソ, ソ#, ラ, ラ#, シ');
                    }}
                    className="px-2 py-0.5 bg-[#21262d] hover:bg-slate-700 text-slate-200 text-xs rounded border border-[#30363d]"
                  >
                    12EDO (C~B / ド~シ)
                  </button>
                  <button
                    onClick={() => {
                      setBulkNoteNamesText('C, C+¼, C#, C+¾, D, D+¼, D#, D+¾, E, E+¼, F, F+¼, F#, F+¾, G, G+¼, G#, G+¾, A, A+¼, A#, A+¾, B, B+¼');
                      setBulkDoremiNamesText('ド, ド+¼, ド#, ド+¾, レ, レ+¼, レ#, レ+¾, ミ, ミ+¼, ファ, ファ+¼, ファ#, ファ+¾, ソ, ソ+¼, ソ#, ソ+¾, ラ, ラ+¼, ラ#, ラ+¾, シ, シ+¼');
                    }}
                    className="px-2 py-0.5 bg-[#21262d] hover:bg-slate-700 text-slate-200 text-xs rounded border border-[#30363d]"
                  >
                    24EDO (四分音表記)
                  </button>
                  <button
                    onClick={() => {
                      const arr = Array.from({ length: 31 }, (_, i) => `S${i}`);
                      setBulkNoteNamesText(arr.join(', '));
                      setBulkDoremiNamesText(arr.join(', '));
                    }}
                    className="px-2 py-0.5 bg-[#21262d] hover:bg-slate-700 text-slate-200 text-xs rounded border border-[#30363d]"
                  >
                    S0~S30 ステップ番号
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[#0d1117] text-slate-300 border-b border-[#30363d]">
                    <th className="p-2.5">ID</th>
                    <th className="p-2.5">名称 (pitch.name)</th>
                    <th className="p-2.5">方式</th>
                    <th className="p-2.5">パラメータ</th>
                    <th className="p-2.5">計算周波数</th>
                    <th className="p-2.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tuning.pitches.map((p) => {
                    const freq = calculateFrequency(p, tuning);

                    return (
                      <tr key={`p_row_${p.id}`} className="border-b border-[#30363d]/60 hover:bg-[#0d1117]/60">
                        <td className="p-2.5 font-bold font-mono text-sky-400">{p.id}</td>
                        <td className="p-2.5">
                          <input
                            type="text"
                            value={p.name}
                            onChange={(e) => handleUpdatePitchItem({ ...p, name: e.target.value })}
                            className="px-2 py-1 bg-[#0d1117] text-slate-200 border border-[#30363d] focus:border-sky-500 rounded text-xs w-40 outline-none"
                          />
                        </td>
                        <td className="p-2.5">
                          <select
                            value={p.type}
                            onChange={(e) =>
                              handleUpdatePitchItem({
                                ...p,
                                type: e.target.value as PitchType,
                              })
                            }
                            className="px-2 py-1 bg-[#0d1117] text-slate-200 border border-[#30363d] focus:border-sky-500 rounded text-xs outline-none"
                          >
                            <option value="edo">EDOステップ</option>
                            <option value="cents">Cent</option>
                            <option value="ratio">周波数比率</option>
                            <option value="frequency">絶対周波数</option>
                          </select>
                        </td>
                        <td className="p-2.5">
                          {p.type === 'edo' && (
                            <div className="flex gap-2 items-center text-slate-300">
                              <span>EDO:</span>
                              <input
                                type="number"
                                value={p.edo || 12}
                                onChange={(e) => handleUpdatePitchItem({ ...p, edo: Number(e.target.value) })}
                                className="w-16 px-1.5 py-0.5 bg-[#0d1117] text-slate-200 border border-[#30363d] focus:border-sky-500 rounded font-mono"
                              />
                              <span>Step:</span>
                              <input
                                type="number"
                                value={p.step ?? 0}
                                onChange={(e) => handleUpdatePitchItem({ ...p, step: Number(e.target.value) })}
                                className="w-16 px-1.5 py-0.5 bg-[#0d1117] text-slate-200 border border-[#30363d] focus:border-sky-500 rounded font-mono"
                              />
                            </div>
                          )}
                          {p.type === 'cents' && (
                            <div className="flex gap-2 items-center text-slate-300">
                              <span>Cent:</span>
                              <input
                                type="number"
                                step="0.1"
                                value={p.cents ?? 0}
                                onChange={(e) => handleUpdatePitchItem({ ...p, cents: Number(e.target.value) })}
                                className="w-24 px-1.5 py-0.5 bg-[#0d1117] text-slate-200 border border-[#30363d] focus:border-sky-500 rounded font-mono"
                              />
                            </div>
                          )}
                          {p.type === 'ratio' && (
                            <div className="flex gap-1 items-center text-slate-300">
                              <input
                                type="number"
                                value={p.numerator || 1}
                                onChange={(e) => handleUpdatePitchItem({ ...p, numerator: Number(e.target.value) })}
                                className="w-14 px-1.5 py-0.5 bg-[#0d1117] text-slate-200 border border-[#30363d] focus:border-sky-500 rounded font-mono"
                              />
                              <span>/</span>
                              <input
                                type="number"
                                value={p.denominator || 1}
                                onChange={(e) => handleUpdatePitchItem({ ...p, denominator: Number(e.target.value) })}
                                className="w-14 px-1.5 py-0.5 bg-[#0d1117] text-slate-200 border border-[#30363d] focus:border-sky-500 rounded font-mono"
                              />
                            </div>
                          )}
                          {p.type === 'frequency' && (
                            <div className="flex gap-2 items-center text-slate-300">
                              <span>Hz:</span>
                              <input
                                type="number"
                                step="0.1"
                                value={p.frequency ?? 440}
                                onChange={(e) => handleUpdatePitchItem({ ...p, frequency: Number(e.target.value) })}
                                className="w-24 px-1.5 py-0.5 bg-[#0d1117] text-slate-200 border border-[#30363d] focus:border-sky-500 rounded font-mono"
                              />
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 font-mono font-bold text-amber-300">
                          {formatFrequency(freq)}
                        </td>
                        <td className="p-2.5 text-right">
                          <button
                            onClick={() => handleDeletePitch(p.id)}
                            className="p-1 text-rose-400 hover:bg-rose-950/80 border border-transparent hover:border-rose-800 rounded transition-colors"
                            title="削除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- 3. レーン段数・配置設定 --- */}
        {activeTab === 'lanes' && (
          <div className="flex flex-col gap-4 bg-[#161b22] p-4 rounded-lg border border-[#30363d] shadow-sm">
            <div className="flex flex-wrap justify-between items-center pb-2 border-b border-[#30363d] gap-2">
              <h3 className="text-sm font-bold text-slate-100">
                レーン有効段数設定 (表示中: {displayHorizontalCount}横位置 x 白黒2)
              </h3>

              {/* 横列追加・削除ボタン */}
              <div className="flex items-center gap-2 bg-[#0d1117] px-3 py-1 rounded-lg border border-[#30363d]">
                <span className="text-xs text-slate-300 font-bold">横列数(x):</span>
                <span className="text-xs font-mono text-sky-400 font-bold">{displayHorizontalCount} 列</span>
                <button
                  onClick={handleRemoveHorizontalColumn}
                  className="px-2 py-0.5 bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-200 rounded text-xs font-bold transition-colors"
                >
                  - 列削除
                </button>
                <button
                  onClick={handleAddHorizontalColumn}
                  className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 border border-sky-400 text-white rounded text-xs font-bold transition-colors"
                >
                  + 列追加
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 bg-[#0d1117] p-3 rounded-lg border border-[#30363d]">
              <span className="text-xs font-bold text-slate-300 mr-1">全レーン段数一括適用:</span>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((d) => (
                <button
                  key={`all_d_${d}`}
                  onClick={() => setAllLanesActiveDepths(d)}
                  className="px-2.5 py-1 bg-[#21262d] hover:bg-sky-600 hover:text-white border border-[#30363d] text-xs font-bold font-mono rounded text-slate-200 transition-colors"
                >
                  全{d}段
                </button>
              ))}
            </div>

            <div
              className="grid gap-2.5"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(130px, 1fr))`,
              }}
            >
              {Array.from({ length: displayHorizontalCount }, (_, x) => {
                const whiteIdx = x * 2;
                const blackIdx = x * 2 + 1;
                const whiteLane = layout.lanes[whiteIdx];
                const blackLane = layout.lanes[blackIdx];

                const wDepths = whiteLane ? whiteLane.activeDepths : 0;
                const bDepths = blackLane ? blackLane.activeDepths : 0;

                return (
                  <div key={`lane_cfg_${x}`} className="bg-[#0d1117] p-2 rounded border border-[#30363d] flex flex-col gap-2">
                    <div className="font-bold text-center font-mono text-xs text-sky-400 border-b border-[#30363d] pb-1">
                      x = {x.toString(16).toUpperCase()}
                    </div>

                    {/* 白鍵設定 */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[10px] font-bold text-slate-300">
                        <span>白鍵段数:</span>
                        <div className="flex items-center gap-1 font-mono text-sky-400">
                          <button
                            onClick={() => {
                              const newLanes = [...layout.lanes];
                              newLanes[whiteIdx] = { ...newLanes[whiteIdx], activeDepths: Math.max(0, wDepths - 1) };
                              onUpdateLayout({ ...layout, lanes: newLanes });
                            }}
                            className="px-1 bg-[#21262d] hover:bg-slate-700 rounded text-rose-300"
                          >
                            -
                          </button>
                          <span>{wDepths}</span>
                          <button
                            onClick={() => {
                              const newLanes = [...layout.lanes];
                              newLanes[whiteIdx] = { ...newLanes[whiteIdx], activeDepths: Math.min(8, wDepths + 1) };
                              onUpdateLayout({ ...layout, lanes: newLanes });
                            }}
                            className="px-1 bg-[#21262d] hover:bg-slate-700 rounded text-sky-300"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="8"
                        value={wDepths}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const newLanes = [...layout.lanes];
                          newLanes[whiteIdx] = { ...newLanes[whiteIdx], activeDepths: val };
                          onUpdateLayout({ ...layout, lanes: newLanes });
                        }}
                        className="w-full h-1 bg-[#30363d] accent-sky-500 rounded appearance-none cursor-pointer"
                      />
                    </div>

                    {/* 黒鍵設定 */}
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center text-[10px] font-bold text-slate-300">
                        <span>黒鍵段数:</span>
                        <div className="flex items-center gap-1 font-mono text-amber-400">
                          <button
                            onClick={() => {
                              const newLanes = [...layout.lanes];
                              newLanes[blackIdx] = { ...newLanes[blackIdx], activeDepths: Math.max(0, bDepths - 1) };
                              onUpdateLayout({ ...layout, lanes: newLanes });
                            }}
                            className="px-1 bg-[#21262d] hover:bg-slate-700 rounded text-rose-300"
                          >
                            -
                          </button>
                          <span>{bDepths}</span>
                          <button
                            onClick={() => {
                              const newLanes = [...layout.lanes];
                              newLanes[blackIdx] = { ...newLanes[blackIdx], activeDepths: Math.min(8, bDepths + 1) };
                              onUpdateLayout({ ...layout, lanes: newLanes });
                            }}
                            className="px-1 bg-[#21262d] hover:bg-slate-700 rounded text-amber-300"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="8"
                        value={bDepths}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const newLanes = [...layout.lanes];
                          newLanes[blackIdx] = { ...newLanes[blackIdx], activeDepths: val };
                          onUpdateLayout({ ...layout, lanes: newLanes });
                        }}
                        className="w-full h-1 bg-[#30363d] accent-amber-500 rounded appearance-none cursor-pointer"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
