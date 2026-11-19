const connectionManager = require('./ConnectionManager');

const MYSQL_TYPE_MAP = {
  0: 'DECIMAL',
  1: 'TINYINT',
  2: 'SMALLINT',
  3: 'INT',
  4: 'FLOAT',
  5: 'DOUBLE',
  6: 'NULL',
  7: 'TIMESTAMP',
  8: 'BIGINT',
  9: 'MEDIUMINT',
  10: 'DATE',
  11: 'TIME',
  12: 'DATETIME',
  13: 'YEAR',
  15: 'VARCHAR',
  16: 'BIT',
  245: 'JSON',
  246: 'DECIMAL',
  249: 'TINYBLOB',
  250: 'MEDIUMBLOB',
  251: 'LONGBLOB',
  252: 'BLOB/TEXT',
  253: 'VARCHAR',
  254: 'CHAR',
};

// Bitmask flag internal protokol MySQL
const MYSQL_FLAGS = {
  NOT_NULL: 1,
  PRI_KEY: 2,
  AUTO_INCREMENT: 512,
};

class QueryExecutor {
  _formatDurationMs(startHrTime) {
    const diffNs = process.hrtime.bigint() - startHrTime;
    return Number((Number(diffNs) / 1e6).toFixed(2));
  }

  _mapFields(fieldPackets = []) {
    return fieldPackets.map((f) => {
      const flags = Number(f.flags || 0);
      return {
        name: f.name, // Nama kolom tampil (atau alias AS)
        orgName: f.orgName || f.name, // Nama kolom asli di tabel database
        table: f.table || '',
        orgTable: f.orgTable || f.table || '', // Nama tabel asli (meski memakai alias)
        db: f.db || '',
        type: MYSQL_TYPE_MAP[f.columnType] || 'UNKNOWN',
        isPrimary: (flags & MYSQL_FLAGS.PRI_KEY) !== 0,
        nullable: (flags & MYSQL_FLAGS.NOT_NULL) === 0,
        autoIncrement: (flags & MYSQL_FLAGS.AUTO_INCREMENT) !== 0,
      };
    });
  }

  /**
   * Mengevaluasi apakah hasil SELECT berasal dari 1 tabel fisik tunggal dan menyertakan Primary Key
   */
  _buildEditMetadata(mappedColumns, fallbackDb = null) {
    const baseTables = new Map();

    for (const col of mappedColumns) {
      if (col.orgTable) {
        const schemaName = col.db || fallbackDb || '';
        const key = `${schemaName}.${col.orgTable}`;
        baseTables.set(key, { db: schemaName, table: col.orgTable });
      }
    }

    if (baseTables.size === 0) {
      return {
        canEdit: false,
        reason: 'Hasil query bukan berasal dari tabel fisik (kalkulasi/fungsi).',
      };
    }

    if (baseTables.size > 1) {
      return {
        canEdit: false,
        reason: 'Query melibatkan lebih dari 1 tabel (JOIN).',
      };
    }

    const [{ db, table }] = Array.from(baseTables.values());
    if (!db) {
      return {
        canEdit: false,
        reason: 'Database target tidak terdeteksi.',
      };
    }

    const pkColumns = mappedColumns.filter((c) => c.isPrimary && c.orgTable === table);
    if (pkColumns.length === 0) {
      return {
        canEdit: false,
        reason: 'Primary Key tidak disertakan dalam kolom SELECT.',
      };
    }

    return {
      canEdit: true,
      reason: '',
      db,
      table,
      // Menyimpan pasangan nama kolom di hasil grid (alias) & nama kolom asli di DB
      primaryKeys: pkColumns.map((pk) => ({
        resultKey: pk.name,
        dbColumn: pk.orgName,
      })),
    };
  }

