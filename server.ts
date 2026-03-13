import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import next from 'next';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import vm from 'vm';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = 3000;

// Plugin System
class PluginManager {
  private plugins: Map<string, any> = new Map();
  private db: Database;
  private pluginsDir = path.join(process.cwd(), 'plugins');

  constructor(db: Database) {
    this.db = db;
    if (!fs.existsSync(this.pluginsDir)) {
      fs.mkdirSync(this.pluginsDir);
    }
  }

  async loadPlugins() {
    const rows = await this.db.all('SELECT * FROM plugins WHERE enabled = 1');
    this.plugins.clear();
    for (const row of rows) {
      const filePath = path.join(this.pluginsDir, `${row.id}.js`);
      let code = row.code;

      // Try to load from file if it exists, otherwise use DB and create file
      if (fs.existsSync(filePath)) {
        try {
          code = fs.readFileSync(filePath, 'utf-8');
          // Sync back to DB if file is different? 
          // For now, let's assume file is the source of truth if it exists.
        } catch (err) {
          console.error(`Failed to read plugin file ${filePath}:`, err);
        }
      } else {
        try {
          fs.writeFileSync(filePath, code);
        } catch (err) {
          console.error(`Failed to write plugin file ${filePath}:`, err);
        }
      }

      this.runPlugin({ ...row, code });
    }
  }

  async savePluginFile(id: string, code: string) {
    const filePath = path.join(this.pluginsDir, `${id}.js`);
    fs.writeFileSync(filePath, code);
  }

