"""Builds the README images in assets/ from logo-source.png and the HTML cards below.

Needs Python with Pillow and Microsoft Edge (headless screenshots). Run: python assets/src/build.py
"""
import html
import random
import subprocess
from collections import deque
from pathlib import Path

from PIL import Image

SRC = Path(__file__).resolve().parent
OUT = SRC.parent
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

BG = "#0f0d0c"
CARD = "#141110"
TEXT = "#ece6da"
MUTED = "#8a8178"
FAINT = "#2b2622"
LINE = "#2a2421"
CORAL = "#d97757"
GREEN = "#4cc36b"
RED = "#e5534b"
YELLOW = "#e3b341"


def is_coral(p):
    return p[0] - p[2] > 70 and p[0] > 150


# ---------------------------------------------------------------- logo

def build_logos():
    im = Image.open(SRC / "logo-source.png").convert("RGB")
    w, h = im.size
    px = im.load()
    light, dark = Image.new("RGBA", im.size), Image.new("RGBA", im.size)
    lp, dp = light.load(), dark.load()
    ink_dark = (236, 230, 218)
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            if is_coral(p):
                lp[x, y] = dp[x, y] = (217, 119, 87, 255)
                continue
            a = 255 - min(p)
            a = 0 if a < 25 else min(255, int(a * 1.15))
            lp[x, y] = (17, 17, 17, a)
            dp[x, y] = ink_dark + (a,)

    # Regions fully enclosed by the mascot (its eyes) keep their own colours in the dark logo.
    seen = set()
    for y in range(h):
        for x in range(w):
            if (x, y) in seen or is_coral(px[x, y]) or min(px[x, y]) > 200:
                continue
            comp, queue, closed = [], deque([(x, y)]), True
            seen.add((x, y))
            while queue:
                cx, cy = queue.popleft()
                comp.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if not (0 <= nx < w and 0 <= ny < h):
                        closed = False
                        continue
                    if is_coral(px[nx, ny]) or (nx, ny) in seen:
                        continue
                    seen.add((nx, ny))
                    queue.append((nx, ny))
            if closed and len(comp) < 20000:
                for cx, cy in comp:
                    dp[cx, cy] = (17, 17, 17, 255) if 255 - min(px[cx, cy]) > 60 else (217, 119, 87, 255)

    l, t, r, b = light.getbbox()
    box = (max(0, l - 20), max(0, t - 20), min(w, r + 20), min(h, b + 20))
    light.crop(box).save(OUT / "logo.png", optimize=True)
    dark.crop(box).save(OUT / "logo-dark.png", optimize=True)


# ---------------------------------------------------------------- hero text art

def sysex_stream(n):
    """Endless KATANA Gen 3 DT1 frames: F0 41 10 01 05 07 12 <addr> <data> <sum> F7."""
    rnd = random.Random(7)
    out = []
    while len("".join(out)) < n:
        addr = [0x10, rnd.choice([0x00, 0x01, 0x02]), rnd.randrange(0x00, 0x40), rnd.randrange(0x00, 0x7F)]
        data = [rnd.randrange(0, 0x65)]
        s = sum(addr + data)
        frame = [0xF0, 0x41, 0x10, 0x01, 0x05, 0x07, 0x12] + addr + data + [(128 - s % 128) & 0x7F, 0xF7]
        out.extend(f"{b:02X}" for b in frame)
    return "".join(out)


def text_art(cols, rows):
    im = Image.open(OUT / "logo.png").convert("RGBA")
    w, h = im.size
    small = im.resize((cols, rows), Image.BOX)
    sp = small.load()
    stream = sysex_stream(cols * rows + 10)
    lines = []
    for y in range(rows):
        spans, run_style, run = [], None, ""
        for x in range(cols):
            ch = stream[y * cols + x]
            r, g, b, a = sp[x, y]
            if a > 40 and r - b > 60:
                style = f"color:{CORAL};font-weight:700"
            elif a > 150:
                style = f"color:{TEXT};font-weight:700"
            elif a > 70:
                style = "color:#9c938a"
            else:
                style = f"color:{FAINT}"
            if style != run_style and run:
                spans.append(f'<span style="{run_style}">{html.escape(run)}</span>')
                run = ""
            run_style = style
            run += ch
        spans.append(f'<span style="{run_style}">{html.escape(run)}</span>')
        lines.append("".join(spans))
    return "\n".join(lines)


