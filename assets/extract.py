import librosa
import numpy as np
from scipy.signal import find_peaks

# 读取音频
y, sr = librosa.load("strike.mp3", sr=None)

# 计算能量（RMS）
frame_length = 1024
hop_length = 256
rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]

# 转时间轴
times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)

# 找峰值
peaks, _ = find_peaks(rms, height=np.max(rms)*0.3, distance=10)

# 取前两个峰（时间排序）
peak_times = times[peaks]
peak_times = sorted(peak_times)[:2]

print("两个撞击时间：", peak_times)


import soundfile as sf

segments = []
windows = [0.17, 0.3]  # 两个窗口长度，分别对应两个撞击

for i, t in enumerate(peak_times):
    start = int((t - 0.02) * sr)
    end   = int((t + windows[i]) * sr)

    start = max(0, start)
    end = min(len(y), end)

    segment = y[start:end]
    segments.append(segment)

    sf.write(f"hit_{i+1}.wav", segment, sr)