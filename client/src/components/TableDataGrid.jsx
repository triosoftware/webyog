import React, { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Eye,
  Filter,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  AlertTriangle,
  Key,
  X,
  Wrench,
  Pencil,
} from 'lucide-react';
import { dbApi } from '../services/api';

const OPERATORS = ['=', '!=', 'LIKE', 'NOT LIKE', '>', '>=', '<', '<=', 'IS NULL', 'IS NOT NULL'];

export default function TableDataGrid({ session, db, table, onOpenSchema, onLog }) {
  const [columns, setColumns] = useState([]);
  const [primaryKeys, setPrimaryKeys] = useState([]);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(false);

  // Pagination & Sorting
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [sortBy, setSortBy] = useState(null);
  const [sortDir, setSortDir] = useState('ASC');

  // Filter Builder
  const [showFilterBar, setShowFilterBar] = useState(false);
  const [filterDraft, setFilterDraft] = useState({ column: '', operator: '=', value: '' });
  const [activeFilters, setActiveFilters] = useState([]);

  // Inline Editing States
  const [pendingUpdates, setPendingUpdates] = useState({});
  const [pendingInserts, setPendingInserts] = useState([]);
  const [pendingDeletes, setPendingDeletes] = useState(new Set());

  // Touch-Friendly Selection & Cell Editor
  const [selectedCell, setSelectedCell] = useState(null); // { rowType, rowIdx, colName }
  const [editingCell, setEditingCell] = useState(null); // { rowType, rowIdx, colName, value }

  // Modal Preview SQL
  const [previewStatements, setPreviewStatements] = useState(null);
  const [committing, setCommitting] = useState(false);

  const resetPendingChanges = () => {
    setPendingUpdates({});
    setPendingInserts([]);
    setPendingDeletes(new Set());
    setSelectedCell(null);
    setEditingCell(null);
  };

  const fetchData = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await dbApi.getTableData(session.sessionId, db, table, {
        page,
        pageSize,
        sortBy,
        sortDir,
        filters: activeFilters,
      });
      setColumns(res.columns);
      setPrimaryKeys(res.primaryKeys);
      setRows(res.rows);
      setTotalRows(res.totalRows);
      resetPendingChanges();
      if (!filterDraft.column && res.columns.length > 0) {
        setFilterDraft((prev) => ({ ...prev, column: res.columns[0].name }));
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }, [session?.sessionId, db, table, page, pageSize, sortBy, sortDir, activeFilters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (colName) => {
    if (sortBy === colName) {
      if (sortDir === 'ASC') setSortDir('DESC');
      else {
        setSortBy(null);
        setSortDir('ASC');
      }
    } else {
      setSortBy(colName);
      setSortDir('ASC');
    }
    setPage(1);
  };

  const handleAddFilter = (e) => {
    e.preventDefault();
    if (!filterDraft.column) return;
    setActiveFilters((prev) => [...prev, { ...filterDraft }]);
    setFilterDraft((prev) => ({ ...prev, value: '' }));
    setPage(1);
  };

  const removeFilter = (idx) => {
    setActiveFilters((prev) => prev.filter((_, i) => i !== idx));
    setPage(1);
  };

  const canModify = primaryKeys.length > 0;

  // Pola Tap-to-Select, Tap-Again-to-Edit untuk layar sentuh
  const handleCellActivate = (rowType, rowIdx, colName, currentVal, isEditable) => {
    if (!isEditable) return;
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
    if (!selectedCell) return;
    const { rowType, rowIdx, colName } = selectedCell;
    if (rowType === 'new') {
      const val = pendingInserts[rowIdx]?.data?.[colName];
      setEditingCell({ rowType, rowIdx, colName, value: val === null || val === undefined ? '' : String(val) });
    } else {
      const rowUpdates = pendingUpdates[rowIdx] || {};
      const val = Object.prototype.hasOwnProperty.call(rowUpdates, colName)
        ? rowUpdates[colName]
        : rows[rowIdx]?.[colName];
      setEditingCell({ rowType, rowIdx, colName, value: val === null ? '' : String(val) });
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
      if (!c.extra.includes('auto_increment')) {
        blankData[c.name] = c.default ?? (c.nullable ? null : '');
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

  const buildChangesPayload = () => {
    const extractPk = (row) => {
      const pkObj = {};
      primaryKeys.forEach((pk) => {
        pkObj[pk] = row[pk];
      });
      return pkObj;
    };

    const updates = Object.entries(pendingUpdates)
      .filter(([rIdx]) => !pendingDeletes.has(Number(rIdx)))
      .map(([rIdx, changes]) => ({
        pkValues: extractPk(rows[Number(rIdx)]),
        changes,
      }));

    const inserts = pendingInserts.map((item) => item.data);

    const deletes = Array.from(pendingDeletes).map((rIdx) => ({
      pkValues: extractPk(rows[rIdx]),
    }));

    return { updates, inserts, deletes };
  };

  const handlePreviewSql = async () => {
    try {
      const changes = buildChangesPayload();
      const res = await dbApi.previewDml(session.sessionId, db, table, primaryKeys, changes);
      setPreviewStatements(res.statements);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCommitChanges = async () => {
    setCommitting(true);
    try {
      const changes = buildChangesPayload();
      const res = await dbApi.commitDml(session.sessionId, db, table, primaryKeys, changes);
      onLog?.({
        success: true,
        durationMs: 0,
        affectedRows: res.affectedRows,
        sqlSnippet: res.statements.join(' '),
      });
      setPreviewStatements(null);
      await fetchData();
    } catch (err) {
      alert(`Gagal menyimpan perubahan: ${err.message}`);
    } finally {
      setCommitting(false);
    }
  };

  const updatedCount = Object.keys(pendingUpdates).length;
  const insertedCount = pendingInserts.length;
  const deletedCount = pendingDeletes.size;
  const hasPendingChanges = updatedCount + insertedCount + deletedCount > 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <div className="h-full flex flex-col bg-slate-950 text-xs relative">
      {/* Top Data Toolbar (Responsive Wrap untuk Mobile) */}
      <div className="min-h-9 px-2.5 py-1.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={fetchData}
            title="Refresh Data"
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-slate-200"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          <button
            onClick={() => setShowFilterBar((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded border ${
              showFilterBar || activeFilters.length > 0
                ? 'bg-sky-950/60 border-sky-600 text-sky-300'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filter {activeFilters.length > 0 ? `(${activeFilters.length})` : ''}</span>
          </button>

          <button
            disabled={!canModify}
            onClick={handleAddRow}
            title={canModify ? 'Tambah baris baru' : 'Tabel membutuhkan Primary Key untuk edit'}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium rounded"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Row</span>
          </button>

          {/* Tombol Edit Cell eksplisit untuk layar sentuh saat sel dipilih */}
          {selectedCell && !editingCell && canModify && (
            <button
              onClick={openSelectedCellEditor}
              className="md:hidden flex items-center gap-1 px-2 py-1 bg-sky-600 text-white font-medium rounded"
            >
              <Pencil className="w-3 h-3" />
              <span>Edit Cell</span>
            </button>
          )}

          <button
            onClick={() => onOpenSchema?.(db, table)}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-slate-300"
          >
            <Wrench className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Alter Schema</span>
          </button>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center gap-1 text-slate-300">
          <span className="text-slate-400 mr-1 text-[11px]">
            <strong className="text-slate-200">{totalRows}</strong> rows
          </span>

          <button
            disabled={page <= 1}
            onClick={() => setPage(1)}
            className="p-1.5 sm:p-1 bg-slate-800 rounded disabled:opacity-40 hover:bg-slate-700"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="p-1.5 sm:p-1 bg-slate-800 rounded disabled:opacity-40 hover:bg-slate-700"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <span className="px-1.5 text-[11px]">
            <strong>{page}</strong>/{totalPages}
          </span>

          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="p-1.5 sm:p-1 bg-slate-800 rounded disabled:opacity-40 hover:bg-slate-700"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(totalPages)}
            className="p-1.5 sm:p-1 bg-slate-800 rounded disabled:opacity-40 hover:bg-slate-700"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>

          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="ml-1 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 outline-none text-xs!"
          >
            {[50, 100, 500, 1000].map((sz) => (
              <option key={sz} value={sz}>
                {sz}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Warning jika tidak punya Primary Key */}
      {!loading && columns.length > 0 && !canModify && (
        <div className="px-3 py-1.5 bg-amber-950/60 border-b border-amber-800/70 text-amber-300 flex items-center gap-2 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>
            Mode Read-Only: Tabel <strong>{table}</strong> tidak memiliki Primary Key.
          </span>
        </div>
      )}

      {/* WHERE Filter Builder Bar */}
      {showFilterBar && (
        <div className="p-2 bg-slate-900/90 border-b border-slate-800 space-y-2 shrink-0">
          <form onSubmit={handleAddFilter} className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sky-400 font-semibold">WHERE</span>
            <select
              value={filterDraft.column}
              onChange={(e) => setFilterDraft({ ...filterDraft, column: e.target.value })}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 outline-none text-xs!"
            >
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              value={filterDraft.operator}
              onChange={(e) => setFilterDraft({ ...filterDraft, operator: e.target.value })}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 outline-none font-mono text-xs!"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>

            {!['IS NULL', 'IS NOT NULL'].includes(filterDraft.operator) && (
              <input
                type="text"
                placeholder="Nilai filter..."
                value={filterDraft.value}
                onChange={(e) => setFilterDraft({ ...filterDraft, value: e.target.value })}
                className="flex-1 min-w-[140px] max-w-xs bg-slate-950 border border-slate-700 rounded px-2.5 py-1 outline-none focus:border-sky-500 text-xs!"
              />
            )}

            <button
              type="submit"
              className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded font-medium"
            >
              + Apply
            </button>
          </form>

          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeFilters.map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-800 border border-slate-700 rounded font-mono text-[11px]"
                >
                  <span className="text-sky-300">{f.column}</span>
                  <span className="text-amber-400">{f.operator}</span>
                  {!['IS NULL', 'IS NOT NULL'].includes(f.operator) && (
                    <span className="text-emerald-300">&apos;{f.value}&apos;</span>
                  )}
                  <button onClick={() => removeFilter(i)} className="text-slate-400 hover:text-red-400 p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main Editable Data Grid */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-slate-900 border-b border-slate-700">
            <tr>
              <th className="w-10 px-2 py-2 sm:py-1.5 text-center border-r border-slate-800 text-slate-500">
                Act
              </th>
              {columns.map((col) => (
                <th
                  key={col.name}
                  onClick={() => handleSort(col.name)}
                  className="px-3 py-2 sm:py-1.5 border-r border-slate-800 whitespace-nowrap cursor-pointer hover:bg-slate-800 select-none"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      {col.isPrimary && <Key className="w-3 h-3 text-amber-400 shrink-0" />}
                      <span className="font-semibold text-slate-200">{col.name}</span>
                      <span className="text-[10px] text-slate-500 font-normal">{col.type}</span>
                    </div>
                    {sortBy === col.name &&
                      (sortDir === 'ASC' ? (
                        <ArrowUp className="w-3 h-3 text-sky-400" />
                      ) : (
                        <ArrowDown className="w-3 h-3 text-sky-400" />
                      ))}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/70">
            {/* Baris Baru (Pending Inserts) */}
            {pendingInserts.map((ins, insIdx) => (
              <tr key={ins._tempId} className="bg-emerald-950/25">
                <td className="px-2 py-1.5 sm:py-1 text-center border-r border-slate-800">
                  <button
                    onClick={() =>
                      setPendingInserts((prev) => prev.filter((_, idx) => idx !== insIdx))
                    }
                    title="Batalkan baris baru"
                    className="p-1 text-red-400 hover:text-red-300"
                  >
                    <X className="w-3.5 h-3.5 mx-auto" />
                  </button>
                </td>
                {columns.map((col) => {
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
                      key={col.name}
                      onClick={() => handleCellActivate('new', insIdx, col.name, val ?? '', true)}
                      onDoubleClick={() =>
                        setEditingCell({
                          rowType: 'new',
                          rowIdx: insIdx,
                          colName: col.name,
                          value: val ?? '',
                        })
                      }
                      className={`px-3 py-1.5 sm:py-1 border-r border-slate-800 whitespace-nowrap max-w-[320px] truncate cursor-text touch-manipulation ${
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

            {/* Baris Existing dari Database */}
            {rows.map((row, rIdx) => {
              const isDeleted = pendingDeletes.has(rIdx);
              const rowUpdates = pendingUpdates[rIdx] || {};

              return (
                <tr
                  key={rIdx}
                  className={
                    isDeleted
                      ? 'bg-red-950/35 line-through text-red-400 opacity-75'
                      : 'hover:bg-slate-900/90'
                  }
                >
                  <td className="px-2 py-1.5 sm:py-1 text-center border-r border-slate-800/70">
                    {canModify && (
                      <button
                        onClick={() => toggleDeleteExistingRow(rIdx)}
                        title={isDeleted ? 'Batalkan hapus' : 'Tandai baris untuk dihapus'}
                        className={`p-1 ${
                          isDeleted ? 'text-amber-400' : 'text-slate-500 hover:text-red-400'
                        }`}
                      >
                        <Trash2 className="w-3.5 h-3.5 mx-auto" />
                      </button>
                    )}
                  </td>

                  {columns.map((col) => {
                    const isDirty = Object.prototype.hasOwnProperty.call(rowUpdates, col.name);
                    const displayVal = isDirty ? rowUpdates[col.name] : row[col.name];
                    const isEditable = canModify && !isDeleted;
                    const isSelected =
                      selectedCell?.rowType === 'existing' &&
                      selectedCell?.rowIdx === rIdx &&
                      selectedCell?.colName === col.name;
                    const isEditing =
                      editingCell?.rowType === 'existing' &&
                      editingCell?.rowIdx === rIdx &&
                      editingCell?.colName === col.name;

                    return (
                      <td
                        key={col.name}
                        onClick={() =>
                          handleCellActivate('existing', rIdx, col.name, displayVal, isEditable)
                        }
                        onDoubleClick={() => {
                          if (!isEditable) return;
                          setEditingCell({
                            rowType: 'existing',
                            rowIdx: rIdx,
                            colName: col.name,
                            value: displayVal === null ? '' : String(displayVal),
                          });
                        }}
                        className={`px-3 py-1.5 sm:py-1 border-r border-slate-800/70 whitespace-nowrap max-w-[320px] truncate touch-manipulation ${
                          isDirty ? 'bg-amber-950/40 text-amber-200' : 'text-slate-300'
                        } ${isEditable ? 'cursor-text' : ''} ${
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

      {/* Floating Commit Bar (Responsive Wrap untuk Mobile) */}
      {hasPendingChanges && (
        <div className="min-h-10 px-3 py-2 bg-slate-900 border-t border-amber-500/50 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 text-xs">
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
              <span>Preview</span>
            </button>

            <button
              disabled={committing}
              onClick={handleCommitChanges}
              className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{committing ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal Preview SQL Sebelum Commit */}
      {previewStatements && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
          <div className="w-full max-w-2xl max-h-[85dvh] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
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
