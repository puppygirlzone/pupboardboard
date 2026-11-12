#!/usr/bin/env python3
"""Rebuild the Japanese font subset used by Aiko mode.

Needs: Node, Python with fonttools + brotli (`pip install fonttools brotli`),
and Noto Sans CJK (Fedora: google-noto-sans-cjk-vf-fonts; Debian/Ubuntu:
fonts-noto-cjk). Run from the repo root after changing any Japanese text:

    python3 scripts/build-jp-font.py [path/to/NotoSansCJK-VF.ttc]

Writes public/fonts/noto-sans-jp/NotoSansJP-pupboard.woff2 and characters.txt
(tests/eggs.test.js checks the font covers every character the text uses).
"""
import os
import subprocess
import sys

from fontTools import subset
from fontTools.ttLib import TTCollection, TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'fonts', 'noto-sans-jp')
SOURCE = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/google-noto-sans-cjk-vf-fonts/NotoSansCJK-VF.ttc'

# Every Japanese character the interface can show (translations, greetings, toasts, dates).
JS = """
const m = await import(process.argv[1] + '/public/js/i18n-ja.js');
const e = await import(process.argv[1] + '/public/js/eggs.js');
const a = e.EGGS.aiko;
const extra = Object.values(a.greetings).flat().join('') + a.on + a.off + a.verb + '何も起きなかった…' + '年月日曜火水木金土午前後時分秒';
process.stdout.write(m.japaneseCharacters(extra));
"""
chars = subprocess.run(['node', '--input-type=module', '-e', JS, ROOT], check=True, capture_output=True, text=True).stdout

# Plus basic Latin, punctuation, all kana and full-width forms, so mixed text looks even.
RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x2010, 0x2027), (0x2190, 0x2193), (0x2605, 0x2606), (0x3000, 0x303F), (0x3040, 0x30FF), (0xFF01, 0xFF5E)]
codes = {ord(c) for c in chars}
for a, b in RANGES:
    codes.update(range(a, b + 1))

if SOURCE.endswith('.ttc'):
    fonts = TTCollection(SOURCE).fonts
    font = next(f for f in fonts if 'JP' in f['name'].getDebugName(4))
else:
    font = TTFont(SOURCE)

opts = subset.Options()
opts.flavor = 'woff2'
opts.layout_features = ['*']
opts.name_IDs = ['*']
opts.notdef_outline = True
sub = subset.Subsetter(opts)
sub.populate(unicodes=codes)
sub.subset(font)
os.makedirs(OUT, exist_ok=True)
font.flavor = 'woff2'
font.save(os.path.join(OUT, 'NotoSansJP-pupboard.woff2'))
with open(os.path.join(OUT, 'characters.txt'), 'w', encoding='utf-8') as f:
    f.write(''.join(sorted(chr(c) for c in codes)))
print(f'{len(codes)} characters, {os.path.getsize(os.path.join(OUT, "NotoSansJP-pupboard.woff2"))} bytes')
