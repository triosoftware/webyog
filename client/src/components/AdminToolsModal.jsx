import React, { useState, useEffect } from 'react';
import { ShieldCheck, Wrench, UserPlus, Trash2, X, RefreshCw } from 'lucide-react';
import { dbApi } from '../services/api';

const COMMON_PRIVILEGES = [
  'ALL PRIVILEGES',
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'INDEX',
  'EXECUTE',
];

export default function AdminToolsModal({ isOpen, onClose, session, databases, defaultDb }) {
  const [activeTab, setActiveTab] = useState('maintenance');

  // Table Maintenance States
  const [selectedDb, setSelectedDb] = useState(defaultDb || databases[0] || '');
  const [tables, setTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [maintResults, setMaintResults] = useState([]);
  const [runningMaint, setRunningMaint] = useState(false);

  // User Manager States
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userGrants, setUserGrants] = useState([]);
  const [newUserForm, setNewUserForm] = useState({
    user: '',
    host: '%',
    password: '',
    database: '*',
    privileges: ['SELECT'],
  });

  useEffect(() => {
    if (defaultDb) setSelectedDb(defaultDb);
    else if (databases.length > 0 && !selectedDb) setSelectedDb(databases[0]);
  }, [defaultDb, databases, isOpen]);

  useEffect(() => {
    if (!isOpen || !session || !selectedDb) return;
    dbApi.getDatabaseObjects(session.sessionId, selectedDb).then((res) => {
      const tbls = res.objects.tables || [];
      setTables(tbls);
      setSelectedTables(tbls);
    });
  }, [isOpen, session?.sessionId, selectedDb]);

  const loadUsers = async () => {
    if (!session) return;
    try {
      const res = await dbApi.listUsers(session.sessionId);
      setUsers(res.users);
    } catch (err) {
      alert(`Gagal memuat daftar user (membutuhkan hak akses mysql.user): ${err.message}`);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'users') {
      loadUsers();
    }
  }, [isOpen, activeTab]);

  if (!isOpen || !session) return null;

  const handleRunMaintenance = async (operation) => {
    if (!selectedDb || selectedTables.length === 0) return;
    setRunningMaint(true);
    try {
      const res = await dbApi.runMaintenance(session.sessionId, selectedDb, selectedTables, operation);
      setMaintResults(res.results);
    } catch (err) {
      alert(err.message);
    } finally {
      setRunningMaint(false);
    }
  };

  const handleSelectUser = async (u) => {
    setSelectedUser(u);
    try {
      const res = await dbApi.getUserGrants(session.sessionId, u.user, u.host);
      setUserGrants(res.grants);
    } catch (err) {
      setUserGrants([`Error: ${err.message}`]);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await dbApi.createUser(session.sessionId, newUserForm);
      setNewUserForm({ user: '', host: '%', password: '', database: '*', privileges: ['SELECT'] });
      await loadUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDropUser = async (u) => {
    if (!window.confirm(`Hapus user '${u.user}'@'${u.host}'?`)) return;
    try {
      await dbApi.dropUser(session.sessionId, u.user, u.host);
      if (selectedUser?.user === u.user && selectedUser?.host === u.host) {
        setSelectedUser(null);
        setUserGrants([]);
      }
      await loadUsers();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4">
      <div className="w-full max-w-4xl h-[90dvh] md:h-[540px] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl text-slate-200 overflow-hidden text-xs">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span>Admin & Maintenance Tools</span>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950 px-3 sm:px-4 pt-2 gap-2 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('maintenance')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t border-t border-x shrink-0 ${
              activeTab === 'maintenance'
                ? 'bg-slate-900 text-amber-400 border-slate-700 font-medium'
                : 'text-slate-400 border-transparent'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>Table Maintenance</span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t border-t border-x shrink-0 ${
              activeTab === 'users'
                ? 'bg-slate-900 text-sky-400 border-slate-700 font-medium'
                : 'text-slate-400 border-transparent'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>User & Privileges</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto md:overflow-hidden p-3 sm:p-4">
          {activeTab === 'maintenance' ? (
            <div className="h-full flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 shrink-0">
                <select
                  value={selectedDb}
                  onChange={(e) => setSelectedDb(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
                >
                  {databases.map((db) => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 sm:flex gap-1.5">
                  {['ANALYZE', 'CHECK', 'OPTIMIZE', 'REPAIR'].map((op) => (
                    <button
                      key={op}
                      disabled={runningMaint || selectedTables.length === 0}
                      onClick={() => handleRunMaintenance(op)}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-amber-600 hover:text-white border border-slate-700 rounded font-medium disabled:opacity-40 transition"
                    >
                      {op} TABLE
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3 overflow-y-auto md:overflow-hidden">
                {/* Daftar Tabel */}
                <div className="max-h-40 md:max-h-none bg-slate-950 border border-slate-800 rounded p-2 overflow-y-auto font-mono">
                  <div className="flex justify-between text-[11px] text-slate-400 pb-1.5 mb-1.5 border-b border-slate-800">
                    <span>
                      Tables ({selectedTables.length}/{tables.length})
                    </span>
                    <button
                      onClick={() =>
                        setSelectedTables(selectedTables.length === tables.length ? [] : tables)
                      }
                      className="text-sky-400 hover:underline"
                    >
                      Toggle All
                    </button>
                  </div>
                  {tables.map((t) => (
                    <label
                      key={t}
                      className="flex items-center gap-2 py-1 md:py-0.5 cursor-pointer truncate"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTables.includes(t)}
                        onChange={() =>
                          setSelectedTables((prev) =>
                            prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                          )
                        }
                      />
                      <span className="truncate">{t}</span>
                    </label>
                  ))}
                </div>

                {/* Output Maintenance */}
                <div className="md:col-span-2 min-h-[180px] bg-slate-950 border border-slate-800 rounded overflow-auto">
                  <table className="w-full border-collapse text-left font-mono text-xs">
                    <thead className="bg-slate-900 border-b border-slate-800 sticky top-0">
                      <tr>
                        <th className="p-2">Table</th>
                        <th className="p-2">Op</th>
                        <th className="p-2">Msg_type</th>
                        <th className="p-2">Msg_text</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {maintResults.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-slate-500">
                            Pilih tabel dan klik operasi maintenance di atas.
                          </td>
                        </tr>
                      ) : (
                        maintResults.map((r, i) => (
                          <tr key={i}>
                            <td className="p-2 text-slate-300 whitespace-nowrap">{r.Table}</td>
                            <td className="p-2 text-sky-400 whitespace-nowrap">{r.Op}</td>
                            <td className="p-2 text-amber-400 whitespace-nowrap">{r.Msg_type}</td>
                            <td className="p-2 text-emerald-300">{r.Msg_text}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 overflow-y-auto md:overflow-hidden">
              {/* Daftar User */}
              <div className="max-h-40 md:max-h-none bg-slate-950 border border-slate-800 rounded flex flex-col overflow-hidden">
                <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
                  <span className="font-semibold">MySQL Accounts</span>
                  <button onClick={loadUsers} className="p-1 text-slate-400 hover:text-white">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 font-mono">
                  {users.map((u, idx) => {
                    const isSelected =
                      selectedUser?.user === u.user && selectedUser?.host === u.host;
                    return (
                      <div
                        key={idx}
                        onClick={() => handleSelectUser(u)}
                        className={`flex items-center justify-between px-3 py-2 cursor-pointer ${
                          isSelected ? 'bg-slate-800 text-sky-400' : 'hover:bg-slate-900'
                        }`}
                      >
                        <span className="truncate">
                          &apos;{u.user}&apos;@&apos;{u.host}&apos;
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDropUser(u);
                          }}
                          className="p-1 text-slate-500 hover:text-red-400 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Form Buat User & Detail Grants */}
              <div className="md:col-span-2 flex flex-col gap-3 overflow-y-auto pr-1">
                <form
                  onSubmit={handleCreateUser}
                  className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2.5"
                >
                  <div className="font-semibold text-slate-300">Create New User & Grant</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Username"
                      value={newUserForm.user}
                      onChange={(e) => setNewUserForm({ ...newUserForm, user: e.target.value })}
                      className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Host (% / localhost)"
                      value={newUserForm.host}
                      onChange={(e) => setNewUserForm({ ...newUserForm, host: e.target.value })}
                      className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={newUserForm.password}
                      onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                      className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-400">Scope DB:</span>
                    <select
                      value={newUserForm.database}
                      onChange={(e) => setNewUserForm({ ...newUserForm, database: e.target.value })}
                      className="bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 outline-none"
                    >
                      <option value="*">*.* (Global)</option>
                      {databases.map((db) => (
                        <option key={db} value={db}>
                          {db}.*
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {COMMON_PRIVILEGES.map((priv) => (
                      <label
                        key={priv}
                        className="flex items-center gap-1.5 bg-slate-900 px-2.5 py-1 rounded border border-slate-800 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={newUserForm.privileges.includes(priv)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setNewUserForm((prev) => ({
                              ...prev,
                              privileges: checked
                                ? [...prev.privileges, priv]
                                : prev.privileges.filter((p) => p !== priv),
                            }));
                          }}
                        />
                        <span className="text-[11px] font-mono">{priv}</span>
                      </label>
                    ))}
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="w-full sm:w-auto px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded"
                    >
                      Create User
                    </button>
                  </div>
                </form>

                {/* Active Grants Viewer */}
                <div className="min-h-[120px] flex-1 bg-slate-950 border border-slate-800 rounded p-3 flex flex-col">
                  <div className="font-semibold text-slate-300 mb-2">
                    {selectedUser
                      ? `Effective Grants: '${selectedUser.user}'@'${selectedUser.host}'`
                      : 'Pilih akun untuk melihat SHOW GRANTS'}
                  </div>
                  <pre className="flex-1 overflow-auto font-mono text-[11px] text-emerald-300 whitespace-pre-wrap">
                    {userGrants.join('\n\n')}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
