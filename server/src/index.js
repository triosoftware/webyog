const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 1. Endpoint autentikasi publik (login, logout, cek status sesi)
app.use('/api/auth', authRoutes);

// 2. Seluruh endpoint database & MySQL dilindungi middleware requireAuth
app.use('/api', requireAuth, apiRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Endpoint API tidak ditemukan' });
});

// 3. Sajikan production build React dari client/dist
const clientDistPath = path.resolve(__dirname, '../../client/dist');

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  app.use((req, res, next) => {
    if (req.method === 'GET') {
      return res.sendFile(path.join(clientDistPath, 'index.html'));
    }
    next();
  });
} else {
  app.get('/', (req, res) => {
    res.status(503).send(
      'Folder client/dist belum tersedia. Jalankan "npm run build" di folder client terlebih dahulu.'
    );
  });
}

app.use((err, req, res, next) => {
  console.error('[WebYog Error]:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Terjadi kesalahan internal pada server',
  });
});

app.listen(PORT, HOST, () => {
  console.log(`WebYog Server berjalan pada http://${HOST}:${PORT}`);
  if (!process.env.WEBYOG_PASS) {
    console.warn(
      '[PERINGATAN KEAMANAN] Menggunakan kredensial default (admin / webyog123). Atur WEBYOG_USER & WEBYOG_PASS pada server/.env'
    );
  }
});
