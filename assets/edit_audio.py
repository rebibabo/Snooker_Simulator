import tkinter as tk
from tkinter import filedialog, messagebox
from pydub import AudioSegment
import simpleaudio as sa

class AudioCutterApp:
    def __init__(self, root):
        self.root = root
        self.root.title("M4A 音频裁剪工具")

        self.audio = None
        self.file_path = None

        # UI
        tk.Button(root, text="选择音频文件", command=self.load_file).pack(pady=5)

        self.label = tk.Label(root, text="未加载文件")
        self.label.pack()

        tk.Label(root, text="开始时间 (秒)").pack()
        self.start_entry = tk.Entry(root)
        self.start_entry.pack()

        tk.Label(root, text="结束时间 (秒)").pack()
        self.end_entry = tk.Entry(root)
        self.end_entry.pack()

        tk.Button(root, text="播放选中片段", command=self.play_segment).pack(pady=5)
        tk.Button(root, text="导出片段", command=self.export_segment).pack(pady=5)

    def load_file(self):
        file_path = filedialog.askopenfilename(filetypes=[("Audio Files", "*.m4a *.mp3 *.wav")])
        if not file_path:
            return
        
        self.file_path = file_path
        self.audio = AudioSegment.from_file(file_path)
        self.label.config(text=f"已加载: {file_path}")

    def get_segment(self):
        try:
            start = float(self.start_entry.get()) * 1000
            end = float(self.end_entry.get()) * 1000
        except:
            messagebox.showerror("错误", "请输入有效的时间")
            return None

        if self.audio is None:
            messagebox.showerror("错误", "请先加载音频")
            return None

        return self.audio[int(start):int(end)]

    def play_segment(self):
        segment = self.get_segment()
        if segment is None:
            return

        raw_data = segment.raw_data
        play_obj = sa.play_buffer(
            raw_data,
            num_channels=segment.channels,
            bytes_per_sample=segment.sample_width,
            sample_rate=segment.frame_rate
        )
        play_obj.wait_done()

    def export_segment(self):
        segment = self.get_segment()
        if segment is None:
            return

        save_path = filedialog.asksaveasfilename(defaultextension=".wav",
                                                 filetypes=[("WAV", "*.wav"), ("MP3", "*.mp3")])
        if not save_path:
            return

        segment.export(save_path, format=save_path.split('.')[-1])
        messagebox.showinfo("成功", f"已导出到 {save_path}")


if __name__ == "__main__":
    root = tk.Tk()
    app = AudioCutterApp(root)
    root.mainloop()