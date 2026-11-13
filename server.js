const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Credential constants requested by user
const AUTH_EMAIL = '123@gmail.com';
const AUTH_PASSWORD = '123';

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB per file
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files in public (index: false ensures root / goes through requirePageAuth)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Authentication verification helper
function isAuthenticated(req) {
  const token = req.cookies['note_session'];
  if (!token) return false;

  const stmt = db.prepare(`
    SELECT user_email FROM sessions 
    WHERE token = ? AND datetime(expires_at) > datetime('now')
  `);
  const session = stmt.get(token);
  return !!session;
}

// Auth middleware for API routes
function requireApiAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  next();
}

// Auth middleware for page routes
function requirePageAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.redirect('/login');
  }
  next();
}

// ----------------- Auth Routes -----------------

app.get('/login', (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Please provide both email and password.' });
  }

  if (email.trim().toLowerCase() === AUTH_EMAIL.toLowerCase() && password === AUTH_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const insertSession = db.prepare(`
      INSERT INTO sessions (token, user_email, expires_at)
      VALUES (?, ?, ?)
    `);
    insertSession.run(token, AUTH_EMAIL, expiresAt);

    // Set secure cookie
    res.cookie('note_session', token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    return res.json({ success: true, message: 'Logged in successfully.' });
  }

  return res.status(401).json({ error: 'Invalid login ID or password.' });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies['note_session'];
  if (token) {
    const delStmt = db.prepare('DELETE FROM sessions WHERE token = ?');
    delStmt.run(token);
  }
  res.clearCookie('note_session');
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (isAuthenticated(req)) {
    return res.json({ authenticated: true, email: AUTH_EMAIL });
  }
  return res.json({ authenticated: false });
});

// ----------------- Note Routes -----------------

// Main Application Page (Requires Auth)
app.get('/', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Alias routes for clean URLs
app.get(['/editor', '/attachments', '/all-notes'], requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// List all notes with counts of attachments and links
app.get('/api/notes', requireApiAuth, (req, res) => {
  const stmt = db.prepare(`
    SELECT 
      n.id, 
      n.title, 
      n.content, 
      n.created_at, 
      n.updated_at,
      (SELECT COUNT(*) FROM attachments WHERE note_id = n.id) AS attachment_count,
      (SELECT COUNT(*) FROM attachments WHERE note_id = n.id AND file_type = 'image') AS image_count,
      (SELECT COUNT(*) FROM links WHERE note_id = n.id) AS link_count
    FROM notes n
    ORDER BY n.updated_at DESC
  `);
  const notes = stmt.all();
  res.json({ notes });
});

// Get a single note with its attachments and links
app.get('/api/notes/:id', requireApiAuth, (req, res) => {
  const noteId = Number(req.params.id);
  const noteStmt = db.prepare('SELECT * FROM notes WHERE id = ?');
  const note = noteStmt.get(noteId);

  if (!note) {
    return res.status(404).json({ error: 'Note not found.' });
  }

  const attachmentsStmt = db.prepare(`
    SELECT id, note_id, original_name, filename, file_type, file_size, mime_type, created_at
    FROM attachments
    WHERE note_id = ?
    ORDER BY created_at DESC
  `);
  const attachments = attachmentsStmt.all(noteId);

  const linksStmt = db.prepare(`
    SELECT id, note_id, title, url, created_at
    FROM links
    WHERE note_id = ?
    ORDER BY created_at DESC
  `);
  const links = linksStmt.all(noteId);

  res.json({ note, attachments, links });
});

// Create a new note
app.post('/api/notes', requireApiAuth, (req, res) => {
  const title = (req.body.title || 'Untitled Note').trim();
  const content = req.body.content || '';

  const insert = db.prepare(`
    INSERT INTO notes (title, content, created_at, updated_at)
    VALUES (?, ?, datetime('now'), datetime('now'))
  `);
  const result = insert.run(title, content);
  const newNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ note: newNote });
});

