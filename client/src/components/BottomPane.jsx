import React, { useState, useEffect } from 'react';
import {
  Table2,
  Terminal,
  Activity,
  Download,
  CheckCircle2,
  XCircle,
  Trash2,
  Plus,
  Save,
  RotateCcw,
  Eye,
  Key,
  Lock,
  Pencil,
  X,
} from 'lucide-react';
import { dbApi } from '../services/api';

function DataTable({ resultSet, session, isExplain = false, onRefreshQuery, onLog }) {
  const [editMode, setEditMode] = useState('readonly'); // 'readonly' | 'edit'
  const [pendingUpdates, setPendingUpdates] = useState({}); // { [rowIdx]: { [resultColName]: newVal } }
  const [pendingInserts, setPendingInserts] = useState([]); // Array<{ _tempId, data: { [resultColName]: val } }>
  const [pendingDeletes, setPendingDeletes] = useState(new Set());
  const [selectedCell, setSelectedCell] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [previewStatements, setPreviewStatements] = useState(null);
  const [committing, setCommitting] = useState(false);

  const editMeta = resultSet?.editMeta || { canEdit: false, reason: 'Mode Read Only' };
  const canSwitchToEdit = !isExplain && Boolean(session) && Boolean(editMeta.canEdit);
  const isEditingEnabled = editMode === 'edit' && canSwitchToEdit;

  const resetPendingChanges = () => {
    setPendingUpdates({});
    setPendingInserts([]);
    setPendingDeletes(new Set());
    setSelectedCell(null);
    setEditingCell(null);
  };

  // Reset kembali ke Read Only setiap kali hasil query baru dimuat
  useEffect(() => {
    setEditMode('readonly');
    resetPendingChanges();
  }, [resultSet]);

  if (!resultSet || !resultSet.columns) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-500">
        Tidak ada data tabular untuk ditampilkan.
      </div>
    );
  }

  const { columns, rows } = resultSet;

  const handleModeChange = (nextMode) => {
    if (nextMode === 'readonly') {
      const hasChanges =
        Object.keys(pendingUpdates).length + pendingInserts.length + pendingDeletes.size > 0;
      if (
        hasChanges &&
        !window.confirm('Beralih ke Read Only akan membatalkan perubahan yang belum disimpan. Lanjutkan?')
      ) {
        return;
      }
      resetPendingChanges();
    }
    setEditMode(nextMode);
  };

  // Pola Tap-to-Select, Tap-Again-to-Edit (ramah layar sentuh & desktop)
  const handleCellActivate = (rowType, rowIdx, colName, currentVal) => {
    if (!isEditingEnabled) return;
    const isAlreadySelected =
      selectedCell?.rowType === rowType &&
      selectedCell?.rowIdx === rowIdx &&
      selectedCell?.colName === colName;

    if (isAlreadySelected) {
      setEditingCell({
        rowType,
        rowIdx,
        colName,
        value: currentVal === null ? '' : String(currentVal),
      });
    } else {
      setSelectedCell({ rowType, rowIdx, colName });
    }
  };

  const openSelectedCellEditor = () => {
    if (!selectedCell || !isEditingEnabled) return;
    const { rowType, rowIdx, colName } = selectedCell;
    if (rowType === 'new') {
      const val = pendingInserts[rowIdx]?.data?.[colName];
      setEditingCell({
        rowType,
        rowIdx,
        colName,
        value: val === null || val === undefined ? '' : String(val),
      });
    } else {
      const rowUpdates = pendingUpdates[rowIdx] || {};
      const val = Object.prototype.hasOwnProperty.call(rowUpdates, colName)
        ? rowUpdates[colName]
        : rows[rowIdx]?.[colName];
      setEditingCell({
        rowType,
        rowIdx,
        colName,
        value: val === null ? '' : String(val),
      });
    }
  };

  const commitCellEdit = (rowType, rowIdx, colName, newValue) => {
    if (rowType === 'existing') {
      const originalVal = rows[rowIdx][colName];
      setPendingUpdates((prev) => {
        const rowPatch = { ...(prev[rowIdx] || {}) };
        if (newValue === originalVal) {
          delete rowPatch[colName];
        } else {
          rowPatch[colName] = newValue;
        }
        const next = { ...prev };
        if (Object.keys(rowPatch).length === 0) delete next[rowIdx];
        else next[rowIdx] = rowPatch;
        return next;
      });
    } else {
      setPendingInserts((prev) =>
        prev.map((item, idx) =>
          idx === rowIdx ? { ...item, data: { ...item.data, [colName]: newValue } } : item
        )
      );
    }
    setEditingCell(null);
  };

  const handleAddRow = () => {
    const blankData = {};
    columns.forEach((c) => {
      if (!c.autoIncrement && c.orgTable === editMeta.table) {
        blankData[c.name] = c.nullable ? null : '';
      }
    });
    setPendingInserts((prev) => [...prev, { _tempId: crypto.randomUUID(), data: blankData }]);
  };

  const toggleDeleteExistingRow = (rowIdx) => {
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      return next;
    });
  };

  // Pemetaan nama kolom hasil query (bisa berupa alias AS) ke nama kolom fisik DB
  const buildChangesPayload = () => {
    const colToDbCol = new Map();
    columns.forEach((c) => {
      if (c.orgTable === editMeta.table && c.orgName) {
        colToDbCol.set(c.name, c.orgName);
      }
    });

    const extractPk = (row) => {
      const pkObj = {};
      editMeta.primaryKeys.forEach(({ resultKey, dbColumn }) => {
        pkObj[dbColumn] = row[resultKey];
      });
      return pkObj;
    };

    const updates = Object.entries(pendingUpdates)
      .filter(([rIdx]) => !pendingDeletes.has(Number(rIdx)))
      .map(([rIdx, changes]) => {
        const mappedChanges = {};
        Object.entries(changes).forEach(([resCol, val]) => {
          const dbCol = colToDbCol.get(resCol);
          if (dbCol) mappedChanges[dbCol] = val;
        });
        return {
          pkValues: extractPk(rows[Number(rIdx)]),
          changes: mappedChanges,
        };
      })
      .filter((u) => Object.keys(u.changes).length > 0);

    const inserts = pendingInserts.map((item) => {
      const mappedRow = {};
      Object.entries(item.data).forEach(([resCol, val]) => {
        const dbCol = colToDbCol.get(resCol);
        if (dbCol && val !== undefined) mappedRow[dbCol] = val;
      });
      return mappedRow;
    });

    const deletes = Array.from(pendingDeletes).map((rIdx) => ({
      pkValues: extractPk(rows[rIdx]),
    }));

    const pkDbColumnNames = editMeta.primaryKeys.map((pk) => pk.dbColumn);
    return { pkDbColumnNames, changes: { updates, inserts, deletes } };
  };

  const handlePreviewSql = async () => {
    try {
      const { pkDbColumnNames, changes } = buildChangesPayload();
      const res = await dbApi.previewDml(
        session.sessionId,
        editMeta.db,
        editMeta.table,
        pkDbColumnNames,
        changes
      );
      setPreviewStatements(res.statements);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCommitChanges = async () => {
    setCommitting(true);
    try {
      const { pkDbColumnNames, changes } = buildChangesPayload();
      const res = await dbApi.commitDml(
        session.sessionId,
        editMeta.db,
        editMeta.table,
        pkDbColumnNames,
        changes
      );
      onLog?.({
        success: true,
        durationMs: 0,
        affectedRows: res.affectedRows,
        sqlSnippet: res.statements.join(' '),
      });
      setPreviewStatements(null);
      resetPendingChanges();
      onRefreshQuery?.();
    } catch (err) {
      alert(`Gagal menyimpan perubahan: ${err.message}`);
    } finally {
      setCommitting(false);
    }
  };

  const exportFile = (format) => {
    let content = '';
    let mime = 'text/plain;charset=utf-8;';
    const ext = format;

    if (format === 'json') {
      content = JSON.stringify(rows, null, 2);
      mime = 'application/json;charset=utf-8;';
    } else {
      const headers = columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(',');
      const lines = rows.map((row) =>
        columns
          .map((c) => {
            const val = row[c.name];
            if (val === null || val === undefined) return '';
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return `"${str.replace(/"/g, '""')}"`;
          })
          .join(',')
      );
      content = [headers, ...lines].join('\n');
      mime = 'text/csv;charset=utf-8;';
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query_result_${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updatedCount = Object.keys(pendingUpdates).length;
  const insertedCount = pendingInserts.length;
  const deletedCount = pendingDeletes.size;
  const hasPendingChanges = updatedCount + insertedCount + deletedCount > 0;

  return (
    <div className="h-full flex flex-col relative">
      {/* Result Toolbar dengan Dropdown Read Only / Edit */}
      <div className="min-h-8 px-2.5 py-1 bg-slate-900/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span>
            <strong className="text-slate-200">{rows.length}</strong> rows
          </span>

          {/* Dropdown Mode Edit / Read Only */}
          {!isExplain && (
            <div className="flex items-center gap-1.5">
              <div
                title={!canSwitchToEdit ? editMeta.reason : `Target Edit: ${editMeta.db}.${editMeta.table}`}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                  isEditingEnabled
                    ? 'bg-amber-950/50 border-amber-600/70 text-amber-300'
                    : 'bg-slate-950 border-slate-700 text-slate-300'
                }`}
              >
                {isEditingEnabled ? (
                  <Pencil className="w-3 h-3 text-amber-400 shrink-0" />
                ) : (
                  <Lock className="w-3 h-3 text-slate-500 shrink-0" />
                )}
                <select
                  value={isEditingEnabled ? 'edit' : 'readonly'}
                  onChange={(e) => handleModeChange(e.target.value)}
                  className="bg-transparent outline-none cursor-pointer font-medium text-[11px]!"
                >
                  <option value="readonly" className="bg-slate-900 text-slate-200">
                    Read Only
                  </option>
                  <option
                    value="edit"
                    disabled={!canSwitchToEdit}
                    className="bg-slate-900 text-amber-300 disabled:text-slate-600"
                  >
                    Edit {canSwitchToEdit ? `(${editMeta.table})` : '(Unavailable)'}
                  </option>
                </select>
              </div>

              {!canSwitchToEdit && editMeta.reason && (
                <span className="hidden lg:inline text-[10px] text-slate-500 italic">
                  {editMeta.reason}
                </span>
              )}
            </div>
          )}

          {/* Tombol Tambah Baris & Edit Cell saat mode Edit aktif */}
          {isEditingEnabled && (
            <>
              <button
                onClick={handleAddRow}
                className="flex items-center gap-1 px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded"
              >
                <Plus className="w-3 h-3" />
                <span>Add Row</span>
              </button>

              {selectedCell && !editingCell && (
                <button
                  onClick={openSelectedCellEditor}
                  className="md:hidden flex items-center gap-1 px-2 py-0.5 bg-sky-600 text-white font-medium rounded"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Edit Cell</span>
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => exportFile('csv')}
            className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
          >
            <Download className="w-3 h-3 text-emerald-400" /> CSV
          </button>
          <button
            onClick={() => exportFile('json')}
            className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded"
          >
            <Download className="w-3 h-3 text-sky-400" /> JSON
          </button>
        </div>
      </div>

      {/* Scrollable Grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-700 shadow-xs">
            <tr>
              <th className="w-10 px-2 py-1.5 text-center text-[10px] text-slate-500 border-r border-slate-800 select-none">
                {isEditingEnabled ? 'Act' : '#'}
              </th>
              {columns.map((col, idx) => (
                <th
                  key={`${col.name}-${idx}`}
                  className="px-3 py-1.5 font-semibold text-slate-200 border-r border-slate-800 whitespace-nowrap"
                >
                  <div className="flex items-center gap-1.5">
                    {col.isPrimary && <Key className="w-3 h-3 text-amber-400 shrink-0" />}
                    <span>{col.name}</span>
                    <span className="text-[10px] font-normal text-slate-500">{col.type}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/70">
            {/* Baris Baru (Hanya tampil saat mode Edit aktif) */}
            {isEditingEnabled &&
              pendingInserts.map((ins, insIdx) => (
                <tr key={ins._tempId} className="bg-emerald-950/25">
                  <td className="px-2 py-1 text-center border-r border-slate-800">
                    <button
                      onClick={() =>
                        setPendingInserts((prev) => prev.filter((_, idx) => idx !== insIdx))
                      }
                      title="Batalkan baris baru"
                      className="p-0.5 text-red-400 hover:text-red-300"
                    >
                      <X className="w-3.5 h-3.5 mx-auto" />
                    </button>
                  </td>
                  {columns.map((col, cIdx) => {
                    const isColEditable = col.orgTable === editMeta.table;
                    const isSelected =
                      selectedCell?.rowType === 'new' &&
                      selectedCell?.rowIdx === insIdx &&
                      selectedCell?.colName === col.name;
                    const isEditing =
                      editingCell?.rowType === 'new' &&
                      editingCell?.rowIdx === insIdx &&
                      editingCell?.colName === col.name;
                    const val = ins.data[col.name];

                    return (
                      <td
                        key={`${ins._tempId}-${cIdx}`}
                        onClick={() =>
                          isColEditable && handleCellActivate('new', insIdx, col.name, val ?? '')
                        }
                        onDoubleClick={() => {
                          if (!isColEditable) return;
                          setEditingCell({
                            rowType: 'new',
                            rowIdx: insIdx,
                            colName: col.name,
                            value: val ?? '',
                          });
                        }}
                        className={`px-3 py-1 border-r border-slate-800 whitespace-nowrap max-w-[360px] truncate touch-manipulation ${
                          isColEditable ? 'cursor-text' : 'opacity-50'
                        } ${
                          isSelected && !isEditing ? 'ring-1 ring-inset ring-sky-500 bg-sky-950/30' : ''
                        }`}
                      >
                        {isEditing ? (
                          <div className="flex items-center gap-1 min-w-[130px]">
                            <input
                              autoFocus
                              value={editingCell.value}
                              onChange={(e) =>
                                setEditingCell({ ...editingCell, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter')
                                  commitCellEdit('new', insIdx, col.name, editingCell.value);
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                              onBlur={() =>
                                commitCellEdit('new', insIdx, col.name, editingCell.value)
                              }
                              className="w-full bg-slate-900 border border-sky-500 px-1.5 py-0.5 text-white outline-none text-xs!"
                            />
                            {col.nullable && (
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  commitCellEdit('new', insIdx, col.name, null);
                                }}
                                className="px-1.5 py-0.5 bg-slate-700 text-[10px] rounded text-amber-300 shrink-0"
                              >
                                NULL
                              </button>
                            )}
                          </div>
                        ) : val === undefined ? (
                          <span className="text-[10px] italic text-emerald-500/70">(AUTO)</span>
                        ) : val === null ? (
                          <span className="px-1.5 py-0.2 text-[10px] italic rounded bg-slate-800 text-slate-400">
                            NULL
                          </span>
                        ) : (
                          <span className="text-emerald-200">{String(val)}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

            {/* Baris Hasil Query */}
            {rows.map((row, rIdx) => {
              const isDeleted = isEditingEnabled && pendingDeletes.has(rIdx);
              const rowUpdates = isEditingEnabled ? pendingUpdates[rIdx] || {} : {};

              return (
                <tr
                  key={rIdx}
                  className={
                    isDeleted
                      ? 'bg-red-950/35 line-through text-red-400 opacity-75'
                      : 'hover:bg-slate-900/90'
                  }
                >
                  <td className="px-2 py-1 text-center text-[10px] text-slate-500 border-r border-slate-800/70 select-none bg-slate-950/50">
                    {isEditingEnabled ? (
                      <button
                        onClick={() => toggleDeleteExistingRow(rIdx)}
                        title={isDeleted ? 'Batalkan hapus' : 'Tandai baris untuk dihapus'}
                        className={`p-0.5 ${
                          isDeleted ? 'text-amber-400' : 'text-slate-500 hover:text-red-400'
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5 mx-auto" />
                      </button>
                    ) : (
                      rIdx + 1
                    )}
                  </td>

                  {columns.map((col, cIdx) => {
                    const isDirty = Object.prototype.hasOwnProperty.call(rowUpdates, col.name);
                    const displayVal = isDirty ? rowUpdates[col.name] : row[col.name];
                    const isCellEditable =
                      isEditingEnabled && !isDeleted && col.orgTable === editMeta.table;

                    const isSelected =
                      isCellEditable &&
                      selectedCell?.rowType === 'existing' &&
                      selectedCell?.rowIdx === rIdx &&
                      selectedCell?.colName === col.name;
                    const isEditing =
                      isCellEditable &&
                      editingCell?.rowType === 'existing' &&
                      editingCell?.rowIdx === rIdx &&
                      editingCell?.colName === col.name;

                    return (
                      <td
                        key={`${rIdx}-${cIdx}`}
                        onClick={() => {
                          if (!isCellEditable) return;
                          handleCellActivate('existing', rIdx, col.name, displayVal);
                        }}
                        onDoubleClick={() => {
                          if (!isCellEditable) return;
                          setEditingCell({
                            rowType: 'existing',
                            rowIdx: rIdx,
                            colName: col.name,
                            value: displayVal === null ? '' : String(displayVal),
                          });
                        }}
                        className={`px-3 py-1 border-r border-slate-800/70 whitespace-nowrap max-w-[360px] truncate touch-manipulation ${
                          isDirty ? 'bg-amber-950/40 text-amber-200' : 'text-slate-300'
                        } ${isCellEditable ? 'cursor-text' : ''} ${
                          isSelected && !isEditing ? 'ring-1 ring-inset ring-sky-500 bg-sky-950/30' : ''
                        }`}
                        title={displayVal === null ? 'NULL' : String(displayVal)}
                      >
                        {isEditing ? (
                          <div className="flex items-center gap-1 min-w-[130px]">
                            <input
                              autoFocus
                              value={editingCell.value}
                              onChange={(e) =>
                                setEditingCell({ ...editingCell, value: e.target.value })
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter')
                                  commitCellEdit('existing', rIdx, col.name, editingCell.value);
                                if (e.key === 'Escape') setEditingCell(null);
                              }}
                              onBlur={() =>
                                commitCellEdit('existing', rIdx, col.name, editingCell.value)
                              }
                              className="w-full bg-slate-900 border border-sky-500 px-1.5 py-0.5 text-white outline-none text-xs!"
                            />
                            {col.nullable && (
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  commitCellEdit('existing', rIdx, col.name, null);
                                }}
                                className="px-1.5 py-0.5 bg-slate-700 text-[10px] rounded text-amber-300 shrink-0"
                              >
                                NULL
                              </button>
                            )}
                          </div>
                        ) : displayVal === null ? (
                          <span className="px-1.5 py-0.2 text-[10px] italic rounded bg-slate-800 text-slate-500">
                            NULL
                          </span>
                        ) : typeof displayVal === 'object' ? (
                          JSON.stringify(displayVal)
                        ) : (
                          String(displayVal)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Floating Commit Bar saat ada perubahan tertunda di mode Edit */}
      {isEditingEnabled && hasPendingChanges && (
        <div className="min-h-9 px-3 py-1.5 bg-slate-900 border-t border-amber-500/50 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-amber-400">Pending:</span>
            {updatedCount > 0 && <span className="text-amber-300">{updatedCount} upd</span>}
            {insertedCount > 0 && <span className="text-emerald-400">{insertedCount} ins</span>}
            {deletedCount > 0 && <span className="text-red-400">{deletedCount} del</span>}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={resetPendingChanges}
              className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Discard</span>
            </button>

            <button
              onClick={handlePreviewSql}
              className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-sky-400 border border-sky-500/40 rounded"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview SQL</span>
            </button>

            <button
              disabled={committing}
              onClick={handleCommitChanges}
              className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{committing ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal Preview SQL */}
      {previewStatements && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
          <div className="w-full max-w-2xl max-h-[85dvh] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden text-xs">
            <div className="px-4 py-2.5 bg-slate-800 border-b border-slate-700 flex items-center justify-between shrink-0">
              <span className="font-semibold text-slate-200">
                SQL Preview ({previewStatements.length} statements)
              </span>
              <button onClick={() => setPreviewStatements(null)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="p-4 flex-1 overflow-auto bg-slate-950 font-mono text-xs text-emerald-300 whitespace-pre-wrap">
              {previewStatements.join('\n')}
            </pre>
            <div className="px-4 py-2.5 bg-slate-800 border-t border-slate-700 flex justify-end gap-2 shrink-0">
              <button
                onClick={() => setPreviewStatements(null)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-200"
              >
                Close
              </button>
              <button
                disabled={committing}
                onClick={handleCommitChanges}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded"
              >
                Execute & Commit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BottomPane({
  session,
  results,
  explainResult,
  logs,
  onClearLogs,
  onRefreshQuery,
  onLog,
}) {
  const resultSets = (results || []).filter((r) => r.type === 'resultset');
  const [activeSubTab, setActiveSubTab] = useState('messages');

  useEffect(() => {
    if (resultSets.length > 0) {
      setActiveSubTab('result-0');
    } else if (logs.length > 0) {
      setActiveSubTab('messages');
    }
  }, [results, logs.length]);

  useEffect(() => {
    if (explainResult) {
      setActiveSubTab('explain');
    }
  }, [explainResult]);

  return (
    <div className="h-full flex flex-col bg-slate-950 border-t border-slate-800">
      {/* Sub-Tabs Navigation */}
      <div className="h-8 px-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0 text-xs">
        <div className="flex items-center gap-1 overflow-x-auto">
          {resultSets.map((_, idx) => {
            const tabKey = `result-${idx}`;
            return (
              <button
                key={tabKey}
                onClick={() => setActiveSubTab(tabKey)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t border-b-2 transition shrink-0 ${
                  activeSubTab === tabKey
                    ? 'bg-slate-950 text-sky-400 border-sky-400 font-medium'
                    : 'text-slate-400 border-transparent hover:text-slate-200'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" />
                <span>Result {resultSets.length > 1 ? idx + 1 : ''}</span>
              </button>
            );
          })}

          <button
            onClick={() => setActiveSubTab('messages')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t border-b-2 transition shrink-0 ${
              activeSubTab === 'messages'
                ? 'bg-slate-950 text-emerald-400 border-emerald-400 font-medium'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Messages ({logs.length})</span>
          </button>

          {explainResult && (
            <button
              onClick={() => setActiveSubTab('explain')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t border-b-2 transition shrink-0 ${
                activeSubTab === 'explain'
                  ? 'bg-slate-950 text-amber-400 border-amber-400 font-medium'
                  : 'text-slate-400 border-transparent hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Explain Plan</span>
            </button>
          )}
        </div>

        {activeSubTab === 'messages' && logs.length > 0 && (
          <button
            onClick={onClearLogs}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-slate-400 hover:text-red-400 shrink-0"
          >
            <Trash2 className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {activeSubTab.startsWith('result-') && (
          <DataTable
            resultSet={resultSets[Number(activeSubTab.split('-')[1])]}
            session={session}
            onRefreshQuery={onRefreshQuery}
            onLog={onLog}
          />
        )}

        {activeSubTab === 'explain' && <DataTable resultSet={explainResult} isExplain />}

        {activeSubTab === 'messages' && (
          <div className="h-full overflow-y-auto p-2.5 space-y-1.5 font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-slate-500">Siap mengeksekusi query...</p>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className={`p-2 rounded border ${
                    log.success
                      ? 'bg-slate-900/60 border-slate-800 text-slate-300'
                      : 'bg-red-950/30 border-red-900/60 text-red-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {log.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-400" />
                      )}
                      <span>[{log.timestamp}]</span>
                      {log.success ? (
                        <span className="text-emerald-400">
                          OK — {log.affectedRows} row(s) affected
                        </span>
                      ) : (
                        <span className="text-red-400">
                          ERROR {log.errno} ({log.code})
                        </span>
                      )}
                    </span>
                    <span className="text-slate-400">Execution Time: {log.durationMs} ms</span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">{log.sqlSnippet}</div>
                  {!log.success && (
                    <div className="mt-1 text-xs text-red-300">{log.errorMessage}</div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
