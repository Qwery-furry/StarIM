# 插件开发指南 (Plugin Development Guide)

本指南将帮助你了解如何为本聊天系统开发插件。插件系统允许你通过拦截事件（Hooks）来扩展系统的功能。

## 核心概念

插件运行在沙箱环境（Node.js `vm` 模块）中，具有受限的访问权限。

### 可用全局变量

在插件代码中，你可以访问以下全局变量：

- `console`: 标准控制台对象，用于调试 (`console.log`, `console.error`)。
- `hooks`: **核心对象**。你需要将你的 Hook 函数挂载到这个对象上。
- `db`: 数据库访问对象（取决于插件权限）：
  - `db.get(sql, params)`: 获取单行。
  - `db.all(sql, params)`: 获取多行。
  - `db.run(sql, params)`: 执行 SQL。
  - `db.exec(sql)`: 执行多条 SQL。

## 支持的 Hooks

### 1. `onUserJoin(user)`
当用户尝试登录时触发。
- **参数**: `user` 对象（包含 `username`, `role` 等）。
- **返回值**: `true` 允许登录，`false` 拒绝登录。

### 2. `onNewMessage({ user, text, roomId })`
当有新消息发送时触发。
- **参数**: 
  - `user`: 发送者信息。
  - `text`: 消息内容。
  - `roomId`: 房间 ID。
- **返回值**: `true` 允许发送，`false` 拦截消息。

### 3. `getUI()`
允许插件定义前端 UI 内容。
- **返回值**: 一个对象，包含：
  - `title`: 侧边栏显示的标题。
  - `content`: 要在主区域显示的 HTML 内容（支持 HTML 字符串）。
  - `allowedRoles` (可选): 一个字符串数组，指定允许访问该内容的级别（如 `['admin']` 或 `['admin', 'user']`）。如果未指定，则所有用户均可访问。

### 4. `sendMessage({ roomId, text, sender, color, tag })`
允许插件在指定房间发送消息。
- **参数**:
  - `roomId`: 房间 ID（默认为 'public'）。
  - `text`: 消息内容。
  - `sender`: 显示的发送者名称。
  - `color` (可选): 发送者头像颜色。
  - `tag` (可选): 发送者名称旁显示的特殊标签（如 '机器人', '官方'）。
- **返回值**: `true` 发送成功，`false` 发送失败。

---

## 示例插件

### 示例 1：欢迎消息插件
当用户登录时，在控制台打印欢迎信息。

```javascript
hooks.onUserJoin = async (user) => {
  console.log(`欢迎用户 ${user.username} 加入聊天室！`);
  return true; // 允许登录
};
```

### 示例 2：关键词过滤插件
拦截包含敏感词的消息。

```javascript
const sensitiveWords = ['坏蛋', '讨厌'];

hooks.onNewMessage = async ({ user, text, roomId }) => {
  const hasSensitive = sensitiveWords.some(word => text.includes(word));
  if (hasSensitive) {
    console.log(`用户 ${user.username} 尝试发送敏感词：${text}`);
    return false; // 拦截消息
  }
  return true; // 允许发送
};
```

### 示例 3：自动回复机器人
当用户发送 "ping" 时，自动记录到数据库（需要 `db:write` 权限）。

```javascript
hooks.onNewMessage = async ({ user, text, roomId }) => {
  if (text.toLowerCase() === 'ping') {
    console.log(`收到来自 ${user.username} 的 ping`);
    // 这里可以执行复杂的逻辑
  }
  return true;
};
```

### 示例 4：自定义面板插件 (仅限管理员)
在侧边栏增加一个“系统统计”链接，仅管理员可见。

```javascript
hooks.getUI = async () => {
  return {
    title: '系统统计',
    allowedRoles: ['admin'], // 限制仅管理员可见
    content: `
      <div style="padding: 20px; background: #111; border-radius: 12px;">
        <h1 style="color: #fbbf24;">管理员控制台</h1>
        <p>当前时间: ${new Date().toLocaleString()}</p>
        <div style="margin-top: 20px; padding: 15px; background: #222; border-radius: 8px;">
          <h3 style="margin-top: 0;">敏感数据</h3>
          <p>此面板仅对具有 'admin' 角色的用户显示。</p>
        </div>
      </div>
    `
  };
};
```

### 示例 5：自动回复机器人 (带标签)
当用户发送 "hello" 时，机器人以 "系统助手" 身份回复，并带有 "机器人" 标签。

```javascript
hooks.onNewMessage = async ({ user, text, roomId }) => {
  if (text.toLowerCase().includes('hello')) {
    await sendMessage({
      roomId,
      text: `你好 ${user.username}！我是系统助手，很高兴为你服务。`,
      sender: '系统助手',
      color: '#3b82f6',
      tag: '机器人'
    });
  }
  return true;
};
```

---

## 如何部署插件

1. 以管理员身份登录系统。
2. 进入“管理面板”。
3. 在“插件管理”部分，点击“上传插件”。
4. 输入插件名称，勾选所需权限（如 `db:read`, `db:write`）。
5. 将你的 JavaScript 代码粘贴到代码框中。
6. 点击“保存”。

## 文件持久化

所有插件代码都会自动保存到服务器根目录下的 `plugins/` 文件夹中。文件名格式为 `plugin_[timestamp].js`。你可以直接在服务器上编辑这些文件，重启系统后更改将生效。

## 注意事项

- **异步支持**: 所有的 Hook 都可以是 `async` 函数。
- **错误处理**: 插件代码中的错误会被系统捕获并记录，不会导致整个服务器崩溃。
- **安全性**: 插件无法访问 `process`, `require`, `fs` 等敏感 Node.js 模块。