// Update an existing note
app.put('/api/notes/:id', requireApiAuth, (req, res) => {
  const noteId = Number(req.params.id);
  const title = (req.body.title || 'Untitled Note').trim();
  const content = req.body.content || '';

  const update = db.prepare(`
    UPDATE notes 
    SET title = ?, content = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  const result = update.run(title, content, noteId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Note not found.' });
  }

  const updatedNote = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
  res.json({ note: updatedNote });
});

// Delete a note and all its attachments from disk
app.delete('/api/notes/:id', requireApiAuth, (req, res) => {
  const noteId = Number(req.params.id);

  // Retrieve filenames to delete from disk
  const files = db.prepare('SELECT filename FROM attachments WHERE note_id = ?').all(noteId);
  for (const item of files) {
    const filePath = path.join(uploadsDir, item.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Failed to delete file from disk:', err);
      }
    }
  }

  const del = db.prepare('DELETE FROM notes WHERE id = ?');
  const result = del.run(noteId);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Note not found.' });
  }

  res.json({ success: true, message: 'Note deleted.' });
});

// ----------------- Attachments Routes -----------------

// Upload files/photos to a note (supports 1 to 5 files at once)
app.post('/api/notes/:id/upload', requireApiAuth, upload.array('files', 5), (req, res) => {
  const noteId = Number(req.params.id);
  const note = db.prepare('SELECT id FROM notes WHERE id = ?').get(noteId);

  if (!note) {
    // If files were uploaded but note doesn't exist, remove uploaded files
    if (req.files) {
      req.files.forEach(f => {
        try { fs.unlinkSync(f.path); } catch (e) {}
      });
    }
    return res.status(404).json({ error: 'Note not found.' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const insert = db.prepare(`
    INSERT INTO attachments (note_id, original_name, filename, file_type, file_size, mime_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const inserted = [];
  for (const file of req.files) {
    const isImage = file.mimetype.startsWith('image/');
    const fileType = isImage ? 'image' : 'file';
    const resRow = insert.run(
      noteId,
      file.originalname,
      file.filename,
      fileType,
      file.size,
      file.mimetype
    );
    const attachment = db.prepare('SELECT * FROM attachments WHERE id = ?').get(resRow.lastInsertRowid);
    inserted.push(attachment);
  }

  // Update note updated_at timestamp
  db.prepare("UPDATE notes SET updated_at = datetime('now') WHERE id = ?").run(noteId);

  res.status(201).json({ success: true, attachments: inserted });
});

// Delete an attachment
app.delete('/api/attachments/:id', requireApiAuth, (req, res) => {
  const attachId = Number(req.params.id);
  const item = db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachId);

  if (!item) {
    return res.status(404).json({ error: 'Attachment not found.' });
  }

  // Delete from disk
  const filePath = path.join(uploadsDir, item.filename);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('Failed to unlink file:', err);
    }
  }

  db.prepare('DELETE FROM attachments WHERE id = ?').run(attachId);
  db.prepare("UPDATE notes SET updated_at = datetime('now') WHERE id = ?").run(item.note_id);

  res.json({ success: true, message: 'Attachment deleted.' });
});

// Securely serve uploaded files & images (Protected: only authenticated user can access)
app.get('/uploads/:filename', requirePageAuth, (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found.');
  }

  // Optional download disposition if download query is passed
  if (req.query.download === '1') {
    const record = db.prepare('SELECT original_name FROM attachments WHERE filename = ?').get(filename);
    const originalName = record ? record.original_name : filename;
    return res.download(filePath, originalName);
  }

  res.sendFile(filePath);
});

// ----------------- External Links Routes -----------------

// Add an external link to a note
app.post('/api/notes/:id/links', requireApiAuth, (req, res) => {
  const noteId = Number(req.params.id);
  let { title, url } = req.body;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  title = (title && title.trim()) ? title.trim() : url;

  const note = db.prepare('SELECT id FROM notes WHERE id = ?').get(noteId);
  if (!note) {
    return res.status(404).json({ error: 'Note not found.' });
  }

  const insert = db.prepare(`
    INSERT INTO links (note_id, title, url)
    VALUES (?, ?, ?)
  `);
  const result = insert.run(noteId, title, url);
  const newLink = db.prepare('SELECT * FROM links WHERE id = ?').get(result.lastInsertRowid);

  db.prepare("UPDATE notes SET updated_at = datetime('now') WHERE id = ?").run(noteId);

  res.status(201).json({ success: true, link: newLink });
});

// Delete an external link
app.delete('/api/links/:id', requireApiAuth, (req, res) => {
  const linkId = Number(req.params.id);
  const item = db.prepare('SELECT note_id FROM links WHERE id = ?').get(linkId);

  if (!item) {
    return res.status(404).json({ error: 'Link not found.' });
  }

  db.prepare('DELETE FROM links WHERE id = ?').run(linkId);
  db.prepare("UPDATE notes SET updated_at = datetime('now') WHERE id = ?").run(item.note_id);

  res.json({ success: true, message: 'Link deleted.' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n==========================================`);
  console.log(`Personal Notes server is running!`);
  console.log(`Port: ${PORT}`);
  console.log(`Access: http://localhost:${PORT}`);
  console.log(`Domain: https://lalpesh.com`);
  console.log(`==========================================\n`);
});
