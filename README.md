# 高级实时聊天系统 (Advanced Real-time Chat System)

这是一个基于 Next.js, Express, Socket.io 和 SQLite 构建的全栈实时聊天应用程序。它具有强大的插件系统和管理员管理功能。

## 主要功能

- **实时聊天**: 支持公共大厅和私密房间。
- **管理员面板**: 管理员可以禁言 (Mute) 或封禁 (Ban) 用户。
- **插件系统**: 
  - 支持沙箱化执行 JavaScript 插件。
  - 插件可以拦截登录 (`onUserJoin`) 和消息 (`onNewMessage`)。
  - 动态启用/禁用插件。
- **用户系统**: 
  - 自定义用户名和颜色。
  - 角色管理 (Admin/User)。
- **响应式设计**: 适配桌面和移动端。

## 默认管理员账户

系统在首次启动时会自动创建一个默认管理员账户：

- **用户名**: `admin`
- **密码**: `admin123`

> **注意**: 请在首次登录后及时在数据库中更改密码或通过管理功能管理用户。

## 技术栈

- **前端**: Next.js 15+, Tailwind CSS, Lucide React, Framer Motion
- **后端**: Node.js, Express, Socket.io
- **数据库**: SQLite (使用 `sqlite3` 和 `sqlite` 驱动)
- **沙箱**: Node.js `vm` 模块

## 快速开始

1. **安装依赖**:
   ```bash
   npm install
   ```

2. **启动开发服务器**:
   ```bash
   npm run dev
   ```

3. **访问应用**:
   打开浏览器访问 `http://localhost:3000`。

## 插件开发

插件可以在管理员面板中上传。详细的开发说明请参考 [插件开发指南](./PLUGIN_GUIDE.md)。

插件代码示例：

```javascript
// 示例：自动回复插件
hooks.onNewMessage = async (user, content) => {
  if (content === 'ping') {
    // 可以在这里执行逻辑
    console.log('Received ping from ' + user.username);
  }
  return true; // 返回 true 允许消息发送，返回 false 拦截消息
};
```

## 许可证

MIT
