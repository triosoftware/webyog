import React, { useState, useEffect } from 'react';
import {
  Database,
  Table,
  Columns,
  Key,
  Link2,
  Eye,
  Code2,
  Zap,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Search,
  Folder,
  Loader2,
  MoreVertical,
  X,
} from 'lucide-react';
import { dbApi } from '../services/api';

export default function ObjectBrowser({
  session,
  refreshTrigger,
  onSelectTable,
  onAction,
  onCloseDrawer,
}) {
  const [databases, setDatabases] = useState([]);
  const [filterText, setFilterText] = useState('');
  const [expanded, setExpanded] = useState({});
  const [loadingNode, setLoadingNode] = useState({});
  const [dbObjects, setDbObjects] = useState({});
  const [tableDetails, setTableDetails] = useState({});
  const [contextMenu, setContextMenu] = useState(null);

  const loadDatabases = async () => {
    if (!session) return;
    setLoadingNode((prev) => ({ ...prev, root: true }));
    try {
      const res = await dbApi.getDatabases(session.sessionId);
      setDatabases(res.databases);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingNode((prev) => ({ ...prev, root: false }));
    }
  };

  useEffect(() => {
    setDatabases([]);
    setExpanded({});
    setDbObjects({});
    setTableDetails({});
    if (session) loadDatabases();
  }, [session?.sessionId]);

  useEffect(() => {
    if (session && refreshTrigger > 0) {
      loadDatabases();
      Object.keys(dbObjects).forEach((db) => loadDbObjects(db, true));
    }
  }, [refreshTrigger]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const toggleNode = async (nodeKey, fetchFn) => {
    const nextState = !expanded[nodeKey];
    setExpanded((prev) => ({ ...prev, [nodeKey]: nextState }));
    if (nextState && fetchFn) {
      await fetchFn();
    }
  };

  const loadDbObjects = async (db, force = false) => {
    if (dbObjects[db] && !force) return;
    setLoadingNode((prev) => ({ ...prev, [`db:${db}`]: true }));
    try {
      const res = await dbApi.getDatabaseObjects(session.sessionId, db);
      setDbObjects((prev) => ({ ...prev, [db]: res.objects }));
    } finally {
      setLoadingNode((prev) => ({ ...prev, [`db:${db}`]: false }));
    }
  };

  const loadTableDetails = async (db, table, force = false) => {
    const key = `${db}.${table}`;
    if (tableDetails[key] && !force) return;
    setLoadingNode((prev) => ({ ...prev, [`tbl:${key}`]: true }));
    try {
      const res = await dbApi.getTableDetails(session.sessionId, db, table);
      setTableDetails((prev) => ({ ...prev, [key]: res.details }));
    } finally {
      setLoadingNode((prev) => ({ ...prev, [`tbl:${key}`]: false }));
    }
  };

  // Membuka context menu baik dari klik kanan maupun tombol ⋮ mobile dengan posisi aman di layar
  const openActionMenu = (e, payload) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 192;
    const menuHeight = 200;
    const safeX = Math.min(e.clientX, window.innerWidth - menuWidth - 12);
    const safeY = Math.min(e.clientY, window.innerHeight - menuHeight - 12);
    setContextMenu({
      x: Math.max(12, safeX),
      y: Math.max(12, safeY),
      ...payload,
    });
  };

  const handleCopyCreate = async (db, type, name) => {
    try {
      const res = await dbApi.getCreateStatement(session.sessionId, db, type, name);
      await navigator.clipboard.writeText(res.ddl);
      onAction?.({ type: 'DDL_COPIED', db, objectType: type, name, ddl: res.ddl });
    } catch (err) {
      alert(err.message);
    }
  };

  if (!session) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-500 p-4 text-center">
        Belum ada koneksi aktif.
      </div>
    );
  }

  const filteredDatabases = databases.filter((db) =>
    db.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-300 select-none text-xs">
      {/* Header & Filter */}
      <div className="p-2.5 md:p-2 border-b border-slate-800 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-200 truncate" title={session.meta.name}>
            {session.meta.user}@{session.meta.host}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={loadDatabases}
              title="Refresh Databases"
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingNode.root ? 'animate-spin' : ''}`} />
            </button>
            {onCloseDrawer && (
              <button
                onClick={onCloseDrawer}
                className="md:hidden p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2 md:top-1.5" />
          <input
            type="text"
            placeholder="Filter database..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded pl-8 pr-2 py-1.5 md:py-1 text-xs focus:border-sky-500 outline-none"
          />
        </div>
      </div>

      {/* Tree View dengan tap-target lebih nyaman */}
      <div className="flex-1 overflow-y-auto py-1 font-mono text-xs md:text-[11px]">
        {filteredDatabases.map((db) => {
          const isDbOpen = !!expanded[`db:${db}`];
          const objs = dbObjects[db];

          return (
            <div key={db}>
              <div
                onClick={() => toggleNode(`db:${db}`, () => loadDbObjects(db))}
                onContextMenu={(e) => openActionMenu(e, { nodeType: 'database', db })}
                className="flex items-center justify-between px-2 py-2 md:py-1 hover:bg-slate-800/80 cursor-pointer"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {loadingNode[`db:${db}`] ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400 shrink-0" />
                  ) : isDbOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="truncate font-medium text-slate-200">{db}</span>
                </div>
                <button
                  onClick={(e) => openActionMenu(e, { nodeType: 'database', db })}
                  className="p-1 text-slate-500 hover:text-slate-200 shrink-0"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </div>

              {isDbOpen && objs && (
                <div className="pl-3">
                  {/* Folder Tables */}
                  <div>
                    <div
                      onClick={() => toggleNode(`folder:${db}:tables`)}
                      className="flex items-center gap-1.5 px-2 py-1.5 md:py-1 hover:bg-slate-800/60 cursor-pointer text-slate-400"
                    >
                      {expanded[`folder:${db}:tables`] ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                      <Folder className="w-3.5 h-3.5 text-sky-400" />
                      <span>Tables ({objs.tables.length})</span>
                    </div>

                    {expanded[`folder:${db}:tables`] && (
                      <div className="pl-3">
                        {objs.tables.map((table) => {
                          const tblKey = `${db}.${table}`;
                          const isTblOpen = !!expanded[`tbl:${tblKey}`];
                          const details = tableDetails[tblKey];

                          return (
                            <div key={table}>
                              <div
                                onClick={() => onSelectTable?.(db, table)}
                                onContextMenu={(e) =>
                                  openActionMenu(e, { nodeType: 'table', db, name: table })
                                }
                                className="flex items-center justify-between px-2 py-2 md:py-1 hover:bg-slate-800 cursor-pointer"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleNode(`tbl:${tblKey}`, () => loadTableDetails(db, table));
                                    }}
                                    className="p-0.5 text-slate-500 hover:text-white"
                                  >
                                    {loadingNode[`tbl:${tblKey}`] ? (
                                      <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
                                    ) : isTblOpen ? (
                                      <ChevronDown className="w-3.5 h-3.5" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                  <Table className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  <span className="truncate">{table}</span>
                                </div>

                                <button
                                  onClick={(e) =>
                                    openActionMenu(e, { nodeType: 'table', db, name: table })
                                  }
                                  className="p-1 text-slate-500 hover:text-slate-200 shrink-0"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {isTblOpen && details && (
                                <div className="pl-5 space-y-1 text-slate-400 pb-1">
                                  <div>
                                    <div
                                      onClick={() => toggleNode(`sub:${tblKey}:cols`)}
                                      className="flex items-center gap-1 py-1 hover:text-slate-200 cursor-pointer"
                                    >
                                      <Columns className="w-3 h-3 text-sky-300" />
                                      <span>Columns ({details.columns.length})</span>
                                    </div>
                                    {expanded[`sub:${tblKey}:cols`] && (
                                      <div className="pl-4 space-y-1">
                                        {details.columns.map((col) => (
                                          <div
                                            key={col.name}
                                            className="flex items-center justify-between pr-2 py-0.5 text-[11px]"
                                          >
                                            <span className="flex items-center gap-1 truncate">
                                              {col.key === 'PRI' && (
                                                <Key className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                              )}
                                              <span className="text-slate-200">{col.name}</span>
                                            </span>
                                            <span className="text-slate-500 ml-2">{col.type}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  <div>
                                    <div
                                      onClick={() => toggleNode(`sub:${tblKey}:idx`)}
                                      className="flex items-center gap-1 py-1 hover:text-slate-200 cursor-pointer"
                                    >
                                      <Key className="w-3 h-3 text-amber-300" />
                                      <span>Indexes ({details.indexes.length})</span>
                                    </div>
                                    {expanded[`sub:${tblKey}:idx`] && (
                                      <div className="pl-4 space-y-0.5 text-[11px]">
                                        {details.indexes.map((idx, i) => (
                                          <div key={i} className="truncate text-slate-400">
                                            {idx.name} ({idx.column})
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>

                                  <div>
                                    <div
                                      onClick={() => toggleNode(`sub:${tblKey}:fk`)}
                                      className="flex items-center gap-1 py-1 hover:text-slate-200 cursor-pointer"
                                    >
                                      <Link2 className="w-3 h-3 text-purple-400" />
                                      <span>Foreign Keys ({details.foreignKeys.length})</span>
                                    </div>
                                    {expanded[`sub:${tblKey}:fk`] && (
                                      <div className="pl-4 space-y-0.5 text-[11px]">
                                        {details.foreignKeys.map((fk, i) => (
                                          <div key={i} className="truncate text-slate-400">
                                            {fk.columnName} → {fk.referencedTable}.{fk.referencedColumn}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Views, Procedures, & Triggers */}
                  {[
                    { key: 'views', label: 'Views', items: objs.views, type: 'view', icon: Eye, color: 'text-indigo-400' },
                    { key: 'procs', label: 'Procedures', items: objs.procedures, type: 'procedure', icon: Code2, color: 'text-pink-400' },
                    { key: 'triggers', label: 'Triggers', items: objs.triggers.map((t) => t.name), type: 'trigger', icon: Zap, color: 'text-yellow-400' },
                  ].map((group) => {
                    const IconComp = group.icon;
                    return (
                      <div key={group.key}>
                        <div
                          onClick={() => toggleNode(`folder:${db}:${group.key}`)}
                          className="flex items-center gap-1.5 px-2 py-1.5 md:py-1 hover:bg-slate-800/60 cursor-pointer text-slate-400"
                        >
                          {expanded[`folder:${db}:${group.key}`] ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          <IconComp className={`w-3.5 h-3.5 ${group.color}`} />
                          <span>
                            {group.label} ({group.items.length})
                          </span>
                        </div>
                        {expanded[`folder:${db}:${group.key}`] && (
                          <div className="pl-6 space-y-0.5">
                            {group.items.map((itemName) => (
                              <div
                                key={itemName}
                                onContextMenu={(e) =>
                                  openActionMenu(e, { nodeType: group.type, db, name: itemName })
                                }
                                className="flex items-center justify-between py-1.5 md:py-0.5 px-2 hover:bg-slate-800 cursor-pointer"
                              >
                                <span className="truncate">{itemName}</span>
                                <button
                                  onClick={(e) =>
                                    openActionMenu(e, { nodeType: group.type, db, name: itemName })
                                  }
                                  className="p-1 text-slate-500 hover:text-slate-200"
                                >
                                  <MoreVertical className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action Context Menu */}
      {contextMenu && (
        <div
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-48 bg-slate-800 border border-slate-700 rounded shadow-2xl py-1 text-xs text-slate-200"
        >
          {contextMenu.nodeType === 'database' && (
            <>
              <button
                onClick={() => loadDbObjects(contextMenu.db, true)}
                className="w-full text-left px-3 py-2 md:py-1.5 hover:bg-sky-600"
              >
                Refresh Database
              </button>
              <button
                onClick={() => onAction?.({ type: 'CREATE_TABLE', db: contextMenu.db })}
                className="w-full text-left px-3 py-2 md:py-1.5 hover:bg-sky-600"
              >
                Create Table...
              </button>
            </>
          )}

          {contextMenu.nodeType === 'table' && (
            <>
              <button
                onClick={() => onSelectTable?.(contextMenu.db, contextMenu.name)}
                className="w-full text-left px-3 py-2 md:py-1.5 hover:bg-sky-600 font-medium"
              >
                Open Table Data
              </button>
              <button
                onClick={() =>
                  onAction?.({ type: 'ALTER_TABLE', db: contextMenu.db, table: contextMenu.name })
                }
                className="w-full text-left px-3 py-2 md:py-1.5 hover:bg-sky-600"
              >
                Alter Table...
              </button>
              <button
                onClick={() => handleCopyCreate(contextMenu.db, 'table', contextMenu.name)}
                className="w-full text-left px-3 py-2 md:py-1.5 hover:bg-sky-600"
              >
                Copy CREATE Statement
              </button>
              <div className="my-1 border-t border-slate-700" />
              <button
                onClick={() =>
                  onAction?.({ type: 'TRUNCATE_TABLE', db: contextMenu.db, table: contextMenu.name })
                }
                className="w-full text-left px-3 py-2 md:py-1.5 hover:bg-amber-600 text-amber-300 hover:text-white"
              >
                Truncate Table
              </button>
              <button
                onClick={() =>
                  onAction?.({ type: 'DROP_TABLE', db: contextMenu.db, table: contextMenu.name })
                }
                className="w-full text-left px-3 py-2 md:py-1.5 hover:bg-red-600 text-red-400 hover:text-white"
              >
                Drop Table
              </button>
            </>
          )}

          {['view', 'procedure', 'trigger'].includes(contextMenu.nodeType) && (
            <button
              onClick={() =>
                handleCopyCreate(contextMenu.db, contextMenu.nodeType, contextMenu.name)
              }
              className="w-full text-left px-3 py-2 md:py-1.5 hover:bg-sky-600"
            >
              Copy CREATE Statement
            </button>
          )}
        </div>
      )}
    </div>
  );
}
