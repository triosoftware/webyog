import React, { useState, useEffect } from 'react';
import { Download, Upload, Database, CheckCircle2, AlertCircle, X, Loader2 } from 'lucide-react';
import { dbApi } from '../services/api';

export default function ExportImportModal({ isOpen, onClose, session, databases, defaultDb, onCompleted }) {
  const [tab, setTab] = useState('export');
  const [selectedDb, setSelectedDb] = useState(defaultDb || databases[0] || '');

  // State Export
  const [availableTables, setAvailableTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [exportMode, setExportMode] = useState('structure_and_data');
  const [dropTable, setDropTable] = useState(true);
  const [includeRoutines, setIncludeRoutines] = useState(true);

  // State Import
  const [sqlFile, setSqlFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (defaultDb) setSelectedDb(defaultDb);
    else if (databases.length > 0 && !selectedDb) setSelectedDb(databases[0]);
  }, [defaultDb, databases, isOpen]);

  useEffect(() => {
    if (!isOpen || !session || !selectedDb) return;
    dbApi
      .getDatabaseObjects(session.sessionId, selectedDb)
      .then((res) => {
        const tbls = res.objects.tables || [];
        setAvailableTables(tbls);
        setSelectedTables(tbls);
      })
      .catch(() => setAvailableTables([]));
  }, [isOpen, session?.sessionId, selectedDb]);

  if (!isOpen || !session) return null;

  const toggleTable = (tbl) => {
    setSelectedTables((prev) =>
      prev.includes(tbl) ? prev.filter((t) => t !== tbl) : [...prev, tbl]
    );
  };

  const handleStartExport = () => {
    if (!selectedDb) return;
    const url = dbApi.getExportDownloadUrl(session.sessionId, selectedDb, {
      mode: exportMode,
      dropTable,
      includeRoutines,
      tables: selectedTables.length === availableTables.length ? [] : selectedTables,
    });
    window.open(url, '_blank');
  };

  const handleStartImport = async (e) => {
    e.preventDefault();
    if (!sqlFile) return;
    setImporting(true);
    setStatus(null);
    try {
      const res = await dbApi.importSqlFile(session.sessionId, sqlFile, selectedDb || null);
      setStatus({
        type: 'success',
        message: `Impor selesai! ${res.executedStatements} statement dieksekusi dalam ${res.elapsedMs} ms.`,
      });
      setSqlFile(null);
      onCompleted?.();
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4">
      <div className="w-full max-w-2xl max-h-[90dvh] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl text-slate-200 overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Database className="w-4 h-4 text-sky-400" />
            <span>Backup & Restore (SQL Dump)</span>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950 px-3 sm:px-4 pt-2 gap-2 shrink-0 overflow-x-auto">
          <button
            onClick={() => {
              setTab('export');
              setStatus(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t border-t border-x shrink-0 ${
              tab === 'export'
                ? 'bg-slate-900 text-sky-400 border-slate-700 font-medium'
                : 'text-slate-400 border-transparent'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export SQL Dump</span>
          </button>

          <button
            onClick={() => {
              setTab('import');
              setStatus(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t border-t border-x shrink-0 ${
              tab === 'import'
                ? 'bg-slate-900 text-emerald-400 border-slate-700 font-medium'
                : 'text-slate-400 border-transparent'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import .SQL File</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
          {/* Database Target Selector */}
          <div>
            <label className="block text-slate-400 mb-1">Target Database</label>
            <select
              value={selectedDb}
              onChange={(e) => setSelectedDb(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
            >
              {tab === 'import' && <option value="">(Gunakan pernyataan USE di dalam file .sql)</option>}
              {databases.map((db) => (
                <option key={db} value={db}>
                  {db}
                </option>
              ))}
            </select>
          </div>

          {tab === 'export' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Dump Options</label>
                  <select
                    value={exportMode}
                    onChange={(e) => setExportMode(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
                  >
                    <option value="structure_and_data">Structure and Data</option>
                    <option value="structure_only">Structure Only (DDL)</option>
                    <option value="data_only">Data Only (INSERTs)</option>
                  </select>
                </div>

                <div className="space-y-2 sm:pt-5">
                  <label className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={dropTable}
                      onChange={(e) => setDropTable(e.target.checked)}
                    />
                    <span>Include DROP TABLE IF EXISTS</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      checked={includeRoutines}
                      onChange={(e) => setIncludeRoutines(e.target.checked)}
                    />
                    <span>Include Views & Triggers</span>
                  </label>
                </div>
              </div>

              {/* Pemilihan Tabel */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-slate-400">
                    Pilih Tabel ({selectedTables.length} / {availableTables.length})
                  </span>
                  <div className="space-x-3">
                    <button
                      type="button"
                      onClick={() => setSelectedTables(availableTables)}
                      className="text-sky-400 hover:underline"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedTables([])}
                      className="text-slate-400 hover:underline"
                    >
                      Deselect All
                    </button>
                  </div>
                </div>
                <div className="h-40 overflow-y-auto bg-slate-950 border border-slate-800 rounded p-2 grid grid-cols-1 sm:grid-cols-2 gap-1 font-mono">
                  {availableTables.map((tbl) => (
                    <label
                      key={tbl}
                      className="flex items-center gap-2 px-2 py-1.5 sm:py-0.5 hover:bg-slate-900 rounded cursor-pointer truncate"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTables.includes(tbl)}
                        onChange={() => toggleTable(tbl)}
                      />
                      <span className="truncate">{tbl}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-800">
                <button
                  disabled={!selectedDb || selectedTables.length === 0}
                  onClick={handleStartExport}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 sm:py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-medium rounded"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download .SQL Dump</span>
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handleStartImport} className="space-y-4">
              <div className="border-2 border-dashed border-slate-700 rounded-lg p-4 sm:p-6 text-center bg-slate-950">
                <input
                  type="file"
                  accept=".sql,.txt"
                  onChange={(e) => setSqlFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-slate-800 file:text-sky-400 hover:file:bg-slate-700 cursor-pointer"
                />
                <p className="mt-2 text-[11px] text-slate-500">
                  Mendukung file .sql berukuran besar via Node.js Stream serta blok DELIMITER untuk Trigger & Stored Procedure.
                </p>
              </div>

              {status && (
                <div
                  className={`p-2.5 rounded border flex items-center gap-2 ${
                    status.type === 'success'
                      ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                      : 'bg-red-950/60 border-red-800 text-red-300'
                  }`}
                >
                  {status.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  <span>{status.message}</span>
                </div>
              )}

              <div className="flex justify-end pt-2 border-t border-slate-800">
                <button
                  type="submit"
                  disabled={!sqlFile || importing}
                  className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 sm:py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium rounded"
                >
                  {importing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>{importing ? 'Executing Stream...' : 'Execute SQL File'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
