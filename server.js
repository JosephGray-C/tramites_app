const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'tramites.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const KEY_FILE = path.join(DATA_DIR, 'enc.key');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ensure DB files
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));

// encryption key (for prototype only) - stored locally
let ENC_KEY;
if (fs.existsSync(KEY_FILE)) {
    ENC_KEY = fs.readFileSync(KEY_FILE);
} else {
    ENC_KEY = crypto.randomBytes(32); // AES-256
    fs.writeFileSync(KEY_FILE, ENC_KEY);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Persistent session store
const sessions = {}; // In-memory for now, but persists across requests
const sessionSecret = 'conesup-prototype-secret';

app.use(session({
    secret: sessionSecret,
    resave: true,
    saveUninitialized: false,
    cookie: {
        httpOnly: false,
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
app.use(express.static(path.join(__dirname, 'public')));

// multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// NEW ENDPOINTS: Register + Login with simplified flow

// Register: Store user locally, auto-login
app.post('/api/register', (req, res) => {
    const { nombre, email, cedula, rol } = req.body;
    if (!nombre || !email || !cedula || !rol) return res.status(400).json({ error: 'Todos los campos son requeridos' });

    const users = readUsers();
    if (users.find(u => u.email === email || u.cedula === cedula))
        return res.status(400).json({ error: 'Usuario ya existe' });

    const newUser = { id: uuidv4(), nombre, email, cedula, rol, sesion: 1, fechaRegistro: new Date().toISOString() };
    users.push(newUser);
    writeUsers(users);

    // Create JWT token
    const token = createToken(newUser);

    return res.json({ message: 'Usuario registrado e iniciado sesión', user: newUser, token: token });
});

// Login: Email + Cedula, then show MFA code in modal popup
app.post('/api/login', (req, res) => {
    const { email, cedula } = req.body;
    if (!email || !cedula) return res.status(400).json({ error: 'Email y cédula requeridos' });

    const users = readUsers();
    const user = users.find(u => u.email === email && u.cedula === cedula);
    if (!user) return res.status(401).json({ error: 'Usuario o cédula inválidos' });

    // Generate MFA code for popup display
    const code = String(Math.floor(100000 + Math.random() * 900000));
    req.session.tmp_user = { id: user.id, nombre: user.nombre, email: user.email, cedula: user.cedula, rol: user.rol };
    req.session.mfa_code = code;

    return res.json({ message: 'Código MFA generado', code, user: req.session.tmp_user });
});// JWT Secret
const JWT_SECRET = 'conesup-jwt-secret-key-DO-NOT-USE-IN-PRODUCTION';

function createToken(user) {
    return jwt.sign({ id: user.id, email: user.email, rol: user.rol }, JWT_SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

// Middleware to check JWT token
function requireAuth(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1] || req.cookies?.token;
    const decoded = verifyToken(token);
    if (!decoded) return res.status(401).json({ error: 'No autenticado' });
    req.user = decoded;
    next();
}

// Verify MFA code
app.post('/api/verify-mfa', (req, res) => {
    const { code } = req.body;
    if (!req.session.tmp_user) return res.status(401).json({ error: 'No hay login pendiente' });
    if (req.session.mfa_code === String(code)) {
        const user = req.session.tmp_user;
        const token = createToken(user);
        delete req.session.tmp_user;
        delete req.session.mfa_code;

        // Update sesion flag to 1 in users.json
        const users = readUsers();
        const userIdx = users.findIndex(u => u.id === user.id);
        if (userIdx !== -1) {
            users[userIdx].sesion = 1;
            writeUsers(users);
        }

        return res.json({ message: 'MFA verificado', user: user, token: token });
    }
    return res.status(401).json({ error: 'Código inválido' });
});

// Check session status - now checks JWT token
app.get('/api/session', (req, res) => {
    const token = req.headers['authorization']?.split(' ')[1] || req.cookies?.token;
    const decoded = verifyToken(token);
    if (decoded) {
        const users = readUsers();
        const user = users.find(u => u.id === decoded.id);
        return res.json({ authenticated: true, user: user });
    }
    return res.json({ authenticated: false });
});

// Logout
app.post('/api/logout', requireAuth, (req, res) => {
    // Update sesion flag to 0 in users.json
    const users = readUsers();
    const userIdx = users.findIndex(u => u.id === req.user.id);
    if (userIdx !== -1) {
        users[userIdx].sesion = 0;
        writeUsers(users);
    }
    return res.json({ message: 'Sesión cerrada' });
});

function requireRole(roles) {
    return (req, res, next) => {
        if (!req.user) return res.status(401).json({ error: 'authentication required' });
        if (roles.includes(req.user.rol)) return next();
        return res.status(403).json({ error: 'forbidden' });
    };
}

// helpers: read/write DB
function readDB() {
    try { return JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { return []; }
}
function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function readUsers() {
    try { return JSON.parse(fs.readFileSync(USERS_FILE)); } catch (e) { return []; }
}
function writeUsers(data) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

// file encryption using AES-256-GCM
function encryptBuffer(buffer) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { iv: iv.toString('hex'), tag: tag.toString('hex'), data: encrypted.toString('hex') };
}

function decryptToBuffer(obj) {
    const iv = Buffer.from(obj.iv, 'hex');
    const tag = Buffer.from(obj.tag, 'hex');
    const data = Buffer.from(obj.data, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(data), decipher.final()]);
    return out;
}

// Create tramite - only allow Estudiante, Representante, Delegado
app.post('/api/tramites', requireAuth, upload.array('docs', 5), (req, res) => {
    const allowed = ['Estudiante', 'Representante', 'Delegado'];
    if (!allowed.includes(req.user.rol)) return res.status(403).json({ error: 'Solo usuarios de universidad pueden crear trámites' });

    const body = req.body;
    // Don't require docs on submission - user may have none yet
    const requiredFields = ['nombre', 'cedula'];
    for (const f of requiredFields) if (!body[f]) return res.status(400).json({ error: 'Debe rellenar todos los campos' });

    const tramites = readDB();
    const id = uuidv4();
    const initial = {
        id,
        version: 1,
        tipo: body.tipo || 'General',
        fechaCreacion: new Date().toISOString(),
        fechaActualizacion: new Date().toISOString(),
        estado: 'Pendiente',
        datos: {
            nombre: body.nombre,
            cedula: body.cedula,
            telefono: body.telefono || '',
            grado: body.grado || '',
            universidad: body.universidad || '',
            sede: body.sede || '',
            rol: req.user.rol
        },
        documentos: [],
        usuarioCreador: req.user.email,
        historial: []
    };

    if (req.files && req.files.length) {
        for (const f of req.files) {
            const enc = encryptBuffer(f.buffer);
            const name = `${id}_${Date.now()}_${f.originalname}`;
            fs.writeFileSync(path.join(UPLOAD_DIR, name + '.enc'), JSON.stringify(enc));
            initial.documentos.push({ name: f.originalname, file: name + '.enc' });
        }
    }

    tramites.push(initial);
    writeDB(tramites);
    return res.json({ message: 'Trámite registrado con éxito', tramite: initial });
});

// List tramites: for funcionario return all, for user return their own
app.get('/api/tramites', requireAuth, (req, res) => {
    const tramites = readDB();
    if (req.user.rol === 'Funcionario') return res.json(tramites);
    const mine = tramites.filter(t => t.usuarioCreador === req.user.email);
    return res.json(mine);
});

// download document (decrypt)
app.get('/api/tramites/:id/document/:file', requireAuth, (req, res) => {
    const { id, file } = req.params;
    const tramites = readDB();
    const t = tramites.find(x => x.id === id);
    if (!t) return res.status(404).json({ error: 'not found' });
    // check access: owner or funcionario
    if (req.user.rol !== 'Funcionario' && t.usuarioCreador !== req.user.email) return res.status(403).json({ error: 'forbidden' });
    const filePath = path.join(UPLOAD_DIR, file);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
    const enc = JSON.parse(fs.readFileSync(filePath));
    const buf = decryptToBuffer(enc);
    res.setHeader('Content-Disposition', `attachment; filename="${t.documentos.find(d => d.file === file)?.name || 'doc'}"`);
    res.send(buf);
});

// update state (funcionario only)
app.post('/api/tramites/:id/state', requireAuth, (req, res) => {
    if (req.user.rol !== 'Funcionario') return res.status(403).json({ error: 'Solo funcionarios pueden cambiar estado' });

    const { id } = req.params;
    const { estado } = req.body;
    const allowedStates = ['Pendiente', 'EnRevisión', 'Aprobado', 'Rechazado', 'Archivado'];
    if (!allowedStates.includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
    const tramites = readDB();
    const t = tramites.find(x => x.id === id);
    if (!t) return res.status(404).json({ error: 'Trámite no encontrado' });
    // check sequential flow
    const seq = ['Pendiente', 'EnRevisión', 'Aprobado', 'Rechazado', 'Archivado'];
    const curIdx = seq.indexOf(t.estado);
    const newIdx = seq.indexOf(estado);
    if (newIdx < curIdx) return res.status(400).json({ error: 'No se puede retroceder de estado' });
    t.historial.push({ accion: 'cambio_estado', desde: t.estado, hasta: estado, usuario: req.user.email, fecha: new Date().toISOString() });
    t.estado = estado;
    t.fechaActualizacion = new Date().toISOString();
    t.usuarioActualiza = req.user.email;
    writeDB(tramites);
    console.log(`Notificar a ${t.usuarioCreador}: estado cambiado a ${estado}`);
    return res.json({ message: 'Estado actualizado', tramite: t });
});

// resend (user for rejected only) -> create new version
app.post('/api/tramites/:id/resend', requireAuth, upload.array('docs', 5), (req, res) => {
    const { id } = req.params;
    const tramites = readDB();
    const t = tramites.find(x => x.id === id);
    if (!t) return res.status(404).json({ error: 'Trámite no encontrado' });
    if (t.usuarioCreador !== req.user.email) return res.status(403).json({ error: 'No tiene permiso' });
    if (t.estado !== 'Rechazado') return res.status(400).json({ error: 'Solo se pueden reenviar trámites rechazados' });

    const { nombre, cedula, email } = req.body;
    if (!nombre || !cedula || !email) return res.status(400).json({ error: 'Debe rellenar todos los campos' });

    const newVersion = Object.assign({}, t);
    newVersion.version = t.version + 1;
    newVersion.fechaActualizacion = new Date().toISOString();
    newVersion.estado = 'Pendiente';
    newVersion.datos = { nombre, cedula, email, rol: t.datos.rol };
    newVersion.historial = t.historial.concat([{ accion: 'reenviado', usuario: req.user.email, fecha: new Date().toISOString(), versionAnterior: t.version }]);
    newVersion.documentos = [];

    if (req.files && req.files.length) {
        for (const f of req.files) {
            const enc = encryptBuffer(f.buffer);
            const name = `${id}_${Date.now()}_${f.originalname}`;
            fs.writeFileSync(path.join(UPLOAD_DIR, name + '.enc'), JSON.stringify(enc));
            newVersion.documentos.push({ name: f.originalname, file: name + '.enc' });
        }
    }

    const idx = tramites.findIndex(x => x.id === id);
    tramites[idx] = newVersion;
    writeDB(tramites);
    return res.json({ message: 'Su trámite ha sido reenviado exitosamente y se encuentra en estado pendiente.', tramite: newVersion });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
