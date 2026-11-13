const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Ensure data folder exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'notes.db');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrency and reliability
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'Untitled Note',
    content TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    original_name TEXT NOT NULL,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL, -- 'image' or 'file'
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_email TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
  );
`);

// Pre-create initial welcome note if database is brand new
const countStmt = db.prepare('SELECT COUNT(*) as count FROM notes');
const row = countStmt.get();
if (row && row.count === 0) {
  const insertNote = db.prepare(`
    INSERT INTO notes (title, content, created_at, updated_at)
    VALUES (?, ?, datetime('now'), datetime('now'))
  `);
  const result = insertNote.run(
    'Welcome to Your Personal Notes',
    'This is your private notes space.\n\nHere you can:\n1. Write your thoughts, ideas, or to-do lists.\n2. Click "Save Note" anytime to persist changes.\n3. Go to "Attachments" to upload photos, documents, and external links.\n4. Browse all your notes anytime in "All Notes".\n\nEverything is securely stored and private to you.'
  );
  
  const welcomeId = result.lastInsertRowid;
  const insertLink = db.prepare(`
    INSERT INTO links (note_id, title, url)
    VALUES (?, ?, ?)
  `);
  insertLink.run(welcomeId, 'Personal Domain', 'https://lalpesh.com');
}

module.exports = db;

