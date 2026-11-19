const mysql = require('mysql2');
const connectionManager = require('./ConnectionManager');

const ALLOWED_OPERATORS = new Set([
  '=',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'LIKE',
  'NOT LIKE',
  'IS NULL',
  'IS NOT NULL',
]);

class TableService {
  /**
   * Mengambil data tabel dengan server-side pagination, sorting, dan filter WHERE aman
   */
  async getTableData(sessionId, db, table, options = {}) {
    const { pool } = connectionManager.getSession(sessionId);
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const pageSize = Math.min(1000, Math.max(1, parseInt(options.pageSize, 10) || 100));
    const offset = (page - 1) * pageSize;

    // 1. Ambil metadata kolom untuk validasi nama kolom & identifikasi Primary Key
    const [colRows] = await pool.query('SHOW FULL COLUMNS FROM ??.??', [db, table]);
    const columns = colRows.map((c) => ({
      name: c.Field,
      type: c.Type,
      nullable: c.Null === 'YES',
      key: c.Key,
      isPrimary: c.Key === 'PRI',
      default: c.Default,
      extra: c.Extra,
    }));

    const validColumnNames = new Set(columns.map((c) => c.name));
    const primaryKeys = columns.filter((c) => c.isPrimary).map((c) => c.name);

    // 2. Susun klausa WHERE berdasarkan filter yang divalidasi terhadap skema kolom
    const whereClauses = [];
    const whereParams = [];
    const filters = Array.isArray(options.filters) ? options.filters : [];

    for (const f of filters) {
      if (!f.column || !validColumnNames.has(f.column)) continue;
      const op = String(f.operator || '=').toUpperCase();
      if (!ALLOWED_OPERATORS.has(op)) continue;

      if (op === 'IS NULL' || op === 'IS NOT NULL') {
        whereClauses.push(`${mysql.escapeId(f.column)} ${op}`);
      } else {
        whereClauses.push(`${mysql.escapeId(f.column)} ${op} ?`);
        whereParams.push(f.value ?? '');
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 3. Susun klausa ORDER BY
    let orderSql = '';
    if (options.sortBy && validColumnNames.has(options.sortBy)) {
      const dir = String(options.sortDir || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      orderSql = `ORDER BY ${mysql.escapeId(options.sortBy)} ${dir}`;
    }

    // 4. Hitung total baris & ambil data halaman aktif
    const countQuery = `SELECT COUNT(*) AS total FROM ${mysql.escapeId(db)}.${mysql.escapeId(table)} ${whereSql}`;
    const dataQuery = mysql.format(
      `SELECT * FROM ${mysql.escapeId(db)}.${mysql.escapeId(table)} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
      [...whereParams, pageSize, offset]
    );

    const [[countResult], [rows]] = await Promise.all([
      pool.query(countQuery, whereParams),
      pool.query(dataQuery),
    ]);

    return {
      columns,
      primaryKeys,
      rows,
      totalRows: countResult[0]?.total ?? 0,
      page,
      pageSize,
      executedSql: dataQuery,
    };
  }

  /**
   * Menyusun array statement SQL (INSERT, UPDATE, DELETE) untuk preview maupun commit
   */
  buildDmlStatements(db, table, primaryKeys, payload = {}) {
    if (!primaryKeys || primaryKeys.length === 0) {
      throw new Error(
        'Tabel ini tidak memiliki Primary Key. Operasi inline UPDATE/DELETE dinonaktifkan demi keamanan data.'
      );
    }

    const targetTable = `${mysql.escapeId(db)}.${mysql.escapeId(table)}`;
    const statements = [];

    const buildWherePk = (pkValues) => {
      const parts = primaryKeys.map((pk) => {
        const val = pkValues[pk];
        if (val === null || val === undefined) {
          throw new Error(`Nilai Primary Key "${pk}" tidak ditemukan pada baris target.`);
        }
        return `${mysql.escapeId(pk)} = ${mysql.escape(val)}`;
      });
      return parts.join(' AND ');
    };

    // 1. UPDATE statements
    for (const upd of payload.updates || []) {
      const entries = Object.entries(upd.changes || {});
      if (entries.length === 0) continue;
      const setClause = entries
        .map(([col, val]) => `${mysql.escapeId(col)} = ${mysql.escape(val)}`)
        .join(', ');
      const whereClause = buildWherePk(upd.pkValues);
      statements.push(`UPDATE ${targetTable} SET ${setClause} WHERE ${whereClause};`);
    }

    // 2. INSERT statements
    for (const row of payload.inserts || []) {
      const entries = Object.entries(row || {}).filter(([, val]) => val !== undefined);
      if (entries.length === 0) {
        statements.push(`INSERT INTO ${targetTable} () VALUES ();`);
      } else {
        const cols = entries.map(([col]) => mysql.escapeId(col)).join(', ');
        const vals = entries.map(([, val]) => mysql.escape(val)).join(', ');
        statements.push(`INSERT INTO ${targetTable} (${cols}) VALUES (${vals});`);
      }
    }

    // 3. DELETE statements
    for (const del of payload.deletes || []) {
      const whereClause = buildWherePk(del.pkValues);
      statements.push(`DELETE FROM ${targetTable} WHERE ${whereClause};`);
    }

    return statements;
  }

  /**
   * Mengeksekusi seluruh perubahan DML dalam 1 transaksi atomik
   */
  async commitDml(sessionId, db, table, primaryKeys, payload) {
    const statements = this.buildDmlStatements(db, table, primaryKeys, payload);
    if (statements.length === 0) {
      return { affectedRows: 0, statements: [] };
    }

    const { pool } = connectionManager.getSession(sessionId);
    const conn = await pool.getConnection();

    try {
      await conn.beginTransaction();
      let totalAffected = 0;

      for (const stmt of statements) {
        const [res] = await conn.query(stmt);
        totalAffected += res.affectedRows ?? 0;
      }

      await conn.commit();
      return { affectedRows: totalAffected, statements };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * Menyusun definisi kolom SQL tunggal untuk CREATE / ALTER TABLE
   */
  _formatColumnDefinition(col) {
    const name = mysql.escapeId(col.name);
    const typeWithLen = col.length ? `${col.type}(${col.length})` : col.type;
    const unsigned = col.unsigned ? ' UNSIGNED' : '';
    const notNull = col.notNull ? ' NOT NULL' : ' NULL';
    const autoInc = col.autoIncrement ? ' AUTO_INCREMENT' : '';

    let defaultSql = '';
    if (!col.autoIncrement && col.defaultValue !== '' && col.defaultValue !== undefined && col.defaultValue !== null) {
      const upperDef = String(col.defaultValue).toUpperCase();
      if (upperDef === 'NULL') {
        defaultSql = ' DEFAULT NULL';
      } else if (upperDef === 'CURRENT_TIMESTAMP' || upperDef === 'CURRENT_TIMESTAMP()') {
        defaultSql = ` DEFAULT ${upperDef}`;
      } else {
        defaultSql = ` DEFAULT ${mysql.escape(col.defaultValue)}`;
      }
    }

    const commentSql = col.comment ? ` COMMENT ${mysql.escape(col.comment)}` : '';
    return `${name} ${typeWithLen}${unsigned}${notNull}${defaultSql}${autoInc}${commentSql}`;
  }

  /**
   * Menghasilkan DDL CREATE TABLE atau ALTER TABLE dari Visual Schema Designer
   */
  buildDdlStatements(db, table, mode, spec) {
    const targetTable = `${mysql.escapeId(db)}.${mysql.escapeId(table)}`;
    const columns = spec.columns || [];
    const indexes = spec.indexes || [];
    const foreignKeys = spec.foreignKeys || [];

    if (columns.length === 0) {
      throw new Error('Tabel minimal harus memiliki satu kolom.');
    }

    if (mode === 'create') {
      const lines = columns.map((col) => `  ${this._formatColumnDefinition(col)}`);

      const pkCols = columns.filter((c) => c.primaryKey).map((c) => mysql.escapeId(c.name));
      if (pkCols.length > 0) {
        lines.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
      }

      for (const idx of indexes) {
        if (!idx.columns || idx.columns.length === 0) continue;
        const idxName = idx.name ? mysql.escapeId(idx.name) : '';
        const cols = idx.columns.map((c) => mysql.escapeId(c)).join(', ');
        const prefix = idx.type === 'UNIQUE' ? 'UNIQUE KEY' : idx.type === 'FULLTEXT' ? 'FULLTEXT KEY' : 'KEY';
        lines.push(`  ${prefix} ${idxName} (${cols})`.replace(/\s+/g, ' '));
      }

      for (const fk of foreignKeys) {
        if (!fk.column || !fk.referencedTable || !fk.referencedColumn) continue;
        const constraint = fk.name ? `CONSTRAINT ${mysql.escapeId(fk.name)} ` : '';
        const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '';
        const onUpdate = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '';
        lines.push(
          `  ${constraint}FOREIGN KEY (${mysql.escapeId(fk.column)}) REFERENCES ${mysql.escapeId(
            fk.referencedTable
          )} (${mysql.escapeId(fk.referencedColumn)})${onDelete}${onUpdate}`
        );
      }

      const engine = spec.engine || 'InnoDB';
      const charset = spec.charset || 'utf8mb4';
      return [
        `CREATE TABLE ${targetTable} (\n${lines.join(',\n')}\n) ENGINE=${engine} DEFAULT CHARSET=${charset};`,
      ];
    }

    // Mode ALTER TABLE
    const alterClauses = [];
    const originalCols = spec.originalColumns || [];
    const originalMap = new Map(originalCols.map((c) => [c.id, c]));
    const currentIds = new Set(columns.map((c) => c.id));

    // Kolom yang dihapus
    for (const orig of originalCols) {
      if (!currentIds.has(orig.id)) {
        alterClauses.push(`  DROP COLUMN ${mysql.escapeId(orig.name)}`);
      }
    }

    // Kolom baru & kolom yang diubah
    for (const col of columns) {
      const orig = originalMap.get(col.id);
      if (!orig) {
        alterClauses.push(`  ADD COLUMN ${this._formatColumnDefinition(col)}`);
      } else if (orig.name !== col.name) {
        alterClauses.push(
          `  CHANGE COLUMN ${mysql.escapeId(orig.name)} ${this._formatColumnDefinition(col)}`
        );
      } else if (col._dirty) {
        alterClauses.push(`  MODIFY COLUMN ${this._formatColumnDefinition(col)}`);
      }
    }

    // Drop & Add Indexes yang berubah
    for (const dropIdx of spec.droppedIndexes || []) {
      if (dropIdx === 'PRIMARY') {
        alterClauses.push('  DROP PRIMARY KEY');
      } else {
        alterClauses.push(`  DROP INDEX ${mysql.escapeId(dropIdx)}`);
      }
    }

    for (const idx of indexes.filter((i) => i._isNew && i.columns?.length > 0)) {
      const idxName = idx.name ? mysql.escapeId(idx.name) : '';
      const cols = idx.columns.map((c) => mysql.escapeId(c)).join(', ');
      const prefix = idx.type === 'UNIQUE' ? 'ADD UNIQUE INDEX' : 'ADD INDEX';
      alterClauses.push(`  ${prefix} ${idxName} (${cols})`.replace(/\s+/g, ' '));
    }

    // Drop & Add Foreign Keys yang berubah
    for (const dropFk of spec.droppedForeignKeys || []) {
      alterClauses.push(`  DROP FOREIGN KEY ${mysql.escapeId(dropFk)}`);
    }

    for (const fk of foreignKeys.filter((f) => f._isNew && f.column && f.referencedTable)) {
      const constraint = fk.name ? `CONSTRAINT ${mysql.escapeId(fk.name)} ` : '';
      const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '';
      const onUpdate = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '';
      alterClauses.push(
        `  ADD ${constraint}FOREIGN KEY (${mysql.escapeId(fk.column)}) REFERENCES ${mysql.escapeId(
          fk.referencedTable
        )} (${mysql.escapeId(fk.referencedColumn)})${onDelete}${onUpdate}`
      );
    }

    if (alterClauses.length === 0) {
      return [];
    }

    return [`ALTER TABLE ${targetTable}\n${alterClauses.join(',\n')};`];
  }

  async executeDdl(sessionId, statements) {
    if (!statements || statements.length === 0) return;
    const { pool } = connectionManager.getSession(sessionId);
    for (const stmt of statements) {
      await pool.query(stmt);
    }
  }
}

module.exports = new TableService();
