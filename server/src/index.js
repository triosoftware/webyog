// server/src/index.js
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./routes/apiRoutes');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', apiRoutes);

app.listen(PORT,'127.0.0.1', () => {
  console.log(`WebYog Backend berjalan pada http://127.0.0.1:${PORT}`);
});
