import React, { useState, useEffect } from 'react';
import { Database, Server, Shield, Play, CheckCircle2, AlertCircle, Trash2, X } from 'lucide-react';
import { dbApi } from '../services/api';

const DEFAULT_FORM = {
  name: 'Local MySQL',
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  database: '',
  environment: 'development',
  ssh: {
    enabled: false,
    host: '',
    port: 22,
    username: '',
    password: '',
  },
};

export default function ConnectionModal({ isOpen, onClose, onConnected }) {
  const [savedProfiles, setSavedProfiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [activeTab, setActiveTab] = useState('mysql');
  const [status, setStatus] = useState({ type: null, message: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem('webyog_connections') || '[]');
    setSavedProfiles(stored);
  }, [isOpen]);

  if (!isOpen) return null;

  const saveProfileToLocal = () => {
    const profileId = selectedId || crypto.randomUUID();
    const newProfile = { ...form, id: profileId };
    const updated = selectedId
      ? savedProfiles.map((p) => (p.id === selectedId ? newProfile : p))
      : [...savedProfiles, newProfile];

    setSavedProfiles(updated);
    setSelectedId(profileId);
    localStorage.setItem('webyog_connections', JSON.stringify(updated));
    setStatus({ type: 'success', message: 'Profil koneksi disimpan.' });
  };

  const deleteProfile = (id, e) => {
    e.stopPropagation();
    const updated = savedProfiles.filter((p) => p.id !== id);
    setSavedProfiles(updated);
    localStorage.setItem('webyog_connections', JSON.stringify(updated));
    if (selectedId === id) {
      setSelectedId(null);
      setForm(DEFAULT_FORM);
    }
  };

  const handleTest = async () => {
    setLoading(true);
    setStatus({ type: null, message: '' });
    try {
      const res = await dbApi.testConnection(form);
      setStatus({ type: 'success', message: `Terhubung! Versi Server: ${res.version}` });
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus({ type: null, message: '' });
    try {
      const res = await dbApi.connect(form);
      onConnected(res);
      onClose();
    } catch (err) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const envBadge = {
    production: 'bg-red-500/20 text-red-400 border-red-500/40',
    staging: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
    development: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-2 sm:p-4">
      <div className="w-full max-w-3xl max-h-[92dvh] md:h-[460px] flex flex-col bg-slate-900 border border-slate-700 rounded-lg shadow-2xl text-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <Database className="w-4 h-4 text-sky-400" />
            <span>Connect to MySQL Host</span>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: Stack vertikal di mobile, split horizontal di desktop */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Daftar Saved Connections */}
          <div className="w-full md:w-60 max-h-36 md:max-h-none bg-slate-950 border-b md:border-b-0 md:border-r border-slate-800 p-2.5 md:p-3 flex flex-col shrink-0">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setForm(DEFAULT_FORM);
                setStatus({ type: null, message: '' });
              }}
              className="w-full mb-2 px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded transition shrink-0"
            >
              + New Connection
            </button>

            <div className="flex-1 overflow-y-auto space-y-1">
              {savedProfiles.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-2">Belum ada koneksi tersimpan</p>
              )}
              {savedProfiles.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    setSelectedId(p.id);
                    setForm(p);
                    setStatus({ type: null, message: '' });
                  }}
                  className={`group flex items-center justify-between px-2.5 py-2 md:py-1.5 rounded text-xs cursor-pointer ${
                    selectedId === p.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900'
                  }`}
                >
                  <div className="truncate pr-2">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {p.user}@{p.host}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => deleteProfile(p.id, e)}
                    className="p-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 text-slate-500 hover:text-red-400 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Form Konfigurasi */}
          <form onSubmit={handleConnect} className="flex-1 flex flex-col p-3 sm:p-4 overflow-hidden">
            <div className="flex gap-2 border-b border-slate-800 pb-2 mb-3 shrink-0">
              <button
                type="button"
                onClick={() => setActiveTab('mysql')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded ${
                  activeTab === 'mysql' ? 'bg-slate-800 text-sky-400 font-medium' : 'text-slate-400'
                }`}
              >
                <Server className="w-3.5 h-3.5" /> MySQL TCP/IP
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ssh')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded ${
                  activeTab === 'ssh' ? 'bg-slate-800 text-sky-400 font-medium' : 'text-slate-400'
                }`}
              >
                <Shield className="w-3.5 h-3.5" /> SSH Tunnel
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 text-xs pr-1">
              {activeTab === 'mysql' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-slate-400 mb-1">Connection Name</label>
                      <input
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 focus:border-sky-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Environment</label>
                      <select
                        value={form.environment}
                        onChange={(e) => setForm({ ...form, environment: e.target.value })}
                        className={`w-full border rounded px-2 py-1.5 outline-none bg-slate-950 ${envBadge[form.environment]}`}
                      >
                        <option value="development">Development</option>
                        <option value="staging">Staging</option>
                        <option value="production">Production</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-slate-400 mb-1">MySQL Host Address</label>
                      <input
                        type="text"
                        required
                        value={form.host}
                        onChange={(e) => setForm({ ...form, host: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 focus:border-sky-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Port</label>
                      <input
                        type="number"
                        required
                        value={form.port}
                        onChange={(e) => setForm({ ...form, port: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 focus:border-sky-500 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">Username</label>
                      <input
                        type="text"
                        required
                        value={form.user}
                        onChange={(e) => setForm({ ...form, user: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 focus:border-sky-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">Password</label>
                      <input
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 focus:border-sky-500 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-400 mb-1">Default Database(s) (Opsional)</label>
                    <input
                      type="text"
                      placeholder="Kosongkan untuk memuat semua database"
                      value={form.database}
                      onChange={(e) => setForm({ ...form, database: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 focus:border-sky-500 outline-none"
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={form.ssh.enabled}
                      onChange={(e) =>
                        setForm({ ...form, ssh: { ...form.ssh, enabled: e.target.checked } })
                      }
                      className="rounded bg-slate-950 border-slate-700"
                    />
                    <span>Use SSH Tunneling</span>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-slate-400 mb-1">SSH Host</label>
                      <input
                        type="text"
                        disabled={!form.ssh.enabled}
                        value={form.ssh.host}
                        onChange={(e) => setForm({ ...form, ssh: { ...form.ssh, host: e.target.value } })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 disabled:opacity-40"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">SSH Port</label>
                      <input
                        type="number"
                        disabled={!form.ssh.enabled}
                        value={form.ssh.port}
                        onChange={(e) => setForm({ ...form, ssh: { ...form.ssh, port: e.target.value } })}
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 disabled:opacity-40"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
                    <div>
                      <label className="block text-slate-400 mb-1">SSH Username</label>
                      <input
                        type="text"
                        disabled={!form.ssh.enabled}
                        value={form.ssh.username}
                        onChange={(e) =>
                          setForm({ ...form, ssh: { ...form.ssh, username: e.target.value } })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 disabled:opacity-40"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1">SSH Password</label>
                      <input
                        type="password"
                        disabled={!form.ssh.enabled}
                        value={form.ssh.password}
                        onChange={(e) =>
                          setForm({ ...form, ssh: { ...form.ssh, password: e.target.value } })
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 disabled:opacity-40"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Status Alert */}
            {status.message && (
              <div
                className={`mt-2 px-3 py-2 rounded text-xs flex items-center gap-2 shrink-0 ${
                  status.type === 'success'
                    ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-800'
                    : 'bg-red-950/70 text-red-300 border border-red-800'
                }`}
              >
                {status.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span className="truncate">{status.message}</span>
              </div>
            )}

            {/* Footer Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 mt-3 border-t border-slate-800 shrink-0">
              <button
                type="button"
                onClick={saveProfileToLocal}
                className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
              >
                Save Profile
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleTest}
                  className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded text-slate-200 disabled:opacity-50"
                >
                  Test
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded disabled:opacity-50"
                >
                  <Play className="w-3.5 h-3.5" />
                  {loading ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
