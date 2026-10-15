# Builds tests/fixtures/emirates-id-sample.pdf: a text PDF laid out like a digital Emirates ID
# with FICTIONAL data, for the e2e multi-document import.  Usage: python3 scripts/make-id-sample.py <out.pdf>
import re, sys
import pymupdf as fitz

AR = re.compile(r'[؀-ۿ]')
font = 'templates/fonts/NotoSansArabic_400Regular.ttf'
items = [
    ('United Arab Emirates', 40, 40), ('بطاقة هوية', 330, 40),
    ('Resident Identity Card', 40, 58),
    ('ID Number', 40, 90), ('784-1985-1234567-1', 100, 90), ('رقم الهوية', 360, 90),
    ('Name:', 40, 120), ('Mohammed Khalifa Rashed Almansoori', 72, 120),
    ('الاسم:', 380, 140), ('محمد', 350, 140), ('خليفة', 320, 140), ('راشد', 292, 140), ('المنصوري', 250, 140),
    ('Nationality: United Arab Emirates', 40, 170),
]
doc = fitz.open(); page = doc.new_page(width=430, height=270)
for s, x, y in items:
    if AR.search(s):
        page.insert_text((x, y), s[::-1], fontsize=9, fontname='ar', fontfile=font)  # visual order, like real PDFs
    else:
        page.insert_text((x, y), s, fontsize=9, fontname='helv')
doc.set_metadata({'title': 'Emirates ID (sample, fictional data)'})
doc.save(sys.argv[1], garbage=4, deflate=True)
