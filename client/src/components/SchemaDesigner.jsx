import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Eye, Key, Link2, Columns, X } from 'lucide-react';
import { dbApi } from '../services/api';

const DATA_TYPES = [
  'INT', 'BIGINT', 'TINYINT', 'SMALLINT', 'DECIMAL', 'FLOAT', 'DOUBLE',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME',
  'BOOLEAN', 'JSON', 'ENUM', 'BLOB',
];

const FK_ACTIONS = ['RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION'];

const newEmptyColumn = () => ({
  id: crypto.randomUUID(),
  name: '',
  type: 'VARCHAR',
  length: '255',
  defaultValue: '',
  primaryKey: false,
  notNull: false,
  unsigned: false,
  autoIncrement: false,
  comment: '',
  _dirty: true,
});

export default function SchemaDesigner({ session, db, initialTable = '', mode = 'create', onSaved }) {
  const [tableName, setTableName] = useState(initialTable);
  const [activeSection, setActiveSection] = useState('columns'); // columns | indexes | foreignKeys
  const [columns, setColumns] = useState([
    {
      id: crypto.randomUUID(),
      name: 'id',
      type: 'INT',
      length: '',
      defaultValue: '',
      primaryKey: true,
      notNull: true,
      unsigned: true,
      autoIncrement: true,
      comment: '',
      _dirty: true,
    },
  ]);
  const [originalColumns, setOriginalColumns] = useState([]);
  const [indexes, setIndexes] = useState([]);
  const [droppedIndexes, setDroppedIndexes] = useState([]);
  const [foreignKeys, setForeignKeys] = useState([]);
  const [droppedForeignKeys, setDroppedForeignKeys] = useState([]);
  const [availableTables, setAvailableTables] = useState([]);
  const [previewSql, setPreviewSql] = useState(null);
  const [saving, setSaving] = useState(false);

  // Memuat daftar tabel di DB untuk dropdown referensi Foreign Key
  useEffect(() => {
    if (!session || !db) return;
    dbApi.getDatabaseObjects(session.sessionId, db).then((res) => {
      setAvailableTables(res.objects.tables || []);
    });
  }, [session?.sessionId, db]);

  // Jika mode ALTER TABLE, muat struktur kolom, index, dan FK eksisting
  useEffect(() => {
    if (!session || mode !== 'alter' || !initialTable) return;
    dbApi.getTableDetails(session.sessionId, db, initialTable).then((res) => {
      const parsedCols = res.details.columns.map((c) => {
        const match = c.type.match(/^([a-zA-Z0-9_]+)(?:\(([^)]+)\))?(?:\s+(unsigned))?/i);
        return {
          id: crypto.randomUUID(),
          name: c.name,
          type: (match?.[1] || c.type).toUpperCase(),
          length: match?.[2] || '',
          defaultValue: c.default ?? '',
          primaryKey: c.key === 'PRI',
          notNull: !c.nullable,
          unsigned: Boolean(match?.[3]),
          autoIncrement: c.extra.includes('auto_increment'),
          comment: c.comment || '',
          _dirty: false,
        };
      });
      setColumns(parsedCols);
      setOriginalColumns(JSON.parse(JSON.stringify(parsedCols)));

      // Kelompokkan index berdasarkan Key_name
      const idxMap = new Map();
      for (const idx of res.details.indexes) {
        if (idx.name === 'PRIMARY') continue;
        if (!idxMap.has(idx.name)) {
          idxMap.set(idx.name, {
            id: crypto.randomUUID(),
            name: idx.name,
            type: idx.nonUnique ? 'INDEX' : 'UNIQUE',
            columns: [],
            _isNew: false,
          });
        }
        idxMap.get(idx.name).columns.push(idx.column);
      }
      setIndexes(Array.from(idxMap.values()));

      setForeignKeys(
        res.details.foreignKeys.map((fk) => ({
          id: crypto.randomUUID(),
          name: fk.name,
          column: fk.columnName,
          referencedTable: fk.referencedTable,
          referencedColumn: fk.referencedColumn,
          onDelete: 'RESTRICT',
          onUpdate: 'RESTRICT',
          _isNew: false,
        }))
      );
    });
  }, [session?.sessionId, db, initialTable, mode]);

  const updateColumn = (id, patch) => {
    setColumns((prev) =>
      prev.map((col) => (col.id === id ? { ...col, ...patch, _dirty: true } : col))
    );
  };

  const removeColumn = (id) => {
    setColumns((prev) => prev.filter((c) => c.id !== id));
  };

  const buildSpec = () => ({
    columns: columns.filter((c) => c.name.trim()),
    originalColumns,
    indexes,
    droppedIndexes,
    foreignKeys,
    droppedForeignKeys,
  });

  const handlePreview = async () => {
    if (!tableName.trim()) {
      alert('Nama tabel wajib diisi.');
      return;
    }
    try {
      const res = await dbApi.previewDdl(session.sessionId, db, tableName.trim(), mode, buildSpec());
      setPreviewSql(
        res.statements.length > 0 ? res.statements.join('\n\n') : '-- Tidak ada perubahan skema.'
      );
    } catch (err) {
      alert(err.message);
    }
  };

  const handleSave = async () => {
    if (!tableName.trim()) {
      alert('Nama tabel wajib diisi.');
      return;
    }
    setSaving(true);
    try {
      const res = await dbApi.executeDdl(session.sessionId, db, tableName.trim(), mode, buildSpec());
      setPreviewSql(null);
      onSaved?.(db, tableName.trim(), res.statements);
    } catch (err) {
      alert(`Gagal menyimpan skema: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-xs text-slate-200">
      {/* Header Form */}
      <div className="h-11 px-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-700 font-semibold uppercase text-[10px]">
            {mode === 'create' ? 'Create Table' : 'Alter Table'}
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-mono">{db}.</span>
            <input
              type="text"
              disabled={mode === 'alter'}
              placeholder="nama_tabel_baru"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1 font-mono text-white outline-none focus:border-sky-500 disabled:opacity-70"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handlePreview}
            className="flex items-center gap-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 rounded"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview DDL</span>
          </button>

          <button
            disabled={saving}
            onClick={handleSave}
            className="flex items-center gap-1 px-3.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Applying...' : mode === 'create' ? 'Create Table' : 'Alter Table'}</span>
          </button>
        </div>
      </div>

      {/* Sub-tabs: Columns | Indexes | Foreign Keys */}
      <div className="h-8 px-4 bg-slate-900/60 border-b border-slate-800 flex items-center gap-2 shrink-0">
        <button
          onClick={() => setActiveSection('columns')}
          className={`flex items-center gap-1.5 px-3 py-1 border-b-2 ${
            activeSection === 'columns'
              ? 'border-sky-400 text-sky-400 font-medium'
              : 'border-transparent text-slate-400'
          }`}
        >
          <Columns className="w-3.5 h-3.5" />
          <span>Columns ({columns.length})</span>
        </button>

        <button
          onClick={() => setActiveSection('indexes')}
          className={`flex items-center gap-1.5 px-3 py-1 border-b-2 ${
            activeSection === 'indexes'
              ? 'border-amber-400 text-amber-400 font-medium'
              : 'border-transparent text-slate-400'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>Indexes ({indexes.length})</span>
        </button>

        <button
          onClick={() => setActiveSection('foreignKeys')}
          className={`flex items-center gap-1.5 px-3 py-1 border-b-2 ${
            activeSection === 'foreignKeys'
              ? 'border-purple-400 text-purple-400 font-medium'
              : 'border-transparent text-slate-400'
          }`}
        >
          <Link2 className="w-3.5 h-3.5" />
          <span>Foreign Keys ({foreignKeys.length})</span>
        </button>
      </div>

      {/* Body Section */}
      <div className="flex-1 overflow-auto p-3">
        {activeSection === 'columns' && (
          <div className="space-y-2">
            <table className="w-full border-collapse text-left font-mono text-xs">
              <thead className="bg-slate-900 border-b border-slate-700 text-slate-300">
                <tr>
                  <th className="p-2">Column Name</th>
                  <th className="p-2">Data Type</th>
                  <th className="p-2 w-24">Length/Set</th>
                  <th className="p-2 w-32">Default</th>
                  <th className="p-2 text-center w-10" title="Primary Key">PK</th>
                  <th className="p-2 text-center w-10" title="Not Null">NN</th>
                  <th className="p-2 text-center w-10" title="Unsigned">UN</th>
                  <th className="p-2 text-center w-10" title="Auto Increment">AI</th>
                  <th className="p-2">Comment</th>
                  <th className="p-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {columns.map((col) => (
                  <tr key={col.id} className="hover:bg-slate-900/60">
                    <td className="p-1.5">
                      <input
                        type="text"
                        placeholder="column_name"
                        value={col.name}
                        onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white outline-none focus:border-sky-500"
                      />
                    </td>
                    <td className="p-1.5">
                      <select
                        value={col.type}
                        onChange={(e) => updateColumn(col.id, { type: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 outline-none"
                      >
                        {DATA_TYPES.map((dt) => (
                          <option key={dt} value={dt}>
                            {dt}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        placeholder="255 / 10,2"
                        value={col.length}
                        onChange={(e) => updateColumn(col.id, { length: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 outline-none"
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        placeholder="NULL / 0"
                        value={col.defaultValue}
                        onChange={(e) => updateColumn(col.id, { defaultValue: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 outline-none"
                      />
                    </td>
                    <td className="p-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={col.primaryKey}
                        onChange={(e) =>
                          updateColumn(col.id, {
                            primaryKey: e.target.checked,
                            notNull: e.target.checked ? true : col.notNull,
                          })
                        }
                      />
                    </td>
                    <td className="p-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={col.notNull}
                        onChange={(e) => updateColumn(col.id, { notNull: e.target.checked })}
                      />
                    </td>
                    <td className="p-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={col.unsigned}
                        onChange={(e) => updateColumn(col.id, { unsigned: e.target.checked })}
                      />
                    </td>
                    <td className="p-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={col.autoIncrement}
                        onChange={(e) => updateColumn(col.id, { autoIncrement: e.target.checked })}
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        type="text"
                        value={col.comment}
                        onChange={(e) => updateColumn(col.id, { comment: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 outline-none"
                      />
                    </td>
                    <td className="p-1.5 text-center">
                      <button
                        onClick={() => removeColumn(col.id)}
                        className="text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button
              onClick={() => setColumns((prev) => [...prev, newEmptyColumn()])}
              className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded border border-slate-700"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Column</span>
            </button>
          </div>
        )}

        {activeSection === 'indexes' && (
          <div className="space-y-3">
            {indexes.map((idx) => (
              <div
                key={idx.id}
                className="flex items-center gap-2 p-2 bg-slate-900 border border-slate-800 rounded"
              >
                <input
                  type="text"
                  placeholder="idx_nama_index"
                  disabled={!idx._isNew}
                  value={idx.name}
                  onChange={(e) =>
                    setIndexes((prev) =>
                      prev.map((item) => (item.id === idx.id ? { ...item, name: e.target.value } : item))
                    )
                  }
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                />
                <select
                  disabled={!idx._isNew}
                  value={idx.type}
                  onChange={(e) =>
                    setIndexes((prev) =>
                      prev.map((item) => (item.id === idx.id ? { ...item, type: e.target.value } : item))
                    )
                  }
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
                >
                  <option value="INDEX">INDEX</option>
                  <option value="UNIQUE">UNIQUE</option>
                  <option value="FULLTEXT">FULLTEXT</option>
                </select>
                <input
                  type="text"
                  disabled={!idx._isNew}
                  placeholder="Kolom (pisahkan koma: email, status)"
                  value={idx.columns.join(', ')}
                  onChange={(e) =>
                    setIndexes((prev) =>
                      prev.map((item) =>
                        item.id === idx.id
                          ? {
                              ...item,
                              columns: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            }
                          : item
                      )
                    )
                  }
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                />
                <button
                  onClick={() => {
                    if (!idx._isNew && idx.name) {
                      setDroppedIndexes((prev) => [...prev, idx.name]);
                    }
                    setIndexes((prev) => prev.filter((item) => item.id !== idx.id));
                  }}
                  className="text-red-400 hover:text-red-300 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setIndexes((prev) => [
                  ...prev,
                  { id: crypto.randomUUID(), name: '', type: 'INDEX', columns: [], _isNew: true },
                ])
              }
              className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded border border-slate-700"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Index</span>
            </button>
          </div>
        )}

        {activeSection === 'foreignKeys' && (
          <div className="space-y-3">
            {foreignKeys.map((fk) => (
              <div
                key={fk.id}
                className="grid grid-cols-6 gap-2 p-2 bg-slate-900 border border-slate-800 rounded items-center"
              >
                <input
                  type="text"
                  disabled={!fk._isNew}
                  placeholder="fk_constraint_name"
                  value={fk.name}
                  onChange={(e) =>
                    setForeignKeys((prev) =>
                      prev.map((item) => (item.id === fk.id ? { ...item, name: e.target.value } : item))
                    )
                  }
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                />
                <select
                  disabled={!fk._isNew}
                  value={fk.column}
                  onChange={(e) =>
                    setForeignKeys((prev) =>
                      prev.map((item) => (item.id === fk.id ? { ...item, column: e.target.value } : item))
                    )
                  }
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
                >
                  <option value="">-- Local Column --</option>
                  {columns
                    .filter((c) => c.name)
                    .map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <select
                  disabled={!fk._isNew}
                  value={fk.referencedTable}
                  onChange={(e) =>
                    setForeignKeys((prev) =>
                      prev.map((item) =>
                        item.id === fk.id ? { ...item, referencedTable: e.target.value } : item
                      )
                    )
                  }
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
                >
                  <option value="">-- Ref Table --</option>
                  {availableTables.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  disabled={!fk._isNew}
                  placeholder="Ref Column (id)"
                  value={fk.referencedColumn}
                  onChange={(e) =>
                    setForeignKeys((prev) =>
                      prev.map((item) =>
                        item.id === fk.id ? { ...item, referencedColumn: e.target.value } : item
                      )
                    )
                  }
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono"
                />
                <select
                  disabled={!fk._isNew}
                  value={fk.onDelete}
                  onChange={(e) =>
                    setForeignKeys((prev) =>
                      prev.map((item) => (item.id === fk.id ? { ...item, onDelete: e.target.value } : item))
                    )
                  }
                  className="bg-slate-950 border border-slate-700 rounded px-2 py-1"
                >
                  {FK_ACTIONS.map((act) => (
                    <option key={act} value={act}>
                      ON DELETE {act}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (!fk._isNew && fk.name) {
                      setDroppedForeignKeys((prev) => [...prev, fk.name]);
                    }
                    setForeignKeys((prev) => prev.filter((item) => item.id !== fk.id));
                  }}
                  className="text-red-400 hover:text-red-300 justify-self-center"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setForeignKeys((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    name: '',
                    column: '',
                    referencedTable: '',
                    referencedColumn: 'id',
                    onDelete: 'RESTRICT',
                    onUpdate: 'RESTRICT',
                    _isNew: true,
                  },
                ])
              }
              className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-purple-400 rounded border border-slate-700"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Foreign Key</span>
            </button>
          </div>
        )}
      </div>

      {/* Modal DDL Preview */}
      {previewSql && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-lg shadow-2xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
              <span className="font-semibold">DDL Preview</span>
              <button onClick={() => setPreviewSql(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <pre className="p-4 max-h-80 overflow-auto bg-slate-950 font-mono text-xs text-sky-300 whitespace-pre-wrap">
              {previewSql}
            </pre>
            <div className="px-4 py-2.5 bg-slate-800 border-t border-slate-700 flex justify-end gap-2">
              <button
                onClick={() => setPreviewSql(null)}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded"
              >
                Close
              </button>
              <button
                disabled={saving}
                onClick={handleSave}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded"
              >
                Execute DDL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
