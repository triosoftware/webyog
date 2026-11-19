const connectionManager = require('../services/ConnectionManager');

exports.testConnection = async (req, res) => {
  try {
    const result = await connectionManager.testConnection(req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.connect = async (req, res) => {
  try {
    const sessionData = await connectionManager.connect(req.body);
    res.json({ success: true, ...sessionData });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.disconnect = async (req, res) => {
  try {
    await connectionManager.disconnect(req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDatabases = async (req, res) => {
  try {
    const { pool } = connectionManager.getSession(req.params.sessionId);
    const [rows] = await pool.query('SHOW DATABASES');
    const databases = rows.map((row) => Object.values(row)[0]);
    res.json({ success: true, databases });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

exports.getDatabaseObjects = async (req, res) => {
  try {
    const { sessionId, db } = req.params;
    const { pool } = connectionManager.getSession(sessionId);

    // Eksekusi paralel untuk memuat daftar Tables, Views, Routines, dan Triggers
    const [tablesRes, routinesRes, triggersRes] = await Promise.all([
      pool.query('SHOW FULL TABLES FROM ??', [db]),
      pool.query(
        `SELECT ROUTINE_NAME, ROUTINE_TYPE 
         FROM INFORMATION_SCHEMA.ROUTINES 
         WHERE ROUTINE_SCHEMA = ? 
         ORDER BY ROUTINE_NAME`,
        [db]
      ),
      pool.query(
        `SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE 
         FROM INFORMATION_SCHEMA.TRIGGERS 
         WHERE TRIGGER_SCHEMA = ? 
         ORDER BY TRIGGER_NAME`,
        [db]
      ),
    ]);

    const tables = [];
    const views = [];

    for (const row of tablesRes[0]) {
      const values = Object.values(row);
      const name = values[0];
      const type = values[1];
      if (type === 'VIEW') {
        views.push(name);
      } else {
        tables.push(name);
      }
    }

    const procedures = routinesRes[0]
      .filter((r) => r.ROUTINE_TYPE === 'PROCEDURE')
      .map((r) => r.ROUTINE_NAME);

    const functions = routinesRes[0]
      .filter((r) => r.ROUTINE_TYPE === 'FUNCTION')
      .map((r) => r.ROUTINE_NAME);

    const triggers = triggersRes[0].map((t) => ({
      name: t.TRIGGER_NAME,
      event: t.EVENT_MANIPULATION,
      table: t.EVENT_OBJECT_TABLE,
    }));

    res.json({
      success: true,
      objects: { tables, views, procedures, functions, triggers },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

exports.getTableDetails = async (req, res) => {
  try {
    const { sessionId, db, table } = req.params;
    const { pool } = connectionManager.getSession(sessionId);

    const [columnsRes, indexesRes, fkRes] = await Promise.all([
      pool.query('SHOW FULL COLUMNS FROM ??.??', [db, table]),
      pool.query('SHOW INDEX FROM ??.??', [db, table]),
      pool.query(
        `SELECT 
          CONSTRAINT_NAME AS name,
          COLUMN_NAME AS columnName,
          REFERENCED_TABLE_NAME AS referencedTable,
          REFERENCED_COLUMN_NAME AS referencedColumn
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? 
           AND TABLE_NAME = ? 
           AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [db, table]
      ),
    ]);

    const columns = columnsRes[0].map((col) => ({
      name: col.Field,
      type: col.Type,
      nullable: col.Null === 'YES',
      key: col.Key, // PRI, UNI, MUL
      default: col.Default,
      extra: col.Extra,
      comment: col.Comment,
    }));

    const indexes = indexesRes[0].map((idx) => ({
      name: idx.Key_name,
      column: idx.Column_name,
      nonUnique: idx.Non_unique === 1,
      type: idx.Index_type,
    }));

    res.json({
      success: true,
      details: {
        columns,
        indexes,
        foreignKeys: fkRes[0],
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

exports.getCreateStatement = async (req, res) => {
  try {
    const { sessionId, db, type, name } = req.params;
    const { pool } = connectionManager.getSession(sessionId);

    const allowedTypes = {
      table: 'TABLE',
      view: 'VIEW',
      procedure: 'PROCEDURE',
      function: 'FUNCTION',
      trigger: 'TRIGGER',
    };

    const sqlType = allowedTypes[type.toLowerCase()];
    if (!sqlType) {
      return res.status(400).json({ success: false, message: 'Tipe objek tidak valid.' });
    }

    const [rows] = await pool.query(`SHOW CREATE ${sqlType} ??.??`, [db, name]);
    const row = rows[0];
    // Kolom DDL biasanya berada di indeks ke-1 (Table/View) atau ke-2 (Procedure/Function/Trigger)
    const ddlKey = Object.keys(row).find((k) => k.toLowerCase().startsWith('create '));

    res.json({ success: true, ddl: row[ddlKey] });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
