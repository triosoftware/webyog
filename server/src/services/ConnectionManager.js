const mysql = require('mysql2/promise');
const { Client: SSHClient } = require('ssh2');
const net = require('net');
const { v4: uuidv4 } = require('uuid');

class ConnectionManager {
  constructor() {
    // Menyimpan sesi aktif: sessionId -> { pool, sshClient, forwardServer, meta, lastActivity }
    this.sessions = new Map();
    this.IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 menit

    // Pembersihan otomatis sesi tidak aktif setiap 5 menit
    setInterval(() => this.cleanupIdleSessions(), 5 * 60 * 1000);
  }

  async _createMysqlPool(config) {
    const baseDbConfig = {
      user: config.user,
      password: config.password,
      database: config.database || undefined,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      multipleStatements: true, // Dibutuhkan untuk eksekusi batch SQL di Tahap 2
      dateStrings: true, // Menjaga format DATETIME/DATE asli tanpa konversi timezone JS
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    };

    // Jika SSH Tunneling diaktifkan
    if (config.ssh && config.ssh.enabled) {
      return new Promise((resolve, reject) => {
        const sshClient = new SSHClient();

        sshClient
          .on('ready', () => {
            const forwardServer = net.createServer((sock) => {
              sshClient.forwardOut(
                sock.remoteAddress,
                sock.remotePort,
                config.host || '127.0.0.1',
                Number(config.port) || 3306,
                (err, stream) => {
                  if (err) {
                    sock.end();
                    return;
                  }
                  sock.pipe(stream).pipe(sock);
                }
              );
            });

            forwardServer.listen(0, '127.0.0.1', () => {
              const localPort = forwardServer.address().port;
              const pool = mysql.createPool({
                ...baseDbConfig,
                host: '127.0.0.1',
                port: localPort,
              });
              resolve({ pool, sshClient, forwardServer });
            });

            forwardServer.on('error', (err) => {
              sshClient.end();
              reject(err);
            });
          })
          .on('error', (err) => reject(err))
          .connect({
            host: config.ssh.host,
            port: Number(config.ssh.port) || 22,
            username: config.ssh.username,
            password: config.ssh.password || undefined,
            privateKey: config.ssh.privateKey || undefined,
          });
      });
    }

    // Koneksi TCP/IP Standar
    const pool = mysql.createPool({
      ...baseDbConfig,
      host: config.host || '127.0.0.1',
      port: Number(config.port) || 3306,
    });

    return { pool, sshClient: null, forwardServer: null };
  }

  async testConnection(config) {
    let resources = null;
    try {
      resources = await this._createMysqlPool(config);
      const conn = await resources.pool.getConnection();
      const [rows] = await conn.query('SELECT VERSION() AS version');
      conn.release();
      return { success: true, version: rows[0].version };
    } finally {
      if (resources) {
        await this._closeResources(resources);
      }
    }
  }

  async connect(config) {
    const resources = await this._createMysqlPool(config);
    try {
      const conn = await resources.pool.getConnection();
      const [rows] = await conn.query('SELECT VERSION() AS version');
      conn.release();

      const sessionId = uuidv4();
      this.sessions.set(sessionId, {
        ...resources,
        meta: {
          name: config.name || `${config.user}@${config.host}`,
          host: config.host,
          port: config.port || 3306,
          user: config.user,
          environment: config.environment || 'development', // production | staging | development
          version: rows[0].version,
        },
        lastActivity: Date.now(),
      });

      return {
        sessionId,
        meta: this.sessions.get(sessionId).meta,
      };
    } catch (err) {
      await this._closeResources(resources);
      throw err;
    }
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      const error = new Error('Sesi koneksi tidak ditemukan atau telah kedaluwarsa.');
      error.statusCode = 401;
      throw error;
    }
    session.lastActivity = Date.now();
    return session;
  }

  async disconnect(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      await this._closeResources(session);
      this.sessions.delete(sessionId);
    }
  }

  async _closeResources({ pool, sshClient, forwardServer }) {
    if (pool) await pool.end().catch(() => {});
    if (forwardServer) forwardServer.close();
    if (sshClient) sshClient.end();
  }

  async cleanupIdleSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivity > this.IDLE_TIMEOUT_MS) {
        await this.disconnect(sessionId);
      }
    }
  }
}

module.exports = new ConnectionManager();