  async deletePluginFile(id: string) {
    const filePath = path.join(this.pluginsDir, `${id}.js`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  private runPlugin(plugin: any) {
    const permissions = JSON.parse(plugin.permissions);
    const sandbox = {
      console,
      db: {
        get: permissions.includes('db:read') ? this.db.get.bind(this.db) : undefined,
        all: permissions.includes('db:read') ? this.db.all.bind(this.db) : undefined,
        run: permissions.includes('db:write') ? this.db.run.bind(this.db) : undefined,
        exec: permissions.includes('db:write') ? this.db.exec.bind(this.db) : undefined,
      },
      hooks: {} as any
    };

    try {
      vm.createContext(sandbox);
      vm.runInContext(plugin.code, sandbox);
      this.plugins.set(plugin.id, sandbox.hooks);
      console.log(`Plugin loaded: ${plugin.name}`);
    } catch (err) {
      console.error(`Failed to run plugin ${plugin.name}:`, err);
    }
  }

  async triggerHook(hookName: string, ...args: any[]) {
    for (const [id, hooks] of this.plugins.entries()) {
      if (hooks && typeof hooks[hookName] === 'function') {
        try {
          const result = await hooks[hookName](...args);
          if (result === false) return false; // Hook can cancel action
        } catch (err) {
          console.error(`Error in plugin hook ${hookName}:`, err);
        }
      }
    }
    return true;
  }
}

async function setupDatabase() {
  const db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      color TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user', -- 'user', 'admin'
      isMuted BOOLEAN DEFAULT 0,
      isBanned BOOLEAN DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      permissions TEXT NOT NULL, -- JSON array of strings
      enabled BOOLEAN DEFAULT 1,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'public', 'group', 'dm'
      creator TEXT
    );
    CREATE TABLE IF NOT EXISTS room_members (
      roomId TEXT NOT NULL,
      username TEXT NOT NULL,
      PRIMARY KEY (roomId, username)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      sender TEXT NOT NULL,
      senderId TEXT NOT NULL,
      color TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      roomId TEXT NOT NULL DEFAULT 'public'
    );

    -- Ensure public room exists
    INSERT OR IGNORE INTO rooms (id, name, type) VALUES ('public', '公共大厅', 'public');
  `);

  // Create default admin if no users exist
  const userCount = await db.get('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    await db.run(
      'INSERT INTO users (username, password, color, role) VALUES (?, ?, ?, ?)',
      ['admin', 'admin123', '#ef4444', 'admin']
    );
    console.log('Default admin account created: admin / admin123');
  }

  return db;
}

app.prepare().then(async () => {
  const db = await setupDatabase();
  const pluginManager = new PluginManager(db);
  await pluginManager.loadPlugins();

  const expressApp = express();
  const server = createServer(expressApp);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  expressApp.use(cors());

  const activeSessions = new Map(); // socket.id -> user info

  // Socket.io Middleware for JWT authentication
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(); // Allow connection, but user won't be authenticated until login
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // If already authenticated via token
    if (socket.data.user) {
      const user = socket.data.user;
      activeSessions.set(socket.id, {
        username: user.username,
        id: socket.id,
        color: user.color,
        role: user.role,
        isMuted: user.isMuted
      });
      
      // Auto-join rooms and send lists
      (async () => {
        socket.emit('login_success', { user: { username: user.username, color: user.color, role: user.role } });
        io.emit('user_list', Array.from(activeSessions.values()));
        socket.join('public');
        const rooms = await db.all(`
          SELECT r.* FROM rooms r
          LEFT JOIN room_members rm ON r.id = rm.roomId
          WHERE r.type = 'public' OR rm.username = ?
        `, [user.username]);
        socket.emit('room_list', rooms);
        if (user.role === 'admin') {
          const plugins = await db.all('SELECT * FROM plugins');
          socket.emit('plugin_list', plugins);
        }
      })();
    }

    socket.on('register', async (data, callback) => {
      const { username, password } = data;
      try {
        const existingUser = await db.get('SELECT username FROM users WHERE username = ?', [username]);
        if (existingUser) {
          return callback({ success: false, message: '用户名已存在' });
        }
        
        // First user is admin
        const userCount = await db.get('SELECT COUNT(*) as count FROM users');
        const role = userCount.count === 0 ? 'admin' : 'user';
        
        const color = `hsl(${Math.random() * 360}, 70%, 60%)`;
        await db.run('INSERT INTO users (username, password, color, role) VALUES (?, ?, ?, ?)', [username, password, color, role]);
        callback({ success: true });
      } catch (err) {
        callback({ success: false, message: '注册失败' });
      }
    });

    socket.on('login', async (data, callback) => {
      const { username, password } = data;
      try {
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || user.password !== password) {
          return callback({ success: false, message: '用户名或密码错误' });
        }

        if (user.isBanned) {
          return callback({ success: false, message: '您的账号已被封禁' });
        }

        const allowed = await pluginManager.triggerHook('onUserJoin', user);
        if (!allowed) {
          return callback({ success: false, message: '插件阻止了您的登录' });
        }

        const token = jwt.sign({ 
          username: user.username, 
          role: user.role, 
          color: user.color,
          isMuted: user.isMuted 
        }, JWT_SECRET, { expiresIn: '7d' });

        activeSessions.set(socket.id, { 
          username, 
          id: socket.id, 
          color: user.color, 
          role: user.role,
          isMuted: user.isMuted 
        });
        
        io.emit('user_list', Array.from(activeSessions.values()));
        
        // Join public room by default
        socket.join('public');
        
        // Get user's rooms
        const rooms = await db.all(`
          SELECT r.* FROM rooms r
          LEFT JOIN room_members rm ON r.id = rm.roomId
          WHERE r.type = 'public' OR rm.username = ?
        `, [username]);
        
        socket.emit('room_list', rooms);
        
        // If admin, send plugin list
        if (user.role === 'admin') {
          const plugins = await db.all('SELECT * FROM plugins');
          socket.emit('plugin_list', plugins);
        }
        
        callback({ success: true, token, user: { username, color: user.color, role: user.role } });
      } catch (err) {
        callback({ success: false, message: '登录失败' });
      }
    });

    socket.on('get_history', async (roomId) => {
      const history = await db.all('SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp DESC LIMIT 50', [roomId]);
      socket.emit('history', { roomId, messages: history.reverse() });
    });

    socket.on('create_room', async (data, callback) => {
      const user = activeSessions.get(socket.id);
      if (!user) return;

      const { name, type, members } = data; // type: 'group' or 'dm'
      const roomId = type === 'dm' ? [user.username, members[0]].sort().join('_') : `group_${Date.now()}`;
      
      try {
        await db.run('INSERT OR IGNORE INTO rooms (id, name, type, creator) VALUES (?, ?, ?, ?)', [roomId, name, type, user.username]);
        
        const allMembers = [user.username, ...members];
        for (const member of allMembers) {
          await db.run('INSERT OR IGNORE INTO room_members (roomId, username) VALUES (?, ?)', [roomId, member]);
        }

        const room = await db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
        
        // Notify all online members of the new room
        activeSessions.forEach((session, sid) => {
          if (allMembers.includes(session.username)) {
            const s = io.sockets.sockets.get(sid);
            if (s) {
              s.join(roomId);
              s.emit('new_room', room);
            }
          }
        });

        callback({ success: true, room });
      } catch (err) {
        callback({ success: false, message: '创建失败' });
      }
    });

    // Admin Actions
    socket.on('admin_action', async (data, callback) => {
      const admin = activeSessions.get(socket.id);
      if (!admin || admin.role !== 'admin') {
        return callback({ success: false, message: '权限不足' });
      }

      const { type, targetUsername, pluginData } = data;

      try {
        if (type === 'mute') {
          await db.run('UPDATE users SET isMuted = NOT isMuted WHERE username = ?', [targetUsername]);
          // Update active sessions if user is online
          activeSessions.forEach((session, sid) => {
            if (session.username === targetUsername) {
              session.isMuted = !session.isMuted;
            }
          });
        } else if (type === 'ban') {
          await db.run('UPDATE users SET isBanned = 1 WHERE username = ?', [targetUsername]);
          // Kick user if online
          activeSessions.forEach((session, sid) => {
            if (session.username === targetUsername) {
              io.sockets.sockets.get(sid)?.disconnect();
            }
          });
        } else if (type === 'upload_plugin') {
          const id = `plugin_${Date.now()}`;
          await db.run(
            'INSERT INTO plugins (id, name, code, permissions, createdAt) VALUES (?, ?, ?, ?, ?)',
            [id, pluginData.name, pluginData.code, JSON.stringify(pluginData.permissions), new Date().toISOString()]
          );
          await pluginManager.savePluginFile(id, pluginData.code);
          await pluginManager.loadPlugins();
        } else if (type === 'toggle_plugin') {
          await db.run('UPDATE plugins SET enabled = NOT enabled WHERE id = ?', [pluginData.id]);
          await pluginManager.loadPlugins();
        } else if (type === 'remove_plugin') {
          await db.run('DELETE FROM plugins WHERE id = ?', [pluginData.id]);
          await pluginManager.deletePluginFile(pluginData.id);
          await pluginManager.loadPlugins();
        }

        // Refresh lists
        io.emit('user_list', Array.from(activeSessions.values()));
        if (admin.role === 'admin') {
          const plugins = await db.all('SELECT * FROM plugins');
          socket.emit('plugin_list', plugins);
        }

        callback({ success: true });
      } catch (err) {
        callback({ success: false, message: '操作失败' });
      }
    });

    socket.on('send_message', async (data) => {
      const user = activeSessions.get(socket.id);
      if (user) {
        if (user.isMuted) {
          return socket.emit('error_message', '您已被禁言');
        }

        const { text, roomId } = data;

        const allowed = await pluginManager.triggerHook('onNewMessage', { user, text, roomId });
        if (!allowed) return;

        const message = {
          id: Date.now().toString(),
          text,
          sender: user.username,
          senderId: user.id,
          color: user.color,
          timestamp: new Date().toISOString(),
          roomId: roomId || 'public'
        };
        
        try {
          await db.run(
            'INSERT INTO messages (id, text, sender, senderId, color, timestamp, roomId) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [message.id, message.text, message.sender, message.senderId, message.color, message.timestamp, message.roomId]
          );
          io.to(message.roomId).emit('receive_message', message);
        } catch (err) {
          console.error('Failed to save message:', err);
        }
      }
    });

    socket.on('update_color', async (newColor, callback) => {
      const user = activeSessions.get(socket.id);
      if (!user) return;

      try {
        await db.run('UPDATE users SET color = ? WHERE username = ?', [newColor, user.username]);
        user.color = newColor;
        activeSessions.set(socket.id, user);
        
        // Broadcast updated user list to reflect color change
        io.emit('user_list', Array.from(activeSessions.values()));
        
        callback({ success: true });
      } catch (err) {
        callback({ success: false, message: '更新颜色失败' });
      }
    });

    socket.on('add_member_to_room', async (data, callback) => {
      const user = activeSessions.get(socket.id);
      if (!user) return callback({ success: false, message: '未登录' });

      const { roomId, targetUsername } = data;

      try {
        const room = await db.get('SELECT * FROM rooms WHERE id = ?', [roomId]);
        if (!room) return callback({ success: false, message: '房间不存在' });

        if (room.creator !== user.username && user.role !== 'admin') {
          return callback({ success: false, message: '只有创建者或管理员可以添加成员' });
        }

        await db.run('INSERT OR IGNORE INTO room_members (roomId, username) VALUES (?, ?)', [roomId, targetUsername]);

        // Notify the target user if they are online
        activeSessions.forEach((session, sid) => {
          if (session.username === targetUsername) {
            const s = io.sockets.sockets.get(sid);
            if (s) {
              s.join(roomId);
              s.emit('new_room', room);
            }
          }
        });

        callback({ success: true });
      } catch (err) {
        callback({ success: false, message: '添加失败' });
      }
    });

    socket.on('disconnect', () => {
      activeSessions.delete(socket.id);
      io.emit('user_list', Array.from(activeSessions.values()));
      console.log('User disconnected:', socket.id);
    });
  });

  expressApp.all(/.*/, (req, res) => {
    return handle(req, res);
  });

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
