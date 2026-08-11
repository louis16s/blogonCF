# blogonCF

把 Notion 数据库直接变成运行在 Cloudflare Workers 上的完整博客。文章、独立页面、导航、小工具、RSS、站点地图和站点信息均从 Notion 读取，无需 Vercel，也不需要把访客送回 Notion 阅读正文。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Flouis16s%2FblogonCF.git)

线上示例：[1.530555.xyz](https://1.530555.xyz)

等价入口：[blog.530555.xyz](https://blog.530555.xyz) · [www.530555.xyz](https://www.530555.xyz)

## 特性

- 首页直接显示全部公开文章，按 Notion 分类组织
- Notion 常用块、公式、面包屑、关联页面、嵌套子页面、子数据库、图片和带密码文章的站内渲染
- `Page` 直接成为站内页面和导航入口，不需要重复菜单记录
- `Link` 作为外部小工具或跳转入口
- RSS、外部订阅聚合、全文搜索、多样式词云和浅色/深色主题
- Cloudflare D1 密码尝试限流
- 响应式桌面与移动端布局

## 一键部署

### 方式 A：网页按钮

点击上方 **Deploy to Cloudflare**。Cloudflare 会复制公开仓库、创建 Worker、准备 D1，并在部署页面要求填写 Notion 配置。按钮使用完整、已编码的 `.git` 地址，避免 Dashboard 手工输入时的 URL 识别问题。

如果 Cloudflare 页面提示“无法获取存储库内容”，这通常是其 GitHub App 授权或 Git 接入层的问题，不代表仓库不可访问。可重新安装 Cloudflare Workers & Pages GitHub App，或直接使用下面不依赖 GitHub App 的官方 CLI 方式。

### 方式 B：两条命令（推荐备用）

需要本机安装 Node.js 和 pnpm。第一条命令通过 Cloudflare 官方 C3 的 tar 模式下载公开模板，不经过 Dashboard 的 Git 克隆：

```bash
pnpm create cloudflare@latest my-blog --template github:louis16s/blogonCF --template-mode tar --no-agents --no-deploy --no-open --git
cd my-blog && pnpm setup:cloudflare
```

`setup:cloudflare` 只询问 Worker 名称、可选站点地址和两个 Notion Data Source ID，随后自动登录 Cloudflare、创建或复用 D1、写入配置、执行迁移、构建并部署。最后按 Wrangler 提示粘贴一次 `NOTION_TOKEN` 即可。

网页部署时会显示以下配置：

| 名称 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `NOTION_TOKEN` | Secret | 是 | Notion Integration 的内部集成密钥 |
| `NOTION_DATA_SOURCE_ID` | Variable | 建议 | 博客数据库的 Data Source ID；省略时使用项目默认示例值 |
| `NOTION_CONFIG_DATA_SOURCE_ID` | Variable | 可选 | 站点公共配置数据库的 Data Source ID |
| `SITE_URL` | Variable | 可选 | RSS 与站点地图使用的规范站点地址；未设置时使用当前请求域名 |

无论使用哪种方式，都要把文章数据库和可选的配置数据库共享给同一个 Notion Integration。

> 不要把 Notion Token、Cloudflare Token 或 GitHub Token 写进 `wrangler.jsonc`、`.env.example`、提交记录或 Issue。

Cloudflare 的一键部署会从公开仓库创建副本并配置 Workers Builds；D1 等受支持资源可根据 Wrangler 配置自动创建并替换示例资源 ID。详见 [Deploy to Cloudflare 官方文档](https://developers.cloudflare.com/workers/platform/deploy-buttons/) 和 [C3 远程模板文档](https://developers.cloudflare.com/workers/get-started/guide/)。若是把仓库连接到已有 Worker，Worker 名称需与 `wrangler.jsonc` 中的 `blogincf` 一致，构建目录应为仓库根目录。

## 手动部署

以下内容只用于需要完全手工控制资源的情况；一般使用上面的两条命令即可。

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
SITE_URL=https://your-blog.example.com
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

把 `SITE_URL` 和两个 Data Source ID 写进 `wrangler.jsonc` 的 `vars`，或在 Cloudflare Dashboard 中添加普通变量。不要把 Token 放进 `vars`。

### 5. 构建并发布

```bash
pnpm test
pnpm release
```

`pnpm release` 会先构建 vinext Worker，再执行 D1 迁移并通过 Wrangler 发布。Cloudflare Workers Builds 会分别调用 `pnpm build` 与 `pnpm deploy`，不会重复构建。

## Notion 数据库约定

项目直接读取 Notion 数据库。字段名区分大小写时请保持一致。

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `title` | Title | 标题 |
| `type` | Select | `Post`、`Page` 或 `Link` |
| `status` | Select | 只有 `Published` 对外可见 |
| `slug` | Rich text | 文章/页面路径，或 Link 的跳转地址 |
| `summary` | Rich text | 摘要；其中的 Notion 超链接也可作为跳转目标 |
| `category` | Select | 文章分类 |
| `tags` | Multi-select | 文章标签 |
| `date` | Date | 发布时间和排序 |
| `password` | Rich text | 非空时启用密码保护 |

### 内容类型

- 文章继续使用 `Post + Published`
- 独立内容页使用 `Page + Published`
- 外部小工具使用 `Link + Published`，目标可写在 URL 属性、`slug` 的文字链接或其他带链接的富文本属性中
- “关于我”可使用 `me` slug，会映射到 `/about`
- 其余页面使用 `/page/{slug}`
- 标题或 slug 为 `RSS` 的 Page 会映射到 `/rss.xml`

### 资讯页聚合外部 RSS

Notion 本身不能显示别人的 RSS，但本站可以。新建或保留一个已发布的 `Page`（标题包含“资讯”，或 slug 为 `links`/`news`），在正文插入一个或多个 **Bookmark（书签）**，每个书签的 URL 填入订阅源地址，例如：

```text
https://example.com/feed.xml
https://example.org/rss
```

本站会在该页面下方自动渲染订阅动态的标题、来源、日期和摘要；文章仍在原站点打开。RSS 2.0 和 Atom 都可用。无效链接会被静默跳过，不影响 Notion 正文显示；本地、内网和非 `http(s)` 地址会被拒绝。订阅结果写入 D1，并由 Cron Trigger 每 15 分钟预热；源站短暂失败时会回退到最近一次成功结果。

若订阅源只用于聚合、不希望在资讯正文中显示，可用两行标记包住它们：

```text
------[hide]------
https://example.com/feed.xml
------[hide]------
```

Notion 自动转换出的 `———[hide]———` 也会被识别。标记和中间内容不会渲染，但 Worker 仍会读取其中的 RSS 地址。

## 配置中心

公共接口只读取以下允许项，避免把配置数据库中的私密字段暴露给访客：

- `AUTHOR`：页脚作者
- `SINCE`：创始年份
- `HOME_NOTICE`：首页公告主句
- `HOME_NOTICE_SUBTITLE`：首页公告副句
- `POST_COUNT_TEXT`：首页文章数量文案，使用 `{count}` 作为数量占位符
- `FOOTER_CREDIT`：页脚来源说明；其中的 `Notion` 会保留官网链接
- `REPOSITORY_URL`：侧栏项目仓库地址，仅接受 GitHub HTTPS 仓库链接
- `FOOTER_QUOTES`：页脚随机短句；每行一组，主句与副句用 `｜` 分隔

配置项需要启用；年份会从文本中提取四位数。未配置时使用项目默认值。

`type` 应保持为单选（Select）。不要改成 Multi-select，否则查询条件无法稳定区分文章、页面和外部链接。

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
| `pnpm deploy` | 迁移 D1 并部署已经构建的产物（供 Workers Builds 使用） |
| `pnpm release` | 本地完整构建并部署 |
| `pnpm setup:cloudflare` | 新账号交互式初始化并部署 |
| `pnpm db:generate` | 数据库结构变化后生成 D1 迁移 |

## 自定义域名

在 Cloudflare Dashboard 打开 Worker 的 **Settings → Domains & Routes → Add → Custom Domain**，选择已托管在同一 Cloudflare 账号中的域名。设置 `SITE_URL` 后，RSS 和站点地图固定使用该规范地址；未设置时使用当前请求域名。

## 数据与性能架构

- 首页由 Worker 并行读取文章、菜单和公共配置后直接 SSR，不等待浏览器二次拼装。
- Cloudflare Cache API 与 Worker 内存会共同对公共 bootstrap 做 45 秒跨实例缓存和并发请求去重；上游短暂失败时最多保留 5 分钟的最近公开列表。
- 访客响应使用重新校验策略，避免 Cloudflare 区域缓存规则把 Notion 内容固定数小时；45 秒缓存只存在于 Worker 内部。
- 浏览器端的侧栏、文章统计和页脚配置共用一个 `/api/content/posts` 请求，避免文章页重复请求三个接口。
- 首页与文章页面每 5 分钟检查一次更新；页面重新可见时，只有缓存已经过期才同步。
- 全文索引仅在访客聚焦搜索框后预热，普通首页访问不会读取所有文章正文。
- 词云、KaTeX 和 HEIC 浏览器兜底按需加载；配置 Cloudflare Images 后，HEIC 会优先在 Worker 侧转换。
- 密码校验、密码文章正文和错误响应始终使用 `no-store`，不会进入公共缓存。

## 安全设计

- 密码文章在校验成功前不会读取或返回正文块；成功后使用按文章隔离、短期有效的 HttpOnly 会话，密码不会在子页面请求中反复传输
- D1 对失败尝试做时间窗限流
- Notion 图片代理限制上游域名和响应类型
- 外部 RSS 只从已发布资讯页中的 `http(s)` 链接读取，并拒绝本机与私网地址
- 导航只接受 `http(s)` 或站内绝对路径，拒绝 `javascript:` 等危险协议
- 公共站点配置采用显式字段白名单
- 所有 Notion 查询只返回 `Published` 内容

发现安全问题请阅读 [SECURITY.md](SECURITY.md)，不要在公开 Issue 中粘贴令牌或未公开文章。

## 项目结构

```text
app/        页面、组件与样式
worker/     Cloudflare Worker 路由、Notion 网关与隔离的外部内容抓取模块
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
