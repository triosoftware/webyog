import React, { useRef, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { format } from 'sql-formatter';
import {
  Play,
  PlaySquare,
  Activity,
  Sparkles,
  Eraser,
  Database,
  Loader2,
} from 'lucide-react';
import { dbApi } from '../services/api';

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS NULL', 'IS NOT NULL',
  'LIKE', 'BETWEEN', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'OFFSET',
  'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'ON', 'AS', 'DISTINCT',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE', 'SHOW TABLES', 'DESCRIBE',
];

const NON_ALIAS_KEYWORDS = new Set([
  'WHERE', 'ON', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS',
  'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'HAVING', 'UNION', 'SET', 'VALUES', 'AS',
]);

const QUICK_TOKENS = [
  { label: '.', insert: '.' },
  { label: '`', insert: '`' },
  { label: '*', insert: '*' },
  { label: 'SELECT', insert: 'SELECT ' },
  { label: 'FROM', insert: 'FROM ' },
  { label: 'WHERE', insert: 'WHERE ' },
  { label: 'JOIN', insert: 'JOIN ' },
  { label: 'LIMIT 50', insert: 'LIMIT 50' },
  { label: ';', insert: ';' },
];

/**
 * Mengekstrak mapping alias tabel dari teks SQL (misal: "FROM users u" -> u: { table: 'users' })
 */
function extractTableAliases(sqlText) {
  const aliases = new Map();
  const regex =
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:`?([a-zA-Z0-9_$]+)`?\.)?`?([a-zA-Z0-9_$]+)`?(?:\s+(?:AS\s+)?`?([a-zA-Z0-9_$]+)`?)?/gi;

  let match;
  while ((match = regex.exec(sqlText)) !== null) {
    const dbName = match[1] || null;
    const tableName = match[2];
    const aliasName = match[3];
    if (aliasName && !NON_ALIAS_KEYWORDS.has(aliasName.toUpperCase())) {
      aliases.set(aliasName.toLowerCase(), { db: dbName, table: tableName });
    }
  }
  return aliases;
}

