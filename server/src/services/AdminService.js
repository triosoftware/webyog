const mysql = require('mysql2');
const connectionManager = require('./ConnectionManager');

const ALLOWED_MAINTENANCE_OPS = new Set(['OPTIMIZE', 'CHECK', 'ANALYZE', 'REPAIR']);

class AdminService {
  /**
   * Menjalankan OPTIMIZE, CHECK, ANALYZE, atau REPAIR pada daftar tabel terpilih
   */
  async runTableMaintenance(sessionId, db, tables, operation) {
    const op = String(operation || '').toUpperCase();
    if (!ALLOWED_MAINTENANCE_OPS.has(op)) {
      throw new Error(`Operasi maintenance tidak valid: ${operation}`);
    }
    if (!Array.isArray(tables) || tables.length === 0) {
      throw new Error('Pilih minimal satu tabel untuk dijalankan maintenance.');
    }

    const { pool } = connectionManager.getSession(sessionId);
    const targetList = tables
      .map((t) => `${mysql.escapeId(db)}.${mysql.escapeId(t)}`)
      .join(', ');

    const sql = `${op} TABLE ${targetList}`;
    const [rows] = await pool.query(sql);
    return { sql, results: rows };
  }

  /**
   * Mengambil daftar user MySQL dari tabel sistem mysql.user
   */
  async listUsers(sessionId) {
    const { pool } = connectionManager.getSession(sessionId);
    const [rows] = await pool.query(
      `SELECT User AS user, Host AS host, account_locked AS locked, plugin 
       FROM mysql.user 
       ORDER BY User, Host`
    );
    return rows;
  }

  /**
   * Mengambil daftar hak akses (SHOW GRANTS) milik user tertentu
   */
  async getUserGrants(sessionId, user, host) {
    const { pool } = connectionManager.getSession(sessionId);
    const sql = `SHOW GRANTS FOR ${mysql.escape(user)}@${mysql.escape(host)}`;
    const [rows] = await pool.query(sql);
    return rows.map((r) => Object.values(r)[0]);
  }

  /**
   * Membuat user baru dan mengatur hak aksesnya
   */
  async createUser(sessionId, { user, host = '%', password, privileges = [], database = '*' }) {
    if (!user || !user.trim()) {
      throw new Error('Username tidak boleh kosong.');
    }
    const { pool } = connectionManager.getSession(sessionId);
    const userHost = `${mysql.escape(user.trim())}@${mysql.escape(host || '%')}`;

    const createSql = password
      ? `CREATE USER ${userHost} IDENTIFIED BY ${mysql.escape(password)}`
      : `CREATE USER ${userHost}`;

    await pool.query(createSql);

    if (privileges.length > 0) {
      await this.updateUserPrivileges(sessionId, {
        user: user.trim(),
        host: host || '%',
        database,
        privileges,
        action: 'GRANT',
      });
    }

    await pool.query('FLUSH PRIVILEGES');
    return { success: true };
  }

  /**
   * GRANT atau REVOKE hak akses pada database tertentu (* atau nama_db)
   */
  async updateUserPrivileges(sessionId, { user, host, database = '*', privileges = [], action = 'GRANT' }) {
    if (!Array.isArray(privileges) || privileges.length === 0) {
      throw new Error('Pilih minimal satu privilege.');
    }

    const { pool } = connectionManager.getSession(sessionId);
    const userHost = `${mysql.escape(user)}@${mysql.escape(host)}`;
    const targetScope = database === '*' ? '*.*' : `${mysql.escapeId(database)}.*`;
    const privList = privileges.map((p) => p.toUpperCase()).join(', ');

    const sql =
      action.toUpperCase() === 'REVOKE'
        ? `REVOKE ${privList} ON ${targetScope} FROM ${userHost}`
        : `GRANT ${privList} ON ${targetScope} TO ${userHost}`;

    await pool.query(sql);
    await pool.query('FLUSH PRIVILEGES');
    return { sql };
  }

  async dropUser(sessionId, user, host) {
    const { pool } = connectionManager.getSession(sessionId);
    const sql = `DROP USER ${mysql.escape(user)}@${mysql.escape(host)}`;
    await pool.query(sql);
    await pool.query('FLUSH PRIVILEGES');
  }
}

module.exports = new AdminService();
