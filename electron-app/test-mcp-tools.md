# MCP 工具功能测试

## 测试目标
测试 MCP Filesystem Server 的前五个工具功能。

## 测试用例

### 1. 测试 list_directory 工具
**目标**：列出指定目录的内容
**测试命令**：列出 Desktop 目录
**预期结果**：返回目录中的文件和文件夹列表

```
请使用 list_directory 工具列出 C:\Users\Administrator\Desktop 目录的内容。
```

### 2. 测试 read_text_file 工具
**目标**：读取指定文件的内容
**测试命令**：读取测试文件
**预期结果**：返回文件的完整内容

```
请使用 read_text_file 工具读取 C:\Users\Administrator\Desktop\test.txt 文件的内容。
```

### 3. 测试 write_file 工具
**目标**：创建或覆盖文件
**测试命令**：写入测试内容
**预期结果**：成功创建文件并写入内容

```
请使用 write_file 工具在 C:\Users\Administrator\Desktop 创建一个名为 test.txt 的文件，内容为 "Hello MCP!"。
```

### 4. 测试 search_files 工具
**目标**：搜索匹配模式的文件
**测试命令**：搜索所有 .txt 文件
**预期结果**：返回所有匹配的文件路径

```
请使用 search_files 工具在 C:\Users\Administrator\Desktop 目录下搜索所有 .txt 文件。
```

### 5. 测试 get_file_info 工具
**目标**：获取文件或目录的详细信息
**测试命令**：获取测试文件信息
**预期结果**：返回文件大小、创建时间、修改时间等信息

```
请使用 get_file_info 工具获取 C:\Users\Administrator\Desktop\test.txt 文件的详细信息。
```

## 测试顺序
1. 先使用 write_file 创建测试文件
2. 使用 read_text_file 读取文件内容验证
3. 使用 list_directory 列出目录查看文件
4. 使用 search_files 搜索特定文件
5. 使用 get_file_info 获取文件详细信息