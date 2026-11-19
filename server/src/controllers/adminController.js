// server/src/controllers/adminController.js
const fs = require('fs');
const dumpService = require('../services/DumpService');
const adminService = require('../services/AdminService');

exports.exportDatabase = (req, res) => {
  try {
    const { sessionId, db } = req.params;
    const { mode, dropTable, includeRoutines, tables } = req.query;

    const parsedTables = tables ? tables.split(',').filter(Boolean) : [];
    const filename = `${db}_${new Date().toISOString().slice(0, 10)}.sql`;

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const dumpStream = dumpService.createExportStream(sessionId, db, {
      tables: parsedTables,
      mode: mode || 'structure_and_data',
      dropTable: dropTable !== 'false',
      includeRoutines: includeRoutines !== 'false',
    });

    dumpStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: err.message });
      } else {
        res.end(`\n-- EXPORT ERROR: ${err.message}\n`);
      }
    });

    dumpStream.pipe(res);
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.importSqlFile = async (req, res) => {
  const uploadedPath = req.file?.path;
  try {
    if (!uploadedPath) {
      return res.status(400).json({ success: false, message: 'File .sql tidak ditemukan.' });
    }
    const { sessionId } = req.params;
    const { database } = req.body;

    const result = await dumpService.executeSqlFileStream(
      sessionId,
      database || null,
      uploadedPath
    );
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  } finally {
    // Hapus file sementara dari disk setelah selesai diproses
    if (uploadedPath) {
      fs.unlink(uploadedPath, () => {});
    }
  }
};

exports.runMaintenance = async (req, res) => {
  try {
    const { sessionId, db } = req.params;
    const { tables, operation } = req.body;
    const result = await adminService.runTableMaintenance(sessionId, db, tables, operation);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.listUsers = async (req, res) => {
  try {
    const users = await adminService.listUsers(req.params.sessionId);
    res.json({ success: true, users });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.getUserGrants = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { user, host } = req.query;
    const grants = await adminService.getUserGrants(sessionId, user, host);
    res.json({ success: true, grants });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    await adminService.createUser(req.params.sessionId, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.updatePrivileges = async (req, res) => {
  try {
    const result = await adminService.updateUserPrivileges(req.params.sessionId, req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};

exports.dropUser = async (req, res) => {
  try {
    const { user, host } = req.body;
    await adminService.dropUser(req.params.sessionId, user, host);
    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
};
