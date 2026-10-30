#!/usr/bin/env python3
"""Generate the speaker one-pager PDF and refresh it inside the press kit. Run from site root:
   python3 scripts/gen-onepager.py      (needs: pip install reportlab)
Reads site-data.json (person.description + onepager); writes protik-roychowdhury-onepager.pdf
and replaces that file inside press-kit.zip. The PDF's Subject carries a hash of its inputs, so
check.js can tell when site-data has moved on and the PDF is stale. Built-in PDF fonts only, so
the output is identical on any machine."""
import hashlib, json, zipfile
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, FrameBreak
from xml.sax.saxutils import escape

PDF, ZIP = "protik-roychowdhury-onepager.pdf", "press-kit.zip"
TXT, MUT, ACC = HexColor("#111111"), HexColor("#4a4a4a"), HexColor("#2a7d6e")

data = json.load(open("site-data.json", encoding="utf-8"))
person, op = data["person"], data["onepager"]
# Same string check.js hashes: description + newline + compact JSON of the onepager block
digest = hashlib.sha256((person["description"] + "\n" + json.dumps(op, separators=(",", ":"), ensure_ascii=False)).encode()).hexdigest()[:16]

S = lambda name, **kw: ParagraphStyle(name, **{"fontName": "Helvetica", "fontSize": 9.3, "leading": 12.8, "textColor": TXT, **kw})
name = S("name", fontName="Times-Roman", fontSize=26, leading=30)
tag = S("tag", textColor=ACC, fontSize=9.5, leading=13, spaceBefore=2)
summary = S("summary", fontSize=10.2, leading=14.6, spaceBefore=10)
h = S("h", fontName="Helvetica-Bold", fontSize=7.4, leading=10, textColor=ACC, spaceBefore=12, spaceAfter=4)
role = S("role", fontName="Helvetica-Bold", fontSize=9.5, leading=12.8, spaceBefore=8)
body = S("body", textColor=MUT)
item = S("item", textColor=MUT, leftIndent=8, bulletIndent=0, spaceAfter=2.5)
foot = S("foot", fontSize=7.6, leading=10, textColor=MUT, alignment=1)

e = lambda s: escape(s)
W, H = A4
M = 16 * mm
gutter = 9 * mm
right_w = 62 * mm
left_w = W - 2 * M - gutter - right_w
top_h = 56 * mm
foot_h = 10 * mm
col_h = H - 2 * M - top_h - foot_h

frames = [
    Frame(M, H - M - top_h, W - 2 * M, top_h, id="top", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0),
    Frame(M, M + foot_h, left_w, col_h, id="left", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0),
    Frame(M + left_w + gutter, M + foot_h, right_w, col_h, id="right", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0),
    Frame(M, M, W - 2 * M, foot_h, id="foot", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0),
]

def rule(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(HexColor("#dddddd"))
    canvas.setLineWidth(0.5)
    canvas.line(M, H - M - top_h + 3 * mm, W - M, H - M - top_h + 3 * mm)
    canvas.line(M, M + foot_h - 1 * mm, W - M, M + foot_h - 1 * mm)
    canvas.restoreState()

doc = BaseDocTemplate(PDF, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=M, bottomMargin=M,
                      title=f"{person['name']} — Speaker one-pager", author=person["name"],
                      subject=f"protik.info one-pager {digest}", creator="scripts/gen-onepager.py", invariant=1)
doc.addPageTemplates([PageTemplate(id="one", frames=frames, onPage=rule)])

story = [Paragraph(e(person["name"]), name), Paragraph(e(op["tagline"]), tag), Paragraph(e(person["description"]), summary), FrameBreak()]

story.append(Paragraph("CAREER", h))
for c in op["career"]:
    story.append(Paragraph(f"{e(c['role'])} <font color='#6b6b6b' name='Helvetica'>· {e(c['years'])}</font>", role))
    story.append(Paragraph(e(c["text"]), body))
story.append(FrameBreak())

for title, items in (("SPEAKING TOPICS", op["talks"]), ("PUBLICATIONS", op["publications"]), ("EXPERTISE", op["expertise"])):
    story.append(Paragraph(title, h))
    story += [Paragraph(e(x), item, bulletText="•") for x in items]
story += [Paragraph("FEATURED IN", h), Paragraph(e(op["featuredIn"]), body),
          Paragraph("CREDENTIALS", h), Paragraph(e(op["credentials"]), body), FrameBreak(),
          Spacer(1, 1.5 * mm), Paragraph(e(op["contact"]), foot)]

doc.build(story)
if doc.page != 1:
    raise SystemExit(f"{PDF} ran to {doc.page} pages — trim site-data.json onepager until it fits on one")

# Refresh the PDF inside the press kit. Stored (not deflated) with fixed timestamps: the zip only
# changes when its contents do, and check.js can find the PDF's bytes in it.
pdf = open(PDF, "rb").read()
with zipfile.ZipFile(ZIP) as z:
    others = [(i, z.read(i.filename)) for i in z.infolist() if i.filename != PDF]
with zipfile.ZipFile(ZIP, "w") as z:
    for i, content in [(zipfile.ZipInfo(PDF, (2026, 1, 1, 0, 0, 0)), pdf)] + others:
        i.date_time = (2026, 1, 1, 0, 0, 0)
        i.compress_type = zipfile.ZIP_STORED if i.filename == PDF else zipfile.ZIP_DEFLATED
        z.writestr(i, content)
print(f"{PDF}: 1 page, inputs {digest}; {ZIP} refreshed ({len(others) + 1} files)")
