import os
import json
from pageindex.utils import LLM_API

# 从 config.json 读取配置
def load_config():
    config_path = os.path.join(os.path.dirname(__file__), 'config.json')
    if os.path.exists(config_path):
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

config_data = load_config()

class VectorlessRAG:
    def __init__(self, structure_file):
        """初始化无向量RAG"""
        self.structure_file = structure_file
        self.structure = self.load_structure()
        self.model = config_data.get('model', "Qwen/Qwen3-VL-235B-A22B-Instruct")
    
    def load_structure(self):
        """加载文档结构"""
        try:
            with open(self.structure_file, 'r', encoding='utf-8') as f:
                structure = json.load(f)
            return structure
        except Exception as e:
            print(f"加载结构文件失败: {e}")
            return None
    
    def search_tree(self, question, structure=None, path=""):
        """基于推理的树搜索"""
        if structure is None:
            structure = self.structure.get('structure', [])
        
        # 构建当前结构的摘要
        context = []
        for section in structure:
            title = section.get('title', '')
            summary = section.get('summary', '')
            current_path = f"{path} > {title}" if path else title
            context.append(f"【{current_path}】\n{summary}")
        
        context_str = "\n\n".join(context)
        
        # 构建推理提示
        prompt = f"""你是一个文档检索专家。请分析以下文档结构和用户问题，确定哪些部分最相关。

文档结构：
{context_str}

用户问题：
{question}

请返回最相关的章节标题列表，按相关性从高到低排序。只返回标题，不返回其他内容。"""
        
        # 调用模型进行推理
        response = LLM_API(model=self.model, prompt=prompt)
        
        # 解析响应，提取相关章节
        relevant_titles = [line.strip() for line in response.split('\n') if line.strip()]
        
        return relevant_titles
    
    def get_relevant_content(self, relevant_titles):
        """获取相关章节的内容"""
        relevant_content = []
        
        def search_sections(sections, path=""):
            for section in sections:
                title = section.get('title', '')
                summary = section.get('summary', '')
                current_path = f"{path} > {title}" if path else title
                
                # 处理搜索结果中的括号
                formatted_title = f"【{title}】"
                if title in relevant_titles or formatted_title in relevant_titles:
                    relevant_content.append(f"【{current_path}】\n{summary}")
                
                if 'nodes' in section:
                    search_sections(section['nodes'], current_path)
        
        search_sections(self.structure.get('structure', []))
        return relevant_content
    
    def generate_answer(self, question):
        """生成回答"""
        # 搜索相关章节
        relevant_titles = self.search_tree(question)
        
        # 获取相关内容
        relevant_content = self.get_relevant_content(relevant_titles)
        context = "\n\n".join(relevant_content)
        
        # 构建回答提示
        prompt = f"""你是一个基于文档的问答助手。请根据以下文档内容回答用户的问题。

文档内容：
{context}

用户问题：
{question}

请基于文档内容提供详细、准确的回答。如果文档中没有相关信息，请明确说明。"""
        
        # 调用模型生成回答
        response = LLM_API(model=self.model, prompt=prompt)
        return response
    
    def chat(self):
        """开始聊天"""
        print("====================================")
        print("无向量RAG聊天助手")
        print(f"基于文件: {self.structure_file}")
        print("输入 'exit' 退出聊天")
        print("====================================")
        
        while True:
            question = input("\n请输入你的问题: ")
            if question.lower() == 'exit':
                break
            
            print("\n思考中...")
            answer = self.generate_answer(question)
            print("\n回答:")
            print(answer)
            print("====================================")

if __name__ == "__main__":
    import sys
    import json
    
    if len(sys.argv) < 3:
        print("用法: python vectorless_rag.py <command> <structure_file> [--query <query>]")
        print("命令:")
        print("  chat - 启动交互式聊天")
        print("  query - 执行单个查询并返回结果")
        print("示例:")
        print("  python vectorless_rag.py chat results/污水处理英文版_structure.json")
        print("  python vectorless_rag.py query results/污水处理英文版_structure.json --query '污水处理的主要步骤是什么?'")
        sys.exit(1)
    
    command = sys.argv[1]
    structure_file = sys.argv[2]
    
    if not os.path.exists(structure_file):
        print(f"文件不存在: {structure_file}")
        sys.exit(1)
    
    rag = VectorlessRAG(structure_file)
    
    if command == "chat":
        rag.chat()
    elif command == "query":
        # 解析查询参数
        query = None
        for i in range(3, len(sys.argv)):
            if sys.argv[i] == "--query" and i + 1 < len(sys.argv):
                query = sys.argv[i + 1]
                break
        
        if not query:
            print("错误: 查询模式需要 --query 参数")
            sys.exit(1)
        
        # 执行查询并返回结果
        answer = rag.generate_answer(query)
        # 去除markdown格式（粗体、列表等）
        import re
        answer = re.sub(r'\*\*(.*?)\*\*', r'\1', answer)  # 去除粗体
        answer = re.sub(r'^- ', '', answer, flags=re.MULTILINE)  # 去除列表标记
        answer = re.sub(r'^-', '', answer, flags=re.MULTILINE)  # 去除列表标记
        answer = re.sub(r'^\d+\.\s', '', answer, flags=re.MULTILINE)  # 去除数字列表
        answer = re.sub(r'^(\d+)\.', r'\1', answer, flags=re.MULTILINE)  # 去除数字点
        answer = re.sub(r'^\*\s', '', answer, flags=re.MULTILINE)  # 去除星号列表
        # 使用UTF-8编码输出，避免Windows编码问题
        import sys
        sys.stdout.buffer.write(answer.encode('utf-8'))
        sys.stdout.buffer.write(b'\n')
    else:
        print(f"未知命令: {command}")
        sys.exit(1)