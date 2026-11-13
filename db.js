const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// Determine writable data directory
let dataDir;
try {
  const localDir = path.join(__dirname, 'data');
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }
  const testFile = path.join(localDir, '.test_write_' + Date.now());
  fs.writeFileSync(testFile, 'ok');
  fs.unlinkSync(testFile);
  dataDir = localDir;
} catch (err) {
  // Serverless environment with read-only root (e.g., Vercel)
  dataDir = path.join(os.tmpdir(), 'notes-store');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

const dbFile = path.join(dataDir, 'database.json');

// Default initial state
const defaultState = {
  nextNoteId: 2,
  nextAttachmentId: 1,
  nextLinkId: 2,
  notes: [
    {
      id: 1,
      title: 'Welcome to Your Personal Notes',
      content: 'This is your private notes space.\n\nHere you can:\n1. Write your thoughts, ideas, or to-do lists.\n2. Click "Save Note" anytime to persist changes.\n3. Go to "Attachments" to upload photos, documents, and external links.\n4. Browse all your notes anytime in "All Notes".\n\nEverything is securely stored and private to you.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ],
  attachments: [],
  links: [
    {
      id: 1,
      note_id: 1,
      title: 'Personal Domain',
      url: 'https://lalpesh.com',
      created_at: new Date().toISOString()
    }
  ],
  sessions: []
};

// In-memory cache + persistent JSON store
let store = null;

function loadStore() {
  if (store) return store;
  try {
    if (fs.existsSync(dbFile)) {
      const raw = fs.readFileSync(dbFile, 'utf8');
      store = JSON.parse(raw);
    } else {
      store = JSON.parse(JSON.stringify(defaultState));
      saveStore();
    }
  } catch (err) {
    console.error('Error loading database file, initializing defaults:', err);
    store = JSON.parse(JSON.stringify(defaultState));
  }
  return store;
}

function saveStore() {
  try {
    const tmp = `${dbFile}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, dbFile);
  } catch (err) {
    console.error('Error saving store to disk:', err);
  }
}

// ----------------- Public DB Methods -----------------

const db = {
  getNotes() {
    const s = loadStore();
    return s.notes
      .slice()
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .map(n => {
        const attachList = s.attachments.filter(a => a.note_id === n.id);
        const imgList = attachList.filter(a => a.file_type === 'image');
        const linkList = s.links.filter(l => l.note_id === n.id);
        return {
          id: n.id,
          title: n.title,
          content: n.content,
          created_at: n.created_at,
          updated_at: n.updated_at,
          attachment_count: attachList.length,
          image_count: imgList.length,
          link_count: linkList.length
        };
      });
  },

  getNoteById(id) {
    const s = loadStore();
    const noteId = Number(id);
    const note = s.notes.find(n => n.id === noteId);
    if (!note) return null;

    const attachments = s.attachments
      .filter(a => a.note_id === noteId)
      .map(a => ({
        id: a.id,
        note_id: a.note_id,
        original_name: a.original_name,
        filename: a.filename,
        file_type: a.file_type,
        file_size: a.file_size,
        mime_type: a.mime_type,
        created_at: a.created_at
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const links = s.links
      .filter(l => l.note_id === noteId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return { note, attachments, links };
  },

  createNote(title, content) {
    const s = loadStore();
    const now = new Date().toISOString();
    const note = {
      id: s.nextNoteId++,
      title: (title || 'Untitled Note').trim(),
      content: content || '',
      created_at: now,
      updated_at: now
    };
    s.notes.push(note);
    saveStore();
    return note;
  },

  updateNote(id, title, content) {
    const s = loadStore();
    const noteId = Number(id);
    const note = s.notes.find(n => n.id === noteId);
    if (!note) return null;

    note.title = (title || 'Untitled Note').trim();
    note.content = content || '';
    note.updated_at = new Date().toISOString();
    saveStore();
    return note;
  },

  deleteNote(id) {
    const s = loadStore();
    const noteId = Number(id);
    const initialLen = s.notes.length;
    s.notes = s.notes.filter(n => n.id !== noteId);
    if (s.notes.length === initialLen) return false;

    // Delete associated attachments and links
    s.attachments = s.attachments.filter(a => a.note_id !== noteId);
    s.links = s.links.filter(l => l.note_id !== noteId);
    saveStore();
    return true;
  },

  addAttachment(noteId, originalName, filename, fileType, fileSize, mimeType, dataBase64) {
    const s = loadStore();
    const attachment = {
      id: s.nextAttachmentId++,
      note_id: Number(noteId),
      original_name: originalName,
      filename: filename,
      file_type: fileType,
      file_size: fileSize,
      mime_type: mimeType,
      data_base64: dataBase64,
      created_at: new Date().toISOString()
    };
    s.attachments.push(attachment);

    // Touch note's updated_at
    const note = s.notes.find(n => n.id === Number(noteId));
    if (note) note.updated_at = new Date().toISOString();

    saveStore();
    return attachment;
  },

  getAttachment(id) {
    const s = loadStore();
    return s.attachments.find(a => a.id === Number(id));
  },

  getAttachmentByFilename(filename) {
    const s = loadStore();
    return s.attachments.find(a => a.filename === filename);
  },

  deleteAttachment(id) {
    const s = loadStore();
    const attachId = Number(id);
    const item = s.attachments.find(a => a.id === attachId);
    if (!item) return null;

    s.attachments = s.attachments.filter(a => a.id !== attachId);
    const note = s.notes.find(n => n.id === item.note_id);
    if (note) note.updated_at = new Date().toISOString();

    saveStore();
    return item;
  },

  addLink(noteId, title, url) {
    const s = loadStore();
    const link = {
      id: s.nextLinkId++,
      note_id: Number(noteId),
      title: title || url,
      url: url,
      created_at: new Date().toISOString()
    };
    s.links.push(link);

    const note = s.notes.find(n => n.id === Number(noteId));
    if (note) note.updated_at = new Date().toISOString();

    saveStore();
    return link;
  },

  deleteLink(id) {
    const s = loadStore();
    const linkId = Number(id);
    const item = s.links.find(l => l.id === linkId);
    if (!item) return null;

    s.links = s.links.filter(l => l.id !== linkId);
    const note = s.notes.find(n => n.id === item.note_id);
    if (note) note.updated_at = new Date().toISOString();

    saveStore();
    return item;
  },

  createSession(token, userEmail, expiresAt) {
    const s = loadStore();
    s.sessions = s.sessions.filter(sess => new Date(sess.expires_at) > new Date());
    s.sessions.push({
      token,
      user_email: userEmail,
      created_at: new Date().toISOString(),
      expires_at: expiresAt
    });
    saveStore();
  },

  validateSession(token) {
    if (!token) return false;
    const s = loadStore();
    const session = s.sessions.find(sess => sess.token === token && new Date(sess.expires_at) > new Date());
    return !!session;
  },

  deleteSession(token) {
    const s = loadStore();
    s.sessions = s.sessions.filter(sess => sess.token !== token);
    saveStore();
  }
};

module.exports = db;
