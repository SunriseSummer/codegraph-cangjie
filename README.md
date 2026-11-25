# CodeGraph + Cangjie Support

本项目在 [CodeGraph](https://github.com/colbymchenry/codegraph) 上扩展支持[仓颉编程语言](https://cangjie-lang.cn/)，可用于中大型仓颉项目的 AI Coding 提效，CodeGraph 项目介绍和使用指南请参阅官方文档：

- [项目介绍](https://github.com/colbymchenry/codegraph/tree/v1.6.4)
- [使用指南](https://colbymchenry.github.io/codegraph/)

当前分支 `cangjie-1.0.6` 基于上游 **CodeGraph v1.6.4**，适配仓颉 **1.0.6 LTS**（兼容 1.0.5 语法）。发布版本为 `1.6.4-cangjie-1.0.6.1`。

一键安装：

```shell
npm install -g @cangjie-lang/codegraph@latest
```

固定安装本版本：

```shell
npm install -g @cangjie-lang/codegraph@1.6.4-cangjie-1.0.6.1
codegraph --version
```

升级后，请在已索引的项目目录运行 `codegraph index` 重建索引，以启用新版提取和引用解析修复。支持 `.cj` 文件、包和导入别名、类/接口/结构体/枚举、扩展、重载与运算符、测试标注、CLI、MCP 和 Web 查看器；原生 Rust 与 WASM 两条解析路径均保留仓颉支持。

本版本补充了常量/函数值依赖、递归及局部回调遮蔽修复，并增加语言特性矩阵、真实编译运行和多包增量同步回归测试，详见[适配与测试说明](docs/cangjie-1.0.6-validation.md)。

<img width="1055" height="1491" alt="CodeGraph" src="https://github.com/user-attachments/assets/527efc05-01a0-4eed-a733-b170f9074f0f" />
