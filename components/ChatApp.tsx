'use client';

import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, User, Hash, MessageSquare, LogOut, Users, Lock, UserPlus, LogIn, Palette, Settings, Check, Shield, ShieldAlert, ShieldCheck, Trash2, Play, Pause, Plus, Code, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Message {
  id: string;
  text: string;
  sender: string;
  senderId: string;
  color: string;
  timestamp: string;
  roomId: string;
}

interface Room {
  id: string;
  name: string;
  type: 'public' | 'group' | 'dm';
  creator?: string;
}

interface ChatUser {
  id: string;
  username: string;
  color: string;
  role: string;
  isMuted: boolean;
}

interface Plugin {
  id: string;
  name: string;
  code: string;
  permissions: string;
  enabled: boolean;
  createdAt: string;
}

export default function ChatApp() {
  const socketRef = useRef<Socket | null>(null);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomId, setActiveRoomId] = useState('public');
  const [input, setInput] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<ChatUser[]>([]);
  const [userColor, setUserColor] = useState('');
  const [userRole, setUserRole] = useState('user');
  const [error, setError] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [showPluginUpload, setShowPluginUpload] = useState(false);
  const [newPlugin, setNewPlugin] = useState({ name: '', code: '', permissions: [] as string[] });
  const [newGroupName, setNewGroupName] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedRoomForAdd, setSelectedRoomForAdd] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('star_im_token');
    
    const newSocket = io({
      auth: {
        token: savedToken
      }
    });
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      setSocketId(newSocket.id || null);
    });

    newSocket.on('connect_error', (err) => {
      if (err.message === 'Authentication error') {
        localStorage.removeItem('star_im_token');
        setIsJoined(false);
      }
    });

    newSocket.on('login_success', (res: any) => {
      setIsJoined(true);
      setUsername(res.user.username);
      setUserColor(res.user.color);
      setUserRole(res.user.role);
    });

    newSocket.on('receive_message', (message: Message) => {
      setMessages((prev) => ({
        ...prev,
        [message.roomId]: [...(prev[message.roomId] || []), message]
      }));
    });

    newSocket.on('history', ({ roomId, messages: history }: { roomId: string, messages: Message[] }) => {
      setMessages((prev) => ({
        ...prev,
        [roomId]: history
      }));
    });

    newSocket.on('room_list', (roomList: Room[]) => {
      setRooms(roomList);
    });

    newSocket.on('new_room', (room: Room) => {
      setRooms((prev) => [...prev, room]);
    });

    newSocket.on('user_list', (users: ChatUser[]) => {
      setOnlineUsers(users);
    });

    newSocket.on('plugin_list', (pluginList: Plugin[]) => {
      setPlugins(pluginList);
    });

    newSocket.on('error_message', (msg: string) => {
      alert(msg);
    });

    return () => {
      newSocket.close();
    };
  }, []);

  useEffect(() => {
    if (isJoined && activeRoomId) {
      socketRef.current?.emit('get_history', activeRoomId);
    }
  }, [isJoined, activeRoomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeRoomId]);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password.trim()) return;

    if (authMode === 'register') {
      socketRef.current?.emit('register', { username, password }, (res: any) => {
        if (res.success) {
          setAuthMode('login');
          setError('注册成功，请登录');
        } else {
          setError(res.message);
        }
      });
    } else {
      socketRef.current?.emit('login', { username, password }, (res: any) => {
        if (res.success) {
          localStorage.setItem('star_im_token', res.token);
          setIsJoined(true);
          setUserColor(res.user.color);
          setUserRole(res.user.role);
        } else {
          setError(res.message);
        }
      });
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('star_im_token');
    window.location.reload();
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && socketRef.current) {
      socketRef.current.emit('send_message', { text: input, roomId: activeRoomId });
      setInput('');
    }
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    socketRef.current?.emit('create_room', { 
      name: newGroupName, 
      type: 'group', 
      members: [] // In a real app, you'd select members
    }, (res: any) => {
      if (res.success) {
        setShowCreateGroup(false);
        setNewGroupName('');
        setActiveRoomId(res.room.id);
      }
    });
  };

  const startDM = (targetUser: ChatUser) => {
    if (targetUser.username === username) return;
    socketRef.current?.emit('create_room', {
      name: `与 ${targetUser.username} 的私聊`,
      type: 'dm',
      members: [targetUser.username]
    }, (res: any) => {
      if (res.success) {
        setActiveRoomId(res.room.id);
      }
    });
  };

  const handleUpdateColor = (newColor: string) => {
    socketRef.current?.emit('update_color', newColor, (res: any) => {
      if (res.success) {
        setUserColor(newColor);
      }
    });
  };

  const handleAdminAction = (type: string, targetUsername?: string, pluginData?: any) => {
    socketRef.current?.emit('admin_action', { type, targetUsername, pluginData }, (res: any) => {
      if (!res.success) alert(res.message);
    });
  };

  const handleUploadPlugin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlugin.name || !newPlugin.code) return;
    handleAdminAction('upload_plugin', undefined, newPlugin);
    setShowPluginUpload(false);
    setNewPlugin({ name: '', code: '', permissions: [] });
  };

  const handleAddMember = (targetUsername: string) => {
    if (!selectedRoomForAdd) return;
    socketRef.current?.emit('add_member_to_room', { 
      roomId: selectedRoomForAdd, 
      targetUsername 
    }, (res: any) => {
      if (res.success) {
        setShowAddMember(false);
        setSelectedRoomForAdd(null);
        alert('成员已添加');
      } else {
        alert(res.message);
      }
    });
  };

  const colorPresets = [
    'hsl(0, 70%, 60%)',    // Red
    'hsl(30, 70%, 60%)',   // Orange
    'hsl(60, 70%, 60%)',   // Yellow
    'hsl(120, 70%, 60%)',  // Green
    'hsl(180, 70%, 60%)',  // Cyan
    'hsl(210, 70%, 60%)',  // Blue
    'hsl(270, 70%, 60%)',  // Purple
    'hsl(330, 70%, 60%)',  // Pink
    'hsl(0, 0%, 80%)',     // Silver
    'hsl(0, 0%, 40%)',     // Gray
  ];

  const activeRoom = rooms.find(r => r.id === activeRoomId) || rooms[0];
  const currentMessages = messages[activeRoomId] || [];

  if (!isJoined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050505] p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md space-y-8 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl"
        >
          <div className="text-center">
            <h1 className="font-display text-4xl font-bold tracking-tighter text-white">STAR IM</h1>
            <p className="mt-2 text-sm text-white/50 uppercase tracking-widest">连接星辰大海</p>
          </div>
          
          <div className="flex rounded-2xl bg-white/5 p-1">
            <button 
              onClick={() => { setAuthMode('login'); setError(''); }}
              className={cn(
                "flex-1 rounded-xl py-2 text-sm font-bold transition-all",
                authMode === 'login' ? "bg-white text-black" : "text-white/50 hover:text-white"
              )}
            >
              登录
            </button>
            <button 
              onClick={() => { setAuthMode('register'); setError(''); }}
              className={cn(
                "flex-1 rounded-xl py-2 text-sm font-bold transition-all",
                authMode === 'register' ? "bg-white text-black" : "text-white/50 hover:text-white"
              )}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div className="space-y-4">
              <div className="relative">
                <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  placeholder="用户名"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 text-white outline-none transition-all focus:border-white/30 focus:bg-white/10"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/30" />
                <input
                  type="password"
                  placeholder="密码"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-12 pr-4 text-white outline-none transition-all focus:border-white/30 focus:bg-white/10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {error && (
              <p className={cn(
                "text-center text-xs font-bold",
                error.includes('成功') ? "text-emerald-500" : "text-rose-500"
              )}>
                {error}
              </p>
            )}

            <button
              type="submit"
              className="w-full rounded-2xl bg-white py-4 font-bold text-black transition-transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
            >
              {authMode === 'login' ? <LogIn className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
              {authMode === 'login' ? '立即登录' : '创建账号'}
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#050505] overflow-hidden">
      {/* Sidebar */}
      <div className="hidden w-72 flex-col border-r border-white/10 bg-white/5 backdrop-blur-xl md:flex">
        <div className="p-6">
          <h2 className="font-display text-2xl font-bold tracking-tighter">STAR IM</h2>
        </div>
        
        <div className="flex-1 overflow-y-auto px-4 space-y-6">
          <div>
            <div className="flex items-center justify-between px-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">聊天频道</p>
              <button 
                onClick={() => setShowCreateGroup(true)}
                className="text-white/30 hover:text-white transition-colors"
                title="创建群聊"
              >
                <UserPlus className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-2 space-y-1">
              {rooms.map((room) => (
                <div 
                  key={room.id}
                  onClick={() => setActiveRoomId(room.id)}
                  onKeyDown={(e) => e.key === 'Enter' && setActiveRoomId(room.id)}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all group cursor-pointer outline-none",
                    activeRoomId === room.id ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white"
                  )}
                >
                  {room.type === 'public' ? <Hash className="h-4 w-4 opacity-50" /> : 
                   room.type === 'group' ? <Users className="h-4 w-4 opacity-50" /> : 
                   <MessageSquare className="h-4 w-4 opacity-50" />}
                  <span className="flex-1 text-left truncate">{room.name}</span>
                  
                  {room.type === 'group' && (room.creator === username || userRole === 'admin') && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedRoomForAdd(room.id);
                        setShowAddMember(true);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-white transition-opacity"
                      title="添加成员"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between px-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">在线用户</p>
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                {onlineUsers.length}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {onlineUsers.map((user) => (
                <div 
                  key={user.id} 
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/70 hover:bg-white/5 transition-all group"
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: user.color }} />
                  <span className="flex-1 text-left truncate flex items-center gap-2">
                    {user.username}
                    {user.role === 'admin' && <ShieldCheck className="h-3 w-3 text-amber-500" />}
                    {user.isMuted && <ShieldAlert className="h-3 w-3 text-rose-500" />}
                  </span>
                  
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {userRole === 'admin' && user.username !== username && (
                      <>
                        <button 
                          onClick={() => handleAdminAction('mute', user.username)}
                          className={cn("p-1 hover:text-white", user.isMuted ? "text-rose-500" : "text-white/30")}
                          title={user.isMuted ? "取消禁言" : "禁言"}
                        >
                          <ShieldAlert className="h-3 w-3" />
                        </button>
                        <button 
                          onClick={() => handleAdminAction('ban', user.username)}
                          className="p-1 text-white/30 hover:text-rose-500"
                          title="封禁"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    )}
                    <button onClick={() => startDM(user)} className="p-1 text-white/30 hover:text-white">
                      <MessageSquare className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {userRole === 'admin' && (
            <div>
              <p className="px-2 text-[10px] font-bold uppercase tracking-widest text-white/30">管理</p>
              <div className="mt-2 space-y-1">
                <button 
                  onClick={() => setShowAdminPanel(true)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all",
                    showAdminPanel ? "bg-amber-500/10 text-amber-500" : "text-white/50 hover:bg-white/5 hover:text-white"
                  )}
                >
                  <Shield className="h-4 w-4 opacity-50" />
                  插件管理
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3 rounded-2xl bg-white/5 p-3">
            <div 
              className="flex h-10 w-10 items-center justify-center rounded-xl font-bold text-black"
              style={{ backgroundColor: userColor }}
            >
              {username[0]?.toUpperCase()}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-bold">{username}</p>
              <p className="text-[10px] text-white/30">{socketId ? '在线' : '连接中...'}</p>
            </div>
            <div className="flex gap-1">
              <button 
                onClick={() => setShowSettings(true)} 
                className="text-white/30 hover:text-white p-1"
                title="设置"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button 
                onClick={handleLogout} 
                className="text-white/30 hover:text-white p-1"
                title="退出"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col relative">
        {showAdminPanel ? (
          <div className="flex-1 flex flex-col bg-[#0a0a0a]">
            <header className="flex h-16 items-center justify-between border-b border-white/10 px-6">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-amber-500" />
                <h3 className="text-sm font-bold">插件管理中心</h3>
              </div>
              <button 
                onClick={() => setShowAdminPanel(false)}
                className="text-sm text-white/50 hover:text-white"
              >
                返回聊天
              </button>
            </header>
            
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-6">
                <p className="text-xs text-white/50">已安装的插件 ({plugins.length})</p>
                <button 
                  onClick={() => setShowPluginUpload(true)}
                  className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:scale-105 transition-transform"
                >
                  <Plus className="h-3 w-3" />
                  上传插件
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {plugins.map((plugin) => (
                  <div key={plugin.id} className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "h-8 w-8 rounded-lg flex items-center justify-center",
                          plugin.enabled ? "bg-emerald-500/20 text-emerald-500" : "bg-white/10 text-white/30"
                        )}>
                          <Code className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-bold">{plugin.name}</p>
                          <p className="text-[10px] text-white/30">{new Date(plugin.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => handleAdminAction('toggle_plugin', undefined, { id: plugin.id })}
                          className="p-2 text-white/30 hover:text-white"
                        >
                          {plugin.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>
                        <button 
                          onClick={() => handleAdminAction('remove_plugin', undefined, { id: plugin.id })}
                          className="p-2 text-white/30 hover:text-rose-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-1">
                      {JSON.parse(plugin.permissions).map((p: string) => (
                        <span key={p} className="rounded-md bg-white/5 px-2 py-0.5 text-[9px] text-white/50 border border-white/5">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <header className="flex h-16 items-center justify-between border-b border-white/10 bg-white/5 px-6 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 md:hidden">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold">
                {activeRoom?.type === 'public' ? '# ' : 
                 activeRoom?.type === 'group' ? '👥 ' : '💬 '}
                {activeRoom?.name}
              </h3>
              <p className="text-[10px] text-white/30">
                {activeRoom?.type === 'public' ? '欢迎来到星辰通讯中心' : 
                 activeRoom?.type === 'group' ? `由 ${activeRoom.creator} 创建的群组` : '私密对话'}
              </p>
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <AnimatePresence initial={false}>
            {currentMessages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className={cn(
                  "flex gap-4",
                  msg.senderId === socketId && "flex-row-reverse"
                )}
              >
                <div 
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl font-bold text-black"
                  style={{ backgroundColor: msg.color }}
                >
                  {msg.sender[0]?.toUpperCase()}
                </div>
                <div className={cn(
                  "flex max-w-[70%] flex-col gap-1",
                  msg.senderId === socketId && "items-end"
                )}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white/50">{msg.sender}</span>
                    <span className="text-[10px] text-white/20">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className={cn(
                    "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    msg.senderId === socketId 
                      ? "bg-white text-black rounded-tr-none" 
                      : "bg-white/10 text-white rounded-tl-none border border-white/10"
                  )}>
                    {msg.text}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-6">
          <form onSubmit={handleSendMessage} className="relative">
            <input
              type="text"
              placeholder={`在 ${activeRoom?.name} 中发送消息...`}
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 pl-6 pr-16 text-sm text-white outline-none transition-all focus:border-white/30 focus:bg-white/10"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-white p-2 text-black transition-transform hover:scale-110 active:scale-95"
            >
              <Send className="h-5 w-5" />
            </button>
          </form>
        </div>
      </>
    )}
  </div>

      {/* Create Group Modal */}
      {showCreateGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl"
          >
            <h2 className="text-xl font-bold text-white mb-6">创建新群组</h2>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <input
                type="text"
                placeholder="群组名称"
                className="w-full rounded-2xl border border-white/10 bg-white/5 py-4 px-6 text-white outline-none focus:border-white/30"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateGroup(false)}
                  className="flex-1 rounded-2xl bg-white/5 py-4 font-bold text-white/50 hover:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-2xl bg-white py-4 font-bold text-black hover:scale-[1.02]"
                >
                  创建
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">添加成员</h2>
              <button onClick={() => setShowAddMember(false)} className="text-white/30 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
              {onlineUsers.filter(u => u.username !== username).map(user => (
                <button
                  key={user.id}
                  onClick={() => handleAddMember(user.username)}
                  className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-3 text-sm text-white hover:bg-white/10 transition-all"
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: user.color }} />
                  <span className="flex-1 text-left">{user.username}</span>
                  <Plus className="h-4 w-4 opacity-50" />
                </button>
              ))}
              {onlineUsers.filter(u => u.username !== username).length === 0 && (
                <p className="text-center text-xs text-white/30 py-4">暂无其他在线用户</p>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">个人设置</h2>
              <button onClick={() => setShowSettings(false)} className="text-white/30 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-3">我的色彩标识</p>
                <div className="grid grid-cols-5 gap-3">
                  {colorPresets.map((color) => (
                    <button
                      key={color}
                      onClick={() => handleUpdateColor(color)}
                      className={cn(
                        "h-10 w-10 rounded-xl transition-transform hover:scale-110 flex items-center justify-center",
                        userColor === color && "ring-2 ring-white ring-offset-2 ring-offset-black"
                      )}
                      style={{ backgroundColor: color }}
                    >
                      {userColor === color && <Check className="h-4 w-4 text-black" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-white/5 p-4 border border-white/10">
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2">预览</p>
                <div className="flex items-center gap-3">
                  <div 
                    className="h-10 w-10 rounded-xl flex items-center justify-center font-bold text-black"
                    style={{ backgroundColor: userColor }}
                  >
                    {username[0]?.toUpperCase()}
                  </div>
                  <div className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-white">
                    这是我的消息预览
                  </div>
                </div>
              </div>

              <button
                onClick={() => setShowSettings(false)}
                className="w-full rounded-2xl bg-white py-4 font-bold text-black hover:scale-[1.02]"
              >
                完成
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showPluginUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0a0a0a] p-8 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">上传新插件</h2>
              <button onClick={() => setShowPluginUpload(false)} className="text-white/30 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleUploadPlugin} className="space-y-6">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">插件名称</label>
                <input
                  type="text"
                  value={newPlugin.name}
                  onChange={(e) => setNewPlugin({ ...newPlugin, name: e.target.value })}
                  className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="例如: 自动欢迎插件"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">插件代码 (JavaScript)</label>
                <textarea
                  value={newPlugin.code}
                  onChange={(e) => setNewPlugin({ ...newPlugin, code: e.target.value })}
                  className="w-full h-48 rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="onNewMessage(user, content) { ... }"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-2 block">所需权限</label>
                <div className="flex flex-wrap gap-2">
                  {['db:read', 'db:write', 'network', 'fs:read'].map((perm) => (
                    <button
                      key={perm}
                      type="button"
                      onClick={() => {
                        const perms = newPlugin.permissions.includes(perm)
                          ? newPlugin.permissions.filter(p => p !== perm)
                          : [...newPlugin.permissions, perm];
                        setNewPlugin({ ...newPlugin, permissions: perms });
                      }}
                      className={cn(
                        "rounded-xl px-3 py-1.5 text-xs font-medium border transition-all",
                        newPlugin.permissions.includes(perm)
                          ? "bg-amber-500 border-amber-500 text-black"
                          : "bg-white/5 border-white/10 text-white/50 hover:text-white"
                      )}
                    >
                      {perm}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPluginUpload(false)}
                  className="flex-1 rounded-2xl bg-white/5 py-4 font-bold text-white hover:bg-white/10"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-2xl bg-amber-500 py-4 font-bold text-black hover:scale-[1.02]"
                >
                  上传并启用
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