export default function QueryEditor({
  session,
  databases,
  activeDatabase,
  onDatabaseChange,
  sql,
  onChangeSql,
  onExecute,
  onExplain,
  isExecuting,
}) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const providerDisposableRef = useRef(null);

  const [schemaItems, setSchemaItems] = useState([]);

  // Ref agar completion provider selalu membaca state terbaru tanpa stale closure
  const latestContextRef = useRef({
    databases: [],
    activeDatabase: '',
    schemaItems: [],
  });

  useEffect(() => {
    latestContextRef.current = {
      databases: databases || [],
      activeDatabase: activeDatabase || '',
      schemaItems: schemaItems || [],
    };
  }, [databases, activeDatabase, schemaItems]);

  // Muat metadata seluruh database & tabel untuk kebutuhan "nama_db." dan "nama_tabel."
  useEffect(() => {
    if (!session?.sessionId) {
      setSchemaItems([]);
      return;
    }
    let cancelled = false;
    dbApi
      .getAutocompleteSchema(session.sessionId, null)
      .then((res) => {
        if (!cancelled) setSchemaItems(res.schema || []);
      })
      .catch(() => {
        if (!cancelled) setSchemaItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.sessionId, databases]);

  // Bersihkan provider saat komponen unmount
  useEffect(() => {
    return () => {
      providerDisposableRef.current?.dispose();
    };
  }, []);

  const registerDotAutocomplete = (monaco) => {
    providerDisposableRef.current?.dispose();

    providerDisposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.'],
      provideCompletionItems(model, position) {
        const {
          databases: dbList,
          activeDatabase: currentDb,
          schemaItems: allSchemas,
        } = latestContextRef.current;

        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn
        );

        const textBeforeCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        // Cek apakah kursor berada setelah tanda titik (`.`)
        // Mendukung: `db`.`table`. | db.table. | `db`. | db. | `table`. | table.
        const dotMatch = textBeforeCursor.match(
          /(?:`?([a-zA-Z0-9_$]+)`?\s*\.\s*)?`?([a-zA-Z0-9_$]+)`?\s*\.\s*([a-zA-Z0-9_$]*)$/
        );

        if (dotMatch) {
          const explicitDb = dotMatch[1] ? dotMatch[1].toLowerCase() : null;
          const identBeforeDot = dotMatch[2].toLowerCase();

          // KASUS 1: Dua tingkat titik (`nama_db.nama_tabel.`) -> Tampilkan HANYA kolom tabel tsb
          if (explicitDb) {
            const targetTable = allSchemas.find(
              (s) =>
                s.database.toLowerCase() === explicitDb &&
                s.table.toLowerCase() === identBeforeDot
            );

            if (!targetTable) return { suggestions: [] };

            return {
              suggestions: targetTable.columns.map((col) => ({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type}${col.isPrimary ? ' (PK)' : ''} — ${targetTable.database}.${targetTable.table}`,
                insertText: col.name,
                range,
              })),
            };
          }

          // KASUS 2: Satu titik dan token sebelum titik adalah DATABASE (`nama_db.`) -> Tampilkan HANYA tabel
          const matchedDbName =
            dbList.find((d) => d.toLowerCase() === identBeforeDot) ||
            allSchemas.find((s) => s.database.toLowerCase() === identBeforeDot)?.database;

          if (matchedDbName) {
            const dbTables = allSchemas.filter(
              (s) => s.database.toLowerCase() === matchedDbName.toLowerCase()
            );

            return {
              suggestions: dbTables.map((tbl) => ({
                label: tbl.table,
                kind: monaco.languages.CompletionItemKind.Class,
                detail: `Table (${tbl.database})`,
                insertText: tbl.table,
                range,
              })),
            };
          }

          // KASUS 3: Satu titik dan token sebelum titik adalah TABEL atau ALIAS (`nama_tabel.` / `alias.`)
          // -> Tampilkan HANYA kolom dari tabel tersebut
          const aliases = extractTableAliases(model.getValue());
          const aliasTarget = aliases.get(identBeforeDot);

          const targetDbLower = aliasTarget?.db
            ? aliasTarget.db.toLowerCase()
            : currentDb
            ? currentDb.toLowerCase()
            : null;
          const targetTableLower = aliasTarget
            ? aliasTarget.table.toLowerCase()
            : identBeforeDot;

          // Prioritaskan kecocokan di database aktif, fallback ke seluruh schema jika tidak ketemu
          let matchedTable = targetDbLower
            ? allSchemas.find(
                (s) =>
                  s.database.toLowerCase() === targetDbLower &&
                  s.table.toLowerCase() === targetTableLower
              )
            : null;

          if (!matchedTable) {
            matchedTable = allSchemas.find(
              (s) => s.table.toLowerCase() === targetTableLower
            );
          }

          if (!matchedTable) {
            return { suggestions: [] };
          }

          return {
            suggestions: matchedTable.columns.map((col) => ({
              label: col.name,
              kind: monaco.languages.CompletionItemKind.Field,
              detail: `${col.type}${col.isPrimary ? ' (PK)' : ''} — ${matchedTable.table}`,
              insertText: col.name,
              range,
            })),
          };
        }

        // KASUS 4: Pengetikan biasa (tanpa titik sebelumnya) -> Keywords, Databases, & Tables aktif
        const suggestions = [];

        SQL_KEYWORDS.forEach((kw) => {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            detail: 'SQL Keyword',
            insertText: kw,
            range,
          });
        });

        dbList.forEach((db) => {
          suggestions.push({
            label: db,
            kind: monaco.languages.CompletionItemKind.Module,
            detail: 'Database',
            insertText: db,
            range,
          });
        });

        const visibleSchemas = currentDb
          ? allSchemas.filter((s) => s.database.toLowerCase() === currentDb.toLowerCase())
          : allSchemas;

        visibleSchemas.forEach((tbl) => {
          suggestions.push({
            label: tbl.table,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: `Table (${tbl.database})`,
            insertText: tbl.table,
            range,
          });
        });

        return { suggestions };
      },
    });
  };

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    registerDotAutocomplete(monaco);

    // Shortcut F9 / Ctrl+Enter: Run All
    editor.addCommand(monaco.KeyCode.F9, () => {
      onExecute(editor.getValue(), activeDatabase);
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onExecute(editor.getValue(), activeDatabase);
    });

    // Shortcut Ctrl+F9: Run Selected
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F9, () => {
      const selection = editor.getSelection();
      const selectedSql = selection ? editor.getModel().getValueInRange(selection) : '';
      onExecute(selectedSql.trim() ? selectedSql : editor.getValue(), activeDatabase);
    });
  };

  const runSelected = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    const selectedSql = selection ? editor.getModel().getValueInRange(selection) : '';
    onExecute(selectedSql.trim() ? selectedSql : sql, activeDatabase);
  };

  const handleFormat = () => {
    try {
      const formatted = format(sql || '', { language: 'mysql', keywordCase: 'upper' });
      onChangeSql(formatted);
    } catch {
      // Abaikan jika SQL belum lengkap untuk diformat
    }
  };

  const insertSqlToken = (token) => {
    const editor = editorRef.current;
    if (!editor) {
      onChangeSql((sql || '') + token);
      return;
    }
    editor.focus();
    editor.trigger('keyboard', 'type', { text: token });
    if (token === '.') {
      editor.trigger('keyboard', 'editor.action.triggerSuggest', {});
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-950">
      {/* Editor Toolbar */}
      <div className="h-10 md:h-9 px-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-2 text-xs shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded px-2 py-1">
            <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <select
              disabled={!session}
              value={activeDatabase || ''}
              onChange={(e) => onDatabaseChange(e.target.value)}
              className="bg-transparent text-slate-200 outline-none max-w-[115px] md:max-w-[160px] truncate cursor-pointer text-xs!"
            >
              <option value="" className="bg-slate-900">
                (No DB)
              </option>
              {databases.map((db) => (
                <option key={db} value={db} className="bg-slate-900">
                  {db}
                </option>
              ))}
            </select>
          </div>

          <button
            disabled={!session || isExecuting}
            onClick={() => onExecute(sql, activeDatabase)}
            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium rounded shrink-0"
          >
            {isExecuting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            <span>Run</span>
          </button>

          <button
            disabled={!session || isExecuting}
            onClick={runSelected}
            title="Execute Selected Text (Ctrl+F9)"
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded border border-slate-700 shrink-0"
          >
            <PlaySquare className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Selection</span>
          </button>

          <button
            disabled={!session || isExecuting}
            onClick={() => {
              const selection = editorRef.current?.getSelection();
              const selected = selection
                ? editorRef.current.getModel().getValueInRange(selection)
                : '';
              onExplain(selected.trim() ? selected : sql, activeDatabase);
            }}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 rounded border border-slate-700 shrink-0"
          >
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Explain</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleFormat}
            title="Format SQL"
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span className="hidden sm:inline">Format</span>
          </button>
          <button
            onClick={() => onChangeSql('')}
            title="Clear Editor"
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded border border-slate-700"
          >
            <Eraser className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bar Token SQL Cepat (Mobile) */}
      <div className="flex md:hidden items-center gap-1 px-2 py-1 bg-slate-900/70 border-b border-slate-800 overflow-x-auto shrink-0">
        {QUICK_TOKENS.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => insertSqlToken(t.insert)}
            className="px-2 py-0.5 bg-slate-800 active:bg-sky-600 text-slate-200 font-mono text-[11px] rounded border border-slate-700 shrink-0"
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Monaco SQL Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme="vs-dark"
          value={sql}
          onChange={(val) => onChangeSql(val ?? '')}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbersMinChars: 3,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            quickSuggestions: { other: true, comments: false, strings: false },
            suggestOnTriggerCharacters: true,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
}
