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

绑定**当前打开书**的 eve 问答面（notebook AI tab）。v1 产品能力仅限当前书问答；摘要、导览、翻译、知识包等扩展靠日后 skill / 自定义工具，不进内建产品壳。
_Avoid_: AI 助手（泛称）、Reedy、内置 AI 服务

## Ask about this（问助手）

阅读器划词工具栏入口：把选区预填进当前书的 Reading Assistant 会话（可见引用块 + 空追问），不自动发送。

## ModelConfig（模型配置）

用户自带的 OpenAI 兼容云端连接信息：端点、模型 id、上下文窗口、是否启用。apiKey 不属于此对象，存放在 OS keychain。
_Avoid_: aiSettings, AI Gateway 配置, Ollama 配置
