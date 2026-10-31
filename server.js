const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const dbPath = process.env.DB_PATH || './astral_zenith.db';
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error(err.message);
    console.log(`Conectado a SQLite en: ${dbPath}`);
});

db.serialize(() => {
    // Tabla de Jugadores
    db.run(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT UNIQUE,
        gender TEXT,
        in_game_id TEXT
    )`);

    // NUEVA TABLA: Registro de Partidas, Kills y Fechas para el PDF
    db.run(`CREATE TABLE IF NOT EXISTS match_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER,
        category TEXT,
        points INTEGER,
        kills INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(player_id) REFERENCES players(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);

    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('event_end', '2026-10-25T23:59:00')`);
});

// Obtener fecha del evento
app.get('/api/settings/event_date', (req, res) => {
    db.get(`SELECT value FROM settings WHERE key = 'event_end'`, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ date: row ? row.value : null });
    });
});

// Reiniciar evento (Borra historial de puntos y actualiza fecha)
app.post('/api/settings/reset_event', (req, res) => {
    const { new_date } = req.body;
    db.serialize(() => {
        db.run(`DELETE FROM match_records`, (err) => {
            if (err) return res.status(500).json({ error: err.message });
        });
        db.run(`UPDATE settings SET value = ? WHERE key = 'event_end'`, [new_date], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('update_needed');
            io.emit('timer_updated', new_date);
            res.json({ success: true });
        });
    });
});

// Enviar Rankings (Suma general y Kills separadas)
app.get('/api/rankings', (req, res) => {
    const query = `
        SELECT p.id, p.nickname, p.gender, p.in_game_id,
               COALESCE(SUM(m.points), 0) as total_points,
               COALESCE(SUM(CASE WHEN m.category = 'Battle Royale' THEN m.kills ELSE 0 END), 0) as br_kills,
               COALESCE(SUM(CASE WHEN m.category = 'Multijugador' THEN m.kills ELSE 0 END), 0) as mj_kills
        FROM players p
        LEFT JOIN match_records m ON p.id = m.player_id
        GROUP BY p.id
        ORDER BY total_points DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Insertar Partida/Puntos (Automático)
app.post('/api/matches', (req, res) => {
    const { player_id, category, points, kills } = req.body;
    db.run(`INSERT INTO match_records (player_id, category, points, kills) VALUES (?, ?, ?, ?)`,
        [player_id, category, points, kills || 0], function (err) {
            if (err) return res.status(400).json({ error: err.message });
            io.emit('update_needed');
            res.json({ success: true });
        });
});

// Extraer Datos para el PDF (Historial completo)
app.get('/api/reports', (req, res) => {
    const query = `
        SELECT p.nickname, m.category, m.points, m.kills, m.created_at
        FROM match_records m
        JOIN players p ON p.id = m.player_id
        ORDER BY m.created_at DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// CRUD Jugadores
app.post('/api/players', (req, res) => {
    const { nickname, gender, in_game_id } = req.body;
    db.run(`INSERT INTO players (nickname, gender, in_game_id) VALUES (?, ?, ?)`,
        [nickname, gender, in_game_id], function (err) {
            if (err) return res.status(400).json({ error: err.message });
            io.emit('update_needed');
            res.json({ id: this.lastID, success: true });
        });
});

app.put('/api/players/:id', (req, res) => {
    const { nickname, gender, in_game_id } = req.body;
    db.run(`UPDATE players SET nickname = ?, gender = ?, in_game_id = ? WHERE id = ?`,
        [nickname, gender, in_game_id, req.params.id], function (err) {
            if (err) return res.status(400).json({ error: err.message });
            io.emit('update_needed');
            res.json({ success: true });
        });
});

app.delete('/api/players/:id', (req, res) => {
    const id = req.params.id;
    db.serialize(() => {
        db.run(`DELETE FROM match_records WHERE player_id = ?`, [id]);
        db.run(`DELETE FROM players WHERE id = ?`, [id], function (err) {
            if (err) return res.status(400).json({ error: err.message });
            io.emit('update_needed');
            res.json({ success: true });
        });
    });
});

// Autenticación de Admin
app.post('/api/admin-login', (req, res) => {
    const { password } = req.body;
    if (password === 'AstR09#Zet!H') {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Contraseña incorrecta' });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});