# ---------------------------------------------------------------- cards

HEAD = f"""<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=block" rel="stylesheet">
<style>
* {{ margin:0; padding:0; box-sizing:border-box; }}
html, body {{ background:transparent; color:{TEXT}; font-family:'JetBrains Mono', monospace; }}
.card {{ background:{CARD}; border-radius:28px; padding:84px 90px; }}
.eyebrow {{ color:{MUTED}; letter-spacing:.35em; font-size:24px; text-transform:uppercase; }}
.title {{ font-size:62px; font-weight:800; line-height:1.18; margin-top:22px; }}
.muted {{ color:{MUTED}; }}
.coral {{ color:{CORAL}; }}
</style></head><body>"""


def hero():
    art = text_art(cols=128, rows=74)
    return HEAD + f"""
<div style="width:1760px;height:990px;display:flex;padding:44px;gap:40px;background:{BG};border-radius:28px">
  <div style="width:880px;flex:none">
    <div class="muted" style="font-size:22px;margin-bottom:22px">~/boss-katana-mcp</div>
    <pre style="font-size:11px;line-height:11.6px;letter-spacing:-.05px;font-family:'JetBrains Mono',monospace">{art}</pre>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding-right:30px">
    <div style="display:flex;align-items:center;gap:16px;font-size:26px;letter-spacing:.3em;font-weight:700;color:{MUTED}">
      <span style="width:16px;height:16px;border-radius:50%;background:{GREEN};box-shadow:0 0 18px {GREEN}"></span>LIVE IN BOSS TONE STUDIO
    </div>
    <div style="font-size:76px;font-weight:800;line-height:1.05;margin-top:34px;white-space:nowrap">boss-katana<span class="coral">-mcp</span></div>
    <div style="font-size:34px;margin-top:26px;line-height:1.4">Say the tone.<br>The knobs turn themselves.</div>
    <div style="display:flex;gap:56px;margin-top:64px">
      <div><div style="font-size:64px;font-weight:800">20</div><div class="muted" style="font-size:22px;margin-top:6px">MCP tools</div></div>
      <div><div style="font-size:64px;font-weight:800">13</div><div class="muted" style="font-size:22px;margin-top:6px">sections</div></div>
      <div><div style="font-size:64px;font-weight:800">3</div><div class="muted" style="font-size:22px;margin-top:6px">agents</div></div>
      <div><div style="font-size:64px;font-weight:800" class="coral">0</div><div class="muted" style="font-size:22px;margin-top:6px">clicks</div></div>
    </div>
    <div class="muted" style="font-size:21px;margin-top:80px;line-height:1.6">Claude Code · Codex CLI · Gemini CLI<br>BOSS KATANA Gen 3 · Windows</div>
  </div>
</div></body></html>"""


THRASH = [
    ("AMP", "type", "LEAD", "BROWN"),
    ("AMP", "gain", "55", "65"),
    ("EQ", "bass", "55", "65"),
    ("EQ", "middle", "70", "40"),
    ("EQ", "treble", "60", "65"),
    ("EQ", "presence", "50", "60"),
    ("BOOSTER", "T-SCREAM drive", "40", "0"),
    ("BOOSTER", "tone", "0", "10"),
    ("BOOSTER", "level", "70", "80"),
    ("DELAY", "switch", "ON", "OFF"),
    ("REVERB", "type", "HALL", "ROOM"),
    ("NS", "threshold", "30", "45"),
]


