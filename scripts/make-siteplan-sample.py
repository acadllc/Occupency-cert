# Builds tests/fixtures/siteplan-sample.pdf (fictional values) from tests/fixtures/siteplan-items.json for the e2e site plan import.
# Usage: python3 scripts/make-siteplan-sample.py tests/fixtures/siteplan-sample.pdf
import json, re, sys
import pymupdf as fitz
items = json.load(open('tests/fixtures/siteplan-items.json'))
doc = fitz.open(); page = doc.new_page(width=842, height=595)
AR = re.compile(r'[؀-ۿ]')
font = 'templates/fonts/NotoSansArabic_400Regular.ttf'
for it in items:
    s = it['str']
    if not s.strip(): continue
    ar = bool(AR.search(s))
    f = fitz.Font(fontfile=font) if ar else fitz.Font('helv')
    size = min(7, it['w'] / max(f.text_length(s, fontsize=1), 0.01)) if it['w'] > 0 else 7
    if ar:
        # content streams store RTL glyphs in visual order
        page.insert_text((it['x'], it['y']), s[::-1], fontsize=size, fontname='ar', fontfile=font)
    else:
        page.insert_text((it['x'], it['y']), s, fontsize=size, fontname='helv')
doc.set_metadata({'title': 'Land Site Plan (sample, fictional data)'})
doc.save(sys.argv[1], garbage=4, deflate=True)
