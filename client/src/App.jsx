import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Power,
  Database,
  FileCode2,
  Table2,
  Wrench,
  X,
  PanelLeft,
  ArchiveRestore,
  ShieldCheck,
  MoreVertical,
} from 'lucide-react';
import ConnectionModal from './components/ConnectionModal';
import ObjectBrowser from './components/ObjectBrowser';
import QueryEditor from './components/QueryEditor';
import BottomPane from './components/BottomPane';
import TableDataGrid from './components/TableDataGrid';
import SchemaDesigner from './components/SchemaDesigner';
import ExportImportModal from './components/ExportImportModal';
import AdminToolsModal from './components/AdminToolsModal';
import { dbApi } from './services/api';
import { LogOut, Loader2 /* ...ikon lainnya tetap */ } from 'lucide-react';
import LoginScreen from './components/LoginScreen';


const createQueryTab = (index, initialSql = '', database = '') => ({
  id: crypto.randomUUID(),
  type: 'query',
  title: `Query ${index}`,
  sql: initialSql,
  database,
  results: [],
  explainResult: null,
});

export default function App() {
  const [session, setSession] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(true);
  const [isExportImportOpen, setIsExportImportOpen] = useState(false);
  const [isAdminToolsOpen, setIsAdminToolsOpen] = useState(false);

  // State khusus navigasi mobile
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [databases, setDatabases] = useState([]);
  const [treeRefreshTrigger, setTreeRefreshTrigger] = useState(0);

  const [tabs, setTabs] = useState([
    createQueryTab(
      1,
      '-- Tekan Run untuk mengeksekusi query.\nSELECT VERSION(), NOW();\n'
    ),
  ]);
  const [activeTabId, setActiveTabId] = useState(tabs[0].id);
  const [isExecuting, setIsExecuting] = useState(false);
  const [logs, setLogs] = useState([]);
  const [toast, setToast] = useState('');

  const [editorHeightPct, setEditorHeightPct] = useState(48);
  const workspaceRef = useRef(null);
  const isDraggingRef = useRef(false);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Mendukung mouse & touch drag untuk resizer panel
  useEffect(() => {
    const updatePosition = (clientY) => {
      if (!isDraggingRef.current || !workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const pct = Math.min(82, Math.max(18, ((clientY - rect.top) / rect.height) * 100));
      setEditorHeightPct(pct);
    };

    const handleMouseMove = (e) => updatePosition(e.clientY);
    const handleTouchMove = (e) => {
      if (e.touches.length > 0) updatePosition(e.touches[0].clientY);
    };
    const stopDragging = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = 'default';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', stopDragging);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', stopDragging);
    };
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchDatabasesList = async (sessionId) => {
    try {
      const res = await dbApi.getDatabases(sessionId);
      setDatabases(res.databases);
    } catch {
      setDatabases([]);
    }
  };

  const handleConnected = (res) => {
    setSession(res);
    fetchDatabasesList(res.sessionId);
    setIsSidebarOpen(true); // Otomatis buka object browser di mobile setelah connect
  };

  const handleDisconnect = async () => {
    if (!session) return;
    await dbApi.disconnect(session.sessionId);
    setSession(null);
    setDatabases([]);
    setIsSidebarOpen(false);
  };

  const updateTabById = (id, patch) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  };

  const addQueryTab = () => {
    const queryCount = tabs.filter((t) => t.type === 'query').length + 1;
    const newTab = createQueryTab(queryCount, '', activeTab?.database || '');
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const openTableDataTab = (db, table) => {
    const existing = tabs.find((t) => t.type === 'data' && t.database === db && t.table === table);
    if (existing) {
      setActiveTabId(existing.id);
      setIsSidebarOpen(false);
      return;
    }
    const newTab = {
      id: crypto.randomUUID(),
      type: 'data',
      title: `${table}`,
      database: db,
      table,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setIsSidebarOpen(false);
  };

  const openSchemaTab = (db, mode = 'create', table = '') => {
    const existing = tabs.find(
      (t) => t.type === 'schema' && t.database === db && t.mode === mode && t.table === table
    );
    if (existing) {
      setActiveTabId(existing.id);
      setIsSidebarOpen(false);
      return;
    }
    const newTab = {
      id: crypto.randomUUID(),
      type: 'schema',
      title: mode === 'create' ? `New: ${db}` : `Alter: ${table}`,
      database: db,
      table,
      mode,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    setIsSidebarOpen(false);
  };

  const closeTab = (id, e) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const filtered = tabs.filter((t) => t.id !== id);
    setTabs(filtered);
    if (activeTabId === id) {
      setActiveTabId(filtered[filtered.length - 1].id);
    }
  };

  const appendLog = (entry) => {
    setLogs((prev) => [
      { id: crypto.randomUUID(), timestamp: new Date().toLocaleTimeString(), ...entry },
      ...prev,
    ]);
  };

  const handleExecuteQuery = async (sqlToRun, db) => {
    if (!session || !sqlToRun.trim()) return;
    setIsExecuting(true);
    try {
      const res = await dbApi.executeQuery(session.sessionId, sqlToRun, db || null);
      if (res.success) {
        updateTabById(activeTab.id, {
          results: res.results,
          explainResult: null,
          database: res.currentDatabase || db,
        });
        appendLog({
          success: true,
          durationMs: res.executionTimeMs,
          affectedRows: res.totalAffectedRows,
          sqlSnippet: sqlToRun.trim().replace(/\s+/g, ' ').slice(0, 140),
        });
        // Di mobile, otomatis geser ke tampilan hasil jika menghasilkan resultset
        if (window.innerWidth < 768 && res.results.some((r) => r.type === 'resultset')) {
          setEditorHeightPct(32);
        }
        if (/\b(create|drop|alter)\b/i.test(sqlToRun)) {
          fetchDatabasesList(session.sessionId);
          setTreeRefreshTrigger((n) => n + 1);
        }
      } else {
        updateTabById(activeTab.id, { results: [] });
        appendLog({
          success: false,
          durationMs: res.executionTimeMs,
          errno: res.error.errno,
          code: res.error.code,
          errorMessage: res.error.message,
          sqlSnippet: sqlToRun.trim().replace(/\s+/g, ' ').slice(0, 140),
        });
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const handleExplainQuery = async (sqlToExplain, db) => {
    if (!session || !sqlToExplain.trim()) return;
    setIsExecuting(true);
    try {
      const res = await dbApi.explainQuery(session.sessionId, sqlToExplain, db || null);
      if (res.success && res.results[0]?.type === 'resultset') {
        updateTabById(activeTab.id, { explainResult: res.results[0] });
        if (window.innerWidth < 768) setEditorHeightPct(32);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const handleBrowserAction = async (action) => {
    if (action.type === 'DDL_COPIED') {
      showToast(`CREATE statement untuk ${action.name} disalin.`);
    } else if (action.type === 'CREATE_TABLE') {
      openSchemaTab(action.db, 'create');
    } else if (action.type === 'ALTER_TABLE') {
      openSchemaTab(action.db, 'alter', action.table);
    } else if (action.type === 'TRUNCATE_TABLE') {
      if (!window.confirm(`Kosongkan seluruh isi tabel \`${action.db}\`.\`${action.table}\`?`)) return;
      await dbApi.truncateTable(session.sessionId, action.db, action.table);
      showToast(`Tabel ${action.table} di-TRUNCATE.`);
    } else if (action.type === 'DROP_TABLE') {
      if (!window.confirm(`HAPUS PERMANEN tabel \`${action.db}\`.\`${action.table}\`?`)) return;
      await dbApi.dropTable(session.sessionId, action.db, action.table);
      setTreeRefreshTrigger((n) => n + 1);
      showToast(`Tabel ${action.table} telah dihapus.`);
    }
  };

  const envHeaderStyle = {
    production: 'border-b-2 border-red-500 bg-red-950/30',
    staging: 'border-b-2 border-amber-500 bg-amber-950/30',
    development: 'border-b-2 border-emerald-500 bg-slate-900',
  };

const [authState, setAuthState] = useState({
  checking: true,
  authenticated: false,
  user: null,
});

useEffect(() => {
  dbApi
    .checkAuth()
    .then((res) => {
      setAuthState({
        checking: false,
        authenticated: Boolean(res.authenticated),
        user: res.user || null,
      });
    })
    .catch(() => {
      setAuthState({ checking: false, authenticated: false, user: null });
    });
}, []);

const handleLogout = async () => {
  if (session) {
    await handleDisconnect();
  }
  await dbApi.logout();
  setAuthState({ checking: false, authenticated: false, user: null });
};

if (authState.checking) {
  return (
    <div className="h-dvh w-screen flex items-center justify-center bg-slate-950 text-slate-400 text-xs gap-2">
      <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
      <span>Memeriksa sesi autentikasi...</span>
    </div>
  );
}

if (!authState.authenticated) {
  return (
    <LoginScreen
      onAuthenticated={(user) =>
        setAuthState({ checking: false, authenticated: true, user })
      }
    />
  );
}
  return (
    <div className="h-dvh w-screen flex flex-col bg-slate-950 text-slate-200 overflow-hidden">
      {/* Top Toolbar */}
      <header
        className={`h-11 px-2.5 md:px-3 flex items-center justify-between border-b border-slate-800 shrink-0 relative ${
          session ? envHeaderStyle[session.meta.environment] : 'bg-slate-900'
        }`}
      >
        <div className="flex items-center gap-1.5 md:gap-2.5">
          {/* Tombol Toggle Sidebar Object Browser (Khusus Mobile) */}
          <button
            onClick={() => setIsSidebarOpen((v) => !v)}
            title="Toggle Object Browser"
            className="md:hidden p-1.5 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 text-slate-200"
          >
            <PanelLeft className="w-4 h-4 text-sky-400" />
          </button>

          <div className="flex items-center gap-1.5 font-bold text-sm text-sky-400">
            <Database className="w-4 h-4" />
            <span>WebYog</span>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1 px-2 md:px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded border border-slate-700"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">New Connection</span>
            <span className="sm:hidden">Connect</span>
          </button>

          {session && (
            <>
              <button
                onClick={handleDisconnect}
                title="Disconnect"
                className="flex items-center gap-1 px-2 py-1 text-xs bg-slate-800 hover:bg-red-950/60 text-red-400 rounded border border-slate-700"
              >
                <Power className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Disconnect</span>
              </button>

              {/* Tombol Tools Desktop */}
              <div className="hidden md:flex items-center gap-2">
                <div className="h-4 w-[1px] bg-slate-700 mx-0.5" />
                <button
                  onClick={() => setIsExportImportOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700"
                >
                  <ArchiveRestore className="w-3.5 h-3.5 text-sky-400" />
                  <span>Backup / Restore</span>
                </button>

                <button
                  onClick={() => setIsAdminToolsOpen(true)}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                  <span>Admin Tools</span>
                </button>
              </div>
{/* Di sisi kanan header (tampil baik saat sudah maupun belum connect MySQL) */}
<div className="flex items-center gap-1.5 text-xs">
  {session && (
    <>
      <span className="px-1.5 md:px-2 py-0.5 rounded uppercase text-[10px] font-bold tracking-wider bg-slate-800 border border-slate-700">
        {session.meta.environment.slice(0, 4)}
        <span className="hidden sm:inline">{session.meta.environment.slice(4)}</span>
      </span>
      <span className="hidden lg:inline text-slate-400">MySQL {session.meta.version}</span>
    </>
  )}

  <button
    onClick={handleLogout}
    title={`Logout (${authState.user})`}
    className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-red-950/60 text-slate-300 hover:text-red-400 rounded border border-slate-700"
  >
    <LogOut className="w-3.5 h-3.5" />
    <span className="hidden sm:inline">Logout</span>
  </button>

  {/* Menu Overflow Mobile */}
  {session && (
    <div className="relative md:hidden">
      {/* ...tombol MoreVertical & dropdown Backup/Admin tetap sama... */}
    </div>
  )}
</div>
            </>
          )}
        </div>

        {/* Status Environment & Menu Mobile */}
        {session && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="px-1.5 md:px-2 py-0.5 rounded uppercase text-[10px] font-bold tracking-wider bg-slate-800 border border-slate-700">
              {session.meta.environment.slice(0, 4)}
              <span className="hidden sm:inline">{session.meta.environment.slice(4)}</span>
            </span>
            <span className="hidden lg:inline text-slate-400">MySQL {session.meta.version}</span>

            {/* Menu Overflow Mobile untuk Backup & Admin */}
            <div className="relative md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen((v) => !v)}
                className="p-1.5 bg-slate-800 border border-slate-700 rounded text-slate-300"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {isMobileMenuOpen && (
                <div className="absolute right-0 mt-1 w-44 bg-slate-800 border border-slate-700 rounded shadow-xl py-1 z-50">
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setIsExportImportOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-700"
                  >
                    <ArchiveRestore className="w-3.5 h-3.5 text-sky-400" />
                    <span>Backup / Restore</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      setIsAdminToolsOpen(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-700"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                    <span>Admin Tools</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* Main Split Workspace */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Backdrop gelap saat drawer mobile terbuka */}
        {isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 top-11 bg-black/60 z-30 md:hidden"
          />
        )}

        {/* Sidebar Object Browser: Slide-over Drawer di mobile, Fixed Sidebar di desktop */}
        <aside
          className={`fixed md:static top-11 bottom-0 left-0 z-40 w-[82vw] max-w-[300px] md:w-72 border-r border-slate-800 bg-slate-900 shrink-0 transition-transform duration-200 ease-out ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          }`}
        >
          <ObjectBrowser
            session={session}
            refreshTrigger={treeRefreshTrigger}
            onSelectTable={openTableDataTab}
            onAction={handleBrowserAction}
            onCloseDrawer={() => setIsSidebarOpen(false)}
          />
        </aside>

        {/* Main Workspace */}
        <main ref={workspaceRef} className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Workspace Tabs Bar */}
          <div className="h-9 md:h-8 bg-slate-900 border-b border-slate-800 flex items-center px-1 gap-1 shrink-0 overflow-x-auto">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`group flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-t cursor-pointer border-t border-x shrink-0 ${
                  tab.id === activeTab.id
                    ? 'bg-slate-950 text-sky-400 border-slate-700 font-medium'
                    : 'bg-slate-900/50 text-slate-400 border-transparent hover:bg-slate-800'
                }`}
              >
                {tab.type === 'query' && <FileCode2 className="w-3.5 h-3.5 text-sky-400" />}
                {tab.type === 'data' && <Table2 className="w-3.5 h-3.5 text-emerald-400" />}
                {tab.type === 'schema' && <Wrench className="w-3.5 h-3.5 text-amber-400" />}
                <span className="max-w-[110px] truncate">{tab.title}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => closeTab(tab.id, e)}
                    className="p-0.5 opacity-70 hover:opacity-100 hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}

            <button
              onClick={addQueryTab}
              title="New Query Tab"
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Konten Tab Aktif */}
          {activeTab.type === 'query' && (
            <>
              <div style={{ height: `${editorHeightPct}%` }} className="overflow-hidden">
                <QueryEditor
                  session={session}
                  databases={databases}
                  activeDatabase={activeTab.database}
                  onDatabaseChange={(db) => updateTabById(activeTab.id, { database: db })}
                  sql={activeTab.sql}
                  onChangeSql={(val) => updateTabById(activeTab.id, { sql: val })}
                  onExecute={handleExecuteQuery}
                  onExplain={handleExplainQuery}
                  isExecuting={isExecuting}
                />
              </div>

              {/* Resizer Handle dengan Touch Support & Quick Snap Mobile */}
              <div
                onMouseDown={() => {
                  isDraggingRef.current = true;
                  document.body.style.cursor = 'row-resize';
                }}
                onTouchStart={() => {
                  isDraggingRef.current = true;
                }}
                className="h-3 md:h-1.5 bg-slate-900 hover:bg-sky-500/60 border-y border-slate-800 cursor-row-resize flex items-center justify-center shrink-0 touch-none"
              >
                <div className="w-10 h-1 rounded-full bg-slate-700 md:hidden" />
              </div>

              <div className="flex-1 overflow-hidden">
                <BottomPane
		  session={session}
		  results={activeTab.results}
		  explainResult={activeTab.explainResult}
		  logs={logs}
		  onClearLogs={() => setLogs([])}
		  onRefreshQuery={() => handleExecuteQuery(activeTab.sql, activeTab.database)}
		  onLog={appendLog}
		/>
              </div>
            </>
          )}

          {activeTab.type === 'data' && (
            <div className="flex-1 overflow-hidden">
              <TableDataGrid
                session={session}
                db={activeTab.database}
                table={activeTab.table}
                onOpenSchema={(db, tbl) => openSchemaTab(db, 'alter', tbl)}
                onLog={appendLog}
              />
            </div>
          )}

          {activeTab.type === 'schema' && (
            <div className="flex-1 overflow-hidden">
              <SchemaDesigner
                session={session}
                db={activeTab.database}
                initialTable={activeTab.table}
                mode={activeTab.mode}
                onSaved={(db, tbl, stmts) => {
                  setTreeRefreshTrigger((n) => n + 1);
                  appendLog({
                    success: true,
                    durationMs: 0,
                    affectedRows: 0,
                    sqlSnippet: stmts.join(' '),
                  });
                  showToast(`Skema tabel ${tbl} berhasil disimpan.`);
                  openTableDataTab(db, tbl);
                }}
              />
            </div>
          )}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 bg-sky-600 text-white text-xs px-3 py-2 rounded shadow-lg z-50 text-center">
          {toast}
        </div>
      )}

      <ConnectionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConnected={handleConnected}
      />

      <ExportImportModal
        isOpen={isExportImportOpen}
        onClose={() => setIsExportImportOpen(false)}
        session={session}
        databases={databases}
        defaultDb={activeTab?.database}
        onCompleted={() => {
          fetchDatabasesList(session.sessionId);
          setTreeRefreshTrigger((n) => n + 1);
        }}
      />

      <AdminToolsModal
        isOpen={isAdminToolsOpen}
        onClose={() => setIsAdminToolsOpen(false)}
        session={session}
        databases={databases}
        defaultDb={activeTab?.database}
      />

    </div>
  );
}
