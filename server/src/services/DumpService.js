const { Readable } = require('stream');
const fs = require('fs');
const mysql = require('mysql2');
const connectionManager = require('./ConnectionManager');

class DumpService {
  /**
   * Menghasilkan Node.js Readable Stream untuk ekspor database/tabel ke format .sql
   * tanpa memuat seluruh dataset ke dalam RAM server.
   */
  createExportStream(sessionId, db, options = {}) {
    const {
      tables = [], // Kosong = semua tabel di database
      mode = 'structure_and_data', // 'structure_only' | 'data_only' | 'structure_and_data'
      dropTable = true,
      includeRoutines = true,
      batchSize = 250,
    } = options;

    const includeStructure = mode === 'structure_only' || mode === 'structure_and_data';
    const includeData = mode === 'data_only' || mode === 'structure_and_data';

    async function* generateSqlChunks() {
      const { pool, meta } = connectionManager.getSession(sessionId);
      const conn = await pool.getConnection();

      try {
        await conn.query('USE ??', [db]);

        // Header SQLyog-style
        yield `-- WebYog SQL Dump\n`;
        yield `-- Host: ${meta.host}:${meta.port}    Database: ${db}\n`;
        yield `-- Server version: ${meta.version}\n`;
        yield `-- Generated at: ${new Date().toISOString()}\n`;
        yield `-- ------------------------------------------------------\n\n`;
        yield `/*!40101 SET NAMES utf8mb4 */;\n`;
        yield `/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;\n`;
        yield `/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;\n\n`;

        // Tentukan daftar tabel target
        let targetTables = tables;
        if (!targetTables || targetTables.length === 0) {
          const [tblRows] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
          targetTables = tblRows.map((r) => Object.values(r)[0]);
        }

        for (const tableName of targetTables) {
          const escapedTbl = mysql.escapeId(tableName);

          // 1. Structure (DDL)
          if (includeStructure) {
            yield `--\n-- Table structure for table ${escapedTbl}\n--\n\n`;
            if (dropTable) {
              yield `DROP TABLE IF EXISTS ${escapedTbl};\n`;
            }
            const [createRows] = await conn.query(`SHOW CREATE TABLE ${escapedTbl}`);
            const ddl = createRows[0]['Create Table'];
            yield `${ddl};\n\n`;
          }

          // 2. Data (Row-by-row streaming dari MySQL socket)
          if (includeData) {
            yield `--\n-- Dumping data for table ${escapedTbl}\n--\n\n`;

            const [colRows] = await conn.query(`SHOW COLUMNS FROM ${escapedTbl}`);
            const colNames = colRows.map((c) => c.Field);
            const escapedCols = colNames.map((c) => mysql.escapeId(c)).join(', ');

            const rawQuery = conn.connection.query(`SELECT * FROM ${escapedTbl}`);
            const rowStream = rawQuery.stream({ highWaterMark: batchSize });

            let batchValues = [];
            let hasRows = false;

            for await (const row of rowStream) {
              if (!hasRows) {
                yield `LOCK TABLES ${escapedTbl} WRITE;\n`;
                hasRows = true;
              }

              const rowTuple =
                '(' + colNames.map((col) => mysql.escape(row[col])).join(', ') + ')';
              batchValues.push(rowTuple);

              if (batchValues.length >= batchSize) {
                yield `INSERT INTO ${escapedTbl} (${escapedCols}) VALUES\n${batchValues.join(
                  ',\n'
                )};\n`;
                batchValues = [];
              }
            }

            if (batchValues.length > 0) {
              yield `INSERT INTO ${escapedTbl} (${escapedCols}) VALUES\n${batchValues.join(
                ',\n'
              )};\n`;
            }

            if (hasRows) {
              yield `UNLOCK TABLES;\n\n`;
            }
          }
        }

        // 3. Views & Routines (jika mode menyertakan struktur)
        if (includeStructure && includeRoutines) {
          const [viewRows] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'VIEW'");
          for (const vRow of viewRows) {
            const viewName = Object.values(vRow)[0];
            const escapedView = mysql.escapeId(viewName);
            yield `--\n-- View structure for ${escapedView}\n--\n\n`;
            yield `DROP VIEW IF EXISTS ${escapedView};\n`;
            const [cView] = await conn.query(`SHOW CREATE VIEW ${escapedView}`);
            yield `${cView[0]['Create View']};\n\n`;
          }

          const [triggers] = await conn.query(
            'SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
            [db]
          );
          for (const trg of triggers) {
            const trgName = trg.TRIGGER_NAME;
            const [cTrg] = await conn.query(`SHOW CREATE TRIGGER ${mysql.escapeId(trgName)}`);
            yield `--\n-- Trigger ${mysql.escapeId(trgName)}\n--\n`;
            yield `DELIMITER ;;\n${cTrg[0]['SQL Original Statement']} ;;\nDELIMITER ;\n\n`;
          }
        }

        yield `/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;\n`;
        yield `/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;\n`;
      } finally {
        conn.release();
      }
    }

    return Readable.from(generateSqlChunks());
  }

