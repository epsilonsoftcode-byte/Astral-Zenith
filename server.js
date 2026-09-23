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
    db.run(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT UNIQUE,
        gender TEXT,
        in_game_id TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER,
        points INTEGER,
        category TEXT,
        reason TEXT,
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

// Reiniciar evento
app.post('/api/settings/reset_event', (req, res) => {
    const { new_date } = req.body;
    db.serialize(() => {
        db.run(`DELETE FROM points`, (err) => {
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

app.get('/api/rankings', (req, res) => {
    const query = `
    SELECT p.id, p.nickname, p.gender, p.in_game_id,
    COALESCE(SUM(pt.points), 0) as total_points,
        COALESCE(SUM(CASE WHEN pt.category = 'Battle Royale' THEN pt.points ELSE 0 END), 0) as br_points,
        COALESCE(SUM(CASE WHEN pt.category = 'Multijugador' THEN pt.points ELSE 0 END), 0) as mj_points
        FROM players p
        LEFT JOIN points pt ON p.id = pt.player_id
        GROUP BY p.id
        ORDER BY total_points DESC
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
           [nickname, gender, in_game_id], function(err) {
               if (err) return res.status(400).json({ error: err.message });
               io.emit('update_needed');
               res.json({ id: this.lastID, success: true });
           });
});

app.put('/api/players/:id', (req, res) => {
    const { nickname, gender, in_game_id } = req.body;
    db.run(`UPDATE players SET nickname = ?, gender = ?, in_game_id = ? WHERE id = ?`,
           [nickname, gender, in_game_id, req.params.id], function(err) {
               if (err) return res.status(400).json({ error: err.message });
               io.emit('update_needed');
               res.json({ success: true });
           });
});

app.delete('/api/players/:id', (req, res) => {
    const id = req.params.id;
    db.serialize(() => {
        db.run(`DELETE FROM points WHERE player_id = ?`, [id]);
        db.run(`DELETE FROM players WHERE id = ?`, [id], function(err) {
            if (err) return res.status(400).json({ error: err.message });
            io.emit('update_needed');
            res.json({ success: true });
        });
    });
});

app.post('/api/points', (req, res) => {
    const { player_id, points, category, reason } = req.body;
    db.run(`INSERT INTO points (player_id, points, category, reason) VALUES (?, ?, ?, ?)`,
           [player_id, points, category, reason], function(err) {
               if (err) return res.status(400).json({ error: err.message });
               io.emit('update_needed');
               res.json({ success: true });
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
