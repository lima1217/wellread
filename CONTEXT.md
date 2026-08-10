# wellread — Domain glossary

Ubiquitous language for Reading Assistant and Books. Implementation contracts: [`apps/readest-app/docs/reading-assistant-contract.md`](./apps/readest-app/docs/reading-assistant-contract.md).

## Books（书库根）

阅读器书文件目录，对应 `appService.resolveFilePath('', 'Books')`。在 eve 侧映射为模型唯一逻辑根 `/workspace`。

## Workspace（/workspace）

eve 模型侧文件系统根：Books 的映射视图（非隔离沙盒拷贝）。

## .wellread（agent 可写区）

`Books/.wellread/`（模型路径 `/workspace/.wellread/`）。读书助手默认只读 Books；仅此子树可写/删。

## SandboxBackend（自定义书库后端）

eve 沙盒后端接口的薄宿主 FS 实现（路径夹紧 + 桩掉 spawn）。抽象层保留；重的是后端选择，不是「sandbox」一词。

## Reading Assistant（读书助手）

绑定**当前打开书**的 eve 问答面。面板标题：**Reading Assistant**；其余用户面入口/开关文案：**「AI」**。v1 仅限当前书问答；扩展靠 skill（输入框 `/`），不进内建芯片。

Canonical: 面板标题用 Reading Assistant；执行期标识符迁离 `Notebook*` / `notebookStore`。

## Ask about this（问助手）

划词工具栏入口：打开 Reading Assistant，把当前选区**追加**为一段 Pending Quote（不替换已有段），不写入 composer、不自动发送。

## Pending Quote（待发引用）

发送前展示在 AI 面板上方的选区上下文（可多段堆叠；可单项或全部清除）。发送后整组归属该条用户消息气泡，live 条清空。

Canonical: 选区进 Pending Quote，不进 composer 草稿。

## Thinking Mode（Think/Fast）

Composer 二档：Think = 思考开，Fast = 思考关。默认 Fast；写入用户全局设置。sidecar 在支持扩展的主机上：Think → `thinking: enabled` + `reasoning_effort: high`；Fast → `thinking: disabled`。

## ModelProfile（模型配置档）

一份命名的 OpenAI 兼容云端连接（显示名、端点、模型 id、上下文窗口等）。可多份、**一份激活**；composer 切换激活项。apiKey 在 OS keychain，不在此对象。

Canonical: ModelProfile（取代旧单轨 ModelConfig）。

## Skill（助手技能包）

Reading Assistant 输入框 `/` 调用的扩展包。两层合并进 `/workspace/skills/<id>/`：

- **user**：`Books/skills/<id>/`（可导入/删除）
- **bundled**：`apps/eve-sidecar/bundled-skills/<id>/`（只读；默认 `explain`、`grill-me`、`note`、`rephrase`、`socratic-check`、`translate`）

同 id 时 **user 覆盖 bundled**（例外：`PACKAGE.md` / `AGENTS.md` / `tools/*` 始终 bundled，防指令注入）。隐藏无 user 覆盖的默认包：`Books/.wellread/disabled-bundled-skills.json`。

每轮 system 只注入目录（id + description + path）；正文按 `/skill:<id>` 展开进当轮 user message，或模型 `read_file` 该 path。

所有权与 wire：disk/catalog → `apps/eve-sidecar`；slash UX → FE `ComposerSlash`；expand → sidecar `skills/invoke`；跨 FE–sidecar schema → `packages/`（`eve-message`、`extract-contract`、`quote-wire`、`reading-context`）；turn 不变量 → `turnLifecycle.ts`。
