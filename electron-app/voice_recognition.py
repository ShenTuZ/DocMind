import sys
import json
import traceback

# 设置标准输出编码为 UTF-8
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

import pyaudio

from vosk import KaldiRecognizer, Model

try:
    # 加载模型
    print('STARTED', flush=True)
    model = Model(r"C:\Users\Administrator\Desktop\MCP\mcp\vosk-model-small-cn-0.22\vosk-model-small-cn-0.22")
    
    # 创建麦克风对象
    micro = pyaudio.PyAudio()
    
    # 配置麦克风参数
    receiver = micro.open(
        format=pyaudio.paInt16,  # 16位深度音频数据
        channels=1,  # 单声道
        rate=16000,  # 采样率16000Hz
        input=True,  # 从麦克风获取数据
        frames_per_buffer=4000)  # 每次读取数据块大小为4000帧

    # 创建识别器
    recognize = KaldiRecognizer(model, 16000)

    # 开始识别
    while True:
        # 每次读取4000帧数据
        try:
            frame = receiver.read(4000)
            # 检查是否有最终结果
            if recognize.AcceptWaveform(frame):
                # 获取最终结果
                trans = recognize.Result()
                result = json.loads(trans)['text'].strip()
                if result:  # 只有当结果非空时才输出
                    print(f'FINAL:{result}', flush=True)
            else:
                # 获取部分结果
                try:
                    partial_result = recognize.PartialResult()
                    if partial_result and '"partial"' in partial_result:  # 检查是否包含部分结果
                        partial_data = json.loads(partial_result)
                        partial_text = partial_data.get('partial', '').strip()
                        if partial_text:
                            print(f'RESULT:{partial_text}', flush=True)
                except:
                    # 忽略部分结果解析错误
                    pass
        except OSError as e:
            # 处理音频读取错误
            if e.errno == pyaudio.paInputOverflowed:
                # 输入溢出，跳过这一帧
                continue
            else:
                raise e
                
except KeyboardInterrupt:
    print('STOPPED', flush=True)
except Exception as e:
    print(f'ERROR:{str(e)}', flush=True)
    sys.exit(1)