def before_after():
    rows = "".join(
        f"""<div style="display:grid;grid-template-columns:170px 1fr 120px 60px 140px;align-items:center;
             padding:15px 0;border-top:1px solid {LINE};font-size:25px">
          <span class="muted" style="letter-spacing:.12em;font-size:20px">{s}</span><span>{p}</span>
          <span class="muted" style="text-align:right">{o}</span><span class="muted" style="text-align:center">→</span>
          <span style="font-weight:700;color:{CORAL}">{n}</span></div>"""
        for s, p, o, n in THRASH
    )
    return HEAD + f"""
<div class="card" style="width:1760px;height:1080px;display:flex;gap:90px">
  <div style="width:560px;flex:none;display:flex;flex-direction:column">
    <div class="eyebrow">Before / after</div>
    <div class="title">One sentence.<br>Twelve changes.</div>
    <div style="margin-top:56px;background:#0b0908;border:1px solid {LINE};border-radius:18px;padding:30px 32px;font-size:27px">
      <span class="muted">&gt;</span> write a thrash<br>&nbsp;&nbsp;metal tone</div>
    <div class="muted" style="font-size:22px;line-height:1.65;margin-top:auto">
      The agent reads the patch first, sets everything in one call and explains each change. Booster with no drive
      tightens the low end; the mids are scooped.<br><br>Nothing is saved until you press WRITE.</div>
  </div>
  <div style="flex:1;padding-top:6px">
    <div style="display:grid;grid-template-columns:170px 1fr 120px 60px 140px;font-size:19px;letter-spacing:.2em;color:{MUTED};padding-bottom:16px">
      <span>SECTION</span><span>PARAMETER</span><span style="text-align:right">BEFORE</span><span></span><span>AFTER</span></div>
    {rows}
    <div style="border-top:1px solid {LINE}"></div>
  </div>
</div></body></html>"""


def how_it_works():
    def node(title, sub, accent=False):
        border = CORAL if accent else LINE
        return f"""<div style="flex:1;border:2px solid {border};border-radius:20px;padding:34px 30px;background:#0b0908">
          <div style="font-size:30px;font-weight:700;line-height:1.3">{title}</div>
          <div class="muted" style="font-size:21px;margin-top:14px;line-height:1.5">{sub}</div></div>"""

    def link(label):
        return f"""<div style="width:150px;flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
          <div class="muted" style="font-size:18px;text-align:center;line-height:1.4">{label}</div>
          <div style="color:{CORAL};font-size:40px">⟶</div></div>"""

    return HEAD + f"""
<div class="card" style="width:1760px;height:800px">
  <div class="eyebrow">How it works</div>
  <div class="title">The app does the talking.<br>The agent just turns its knobs.</div>
  <div style="display:flex;align-items:stretch;margin-top:70px">
    {node("Your agent", "Claude Code<br>Codex CLI<br>Gemini CLI")}
    {link("stdio<br>MCP")}
    {node("katana<br>MCP server", "20 tools, friendly keys like amp.gain", True)}
    {link("DevTools<br>Protocol<br>:9222")}
    {node("BOSS TONE<br>STUDIO", "its own code writes the value and redraws the knob")}
    {link("USB MIDI<br>SysEx DT1")}
    {node("KATANA<br>Gen 3", "the edit buffer of the current patch")}
  </div>
  <div class="muted" style="font-size:22px;margin-top:56px">BOSS TONE STUDIO stays the only program talking to the amp. Every write flashes its loading popup.</div>
</div></body></html>"""


PERSONAS = [
    ("Thinks in sounds,<br>not settings", "\"Hendrix clean\"<br>\"thick doom riff\"",
     "The agent picks amp type, gain and EQ, then explains what it changed. You learn the amp on the way."),
    ("Knows exactly<br>what they want", "\"gain 60, treble +2,<br>delay 350 ms\"",
     "Precise multi-parameter edits in one sentence, and the current tone read back any time."),
    ("Has a guitar<br>in their hands", "\"a bit brighter\"<br>\"delay off\"",
     "Short relative requests. The agent reads the current values first and adjusts from there."),
]


def who():
    cols = "".join(
        f"""<div style="flex:1;border-top:2px solid {c};padding-top:34px">
          <div style="font-size:34px;font-weight:800;line-height:1.25">{t}</div>
          <div style="font-size:24px;margin-top:30px;color:{c};line-height:1.5">{q}</div>
          <div class="muted" style="font-size:21px;margin-top:30px;line-height:1.6">{d}</div></div>"""
        for (t, q, d), c in zip(PERSONAS, (GREEN, RED, YELLOW))
    )
    return HEAD + f"""
<div class="card" style="width:1760px;height:730px">
  <div class="eyebrow">Who is it for</div>
  <div class="title">Three players, one amp.</div>
  <div style="display:flex;gap:70px;margin-top:70px">{cols}</div>
</div></body></html>"""


