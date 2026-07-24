# bloginCF

把 Notion 数据库直接变成运行在 Cloudflare Workers 上的完整博客。文章、独立页面、导航、小工具、RSS、站点地图和站点信息均从 Notion 读取，无需 Vercel，也不需要把访客送回 Notion 阅读正文。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/louis16s/blogonCF)

线上示例：[1.530555.xyz](https://1.530555.xyz)

等价入口：[blog.530555.xyz](https://blog.530555.xyz) · [www.530555.xyz](https://www.530555.xyz)

## 特性

- 首页直接显示全部公开文章，按 Notion 分类组织
- Notion 常用块、嵌套子页面、图片和带密码文章的站内渲染
- `Menu + Page` 自动配对，同时兼容 NotionNext 的旧配置方式
- 已发布的 `Page` 即使没有对应 `Menu`，也会自动成为本站页面和导航入口
- `SubMenu`/旧式带链接记录自动作为小工具
- RSS、`sitemap.xml`、文章搜索、多样式词云和浅色/深色主题
- Cloudflare D1 密码尝试限流
- 响应式桌面与移动端布局

## 一键部署

点击上方 **Deploy to Cloudflare**。Cloudflare 会复制此仓库、创建 Worker、自动准备配置中声明的 D1 数据库，并启用后续 Git 推送自动部署。

部署完成后，在 Cloudflare Dashboard 的 Worker 设置中添加：

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `NOTION_TOKEN` | Secret | 是 | Notion Integration 的内部集成密钥 |
| `NOTION_DATA_SOURCE_ID` | Variable | 建议 | 博客数据库的 Data Source ID；省略时使用项目默认示例值 |
| `NOTION_CONFIG_DATA_SOURCE_ID` | Variable | 可选 | NotionNext 配置中心的 Data Source ID |

随后把两个数据库共享给同一个 Notion Integration，再重新部署一次即可。

> 不要把 Notion Token、Cloudflare Token 或 GitHub Token 写进 `wrangler.jsonc`、`.env.example`、提交记录或 Issue。

Cloudflare 的一键部署会从公开仓库创建副本并配置 Workers Builds；D1 等受支持资源可根据 Wrangler 配置自动创建。详见 [Deploy to Cloudflare 官方文档](https://developers.cloudflare.com/workers/platform/deploy-buttons/)。

## 手动部署

### 1. 准备环境

- Node.js `>=22.13.0`
- pnpm
- Cloudflare 账号
- 一个可读取博客数据库的 Notion Integration

```bash
git clone https://github.com/louis16s/blogonCF.git
cd blogonCF
corepack enable
pnpm install
```

### 2. 配置本地 Notion

复制 `.env.example` 为 `.env`，填入自己的值：

```dotenv
NOTION_TOKEN=ntn_your_token
NOTION_DATA_SOURCE_ID=your_blog_data_source_id
NOTION_CONFIG_DATA_SOURCE_ID=your_config_data_source_id
```

数据库 URL 中的长 ID 不一定等于 Data Source ID。可在 Notion API、数据库连接信息或接口响应的 `collection://...` 中确认。Integration 必须被邀请到数据库，否则 API 会返回未找到或无权限。

### 3. 创建 D1

```bash
pnpm wrangler login
pnpm wrangler d1 create blogincf-rate-limit
```

把命令返回的 `database_id` 写入 `wrangler.jsonc` 的 `d1_databases[0].database_id`，然后执行迁移：

```bash
pnpm wrangler d1 migrations apply DB --remote
```

### 4. 设置线上变量

令牌使用 Worker Secret：

```bash
pnpm wrangler secret put NOTION_TOKEN
```

把两个 Data Source ID 写进 `wrangler.jsonc` 的 `vars`，或在 Cloudflare Dashboard 中添加普通变量。不要把 Token 放进 `vars`。

### 5. 构建并发布

```bash
pnpm test
pnpm deploy
```

`pnpm deploy` 会先构建 vinext Worker，再通过 Wrangler 发布。静态资源通过 `ASSETS` binding 提供，服务端页面和 Notion 网关由 Worker 处理。

## Notion 数据库约定

项目沿用 NotionNext 的核心字段。字段名区分大小写时请保持一致。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `title` | Title | 标题 |
| `type` | Select | `Post`、`Page`、`Menu` 或 `SubMenu` |
| `status` | Select | 只有 `Published` 对外可见 |
| `slug` | Rich text | 文章/页面路径，或菜单、小工具的跳转地址 |
| `summary` | Rich text | 摘要；其中的 Notion 超链接也可作为跳转目标 |
| `category` | Select | 文章分类 |
| `tags` | Multi-select | 文章标签 |
| `date` | Date | 发布时间和排序 |
| `password` | Rich text | 非空时启用密码保护 |

### Menu 与 Page 如何配对

推荐使用清晰的两条记录：

```text
Menu: title=关于我, slug=me, status=Published
Page: title=关于我_, slug=me, status=Published
```

系统按以下顺序配对：

1. Menu 属性中的 Notion 页面链接指向 Page
2. 两者 `slug` 相同
3. 去掉 Page 标题末尾下划线后，标题相同

配对后，Menu 提供入口名称和图标，Page 提供本站渲染的正文。若只有 Page，仍会自动生成入口；若旧配置只有 Menu，仍按其安全链接处理。`RSS` 会固定映射到 `/rss.xml`。

### NotionNext 兼容建议

- 文章继续使用 `Post + Published`
- 独立内容页使用 `Page + Published`
- 一级入口使用 `Menu + Published`
- 小工具使用 `SubMenu + Published`，目标可写在 URL 属性、`slug` 的文字链接或其他带链接的富文本属性中
- “关于我”可使用 `me` slug，会映射到 `/about`
- 其余页面使用 `/page/{slug}`

## 配置中心

公共接口只读取以下允许项，避免把配置数据库中的私密字段暴露给访客：

- `AUTHOR`：页脚作者
- `SINCE`：创始年份

配置项需要启用；年份会从文本中提取四位数。未配置时使用项目默认值。

## 本地开发

```bash
pnpm dev
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动本地 Worker 和前端开发环境 |
| `pnpm build` | 生成 `dist/server` 与 `dist/client` |
| `pnpm test` | 完整构建并运行接口、渲染和安全测试 |
| `pnpm lint` | 运行 ESLint |
| `pnpm deploy` | 构建并部署到 Cloudflare |
| `pnpm db:generate` | 数据库结构变化后生成 D1 迁移 |

## 自定义域名

在 Cloudflare Dashboard 打开 Worker 的 **Settings → Domains & Routes → Add → Custom Domain**，选择已托管在同一 Cloudflare 账号中的域名。项目本身不固定域名，RSS 和站点地图会基于请求 Host 生成绝对地址。

## 安全设计

- 密码文章在校验成功前不会读取或返回正文块
- D1 对失败尝试做时间窗限流
- Notion 图片代理限制上游域名和响应类型
- 导航只接受 `http(s)` 或站内绝对路径，拒绝 `javascript:` 等危险协议
- 公共站点配置采用显式字段白名单
- 所有 Notion 查询只返回 `Published` 内容

发现安全问题请阅读 [SECURITY.md](SECURITY.md)，不要在公开 Issue 中粘贴令牌或未公开文章。

## 项目结构

```text
app/        页面、组件与样式
worker/     Cloudflare Worker、Notion API 网关与 SSR 路由
shared/     浏览器与 Worker 共用的纯逻辑
db/         D1 数据结构与限流逻辑
drizzle/    D1 迁移
tests/      渲染、接口、密码和边界测试
public/     站点图标、开屏素材和分享图
```

## 参与贡献

欢迎修复 Notion 块兼容、可访问性、性能和文档问题。提交前请运行 `pnpm test` 与 `pnpm lint`，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[MIT](LICENSE) © 2020–present louis16s
