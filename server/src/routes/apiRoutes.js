// server/src/routes/apiRoutes.js
const express = require('express');
const os = require('os');
const multer = require('multer');
const router = express.Router();

const meta = require('../controllers/metadataController');
const queryCtrl = require('../controllers/queryController');
const tableCtrl = require('../controllers/tableController');
const adminCtrl = require('../controllers/adminController');

const upload = multer({ dest: os.tmpdir() });

// Connection Management
router.post('/connections/test', meta.testConnection);
router.post('/connections/connect', meta.connect);
router.delete('/connections/:sessionId', meta.disconnect);

// Metadata & Object Browser
router.get('/metadata/:sessionId/databases', meta.getDatabases);
router.get('/metadata/:sessionId/databases/:db/objects', meta.getDatabaseObjects);
router.get('/metadata/:sessionId/databases/:db/tables/:table/details', meta.getTableDetails);
router.get('/metadata/:sessionId/databases/:db/ddl/:type/:name', meta.getCreateStatement);

// Query Execution & Autocomplete Schema
router.post('/query/:sessionId/execute', queryCtrl.executeQuery);
router.post('/query/:sessionId/explain', queryCtrl.explainQuery);
router.get('/query/:sessionId/schema', queryCtrl.getAutocompleteSchema);

// Table Data Grid & Visual Schema Designer
router.post('/tables/:sessionId/:db/:table/data', tableCtrl.getTableData);
router.post('/tables/:sessionId/:db/:table/dml/preview', tableCtrl.previewDml);
router.post('/tables/:sessionId/:db/:table/dml/commit', tableCtrl.commitDml);
router.post('/tables/:sessionId/:db/:table/ddl/preview', tableCtrl.previewDdl);
router.post('/tables/:sessionId/:db/:table/ddl/execute', tableCtrl.executeDdl);
router.post('/tables/:sessionId/:db/:table/truncate', tableCtrl.truncateTable);
router.delete('/tables/:sessionId/:db/:table', tableCtrl.dropTable);

// Streaming Export/Import & Admin Tools
router.get('/dump/:sessionId/:db/export', adminCtrl.exportDatabase);
router.post('/dump/:sessionId/import', upload.single('sqlFile'), adminCtrl.importSqlFile);
router.post('/admin/:sessionId/:db/maintenance', adminCtrl.runMaintenance);
router.get('/admin/:sessionId/users', adminCtrl.listUsers);
router.get('/admin/:sessionId/users/grants', adminCtrl.getUserGrants);
router.post('/admin/:sessionId/users', adminCtrl.createUser);
router.post('/admin/:sessionId/users/privileges', adminCtrl.updatePrivileges);
router.delete('/admin/:sessionId/users', adminCtrl.dropUser);

module.exports = router;
