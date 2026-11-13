// Personal Notes Application - lalpesh.com

const app = {
  state: {
    activeNoteId: null,
    notes: [],
    currentTab: 'notes',
    hasUnsavedChanges: false,
    activeAttachments: [],
    activeLinks: [],
    searchTerm: ''
  },

  // Initialize
  async init() {
    this.setupEvents();
    await this.loadAllNotes();

    // Check URL hash for direct tab
    const hash = window.location.hash.replace('#', '');
    if (['notes', 'attachments', 'all'].includes(hash)) {
      this.switchTab(hash);
    } else {
      this.switchTab('notes');
    }

    // Auto load last active or first note
    const savedActiveId = localStorage.getItem('last_active_note_id');
    const noteExists = this.state.notes.find(n => n.id == savedActiveId);
    if (noteExists) {
      await this.loadNote(noteExists.id);
    } else if (this.state.notes.length > 0) {
      await this.loadNote(this.state.notes[0].id);
    } else {
      await this.createNewNote();
    }
  },

  setupEvents() {
    // Logout button
    document.getElementById('logout-btn').addEventListener('click', async () => {
      if (confirm('Are you sure you want to log out?')) {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login';
      }
    });

    // Note inputs changes
    const titleInput = document.getElementById('note-title');
    const contentInput = document.getElementById('note-content');

    const markUnsaved = () => {
      this.state.hasUnsavedChanges = true;
      this.updateStatusBadge('unsaved', 'Unsaved changes');
      this.updateWordCount();
    };

    titleInput.addEventListener('input', markUnsaved);
    contentInput.addEventListener('input', markUnsaved);

    // Keyboard shortcut: Ctrl+S or Cmd+S to save
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.saveCurrentNote();
      }
    });

    // File Dropzones & Inputs
    this.setupDropzone('photo-dropzone', 'photo-file-input', 'image');
    this.setupDropzone('document-dropzone', 'document-file-input', 'file');

    // Warn before closing tab if there are unsaved changes
    window.addEventListener('beforeunload', (e) => {
      if (this.state.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  },

  setupDropzone(dropzoneId, inputId, expectedType) {
    const dropzone = document.getElementById(dropzoneId);
    const input = document.getElementById(inputId);

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    ['dragleave', 'dragend'].forEach(type => {
      dropzone.addEventListener(type, () => {
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.uploadFiles(e.dataTransfer.files);
      }
    });

    input.addEventListener('change', () => {
      if (input.files && input.files.length > 0) {
        this.uploadFiles(input.files);
        input.value = ''; // Reset input
      }
    });
  },

  // Switch between Page 1 (Notes), Page 2 (Attachments), Page 3 (All Notes)
  switchTab(tabName) {
    this.state.currentTab = tabName;
    window.location.hash = tabName;

    // Update Tab Buttons
    document.querySelectorAll('.nav-tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Update Page Views
    document.querySelectorAll('.page-view').forEach(view => view.classList.remove('active'));
    const activeView = document.getElementById(`page-${tabName}`);
    if (activeView) activeView.classList.add('active');

    // Show/hide active note top banner
    const activeNoteBar = document.getElementById('active-note-bar');
    if (tabName === 'all') {
      activeNoteBar.style.display = 'none';
      this.renderAllNotesGrid();
    } else {
      activeNoteBar.style.display = 'flex';
      if (tabName === 'attachments') {
        this.renderAttachmentsUI();
      }
    }
  },

  // ----------------- Note Operations -----------------

  async loadAllNotes() {
    try {
      const res = await fetch('/api/notes');
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await res.json();
      this.state.notes = data.notes || [];
      this.renderAllNotesGrid();
    } catch (err) {
      console.error('Error fetching notes:', err);
    }
  },

  async loadNote(id) {
    try {
      const res = await fetch(`/api/notes/${id}`);
      if (!res.ok) throw new Error('Note not found');

      const data = await res.json();
      const note = data.note;

      this.state.activeNoteId = note.id;
      localStorage.setItem('last_active_note_id', note.id);

      this.state.activeAttachments = data.attachments || [];
      this.state.activeLinks = data.links || [];
      this.state.hasUnsavedChanges = false;

      // Populate Page 1 Inputs
      document.getElementById('note-title').value = note.title || '';
      document.getElementById('note-content').value = note.content || '';
      document.getElementById('active-note-title-display').textContent = note.title || 'Untitled Note';

      this.updateStatusBadge('saved', 'Saved');
      this.updateWordCount();
      this.updateAttachmentNavBadge();
      this.renderAttachmentsUI();
    } catch (err) {
      console.error('Failed to load note:', err);
      this.showToast('Failed to load note');
    }
  },

  async createNewNote() {
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Note', content: '' })
      });
      const data = await res.json();
      await this.loadAllNotes();
      await this.loadNote(data.note.id);
      this.switchTab('notes');
      document.getElementById('note-title').focus();
      document.getElementById('note-title').select();
      this.showToast('New note created');
    } catch (err) {
      console.error('Failed to create note:', err);
      this.showToast('Error creating note');
    }
  },

  async saveCurrentNote() {
    if (!this.state.activeNoteId) {
      await this.createNewNote();
      return;
    }

    const title = document.getElementById('note-title').value.trim() || 'Untitled Note';
    const content = document.getElementById('note-content').value;

    this.updateStatusBadge('saving', 'Saving...');

    try {
      const res = await fetch(`/api/notes/${this.state.activeNoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content })
      });

      if (!res.ok) throw new Error('Save failed');

      const data = await res.json();
      this.state.hasUnsavedChanges = false;
      document.getElementById('active-note-title-display').textContent = data.note.title;

      this.updateStatusBadge('saved', 'Saved');
      this.showToast('Note saved successfully');

      // Refresh list in background
      await this.loadAllNotes();
    } catch (err) {
      console.error('Save error:', err);
      this.updateStatusBadge('unsaved', 'Error saving');
      this.showToast('Error saving note');
    }
  },

  async deleteNote(id, e) {
    if (e) e.stopPropagation();
    if (!confirm('Are you sure you want to delete this note and all its attachments?')) {
      return;
    }

    try {
      const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');

      this.showToast('Note deleted');
      await this.loadAllNotes();

      // If active note was deleted, switch to first note or create new
      if (this.state.activeNoteId === id) {
        if (this.state.notes.length > 0) {
          await this.loadNote(this.state.notes[0].id);
        } else {
          await this.createNewNote();
        }
      }
    } catch (err) {
      console.error('Error deleting note:', err);
      this.showToast('Failed to delete note');
    }
  },

  // ----------------- Page 2: Attachments Operations -----------------

  async uploadFiles(fileList) {
    if (!this.state.activeNoteId) {
      alert('Please save or select a note before attaching files.');
      return;
    }

    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) {
      formData.append('files', fileList[i]);
    }

    this.showToast('Uploading files...');

    try {
      const res = await fetch(`/api/notes/${this.state.activeNoteId}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Upload failed');

      const data = await res.json();
      this.showToast('Uploaded successfully');

      // Refresh active note
      await this.loadNote(this.state.activeNoteId);
      await this.loadAllNotes();
    } catch (err) {
      console.error('Upload error:', err);
      this.showToast('Upload failed');
    }
  },

  async deleteAttachment(attachmentId) {
    if (!confirm('Are you sure you want to remove this attachment?')) return;

    try {
      const res = await fetch(`/api/attachments/${attachmentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete attachment');

      this.showToast('Attachment removed');
      await this.loadNote(this.state.activeNoteId);
      await this.loadAllNotes();
    } catch (err) {
      console.error('Error deleting attachment:', err);
      this.showToast('Failed to delete attachment');
    }
  },

  async addExternalLink(e) {
    e.preventDefault();
    if (!this.state.activeNoteId) return;

    const titleInput = document.getElementById('link-title-input');
    const urlInput = document.getElementById('link-url-input');

    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    if (!url) return;

    try {
      const res = await fetch(`/api/notes/${this.state.activeNoteId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url })
      });

      if (!res.ok) throw new Error('Failed to add link');

      titleInput.value = '';
      urlInput.value = '';
      this.showToast('Link added');

      await this.loadNote(this.state.activeNoteId);
      await this.loadAllNotes();
    } catch (err) {
      console.error('Add link error:', err);
      this.showToast('Failed to add link');
    }
  },

  async deleteLink(linkId) {
    if (!confirm('Remove this link?')) return;

    try {
      const res = await fetch(`/api/links/${linkId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete link');

      this.showToast('Link removed');
      await this.loadNote(this.state.activeNoteId);
      await this.loadAllNotes();
    } catch (err) {
      console.error('Error deleting link:', err);
      this.showToast('Failed to delete link');
    }
  },

  renderAttachmentsUI() {
    const photosGrid = document.getElementById('photos-grid');
    const emptyPhotosMsg = document.getElementById('empty-photos-msg');
    const filesList = document.getElementById('files-list');
    const emptyFilesMsg = document.getElementById('empty-files-msg');
    const linksList = document.getElementById('links-list');
    const emptyLinksMsg = document.getElementById('empty-links-msg');

    const photos = this.state.activeAttachments.filter(a => a.file_type === 'image');
    const files = this.state.activeAttachments.filter(a => a.file_type !== 'image');
    const links = this.state.activeLinks;

    // 1. Photos
    document.getElementById('photo-count-badge').textContent = `${photos.length} Photo${photos.length === 1 ? '' : 's'}`;
    if (photos.length === 0) {
      photosGrid.innerHTML = '';
      emptyPhotosMsg.style.display = 'block';
    } else {
      emptyPhotosMsg.style.display = 'none';
      photosGrid.innerHTML = photos.map(p => `
        <div class="photo-card">
          <div class="photo-thumb-wrap" onclick="app.openImageModal('/uploads/${encodeURIComponent(p.filename)}', '${this.escapeHtml(p.original_name)}')">
            <img src="/uploads/${encodeURIComponent(p.filename)}" alt="${this.escapeHtml(p.original_name)}" class="photo-thumb" loading="lazy">
          </div>
          <div class="photo-meta">
            <div style="min-width: 0; flex: 1;">
              <div class="photo-name" title="${this.escapeHtml(p.original_name)}">${this.escapeHtml(p.original_name)}</div>
              <div class="photo-size">${this.formatBytes(p.file_size)}</div>
            </div>
            <div style="display: flex; gap: 0.25rem;">
              <a href="/uploads/${encodeURIComponent(p.filename)}?download=1" class="btn btn-secondary btn-icon-only btn-sm" title="Download Image">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </a>
              <button class="btn btn-danger btn-icon-only btn-sm" onclick="app.deleteAttachment(${p.id})" title="Delete Image">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `).join('');
    }

    // 2. Documents & Files
    document.getElementById('file-count-badge').textContent = `${files.length} File${files.length === 1 ? '' : 's'}`;
    if (files.length === 0) {
      filesList.innerHTML = '';
      emptyFilesMsg.style.display = 'block';
    } else {
      emptyFilesMsg.style.display = 'none';
      filesList.innerHTML = files.map(f => `
        <div class="file-item">
          <div class="file-item-left">
            <div class="file-icon-box">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                <polyline points="13 2 13 9 20 9"></polyline>
              </svg>
            </div>
            <div class="file-info">
              <div class="file-name" title="${this.escapeHtml(f.original_name)}">${this.escapeHtml(f.original_name)}</div>
              <div class="file-size-date">${this.formatBytes(f.file_size)} &bull; ${new Date(f.created_at).toLocaleDateString()}</div>
            </div>
          </div>
          <div class="file-actions">
            <a href="/uploads/${encodeURIComponent(f.filename)}?download=1" class="btn btn-secondary btn-sm" title="Download">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Download</span>
            </a>
            <button class="btn btn-danger btn-icon-only btn-sm" onclick="app.deleteAttachment(${f.id})" title="Delete File">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `).join('');
    }

    // 3. Links
    document.getElementById('link-count-badge').textContent = `${links.length} Link${links.length === 1 ? '' : 's'}`;
    if (links.length === 0) {
      linksList.innerHTML = '';
      emptyLinksMsg.style.display = 'block';
    } else {
      emptyLinksMsg.style.display = 'none';
      linksList.innerHTML = links.map(l => `
        <div class="link-item">
          <div class="link-item-left">
            <div class="file-icon-box" style="color: #0284c7;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
            </div>
            <div class="file-info">
              <div class="file-name">${this.escapeHtml(l.title)}</div>
              <a href="${this.escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" class="link-url-text">${this.escapeHtml(l.url)}</a>
            </div>
          </div>
          <div class="file-actions">
            <a href="${this.escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">
              <span>Open</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </a>
            <button class="btn btn-danger btn-icon-only btn-sm" onclick="app.deleteLink(${l.id})" title="Delete Link">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `).join('');
    }
  },

  // ----------------- Page 3: All Notes Grid -----------------

  filterNotes(term) {
    this.state.searchTerm = term.toLowerCase().trim();
    this.renderAllNotesGrid();
  },

  renderAllNotesGrid() {
    const grid = document.getElementById('notes-grid');
    const empty = document.getElementById('empty-notes-view');

    let filtered = this.state.notes;
    if (this.state.searchTerm) {
      filtered = filtered.filter(n => 
        (n.title && n.title.toLowerCase().includes(this.state.searchTerm)) ||
        (n.content && n.content.toLowerCase().includes(this.state.searchTerm))
      );
    }

    if (filtered.length === 0) {
      grid.innerHTML = '';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    grid.innerHTML = filtered.map(n => {
      const isSelected = n.id === this.state.activeNoteId;
      const snippet = n.content ? n.content.trim() : 'Empty note...';
      const updatedDate = new Date(n.updated_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });

      return `
        <div class="note-card ${isSelected ? 'active-selected' : ''}" onclick="app.openNoteFromGrid(${n.id})">
          <div class="note-card-title">${this.escapeHtml(n.title || 'Untitled Note')}</div>
          <div class="note-card-snippet">${this.escapeHtml(snippet)}</div>
          
          <div class="note-card-footer">
            <div class="note-badges">
              ${n.image_count > 0 ? `<span class="badge-tag">📷 ${n.image_count}</span>` : ''}
              ${(n.attachment_count - n.image_count) > 0 ? `<span class="badge-tag">📎 ${n.attachment_count - n.image_count}</span>` : ''}
              ${n.link_count > 0 ? `<span class="badge-tag">🔗 ${n.link_count}</span>` : ''}
            </div>
            <span>${updatedDate}</span>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.75rem; padding-top: 0.5rem; border-top: 1px dashed var(--border-light);">
            <button class="btn btn-secondary btn-sm" onclick="app.openNoteFromGrid(${n.id})">
              <span>Open &bull; Edit</span>
            </button>
            <button class="btn btn-danger btn-icon-only btn-sm" onclick="app.deleteNote(${n.id}, event)" title="Delete Note">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  async openNoteFromGrid(id) {
    await this.loadNote(id);
    this.switchTab('notes');
  },

  // ----------------- Helpers & Utilities -----------------

  updateStatusBadge(type, text) {
    const badge = document.getElementById('save-status');
    badge.className = `status-badge ${type}`;
    if (type === 'saved') {
      badge.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>${text}</span>
      `;
    } else if (type === 'saving') {
      badge.innerHTML = `<span>Saving...</span>`;
    } else {
      badge.innerHTML = `<span>&bull; ${text}</span>`;
    }
  },

  updateWordCount() {
    const text = document.getElementById('note-content').value;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    document.getElementById('char-word-count').textContent = `${words} word${words === 1 ? '' : 's'} &bull; ${chars} chars`;
  },

  updateAttachmentNavBadge() {
    const badge = document.getElementById('nav-attachment-count');
    const total = (this.state.activeAttachments ? this.state.activeAttachments.length : 0) + 
                  (this.state.activeLinks ? this.state.activeLinks.length : 0);
    if (total > 0) {
      badge.textContent = total;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  },

  openImageModal(src, caption) {
    const modal = document.getElementById('image-modal');
    const img = document.getElementById('lightbox-img');
    const cap = document.getElementById('lightbox-caption');
    img.src = src;
    cap.textContent = caption;
    modal.style.display = 'flex';
  },

  closeImageModal() {
    document.getElementById('image-modal').style.display = 'none';
    document.getElementById('lightbox-img').src = '';
  },

  showToast(message) {
    const toast = document.getElementById('toast');
    const text = document.getElementById('toast-text');
    text.textContent = message;
    toast.classList.add('show');
    clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

// Start application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});

