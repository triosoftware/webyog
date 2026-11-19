const API_BASE = '/api';

async function request(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error?.message || data.message || 'Terjadi kesalahan pada server');
  }
  return data;
}

export const dbApi = {
  testConnection: (config) =>
    request('/connections/test', { method: 'POST', body: JSON.stringify(config) }),

  connect: (config) =>
    request('/connections/connect', { method: 'POST', body: JSON.stringify(config) }),

  disconnect: (sessionId) =>
    request(`/connections/${sessionId}`, { method: 'DELETE' }),

  getDatabases: (sessionId) =>
    request(`/metadata/${sessionId}/databases`),

  getDatabaseObjects: (sessionId, db) =>
    request(`/metadata/${sessionId}/databases/${encodeURIComponent(db)}/objects`),

  getTableDetails: (sessionId, db, table) =>
    request(`/metadata/${sessionId}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/details`),

  getCreateStatement: (sessionId, db, type, name) =>
    request(`/metadata/${sessionId}/databases/${encodeURIComponent(db)}/ddl/${type}/${encodeURIComponent(name)}`),

  executeQuery: (sessionId, sql, database) =>
    request(`/query/${sessionId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ sql, database }),
    }),

  explainQuery: (sessionId, sql, database) =>
    request(`/query/${sessionId}/explain`, {
      method: 'POST',
      body: JSON.stringify({ sql, database }),
    }),

  getAutocompleteSchema: (sessionId, db = '') =>
    request(`/query/${sessionId}/schema${db ? `?db=${encodeURIComponent(db)}` : ''}`),

//  async getAutocompleteSchema(sessionId, database = null) {
///    const params = database ? `?database=${encodeURIComponent(database)}` : '';
//    const res = await fetch(`${API_BASE}/sessions/${sessionId}/autocomplete-schema${params}`);
//    const data = await res.json();
//    if (!res.ok) throw new Error(data.error || 'Gagal memuat skema autocomplete');
//    return data;
//  },

  // Table Data Grid & Schema Designer APIs
  getTableData: (sessionId, db, table, params) =>
    request(`/tables/${sessionId}/${encodeURIComponent(db)}/${encodeURIComponent(table)}/data`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  previewDml: (sessionId, db, table, primaryKeys, changes) =>
    request(`/tables/${sessionId}/${encodeURIComponent(db)}/${encodeURIComponent(table)}/dml/preview`, {
      method: 'POST',
      body: JSON.stringify({ primaryKeys, changes }),
    }),

  commitDml: (sessionId, db, table, primaryKeys, changes) =>
    request(`/tables/${sessionId}/${encodeURIComponent(db)}/${encodeURIComponent(table)}/dml/commit`, {
      method: 'POST',
      body: JSON.stringify({ primaryKeys, changes }),
    }),

  previewDdl: (sessionId, db, table, mode, spec) =>
    request(`/tables/${sessionId}/${encodeURIComponent(db)}/${encodeURIComponent(table)}/ddl/preview`, {
      method: 'POST',
      body: JSON.stringify({ mode, spec }),
    }),

  executeDdl: (sessionId, db, table, mode, spec) =>
    request(`/tables/${sessionId}/${encodeURIComponent(db)}/${encodeURIComponent(table)}/ddl/execute`, {
      method: 'POST',
      body: JSON.stringify({ mode, spec }),
    }),

  truncateTable: (sessionId, db, table) =>
    request(`/tables/${sessionId}/${encodeURIComponent(db)}/${encodeURIComponent(table)}/truncate`, {
      method: 'POST',
    }),

  dropTable: (sessionId, db, table) =>
    request(`/tables/${sessionId}/${encodeURIComponent(db)}/${encodeURIComponent(table)}`, {
      method: 'DELETE',
    }),

// Tambahkan method berikut ke dalam objek export const dbApi = { ... } di client/src/services/api.js
  getExportDownloadUrl: (sessionId, db, { mode, dropTable, includeRoutines, tables }) => {
    const params = new URLSearchParams({
      mode,
      dropTable: String(dropTable),
      includeRoutines: String(includeRoutines),
    });
    if (tables && tables.length > 0) {
      params.set('tables', tables.join(','));
    }
    return `${API_BASE}/dump/${sessionId}/${encodeURIComponent(db)}/export?${params.toString()}`;
  },

  importSqlFile: async (sessionId, file, database) => {
    const formData = new FormData();
    formData.append('sqlFile', file);
    if (database) formData.append('database', database);

    const res = await fetch(`${API_BASE}/dump/${sessionId}/import`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.message || 'Gagal mengimpor file SQL.');
    }
    return data;
  },

  runMaintenance: (sessionId, db, tables, operation) =>
    request(`/admin/${sessionId}/${encodeURIComponent(db)}/maintenance`, {
      method: 'POST',
      body: JSON.stringify({ tables, operation }),
    }),

  listUsers: (sessionId) => request(`/admin/${sessionId}/users`),

  getUserGrants: (sessionId, user, host) =>
    request(
      `/admin/${sessionId}/users/grants?user=${encodeURIComponent(user)}&host=${encodeURIComponent(host)}`
    ),

  createUser: (sessionId, payload) =>
    request(`/admin/${sessionId}/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateUserPrivileges: (sessionId, payload) =>
    request(`/admin/${sessionId}/users/privileges`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  dropUser: (sessionId, user, host) =>
    request(`/admin/${sessionId}/users`, {
      method: 'DELETE',
      body: JSON.stringify({ user, host }),
    }),
};
