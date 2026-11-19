// server/src/controllers/tableController.js
const tableService = require('../services/TableService');
const connectionManager = require('../services/ConnectionManager');

exports.getTableData = async (req, res) => {
  try {
    const { sessionId, db, table } = req.params;
    const { page, pageSize, sortBy, sortDir, filters } = req.body || {};
    const result = await tableService.getTableData(sessionId, db, table, {
      page,
      pageSize,
      sortBy,
      sortDir,
      filters,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.previewDml = (req, res) => {
  try {
    const { db, table } = req.params;
    const { primaryKeys, changes } = req.body;
    const statements = tableService.buildDmlStatements(db, table, primaryKeys, changes);
    res.json({ success: true, statements });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.commitDml = async (req, res) => {
  try {
    const { sessionId, db, table } = req.params;
    const { primaryKeys, changes } = req.body;
    const result = await tableService.commitDml(sessionId, db, table, primaryKeys, changes);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.previewDdl = (req, res) => {
  try {
    const { db, table } = req.params;
    const { mode, spec } = req.body;
    const statements = tableService.buildDdlStatements(db, table, mode, spec);
    res.json({ success: true, statements });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

exports.executeDdl = async (req, res) => {
  try {
    const { sessionId, db, table } = req.params;
    const { mode, spec } = req.body;
    const statements = tableService.buildDdlStatements(db, table, mode, spec);
    await tableService.executeDdl(sessionId, statements);
    res.json({ success: true, statements });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.truncateTable = async (req, res) => {
  try {
    const { sessionId, db, table } = req.params;
    const { pool } = connectionManager.getSession(sessionId);
    await pool.query('TRUNCATE TABLE ??.??', [db, table]);
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.dropTable = async (req, res) => {
  try {
    const { sessionId, db, table } = req.params;
    const { pool } = connectionManager.getSession(sessionId);
    await pool.query('DROP TABLE ??.??', [db, table]);
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};
