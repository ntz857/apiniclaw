# ApiniClaw 官网

静态落地页，介绍 ApiniClaw 桌面客户端。

## 本地预览

```bash
# 在仓库根目录
npx --yes serve website -p 5173
# 打开 http://localhost:5173
```

或：

```bash
cd website
python -m http.server 5173
```

## 结构

- `index.html` - 中英切换落地页
- `css/styles.css` - 品牌暗色主题（主色 `#FF4D2A`）
- `js/main.js` - 语言切换、截图 Tab、滚动显现
- `assets/` - logo、图标与产品截图

## 部署

将 `website/` 目录内容发布到 `www.apiniclaw.com`（任意静态托管：GitHub Pages、Cloudflare Pages、Nginx 等）。