  /**
   * Mengeksekusi file .sql berukuran besar secara streaming menggunakan state-machine parser
   * yang memahami string quotes, komentar, dan perubahan DELIMITER.
   */
  async executeSqlFileStream(sessionId, db, filePath) {
    const { pool } = connectionManager.getSession(sessionId);
    const conn = await pool.getConnection();

    const startTime = process.hrtime.bigint();
    let executedStatements = 0;

    try {
      if (db) {
        await conn.query('USE ??', [db]);
      }

      const readStream = fs.createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 64 * 1024, // 64KB chunk per bacaan
      });

      let delimiter = ';';
      let buffer = '';
      let inSingleQuote = false;
      let inDoubleQuote = false;
      let inBacktick = false;
      let inLineComment = false;
      let inBlockComment = false;
      let escapeNext = false;

      const runStatement = async (rawStmt) => {
        const stmt = rawStmt.trim();
        if (!stmt) return;

        // Tangani direktif DELIMITER (misal: DELIMITER $$ atau DELIMITER ;)
        const delimMatch = stmt.match(/^DELIMITER\s+(\S+)$/i);
        if (delimMatch) {
          delimiter = delimMatch[1];
          return;
        }

        await conn.query(stmt);
        executedStatements += 1;
      };

      for await (const chunk of readStream) {
        let i = 0;
        while (i < chunk.length) {
          const ch = chunk[i];
          const next = chunk[i + 1];

          // 1. Sedang di dalam komentar satu baris (-- atau #)
          if (inLineComment) {
            if (ch === '\n') {
              inLineComment = false;
              buffer += ch;
            }
            i += 1;
            continue;
          }

          // 2. Sedang di dalam komentar blok (/* ... */)
          // Catatan: MySQL conditional comment /*!40101 ... */ tetap harus dieksekusi!
          if (inBlockComment) {
            if (ch === '*' && next === '/') {
              inBlockComment = false;
              i += 2;
            } else {
              i += 1;
            }
            continue;
          }

          // 3. Karakter escape di dalam string literal
          if (escapeNext) {
            buffer += ch;
            escapeNext = false;
            i += 1;
            continue;
          }

          if ((inSingleQuote || inDoubleQuote) && ch === '\\') {
            buffer += ch;
            escapeNext = true;
            i += 1;
            continue;
          }

          // 4. Toggle kutip string / identifier
          if (!inDoubleQuote && !inBacktick && ch === "'") {
            inSingleQuote = !inSingleQuote;
            buffer += ch;
            i += 1;
            continue;
          }
          if (!inSingleQuote && !inBacktick && ch === '"') {
            inDoubleQuote = !inDoubleQuote;
            buffer += ch;
            i += 1;
            continue;
          }
          if (!inSingleQuote && !inDoubleQuote && ch === '`') {
            inBacktick = !inBacktick;
            buffer += ch;
            i += 1;
            continue;
          }

          // 5. Deteksi awal komentar & delimiter saat berada di luar literal string
          if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
            // Komentar # atau --
            if (ch === '#' || (ch === '-' && next === '-' && /\s/.test(chunk[i + 2] || ' '))) {
              inLineComment = true;
              i += 1;
              continue;
            }

            // Komentar blok standar /* ... */ (kecuali /*! ... */)
            if (ch === '/' && next === '*' && chunk[i + 2] !== '!') {
              inBlockComment = true;
              i += 2;
              continue;
            }

            // Deteksi direktif DELIMITER di awal baris
            if (
              (buffer.trim() === '' || buffer.endsWith('\n')) &&
              chunk.slice(i, i + 10).toUpperCase().startsWith('DELIMITER ')
            ) {
              const newlineIdx = chunk.indexOf('\n', i);
              if (newlineIdx !== -1) {
                const line = chunk.slice(i, newlineIdx).trim();
                const parts = line.split(/\s+/);
                if (parts[1]) delimiter = parts[1];
                i = newlineIdx + 1;
                continue;
              }
            }

            // Cek apakah buffer + ch diakhiri dengan delimiter aktif
            buffer += ch;
            if (buffer.endsWith(delimiter)) {
              const completeSql = buffer.slice(0, -delimiter.length);
              buffer = '';
              await runStatement(completeSql);
            }
            i += 1;
            continue;
          }

          buffer += ch;
          i += 1;
        }
      }

      // Sisa statement di akhir file tanpa delimiter penutup
      if (buffer.trim()) {
        await runStatement(buffer);
      }

      const elapsedMs = Number((Number(process.hrtime.bigint() - startTime) / 1e6).toFixed(2));
      return { executedStatements, elapsedMs };
    } finally {
      conn.release();
    }
  }
}

module.exports = new DumpService();
