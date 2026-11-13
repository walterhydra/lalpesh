const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable proxy trusting for Vercel and reverse proxies
app.set('trust proxy', 1);

// User Credentials requested
const AUTH_EMAIL = '123@gmail.com';
const AUTH_PASSWORD = '123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'lalpesh-notes-secret-key-2026';

// Stateless HMAC Session helpers (works 100% reliably across serverless lambdas)
function createSignedToken(email) {
  const payload = {
    email: email.toLowerCase(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySignedToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [data, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (sig !== expectedSig) return false;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return false;
    return payload.email === AUTH_EMAIL.toLowerCase();
  } catch (e) {
    return false;
  }
}

// Memory storage for file uploads (serverless & cloud-ready, zero disk permission issues)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB limit per file
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files in public
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Authentication Helper
function isAuthenticated(req) {
  const token = req.cookies['note_session'];
  if (!token) return false;
  return verifySignedToken(token);
}

// Auth middleware for API routes
function requireApiAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  next();
}

// Auth middleware for HTML pages
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
  const email = (req.body.email || '').trim().toLowerCase();
  const password = (req.body.password || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'Please provide both email and password.' });
  }

  if (email === AUTH_EMAIL.toLowerCase() && password === AUTH_PASSWORD) {
    const token = createSignedToken(email);

    res.cookie('note_session', token, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    // Check if request is standard form submission
    if (req.headers['accept'] && !req.headers['accept'].includes('application/json')) {
      return res.redirect('/');
    }

    return res.json({ success: true, message: 'Logged in successfully.' });
  }

  return res.status(401).json({ error: 'Invalid login ID or password.' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('note_session', { path: '/' });
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (isAuthenticated(req)) {
    return res.json({ authenticated: true, email: AUTH_EMAIL });
  }
  return res.json({ authenticated: false });
});

// ----------------- Note Routes -----------------

// Main Application Page (Protected)
app.get('/', requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Clean URL aliases
app.get(['/editor', '/attachments', '/all-notes'], requirePageAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// List all notes
app.get('/api/notes', requireApiAuth, (req, res) => {
  const notes = db.getNotes();
  res.json({ notes });
});

// Get a single note with its attachments and links
app.get('/api/notes/:id', requireApiAuth, (req, res) => {
  const noteData = db.getNoteById(req.params.id);
  if (!noteData) {
    return res.status(404).json({ error: 'Note not found.' });
  }
  res.json(noteData);
});

// Create a new note
app.post('/api/notes', requireApiAuth, (req, res) => {
  const title = req.body.title || 'Untitled Note';
  const content = req.body.content || '';
  const note = db.createNote(title, content);
  res.status(201).json({ note });
});

// Update an existing note
app.put('/api/notes/:id', requireApiAuth, (req, res) => {
  const title = req.body.title || 'Untitled Note';
  const content = req.body.content || '';
  const note = db.updateNote(req.params.id, title, content);

  if (!note) {
    return res.status(404).json({ error: 'Note not found.' });
  }
  res.json({ note });
});

// Delete a note
app.delete('/api/notes/:id', requireApiAuth, (req, res) => {
  const success = db.deleteNote(req.params.id);
  if (!success) {
    return res.status(404).json({ error: 'Note not found.' });
  }
  res.json({ success: true, message: 'Note deleted.' });
});

// ----------------- Attachments Routes -----------------

// Upload files or photos
app.post('/api/notes/:id/upload', requireApiAuth, upload.array('files', 5), (req, res) => {
  const noteId = req.params.id;
  const noteData = db.getNoteById(noteId);
  if (!noteData) {
    return res.status(404).json({ error: 'Note not found.' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const inserted = [];
  for (const file of req.files) {
    const isImage = file.mimetype.startsWith('image/');
    const fileType = isImage ? 'image' : 'file';
    const ext = path.extname(file.originalname);
    const uniqueFilename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const base64Data = file.buffer.toString('base64');

    const attachment = db.addAttachment(
      noteId,
      file.originalname,
      uniqueFilename,
      fileType,
      file.size,
      file.mimetype,
      base64Data
    );

    inserted.push({
      id: attachment.id,
      note_id: attachment.note_id,
      original_name: attachment.original_name,
      filename: attachment.filename,
      file_type: attachment.file_type,
      file_size: attachment.file_size,
      mime_type: attachment.mime_type,
      created_at: attachment.created_at
    });
  }

  res.status(201).json({ success: true, attachments: inserted });
});

// Delete an attachment
app.delete('/api/attachments/:id', requireApiAuth, (req, res) => {
  const item = db.deleteAttachment(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Attachment not found.' });
  }
  res.json({ success: true, message: 'Attachment deleted.' });
});

// Serve uploaded files & images securely
app.get('/uploads/:filename', requirePageAuth, (req, res) => {
  const filename = req.params.filename;
  const attachment = db.getAttachmentByFilename(filename);

  if (!attachment || !attachment.data_base64) {
    return res.status(404).send('File not found.');
  }

  const fileBuffer = Buffer.from(attachment.data_base64, 'base64');
  res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');

  if (req.query.download === '1') {
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.original_name)}"`);
  } else {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.original_name)}"`);
  }

  res.send(fileBuffer);
});

// ----------------- External Links Routes -----------------

// Add an external link
app.post('/api/notes/:id/links', requireApiAuth, (req, res) => {
  const noteId = req.params.id;
  let { title, url } = req.body;

  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'URL is required.' });
  }

  url = url.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  title = (title && title.trim()) ? title.trim() : url;

  const noteData = db.getNoteById(noteId);
  if (!noteData) {
    return res.status(404).json({ error: 'Note not found.' });
  }

  const newLink = db.addLink(noteId, title, url);
  res.status(201).json({ success: true, link: newLink });
});

// Delete an external link
app.delete('/api/links/:id', requireApiAuth, (req, res) => {
  const item = db.deleteLink(req.params.id);
  if (!item) {
    return res.status(404).json({ error: 'Link not found.' });
  }
  res.json({ success: true, message: 'Link deleted.' });
});

// Export app for Vercel Serverless
module.exports = app;

// Listen locally if run directly
if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Personal Notes server running on port ${PORT}`);
  });
}
