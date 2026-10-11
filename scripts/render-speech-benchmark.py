# SPDX-License-Identifier: Apache-2.0
"""Render shareable benchmark figures from measured JSON; requires matplotlib."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
from matplotlib.ticker import FuncFormatter

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "docs/benchmarks/speech-cpp-irodori-v41-20261011.json").read_text(encoding="utf-8"))
OUT = ROOT / "docs/benchmarks/media"
OUT.mkdir(parents=True, exist_ok=True)
FONT = Path("C:/Windows/Fonts/meiryo.ttc")
BOLD = Path("C:/Windows/Fonts/meiryob.ttc")
regular = FontProperties(fname=str(FONT))
bold = FontProperties(fname=str(BOLD))
BG, FG, MUTED, GRID = "#0b1422", "#f1f5fb", "#a5b6ce", "#28364a"
NATIVE, WEB = "#43dfc2", "#ffac73"
ids = ["speech-cpp-fp16", "irodori-webgpu-fp16", "speech-cpp-mf-fp16", "irodori-webgpu-mf-fp16"]
stats = {s["provider"]: s for s in DATA["stats"]}
y = [3.4, 2.55, 1.25, .4]
colors = [NATIVE, WEB, NATIVE, WEB]


def text(fig, x, ypos, value, size=20, color=FG, strong=False, **kwargs):
    return fig.text(x, ypos, value, fontproperties=bold if strong else regular,
                    fontsize=size, color=color, **kwargs)


def base(subtitle):
    fig = plt.figure(figsize=(18, 11.25), dpi=100, facecolor=BG)
    text(fig, .055, .945, "CHARADOCK  /  LOCAL TTS BENCHMARK", 16, MUTED)
    text(fig, .055, .885, "Irodori v4.1  音声生成の待ち時間", 34, strong=True)
    text(fig, .055, .835, subtitle, 21, MUTED)
    return fig


def axes(fig, left, width, maximum, ticks, labels=False):
    ax = fig.add_axes([left, .285, width, .375], facecolor=BG)
    ax.set_ylim(-.05, 4.05)
    ax.set_xlim(0, maximum)
    ax.set_xticks(ticks)
    ax.xaxis.set_major_formatter(FuncFormatter(lambda value, _: f"{value:g} s"))
    ax.tick_params(axis="x", colors=MUTED, labelsize=17, length=0, pad=15)
    ax.set_yticks(y, ["speech.cpp", "WebGPU", "speech.cpp", "WebGPU"] if labels else [""] * 4)
    ax.tick_params(axis="y", colors=FG, labelsize=19, length=0, pad=20)
    for label in ax.get_yticklabels():
        label.set_fontproperties(bold)
        label.set_fontsize(19)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.set_axisbelow(True)
    ax.xaxis.grid(True, color=GRID, linewidth=1)
    ax.axhline(1.87, color=GRID, linewidth=1)
    return ax


def model_labels(fig):
    # Align model labels with the midpoint of each pair of engine bars.
    for midpoint, name, steps in [(2.975, "Small", "16 steps"), (.825, "Small MF", "4 steps")]:
        ypos = .285 + ((midpoint + .05) / 4.1) * .375
        text(fig, .055, ypos + .005, name, 22, strong=True)
        text(fig, .055, ypos - .035, steps, 18, MUTED)


def footer(fig, cold=False):
    text(fig, .055, .175, "RTX 5060 Ti 16GB  ·  Windows  ·  FP16  ·  speech.cpp v0.8.3 / Vulkan", 18, MUTED)
    if cold:
        text(fig, .055, .13, "新しいエンジンプロセスの初回。OS・GPUキャッシュは保持。", 18, MUTED)
    else:
        text(fig, .055, .13, "起動後3回の中央値  ·  同じ文章・参照音声  ·  seed 42 / speed 1", 18, MUTED)
    text(fig, .055, .085, "生成音声：speech.cpp 5.4秒 / WebGPU 5.6秒  ·  同じモデル内ではstep数を統一", 17, MUTED)
    text(fig, .055, .044, "最初の音声データ＝再生開始前のデータ到着時間。測定：2026-10-10〜11", 16, MUTED)


fig = base("speech.cpp (Vulkan) vs WebGPU  /  FP16  /  起動後の比較")
text(fig, .055, .755, "最初の音声データ：Smallで8.6倍、MFで6.5倍速い", 24, NATIVE, True)
for left, metric, title in [(.29, "firstAudioMs", "最初の音声データまで"), (.68, "generationMs", "生成完了まで")]:
    text(fig, left, .705, title, 22, strong=True)
    ax = axes(fig, left, .25, 5.25, [0, 1, 2, 3, 4], labels=left == .29)
    values = [stats[key][metric] for key in ids]
    ax.barh(y, [value / 1000 for value in values], color=colors, height=.37)
    for ypos, value, color in zip(y, values, colors):
        ax.text(value / 1000 + .12, ypos, f"{value:,} ms", va="center", color=color,
                fontproperties=bold, fontsize=21, clip_on=False)
model_labels(fig)
footer(fig)
fig.savefig(OUT / "irodori-v41-warm-fp16.png", facecolor=BG, dpi=100)
fig.savefig(OUT / "irodori-v41-warm-fp16.svg", facecolor=BG)
plt.close(fig)

fig = base("初回リクエスト  /  エンジン・モデルの読み込みを含む  /  FP16")
text(fig, .055, .755, "初回の最初の音声データまで", 25, strong=True)
text(fig, .8, .755, "短いほど速い", 19, MUTED)
# Bars begin at zero and retain a common scale across both model groups.
ax = axes(fig, .29, .63, 15.5, [0, 3, 6, 9, 12, 15], labels=True)
values = [stats[key]["cold"]["firstAudioMs"] for key in ids]
ax.barh(y, [value / 1000 for value in values], color=colors, height=.37)
for ypos, value, color in zip(y, values, colors):
    ax.text(value / 1000 + .2, ypos, f"{value / 1000:.3f} s", va="center", color=color,
            fontproperties=bold, fontsize=23, clip_on=False)
model_labels(fig)
footer(fig, cold=True)
fig.savefig(OUT / "irodori-v41-cold-fp16.png", facecolor=BG, dpi=100)
fig.savefig(OUT / "irodori-v41-cold-fp16.svg", facecolor=BG)
plt.close(fig)
print(OUT)