  _normalizeResults(rows, fields, fallbackDb = null) {
    const normalized = [];

    // Kasus 1: Single DML/DDL statement
    if (!Array.isArray(rows)) {
      normalized.push({
        type: 'ok',
        affectedRows: rows.affectedRows ?? 0,
        insertId: rows.insertId ?? 0,
        warningStatus: rows.warningStatus ?? 0,
        info: rows.info || '',
      });
      return normalized;
    }

    // Kasus 2: Single SELECT/SHOW/EXPLAIN statement
    const isSingleResultSet =
      fields && fields.length > 0 && !Array.isArray(fields[0]) && typeof fields[0] === 'object';

    if (isSingleResultSet) {
      const mappedCols = this._mapFields(fields);
      normalized.push({
        type: 'resultset',
        columns: mappedCols,
        rows,
        rowCount: rows.length,
        editMeta: this._buildEditMetadata(mappedCols, fallbackDb),
      });
      return normalized;
    }

    // Kasus 3: Multi-statement
    rows.forEach((item, idx) => {
      const itemFields = Array.isArray(fields) ? fields[idx] : undefined;
      if (Array.isArray(item)) {
        const mappedCols = this._mapFields(itemFields || []);
        normalized.push({
          type: 'resultset',
          columns: mappedCols,
          rows: item,
          rowCount: item.length,
          editMeta: this._buildEditMetadata(mappedCols, fallbackDb),
        });
      } else if (item && typeof item === 'object') {
        normalized.push({
          type: 'ok',
          affectedRows: item.affectedRows ?? 0,
          insertId: item.insertId ?? 0,
          warningStatus: item.warningStatus ?? 0,
          info: item.info || '',
        });
      }
    });

    return normalized;
  }

  async execute(sessionId, sql, database = null) {
    const { pool } = connectionManager.getSession(sessionId);
    const conn = await pool.getConnection();

    try {
      if (database) {
        await conn.query('USE ??', [database]);
      }

      const startTime = process.hrtime.bigint();
      try {
        const [rows, fields] = await conn.query(sql);
        const executionTimeMs = this._formatDurationMs(startTime);

        const [dbRows] = await conn.query('SELECT DATABASE() AS currentDb');
        const currentDatabase = dbRows[0]?.currentDb || database || null;

        const results = this._normalizeResults(rows, fields, currentDatabase);
        const totalAffectedRows = results.reduce(
          (acc, r) => acc + (r.type === 'ok' ? r.affectedRows : r.rowCount),
          0
        );

        return {
          success: true,
          executionTimeMs,
          currentDatabase,
          results,
          totalAffectedRows,
        };
      } catch (sqlErr) {
        const executionTimeMs = this._formatDurationMs(startTime);
        return {
          success: false,
          executionTimeMs,
          error: {
            code: sqlErr.code || 'ER_QUERY_FAILED',
            errno: sqlErr.errno || 0,
            sqlState: sqlErr.sqlState || '',
            message: sqlErr.sqlMessage || sqlErr.message,
          },
        };
      }
    } finally {
      conn.release();
    }
  }

  async explain(sessionId, sql, database = null) {
    const trimmed = sql.trim().replace(/;+$/, '');
    const explainSql = /^explain\s+/i.test(trimmed) ? trimmed : `EXPLAIN ${trimmed}`;
    return this.execute(sessionId, explainSql, database);
  }

  async getSchemaForAutocomplete(sessionId, database = null) {
    const { pool } = connectionManager.getSession(sessionId);

    const query = database
      ? `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME, ORDINAL_POSITION`
      : `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`;

    const [rows] = await pool.query(query, database ? [database] : []);

    const schemaMap = {};
    for (const row of rows) {
      const tableKey = database ? row.TABLE_NAME : `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
      if (!schemaMap[tableKey]) {
        schemaMap[tableKey] = {
          database: row.TABLE_SCHEMA,
          table: row.TABLE_NAME,
          columns: [],
        };
      }
      schemaMap[tableKey].columns.push({
        name: row.COLUMN_NAME,
        type: row.DATA_TYPE,
        isPrimary: row.COLUMN_KEY === 'PRI',
      });
    }

    return Object.values(schemaMap);
  }
}

module.exports = new QueryExecutor();
