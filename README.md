# dsh-plugin-pact

[![npm version](https://img.shields.io/npm/v/dsh-plugin-pact.svg)](https://www.npmjs.com/package/dsh-plugin-pact)

> **Published:** [`dsh-plugin-pact`](https://www.npmjs.com/package/dsh-plugin-pact) is published on npm (latest `0.1.2`), so `dsh plugin add dsh-plugin-pact` installs the released package directly.

DeepSeek Harness（DSH）的 PACT 治理插件。它接管 `AgentFactory` 的注册者，但**不重写** DSH 的 `ReactLoopAgent`：PACT 只决定“这一步能不能开始、这个工具能不能执行”，模型调用、工具执行与会话持久化仍由 DSH 完成。

- 规范与实现背景：上游 [PACT 仓库](https://github.com/onlookor/pact-collab) 的决策 D37 / 需求 FR25（设计 §17、手册 §13）。
- 零运行时 npm 依赖；不依赖 Rust crate，不进入任何 Rust workspace。
- 本仓库只包含 DSH 侧插件；PACT 引擎与 WASM 宿主在上游仓库。

## 安装

```bash
# 从 npm
dsh plugin --profile web add dsh-plugin-pact

# 直接从 GitHub
dsh plugin --profile web add github:onlookor/pact-dsh

# 本地开发（link 安装）
dsh plugin --profile web add link:/path/to/pact-dsh
```

`dsh plugin` 会把参数转发给 profile 目录下的 pnpm；首次使用需要可用的 pnpm。安装后：

- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`；
- patch **禁用**原始 `agent-loop` 行，并插入 `pact-agent-loop`（同一 `agentLoop` 服务）与 `dsh-pact-observe` 两行；
- `@deepseek-ai/dsh-agent-loop` 是 peer，由 DSH 运行时解析。

检查组合结果应看到 `agent-loop` 带 `disabled: true`，并出现 `pact-agent-loop`：

```bash
dsh --profile web --dump-config
```

注意：

- DSH 的 patch 只按 `id` 覆盖字段，`name` 仅作一致性校验；**不能**把 `agent-loop` 行直接改名为插件模块，否则该 patch 会被跳过（`patch: name mismatch`）。
- 禁用原行会丢弃其 config。当前 base 模板为 `agents: []`；若你的 profile 在该行配置了 `agents`，请写进本插件的 `pact-agent-loop` 行。
- 链接安装（`link:`）时 pnpm 会提示 peer 不会从目标 `node_modules` 解析；DSH 运行时会用安装副本解析 peer，实测可用。若改用 `file:` 协议可消除该提示。
- 已在 `@deepseek-ai/dsh@0.2.1-rc.2`（developer preview）上验证；DSH 升级需复核。

## 档位

| 档位 | 行为 | 阻断 |
|---|---|---|
| `observe`（缺省） | 镜像 `session/event` 到有界缓冲；配置 `mirrorDir` 时追加 JSONL | 否 |
| `govern` | `agent/pre-step` 与 `tools/pre-execute` 查询 PACT 门，拒绝返回 `reject` / `deny` | 是 |

只有 `agentPreset` 以 `pact-` 开头的 agent 进入治理；其余 agent 原样委托官方 loop。`tools/post-execute` 与 `agent/turn-stopping` 只审计；`stopOnTermination=true` 时 Rule-T 终止后 steer 收尾。

## 配置

只从 `PACT_DSH_CONFIG` 读取：JSON 文件路径或内联 JSON；缺省 `observe` + `fake`。

```json
{
  "mode": "govern",
  "backend": "fake",
  "domain": "dsh",
  "defaultParticipant": "agent",
  "presetPrefix": "pact-",
  "participants": { "pact-review": "reviewer" },
  "mirrorDir": "/home/me/.pact/dsh-audit",
  "mirrorLimit": 256,
  "denyTools": ["shell"],
  "stopOnTermination": false,
  "fakeEnabled": true
}
```

- `mode=govern` 时 `failClosed` 强制为 `true`。
- `backend=wasm` 时必须提供 `wasmModule`。推荐指向上游仓库的组装入口 `crates/pact-wasm/js/open-host.js`（需先 clone `pact-collab`），并用 `wasmOptions` 提供宿主参数：

```json
{
  "mode": "govern",
  "backend": "wasm",
  "wasmModule": "/home/me/pact-collab/crates/pact-wasm/js/open-host.js",
  "domain": "dsh",
  "wasmOptions": {
    "module": "/tmp/pact-wasm-pkg",
    "storeRoot": "/home/me/.pact/dsh-wasm",
    "declaration": "types { … } rules { … }",
    "ts": "2026-10-23T00:00:00.000Z"
  }
}
```

  先在上游仓库构建产物：`cargo build --locked -p pact-wasm --target wasm32-unknown-unknown --profile wasm-release`，再 `wasm-bindgen --target nodejs --out-dir /tmp/pact-wasm-pkg target/wasm32-unknown-unknown/wasm-release/pact_wasm.wasm`（CLI 版本须与 crate 一致，当前 `0.2.127`）。`wasmOptions` 原样透传；产物缺失时治理调用返回 `BackendUnavailable`（fail-closed）。
- `fakeEnabled=false` 让假后端对所有参与者返回未启用，用于预演 `agent/pre-step` 拒绝路径；仅对 `backend=fake` 生效。
- 非法配置在加载期 fail-fast（`PactConfigError`）。

## 后端

`PactBackend`：`enabled(participant, key)`、`gates`、`status`、`seed`、`produce`、`consume`、`close`；`key = domain/instance`。

- `FakePactBackend`：单测/演示用，只模拟插件消费的表面（参与者启用、token 存在性、request_id 幂等），不解释门表达式。
- `WasmPactBackend`：惰性动态导入上游的 `openPactHost(options)`，适配 `pact-wasm` 的 `PactHost`；宿主返回的 `enabled` 是 Rule-W 可生产选项数组，适配层收窄为布尔（非空即可执行）。

## 测试

```bash
npm run check   # node --check index.js loop.js src/*.js
npm test        # node --test test/*.test.js
```

当前 8 个测试文件、49 项通过。测试不需要 DSH，也不需要 WASM 产物；`openPactHost` 的真实产物往返由上游 `crates/pact-wasm/js/ci-smoke.js` 在 CI 的 wasm job 覆盖。

## 审计与安全

- 只记录 `type/seq/工具名/call id`；不记录工具参数、结果、源码或用户内容。
- `mirrorDir` 目录 `0700`、文件 `0600`；不新增端口、不拉子进程、不联网。
- 实例键由 session id 消毒为 `[A-Za-z0-9_-]{1,128}`。
- `govern` 模式 fail-closed：后端不可用、门查询异常都按拒绝处理。

## 已知限制

- `resume` 的钩子在会话发布后安装，恢复后的第一步不受门控。
- 本轮不做 token 级工具映射（produce/consume 与补偿），也不注册 PACT 原生工具。
- 依赖 DSH 预发布 API（`AgentLoop`、`AgentFactory`、`agent/pre-step`、`tools/pre-execute`）；DSH 升级需复核。
- 已用 `@deepseek-ai/dsh@0.2.1-rc.2` 验证真实装载：`--dump-config` 显示原行禁用与替代行插入，启动后 `ctx.agentLoop` 为 `PactAgentLoop` 且继承官方 `AgentLoop`。
- 已在真实 DSH 会话中验证门控（`deepseek-official/deepseek-flash`）：`pact-*` 预设下 `govern` 允许 `bash` 执行并返回 `PACT_TOOL_OK`、`denyTools` 返回 `pact: tool denied by policy`、`fakeEnabled=false` 使 `agent/pre-step` 拒绝并直接结束 turn（无模型请求）。
- 已用 `backend=wasm`（`wasm-bindgen 0.2.127` 产物 + `open-host.js`）在同一 headless profile 复跑上述三条路径并通过；插件退出时不显式关闭宿主，实例锁文件可能残留，下次打开按 pid 存活检测自动回收。

## 来源与许可

本仓库由 [pact-collab](https://github.com/onlookor/pact-collab) 的 `plugins/dsh` 目录迁出（2026-10-23），运行时行为未改。许可：[MIT](LICENSE)。
