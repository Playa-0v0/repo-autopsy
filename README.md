# 仓库解剖室

本地 Git 仓库分析工具：把任意本地仓库拆开看看，贡献热力图、提交关系图、代码画像、六维评分、Star 趋势一站式呈现。

## 功能

- **贡献热力图**：按人统计提交次数或代码行数，支持合并同一人的多个身份，并带不区分账号的仓库总览
- **提交图**：仿 VSCode Git Graph 的提交关系图，支持全部分支与标签
- **代码画像**：扫描 git 跟踪的代码文件，按语言统计占比，排出超长文件与超长函数（自动排除生成代码和测试文件）
- **六维评分**：活跃度、协作度、代码规模、可维护性、工程化、提交粒度，配雷达图和逐项依据
- **Star 趋势**：从 GitHub 还原 star 增长曲线，本地缓存，不重复翻页
- **仓库画像**：远端 star/fork/PR、贡献者头像墙、语言构成，以及模型生成的技术栈表格
- 深色主题，可跟随系统

## 环境要求

- Node.js 24 或更高版本（使用内置的 `node:sqlite`）
- pnpm：`npm install -g pnpm`
- Git

## 克隆并启动

```bash
git clone https://github.com/Playa-0v0/repo-autopsy.git
cd repo-autopsy
pnpm install
pnpm dev --port 13575
```

启动后在浏览器打开：

```
http://localhost:13575
```

点「选择仓库」会弹出系统文件夹选择器；也可以直接把仓库的绝对路径粘进输入框后回车（例如 `E:\LimeA`）。

## 可选配置

- **Star 趋势**：GitHub 现在要求登录才能读取 stargazers。本机运行过 `gh auth login` 就会自动复用 `gh auth token`；也可以设置环境变量 `GH_TOKEN` 或 `GITHUB_TOKEN`。未登录时该卡片会提示如何配置。
- **技术栈分析**：点左上角仓库图标 → 模型设置，填入任意 OpenAI 兼容接口的 Base URL、模型名和 API Key。分析只会发送依赖列表、语言占比和一级目录，不上传源码。
- **桌面快捷方式**：Windows 下可以新建一个 bat，内容大致为：

  ```bat
  @echo off
  cd /d "你的项目目录"
  call pnpm dev --port 13575 --strictPort
  pause
  ```

## 构建预览

```bash
pnpm build
pnpm preview --port 13575
```

## 数据存储

所有扫描结果、仓库档案、头像、评分缓存和模型结论都存在：

```
~/.gitcontribution/data.db
```

SQLite 数据库，删除该文件即可重置全部本地数据。
