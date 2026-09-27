# 造啥都行 · Contraption Lab v0.4

V0.4 手机镜头版：

- 竖屏编辑默认约 1.55×，固定地形、终点底座和“下落区”贴到可见场景底部。
- 实验开始后约 2.05× 自动跟随小球。
- 小球接近终点时自动缩一点镜头并把终点带进视野。
- 玩家双指缩放或拖动画面后会接管镜头；“全景”按钮恢复完整关卡视图。
- 保留 PWA / iPhone 添加到主屏幕 / 离线缓存。

## GitHub Pages 更新

把本目录中的 `index.html`、`manifest.webmanifest`、`sw.js` 和三个图标文件一起上传到仓库根目录，覆盖 V0.3。首次更新后如仍显示旧版，完全退出主屏幕 App 再重新打开一次。

---

# 造啥都行 · Contraption Lab PWA

把这个文件夹里的所有文件一起上传到 GitHub Pages 仓库根目录。

必需文件：
- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `icon-180.png`
- `icon-192.png`
- `icon-512.png`

发布后：
- iPhone Safari：分享 → 添加到主屏幕。
- Android Chrome：浏览器菜单 → 安装应用 / 添加到主屏幕。

主屏幕启动后会以独立 App 模式显示，并支持离线再次打开。