def social():
    logo = (OUT / "logo-dark.png").as_uri()
    return HEAD + f"""
<div style="width:1280px;height:640px;display:flex;align-items:center;gap:60px;padding:0 80px;background:{BG}">
  <img src="{logo}" style="width:470px;flex:none">
  <div>
    <div style="font-size:64px;font-weight:800;line-height:1.05">boss-katana<span class="coral">-mcp</span></div>
    <div style="font-size:30px;margin-top:26px;line-height:1.45">Say the tone.<br>The knobs turn themselves.</div>
    <div class="muted" style="font-size:20px;margin-top:44px;line-height:1.6">BOSS KATANA Gen 3 from<br>Claude Code · Codex CLI · Gemini CLI</div>
  </div>
</div></body></html>"""


# ---------------------------------------------------------------- framed demo GIFs

def framed_gif(name, title, width=900):
    from PIL import ImageDraw, ImageFont, ImageSequence

    src = Image.open(SRC / f"{name}.gif")
    body_w = width - 2 * 10
    body_h = round(src.height * body_w / src.width)
    bar = 46
    height = bar + body_h + 10
    font = ImageFont.truetype(r"C:\Windows\Fonts\CascadiaMono.ttf", 17)

    chrome = Image.new("RGB", (width, height), (20, 17, 16))
    d = ImageDraw.Draw(chrome)
    d.rectangle((0, 0, width - 1, height - 1), outline=(52, 45, 41))
    for i, c in enumerate(((217, 119, 87), (227, 179, 65), (76, 195, 107))):
        x = 24 + i * 24
        d.ellipse((x - 7, bar // 2 - 7, x + 7, bar // 2 + 7), fill=c)
    label = "> " + title
    tw = d.textlength(label, font=font)
    d.text(((width - tw) / 2, bar // 2), label, font=font, fill=(236, 230, 218), anchor="lm")

    raw, durations = [], []
    for frame in ImageSequence.Iterator(src):
        canvas = chrome.copy()
        canvas.paste(frame.convert("RGB").resize((body_w, body_h), Image.LANCZOS), (10, bar))
        raw.append(canvas)
        durations.append(frame.info.get("duration", 80))

    # One palette for every frame (sampled frames plus the window colours), so unchanged pixels stay
    # identical between frames and the GIF optimiser can skip them.
    samples = raw[:: max(1, len(raw) // 8)]
    sheet = Image.new("RGB", (width, height * len(samples)))
    for i, f in enumerate(samples):
        sheet.paste(f, (0, i * height))
    base = sheet.quantize(colors=200, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    # Saturated pixels (effect LEDs, pedal highlights, the mascot) are rare, so they get their own colours.
    vivid = [p for f in samples for p in f.get_flattened_data() if max(p) - min(p) > 60]
    accents = [(217, 119, 87), (227, 179, 65), (76, 195, 107)]
    if vivid:
        strip = Image.new("RGB", (len(vivid), 1))
        strip.putdata(vivid)
        q = strip.quantize(colors=48, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        pal = q.getpalette()[: 48 * 3]
        accents += [tuple(pal[i:i + 3]) for i in range(0, len(pal), 3)]
    flat = base.getpalette()[: 200 * 3] + [v for c in accents for v in c]
    palette = Image.new("P", (1, 1))
    palette.putpalette(flat + [0] * (768 - len(flat)))
    frames = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in raw]
    frames[0].save(OUT / f"{name}.gif", save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, optimize=True, disposal=1)


def render(name, page, width, height):
    tmp = SRC / f".{name}.html"
    tmp.write_text(page, encoding="utf-8")
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                    "--allow-file-access-from-files", "--default-background-color=00000000", "--virtual-time-budget=8000",
                    f"--window-size={width},{height}", f"--screenshot={OUT / (name + '.png')}", tmp.as_uri()],
                   check=True, capture_output=True)
    tmp.unlink()


if __name__ == "__main__":
    build_logos()
    framed_gif("demo-thrash", "write a thrash metal tone")
    framed_gif("demo-blues", "write blues tones with long sustain and delay")
    render("hero", hero(), 1760, 990)
    render("before-after", before_after(), 1760, 1080)
    render("how-it-works", how_it_works(), 1760, 800)
    render("who-is-it-for", who(), 1760, 730)
    render("social-preview", social(), 1280, 640)
    print("done")
