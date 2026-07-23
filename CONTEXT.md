# wellread — Domain glossary

## Books（书库根）

阅读器存放书文件的目录，对应 `appService.resolveFilePath('', 'Books')` 的绝对路径。在 eve 侧呈现为模型可见的唯一逻辑根 `/workspace`。

## Workspace（/workspace）

eve 模型侧的文件系统根。在 wellread 中**不是**隔离沙盒里的拷贝，而是 Books 的映射视图。

## .wellread（agent 可写区）

Books 下的隐藏目录（`Books/.wellread/`，模型路径 `/workspace/.wellread/`）。读书助手默认只读 Books；仅此子树允许写入与删除。

## SandboxBackend（自定义书库后端）

eve 的沙盒后端接口实现。wellread 使用薄宿主 FS 后端（路径夹紧 + 桩掉 spawn），不使用 microsandbox、Docker、Vercel 或 just-bash 等重后端。抽象层保留；重的是后端选择，不是「sandbox」这个词本身。

## Reading Assistant（读书助手）

绑定**当前打开书**的 eve 问答面。用户可见**面板标题**为 **Reading Assistant**（原 notebook）；其余用户面文案仍用 **「AI」**（入口、开关等）；v1 产品能力仅限当前书问答；摘要、导览、翻译、知识包等扩展靠日后 skill / 自定义工具（输入框 `/` 调用），不进内建芯片。
_Avoid_: 把面板标题写成「AI」、AI 助手（泛称）、Reedy、内置 AI 服务、Notebook（对用户称呼或入口文案）；执行期标识符亦应迁离 `Notebook*` / `notebookStore` 等命名

## Ask about this（问助手）

阅读器划词工具栏入口：打开 Reading Assistant，并把当前选区**追加**为一段 Pending Quote（不替换已有段），不写入 composer、不自动发送。
_Avoid_: 把选区预填进输入草稿（旧 08 做法）、用新选区替换整条 Pending Quote

## Pending Quote（待发引用）

发送前展示在 AI 面板上方的选区上下文，可一段或多段堆叠；可单项或全部清除。用户一点发送，整组归属该条用户消息气泡，live 条清空。
_Avoid_: source bar（实现绰号）、草稿引用块、把阅读器 live 选区镜像进条

## Thinking Mode（Think/Fast）

Composer 上的二档：Think = 思考模式开，Fast = 思考模式关。默认 Fast；写入用户全局设置。不预设具体厂商 API 字段；sidecar 在支持扩展的主机上，Think 映射为 `thinking: enabled` + `reasoning_effort: high`，Fast 为 `thinking: disabled`。
_Avoid_: temperature 滑杆、思考强度 UI（Low/Medium/High）、按会话记忆、按消息锁定

## ModelProfile（模型配置档）

一份命名的 OpenAI 兼容云端连接：显示名、端点、模型 id、上下文窗口等。用户可保存多份，**一份激活**；composer 切换激活项。apiKey 不属于此对象，存放在 OS keychain。
_Avoid_: ModelConfig（旧单轨名，已被多 profile 取代）、aiSettings, AI Gateway 配置, Ollama 配置

## Skill（助手技能包）

用户日后用 Reading Assistant 输入框 `/` 调用的扩展能力包。宿主路径 `Books/skills/<id>/SKILL.md`，模型路径 `/workspace/skills/<id>/SKILL.md`；`SKILL.md` 为 Agent Skills 形（YAML frontmatter 的 `name`/`description` + 正文 instructions）。发现由 eve sidecar 扫该目录（`GET /eve/v1/skills`）；composer 输入 `/` 时补全为 `/skill:<id>`；发送以 `/skill:<id>` 开头的消息时 sidecar 在发给模型前把完整 instructions 展开进当轮 user message（`<skill name="…" location="…">…</skill>` + args），session/UI 仍保留 `/skill:<id>` 短形式。不进内建芯片；不映射 `$HOME/.agents/skills`；不经 `reedy_skills`。
_Avoid_: 快捷动作芯片、把 skill 塞进 `.wellread/` 当主根、SkillRegistry / reedy_skills 表
