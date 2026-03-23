#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
RAG (Retrieval-Augmented Generation) 处理器
负责文档解析、文本分块、向量嵌入和检索功能
"""

import os
import json
import argparse
import logging
from typing import List, Dict, Any

# 配置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class RAGProcessor:
    """
    RAG处理器类，负责文档处理和向量操作
    """
    
    def __init__(self, output_dir: str, model_name: str = "qwen3-embedding:4b"):
        """
        初始化RAG处理器
        
        Args:
            output_dir: 输出目录，用于存储处理结果和向量
            model_name: 嵌入模型名称
        """
        self.output_dir = output_dir
        self.model_name = model_name
        self.vector_db_path = os.path.join(output_dir, "vector_db")
        self.chunks_path = os.path.join(output_dir, "chunks.json")
        self.embeddings_path = os.path.join(output_dir, "embeddings.json")
        
        # 创建必要的目录
        os.makedirs(self.output_dir, exist_ok=True)
        os.makedirs(self.vector_db_path, exist_ok=True)
    
    def process_files(self, files: List[str]) -> Dict[str, Any]:
        """
        处理文件列表
        
        Args:
            files: 文件路径列表
            
        Returns:
            处理结果，包含处理的文件信息
        """
        logger.info(f"开始处理文件: {files}")
        
        processed_files = []
        all_chunks = []  # 保存所有文本块
        total_files = len(files)
        
        if total_files == 0:
            logger.warning("没有文件需要处理")
            return {"success": False, "error": "没有文件需要处理"}
        
        for i, file_path in enumerate(files):
            try:
                # 计算进度
                progress = int((i + 1) / total_files * 70)  # 前70%用于文件处理
                
                logger.info(f"解析文件 {i+1}/{total_files}: {file_path}")
                
                # 检查文件是否存在
                if not os.path.exists(file_path):
                    logger.warning(f"文件不存在: {file_path}")
                    continue
                
                # 解析文件
                text = self._parse_file(file_path)
                
                # 检查解析结果
                if not text or text.startswith('['):
                    logger.warning(f"文件解析失败: {file_path}")
                    continue
                
                logger.info(f"文件解析成功，内容长度: {len(text)}")
                
                # 分块处理
                chunks = self._split_text(text)
                logger.info(f"文件分块数量: {len(chunks)}")
                
                if len(chunks) == 0:
                    logger.warning(f"文件内容为空，无法分块: {file_path}")
                    continue
                
                # 保存文件信息
                file_info = {
                    "name": os.path.basename(file_path),
                    "path": file_path,
                    "size": os.path.getsize(file_path),
                    "chunks": len(chunks)
                }
                processed_files.append(file_info)
                
                # 保存文本块内容
                for j, chunk in enumerate(chunks):
                    all_chunks.append({
                        "file_name": os.path.basename(file_path),
                        "file_path": file_path,
                        "chunk_index": j,
                        "content": chunk
                    })
                
                # 输出进度
                self._output_progress(progress, f"处理文件: {os.path.basename(file_path)} ({i+1}/{total_files})")
                
            except Exception as e:
                logger.error(f"处理文件 {file_path} 时出错: {str(e)}")
                continue
        
        if len(processed_files) == 0:
            logger.error("所有文件处理失败")
            return {"success": False, "error": "所有文件处理失败"}
        
        # 加载现有文件数据（如果存在）
        existing_files = []
        if os.path.exists(self.chunks_path):
            try:
                with open(self.chunks_path, 'r', encoding='utf-8') as f:
                    existing_files = json.load(f)
                logger.info(f"加载了 {len(existing_files)} 个现有文件")
            except Exception as e:
                logger.error(f"加载现有文件失败: {str(e)}")
        
        # 加载现有文本块（如果存在）
        existing_chunks = []
        chunks_content_path = os.path.join(self.output_dir, "chunks_content.json")
        if os.path.exists(chunks_content_path):
            try:
                with open(chunks_content_path, 'r', encoding='utf-8') as f:
                    existing_chunks = json.load(f)
                logger.info(f"加载了 {len(existing_chunks)} 个现有文本块")
            except Exception as e:
                logger.error(f"加载现有文本块失败: {str(e)}")
        
        # 合并新文件和现有文件（去重）
        existing_paths = set(f['path'] for f in existing_files)
        new_files = [f for f in processed_files if f['path'] not in existing_paths]
        
        # 更新文件列表
        updated_files = existing_files + new_files
        
        # 合并文本块（去重）
        existing_chunk_keys = set((c['file_path'], c['chunk_index']) for c in existing_chunks)
        new_chunks = [c for c in all_chunks if (c['file_path'], c['chunk_index']) not in existing_chunk_keys]
        
        # 更新文本块列表
        updated_chunks = existing_chunks + new_chunks
        
        # 保存处理结果
        self._save_chunks(updated_files)
        
        # 保存文本块内容供嵌入使用
        with open(chunks_content_path, 'w', encoding='utf-8') as f:
            json.dump(updated_chunks, f, ensure_ascii=False, indent=2)
        logger.info(f"保存了 {len(updated_chunks)} 个文本块到 chunks_content.json")
        
        # 自动进行向量嵌入
        self._output_progress(75, "开始向量嵌入...")
        embed_result = self.embed()
        
        if embed_result.get("success"):
            logger.info("文件处理和向量嵌入完成")
            return {
                "success": True, 
                "files": processed_files,
                "total_chunks": len(all_chunks),
                "embed_result": embed_result
            }
        else:
            logger.warning(f"向量嵌入失败: {embed_result.get('error', '未知错误')}")
            return {
                "success": True,
                "files": processed_files,
                "total_chunks": len(all_chunks),
                "warning": f"文件处理成功，但向量嵌入失败: {embed_result.get('error', '未知错误')}"
            }
    
    def process_folder(self, folder_path: str) -> Dict[str, Any]:
        """
        处理文件夹中的所有文件
        
        Args:
            folder_path: 文件夹路径
            
        Returns:
            处理结果，包含处理的文件信息
        """
        logger.info(f"开始处理文件夹: {folder_path}")
        
        # 收集文件夹中的所有支持的文件
        supported_extensions = ['.txt', '.md', '.pdf', '.docx']
        files = []
        
        for root, _, filenames in os.walk(folder_path):
            for filename in filenames:
                if any(filename.lower().endswith(ext) for ext in supported_extensions):
                    files.append(os.path.join(root, filename))
        
        # 处理文件
        return self.process_files(files)
    
    def embed(self) -> Dict[str, Any]:
        """
        对处理后的文本进行向量嵌入
        
        Returns:
            嵌入结果
        """
        import sys
        import requests
        
        logger.info("开始向量嵌入")
        
        try:
            # 加载文本块内容
            chunks_content_path = os.path.join(self.output_dir, "chunks_content.json")
            if not os.path.exists(chunks_content_path):
                logger.warning("没有找到文本块内容文件")
                return {"success": False, "error": "请先处理文件"}
            
            with open(chunks_content_path, 'r', encoding='utf-8') as f:
                chunks = json.load(f)
            
            if not chunks:
                logger.warning("没有可处理的文本块")
                return {"success": False, "error": "没有可处理的文本块"}
            
            total_chunks = len(chunks)
            logger.info(f"加载了 {total_chunks} 个文本块")
            
            # 存储嵌入向量
            embeddings = []
            success_count = 0
            error_count = 0
            
            # 发送初始进度
            self._output_progress(0, "开始嵌入...")
            
            # 实际向量嵌入过程
            for i, chunk_info in enumerate(chunks):
                try:
                    chunk_content = chunk_info.get('content', '')
                    if not chunk_content:
                        logger.warning(f"文本块 {i+1} 内容为空")
                        error_count += 1
                        continue
                    
                    # 调用Ollama API获取嵌入向量
                    try:
                        response = requests.post(
                            "http://localhost:11434/api/embeddings",
                            json={
                                "model": self.model_name,
                                "prompt": chunk_content
                            },
                            timeout=30
                        )
                    except requests.exceptions.RequestException as e:
                        logger.error(f"嵌入文本块 {i+1} 时API调用失败: {str(e)}")
                        error_count += 1
                        continue
                    
                    if response.status_code == 200:
                        try:
                            embedding_data = response.json()
                            embedding_vector = embedding_data.get('embedding', [])
                            
                            if embedding_vector:
                                # 保存嵌入向量
                                embedding = {
                                    "file_name": chunk_info.get('file_name'),
                                    "file_path": chunk_info.get('file_path'),
                                    "chunk_index": chunk_info.get('chunk_index'),
                                    "content": chunk_content,
                                    "embedding": embedding_vector
                                }
                                embeddings.append(embedding)
                                success_count += 1
                            else:
                                logger.warning(f"文本块 {i+1} 获取嵌入向量为空")
                                error_count += 1
                        except json.JSONDecodeError as e:
                            logger.error(f"解析文本块 {i+1} 的嵌入响应失败: {str(e)}")
                            error_count += 1
                    else:
                        logger.warning(f"嵌入失败，状态码: {response.status_code}, 响应: {response.text}")
                        error_count += 1
                        
                except Exception as embed_error:
                    logger.error(f"嵌入文本块 {i+1} 时出错: {str(embed_error)}")
                    error_count += 1
                
                # 计算进度 (0-90%)
                progress = int((i + 1) / total_chunks * 25) + 75  # 从75%开始，到100%结束
                
                # 输出进度
                status_msg = f"嵌入中 ({i+1}/{total_chunks})"
                if error_count > 0:
                    status_msg += f" - 成功: {success_count}, 失败: {error_count}"
                self._output_progress(progress, status_msg)
            
            # 检查是否有成功的嵌入
            if not embeddings:
                logger.error("没有成功的嵌入结果")
                return {"success": False, "error": f"嵌入失败，成功: {success_count}, 失败: {error_count}"}
            
            # 保存嵌入向量到文件 (90-98%)
            self._output_progress(98, "保存嵌入向量...")
            try:
                with open(self.embeddings_path, 'w', encoding='utf-8') as f:
                    json.dump(embeddings, f, ensure_ascii=False, indent=2)
            except Exception as save_error:
                logger.error(f"保存嵌入向量失败: {str(save_error)}")
                return {"success": False, "error": f"保存失败: {str(save_error)}"}
            
            # 完成 (100%)
            self._output_progress(100, f"嵌入完成 (成功: {success_count}, 失败: {error_count})")
            logger.info(f"向量嵌入完成，成功: {success_count}, 失败: {error_count}")
            return {"success": True, "message": f"知识库嵌入成功 (成功: {success_count}, 失败: {error_count})"}
            
        except Exception as e:
            logger.error(f"向量嵌入失败: {str(e)}")
            return {"success": False, "error": str(e)}
    
    def _load_embeddings(self) -> List[Dict[str, Any]]:
        """
        加载嵌入向量
        
        Returns:
            嵌入向量列表
        """
        if os.path.exists(self.embeddings_path):
            with open(self.embeddings_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        return []
    
    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """
        计算余弦相似度
        
        Args:
            vec1: 向量1
            vec2: 向量2
            
        Returns:
            相似度得分
        """
        import numpy as np
        
        if not vec1 or not vec2:
            return 0.0
        
        try:
            vec1 = np.array(vec1)
            vec2 = np.array(vec2)
            
            dot_product = np.dot(vec1, vec2)
            norm1 = np.linalg.norm(vec1)
            norm2 = np.linalg.norm(vec2)
            
            if norm1 == 0 or norm2 == 0:
                return 0.0
            
            return float(dot_product / (norm1 * norm2))
        except Exception:
            return 0.0
    
    def query(self, query: str, top_k: int = 3) -> Dict[str, Any]:
        """
        查询知识库
        
        Args:
            query: 查询文本
            top_k: 返回的结果数量
            
        Returns:
            查询结果
        """
        logger.info(f"查询知识库: {query}")
        
        try:
            # 检查嵌入文件是否存在
            logger.info(f"检查嵌入文件: {self.embeddings_path}")
            if not os.path.exists(self.embeddings_path):
                logger.warning(f"嵌入文件不存在: {self.embeddings_path}")
                return {
                    "success": True,
                    "results": [],
                    "message": "知识库尚未嵌入，请先完成嵌入操作"
                }
            
            # 加载嵌入向量
            embeddings = self._load_embeddings()
            logger.info(f"加载了 {len(embeddings)} 个嵌入向量")
            
            if not embeddings:
                logger.warning("没有可用的嵌入向量")
                return {
                    "success": True,
                    "results": [],
                    "message": "知识库为空"
                }
            
            # 实际查询过程
            # 1. 使用Qwen3-Embedding-4模型将查询文本转换为向量
            # 2. 在向量数据库中检索最相似的文本块
            # 3. 返回检索结果
            
            import requests
            import json
            
            # 调用Ollama API获取查询向量
            logger.info(f"调用Ollama API获取查询向量，模型: {self.model_name}")
            
            try:
                response = requests.post(
                    "http://localhost:11434/api/embeddings",
                    json={
                        "model": self.model_name,
                        "prompt": query
                    },
                    timeout=30
                )
            except requests.exceptions.RequestException as e:
                logger.error(f"Ollama API调用失败: {str(e)}")
                return {
                    "success": False,
                    "error": f"无法连接到Ollama服务，请确保Ollama正在运行: {str(e)}"
                }
            
            logger.info(f"Ollama API响应状态码: {response.status_code}")
            
            if response.status_code == 200:
                try:
                    query_embedding = response.json().get('embedding', [])
                    logger.info(f"获取到查询向量，维度: {len(query_embedding)}")
                    
                    if not query_embedding:
                        logger.warning("获取查询向量失败，返回空结果")
                        return {
                            "success": True,
                            "results": [],
                            "message": "无法获取查询向量，请检查Ollama服务"
                        }
                    
                    # 计算相似度
                    logger.info("开始计算相似度")
                    similarities = []
                    for embedding in embeddings:
                        score = self._cosine_similarity(query_embedding, embedding.get('embedding', []))
                        logger.debug(f"相似度得分: {score}, 文件: {embedding.get('file_name', 'unknown')}")
                        if score > 0.1:  # 设置相似度阈值
                            similarities.append({
                                "title": embedding.get('file_name', '文档片段'),
                                "content": embedding.get('content', ''),
                                "score": score,
                                "source": embedding.get('file_name', 'unknown'),
                                "file_path": embedding.get('file_path', '')
                            })
                    
                    # 按相似度排序
                    similarities.sort(key=lambda x: x['score'], reverse=True)
                    
                    # 返回前top_k个结果
                    results = similarities[:top_k]
                    logger.info(f"找到 {len(results)} 个相关结果")
                    
                    if not results:
                        return {
                            "success": True,
                            "results": [],
                            "message": "未找到相关内容"
                        }
                    else:
                        return {"success": True, "results": results}
                        
                except json.JSONDecodeError as e:
                    logger.error(f"解析Ollama响应失败: {str(e)}")
                    return {
                        "success": False,
                        "error": f"解析Ollama响应失败: {str(e)}"
                    }
            else:
                logger.warning(f"获取查询向量失败，状态码: {response.status_code}")
                return {
                    "success": False,
                    "error": f"Ollama API调用失败，状态码: {response.status_code}, 响应: {response.text}"
                }
            
        except Exception as e:
            logger.error(f"查询失败: {str(e)}")
            return {
                "success": False,
                "error": f"查询失败: {str(e)}"
            }
    
    def _parse_file(self, file_path: str) -> str:
        """
        解析文件内容
        
        Args:
            file_path: 文件路径
            
        Returns:
            文件文本内容
        """
        ext = os.path.splitext(file_path)[1].lower()
        
        try:
            if ext == '.txt' or ext == '.md':
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    return f.read()
            elif ext == '.pdf':
                # 使用PyPDF2解析PDF文件
                try:
                    from PyPDF2 import PdfReader
                    reader = PdfReader(file_path)
                    text = []
                    for page in reader.pages:
                        text.append(page.extract_text())
                    return '\n'.join(text)
                except ImportError:
                    logger.warning('PyPDF2 库未安装，无法解析 PDF 文件')
                    return f"[PDF内容] 来自文件: {os.path.basename(file_path)}"
            elif ext == '.docx':
                # 使用python-docx解析DOCX文件
                try:
                    from docx import Document
                    doc = Document(file_path)
                    text = []
                    for paragraph in doc.paragraphs:
                        text.append(paragraph.text)
                    return '\n'.join(text)
                except ImportError:
                    logger.warning('python-docx 库未安装，无法解析 DOCX 文件')
                    return f"[DOCX内容] 来自文件: {os.path.basename(file_path)}"
            else:
                return f"[不支持的文件格式] {os.path.basename(file_path)}"
        except Exception as e:
            logger.error(f"解析文件 {file_path} 时出错: {str(e)}")
            return f"[解析错误] {os.path.basename(file_path)}"
    
    def _split_text(self, text: str, chunk_size: int = 300, overlap: int = 50) -> List[str]:
        """
        将文本分割成块
        
        Args:
            text: 文本内容
            chunk_size: 块大小
            overlap: 块之间的重叠大小
            
        Returns:
            文本块列表
        """
        chunks = []
        start = 0
        text_length = len(text)
        
        while start < text_length:
            end = min(start + chunk_size, text_length)
            chunk = text[start:end]
            
            # 确保分块不是空的
            if chunk.strip():
                chunks.append(chunk)
            
            start += chunk_size - overlap
        
        return chunks
    
    def _save_chunks(self, chunks: List[Dict[str, Any]]):
        """
        保存分块数据
        
        Args:
            chunks: 分块数据
        """
        with open(self.chunks_path, 'w', encoding='utf-8') as f:
            json.dump(chunks, f, ensure_ascii=False, indent=2)
    
    def _load_chunks(self) -> List[Dict[str, Any]]:
        """
        加载分块数据
        
        Returns:
            分块数据
        """
        if os.path.exists(self.chunks_path):
            with open(self.chunks_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        return []
    
    def _output_progress(self, progress: int, status: str):
        """
        输出进度信息
        
        Args:
            progress: 进度百分比
            status: 状态信息
        """
        # 输出JSON格式的进度信息，供Electron应用接收
        progress_data = {
            "progress": progress,
            "status": status
        }
        print(json.dumps(progress_data))

def main():
    """
    主函数
    """
    parser = argparse.ArgumentParser(description="RAG处理器")
    
    # 命令参数
    parser.add_argument('command', choices=['process_files', 'process_folder', 'embed', 'query', 'get_stats'], help='执行命令')
    
    # 通用参数
    parser.add_argument('--output', default=os.path.join(os.getcwd(), 'rag_data'), help='输出目录')
    parser.add_argument('--model', default='qwen3-embedding:4b', help='嵌入模型名称')
    
    # 文件参数
    parser.add_argument('files', nargs='*', help='要处理的文件路径')
    
    # 查询参数
    parser.add_argument('--query-text', help='查询文本')
    parser.add_argument('--top-k', type=int, default=3, help='返回的结果数量')
    
    args = parser.parse_args()
    
    try:
        if args.command == 'process_files':
            # 处理文件
            processor = RAGProcessor(args.output, args.model)
            result = processor.process_files(args.files)
            print(json.dumps(result, ensure_ascii=False))
            
        elif args.command == 'process_folder':
            # 处理文件夹
            if not args.files:
                print(json.dumps({"success": False, "error": "请指定文件夹路径"}, ensure_ascii=False))
                return
            processor = RAGProcessor(args.output, args.model)
            result = processor.process_folder(args.files[0])
            print(json.dumps(result, ensure_ascii=False))
            
        elif args.command == 'embed':
            # 嵌入模式
            processor = RAGProcessor(args.output, args.model)
            result = processor.embed()
            print(json.dumps(result, ensure_ascii=False))
            
        elif args.command == 'query':
            # 查询模式
            if not args.query_text:
                print(json.dumps({"success": False, "error": "请指定查询文本"}, ensure_ascii=False))
                return
            processor = RAGProcessor(args.output, args.model)
            result = processor.query(args.query_text, args.top_k)
            print(json.dumps(result, ensure_ascii=False))
            
        elif args.command == 'get_stats':
            # 获取统计信息
            processor = RAGProcessor(args.output, args.model)
            
            # 统计文档数量
            chunks_path = os.path.join(args.output, "chunks.json")
            chunks_content_path = os.path.join(args.output, "chunks_content.json")
            embeddings_path = os.path.join(args.output, "embeddings.json")
            
            document_count = 0
            chunk_count = 0
            vector_count = 0
            
            # 统计文档数量
            if os.path.exists(chunks_path):
                with open(chunks_path, 'r', encoding='utf-8') as f:
                    chunks_data = json.load(f)
                    document_count = len(chunks_data)
            
            # 统计文本块数量
            if os.path.exists(chunks_content_path):
                with open(chunks_content_path, 'r', encoding='utf-8') as f:
                    chunks_content = json.load(f)
                    chunk_count = len(chunks_content)
            
            # 统计向量数量
            if os.path.exists(embeddings_path):
                with open(embeddings_path, 'r', encoding='utf-8') as f:
                    embeddings = json.load(f)
                    vector_count = len(embeddings)
            
            stats = {
                "documentCount": document_count,
                "chunkCount": chunk_count,
                "vectorCount": vector_count
            }
            print(json.dumps(stats, ensure_ascii=False))
            
    except Exception as e:
        logger.error(f"执行出错: {str(e)}")
        print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))

if __name__ == "__main__":
    main()
