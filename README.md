# Personal Notes &bull; lalpesh.com

A simple, clean, mobile-friendly personal notes application built for private daily use.

---

## Features

### Page 1 &ndash; Notes
- **Distraction-Free Text Editor**: Type notes, ideas, lists, and thoughts with comfort.
- **Save Note Button**: Persists your notes instantly to the SQLite database.
- **Saved Notes Persistence**: Stored safely in `data/notes.db` &mdash; never lost on browser refresh or computer restart.
- **Continuous Editing**: Open, update, and edit notes anytime.
- **Auto Status & Word Count**: Real-time counter and save indicator (`Saved ✓` / `Unsaved changes`). Shortcut: <kbd>Ctrl+S</kbd> / <kbd>Cmd+S</kbd>.

### Page 2 &ndash; File Attachments
- **Photos & Images**: Upload photos (PNG, JPG, WebP, GIF) with thumbnail grid, full-size Lightbox preview, and download.
- **Documents & Files**: Attach 2&ndash;3 files (PDF, DOCX, XLSX, ZIP) with file sizes, timestamps, and downloads.
- **External File Links**: Add Google Drive links, PDF links, or online documents with quick 1-click external opening.
- **Protected File Storage**: Files stored on disk in `uploads/` and served only to authenticated sessions.

### Page 3 &ndash; All Saved Notes
- **Clean Overview**: View all your notes and attachments in organized cards.
- **Live Search**: Instant keyword search across all notes.
- **Badges**: See at a glance how many photos (📷), files (📎), and links (🔗) each note has.
- **1-Click Actions**: Open & edit or delete notes with complete cleanup.

---

## Login Credentials

| Field | Value |
|---|---|
| **Login ID** | `123@gmail.com` |
| **Password** | `123` |

---

## Quick Start (Local Run)

1. **Install Dependencies** (already installed in workspace):
   ```bash
   npm install
   ```

2. **Start Server**:
   ```bash
   npm start
   ```

3. **Open in Browser**:
   ```
   http://localhost:3000
   ```

---

## Connecting to Your Domain (`lalpesh.com`)

To host this website on your domain `lalpesh.com`:

### 1. DNS Settings (at your Domain Registrar or Cloudflare)
Add an **A Record** pointing to your server's public IP address:
```
Type: A
Name: @ (or lalpesh.com)
Value: <YOUR_SERVER_IP>
TTL: Auto / 300
```
*(Optional www record)*:
```
Type: CNAME
Name: www
Value: lalpesh.com
```

### 2. Run with PM2 (Process Manager for 24/7 Uptime)
```bash
npm install -g pm2
pm2 start server.js --name "lalpesh-notes"
pm2 save
pm2 startup
```

### 3. Nginx Reverse Proxy & SSL (HTTPS)
Create an Nginx configuration (`/etc/nginx/sites-available/lalpesh.com`):
```nginx
server {
    server_name lalpesh.com www.lalpesh.com;

    # Allow up to 50MB file uploads
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site and generate free HTTPS certificate with Certbot:
```bash
sudo ln -s /etc/nginx/sites-available/lalpesh.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d lalpesh.com -d www.lalpesh.com
```

---

## Directory Structure

```
lalpesh.com/
├── data/
│   └── notes.db        # SQLite database (ACID-compliant, auto-created)
├── uploads/            # Secure directory for attached images & files
├── public/
│   ├── index.html      # Main 3-page notes app
│   ├── login.html      # Clean, professional login page
│   ├── css/
│   │   └── style.css   # Lightweight, mobile-friendly styles
│   └── js/
│       └── app.js      # Interactive app logic & tabs
├── server.js           # Express backend & authenticated API
├── db.js               # Database schema & queries
├── package.json
└── README.md
```

