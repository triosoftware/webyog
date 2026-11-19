// server/src/controllers/queryController.js
const queryExecutor = require('../services/QueryExecutor');

exports.executeQuery = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { sql, database } = req.body;

    if (!sql || !sql.trim()) {
      return res.status(400).json({ success: false, message: 'Query SQL tidak boleh kosong.' });
    }

    const outcome = await queryExecutor.execute(sessionId, sql, database);
    res.json(outcome);
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

exports.explainQuery = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { sql, database } = req.body;

    if (!sql || !sql.trim()) {
      return res.status(400).json({ success: false, message: 'Query SQL tidak boleh kosong.' });
    }

    const outcome = await queryExecutor.explain(sessionId, sql, database);
    res.json(outcome);
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

exports.getAutocompleteSchema = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { db } = req.query;
    const schema = await queryExecutor.getSchemaForAutocomplete(sessionId, db || null);
    res.json({ success: true, schema });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
