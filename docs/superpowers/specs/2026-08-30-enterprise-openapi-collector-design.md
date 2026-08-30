# 单企业开放平台采集（取代个人 dws）

**状态：** 设计已确认（2026-08-30）  
**选择：** C1 单企业自建应用 + D3 对齐只读能力面 + E2 浏览器 OAuth + 方案 1（Ubuntu 企业应用采集器）

**取代关系：** 正式主路径不再依赖本机个人 `dws` / `scripts/sync` push。  
`docs/design/web-service-ubuntu-dws-push.md` 中的「本机 dws 推送」降为过渡/废弃说明；其 Web Service / vault / 四件套 / 建图骨架**复用**。

---

## 1. 目标

在 Ubuntu 上以**企业内部应用**完成：

- 浏览器 OAuth 扫码登录（单 `corpId`）
- 每钉钉用户独立 vault
- 用**用户授权后的访问令牌**调用开放平台 HTTP，尽量对齐现有个人 `dws` 只读白名单
- 落盘四件套并触发现有 ingest → kl 建图

本机 **不安装** `dws` / MyContext agent；不在服务器上按用户起 `dws` 进程。

## 2. 硬约束

1. `AppKey` / `AppSecret` / 用户 `access_token` / `refresh_token` **不进 git**；日志只打掩码，不打聊天正文与真实 ID 全文。
2. 采集只走「dws 白名单 ↔ 开放平台」对照表中**已映射**项；无映射 → `unsupported`，禁止换接口试探。
3. 保密群 / 无权限：服务端拒绝即 `unreadable` 并跳过，禁止换身份/换参数绕过。
4. 严格遵守用户引导所选范围（时间下界 + 勾选会话）；超范围不采。
5. 分页必须抽干；禁止「只取第一页却记成功」。
6. 发送类 / 花名册 PII（手机号反查、离职名单、银行卡/合同/家庭信息等）不进能力表。
7. 不使用 App 级 token 冒充用户读取个人会话（越权与串数风险）。

## 3. 架构

```
[用户浏览器] --OAuth 扫码--> [开放平台] --授权码--> [Ubuntu MyContext Web]
                                      |
                                      v
                         每用户 vault（SQLite + exports）
                                      |
              [企业应用采集器] --用户 token--> 开放平台 HTTP（消息/听记/文档…）
                                      |
                                      v
                         现有 ingest → 四件套 → kl 建图（Ubuntu）
```

### 复用

- `apps/web-server`（HTTP UI/API）
- vault 与 `exports/dws` 四件套形状
- `POST /api/v1/graph/build` 及 kl ingest 约定
- 部署文档骨架（防火墙 / HTTPS / 数据卷）

### 废弃主路径

- 本机 `dingtalk-workspace-cli` / `dws auth login` 作为采集前提
- `scripts/sync/push-dws-export.*` 作为正式同步方式（可标 deprecated 保留一段时间）

## 4. OAuth 与会话

- **应用**：钉钉企业内部应用；回调域名为 Ubuntu HTTPS 反代地址；`scope` 按开放平台要求配置（至少含登录身份；业务 API 权限在开发者后台单独申请并与对照表对齐）。
- **流**：授权页 → `GET /api/v1/auth/callback` → 换用户级 token → 建立服务端 session（HttpOnly Secure cookie 或等价）；refresh 不进前端 JS。
- **隔离键**：固定单企业 `corpId` + 稳定用户标识（`unionId` / `openId` 等以开放平台实测为准）→ `vaultId`；首次登录建 vault。
- **续期失败**：清会话并引导重新扫码。
- **本阶段不做**：钉内免登、多企业租户、上传本机 `~/.dws`。

参考公开文档入口（实现时以当时文档为准再实测）：

- 网页登录 / 用户个人信息：`open.dingtalk.com` 组织应用「获取用户个人信息」类教程
- 用户 token：`POST https://api.dingtalk.com/v1.0/oauth2/userAccessToken`
- 应用 token（仅非用户会话类调用，若需要）：`POST https://api.dingtalk.com/v1.0/oauth2/accessToken` —— **不得**用于替代用户读个人聊天

## 5. 采集映射与降级

- **对照表**：仓库内单一模块维护 `既有 dws 只读白名单命令 → 开放平台 HTTP | unsupported`。
- **已映射**：HTTP 客户端 + 分页抽干 + 写入该用户 vault 的四件套（或中间库再物化，形状必须对齐 kl loader）。
- **unsupported**：进度可见，不记采集成功。
- **unreadable**：保密/无权限，跳过并计数。
- **产品文案**：相对个人 `dws` 的能力缩水必须明示，禁止静默空成功。

调度：登录后按引导范围跑；先任务 + 进度 API；`dws event` 长连后置。

## 6. 错误处理

| 情况 | 处置 |
|------|------|
| OAuth / refresh 失败 | 清会话，重新扫码 |
| 限流 / 5xx | 退避重试 |
| 权限拒绝 / 保密 | `unreadable`，不重试风暴 |
| 无 API 映射 | `unsupported` |
| 体量过大 / 超时 | 明确失败，水位不假装前进 |

## 7. 测试

- OAuth / session / vault 绑定：mock，假 ID。
- 每条已映射 API：分页与解析单测；`unsupported` / `unreadable` 必测。
- 四件套假 fixture 对齐现有 export 契约。
- 真实企业响应与凭据禁止入库。

## 8. MVP 验收

1. 单企业应用可配置；浏览器扫码登录 Ubuntu Web；每用户独立 vault。
2. 按引导触发采集：已映射有数据或明确错误；未映射显示不可用。
3. 有导出时可触发现有建图路径。
4. 文档：权限清单、对照表、无本机 `dws` 安装步骤；密钥仅环境变量说明。

## 9. 明确不做（本阶段）

- 多企业 / 应用市场多租户
- 服务器上跑个人 `dws` 或拷贝 `~/.dws`
- 钉内免登（E1）
- 发送消息、改群、PII 花名册类接口
- 一次删光 Electron 开发态

## 10. 文档可得性说明

本规格不内嵌开放平台全文。实现与对照表填写时以 [钉钉开放平台](https://open.dingtalk.com/) 当时文档为准，并对每条已映射 API **重新实测**（分页、信封、权限码）；仓库内历史注释有保质期。
