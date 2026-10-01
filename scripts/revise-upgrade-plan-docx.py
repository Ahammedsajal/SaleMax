"""Apply the existing-project scope correction while retaining the plan's layout.

Uses a pre-edit Markdown snapshot and the updated Markdown as exact sources.
Run with the bundled document Python runtime. No customer/runtime files are read.
"""
import difflib
import re
import sys
from pathlib import Path
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


def plain(value):
    value = re.sub(r"^\s*(?:#{1,6}\s+|>\s+)", "", value)
    value = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", value)
    return value.replace("**", "").replace("`", "").strip()


def paragraphs(document):
    yield from document.paragraphs
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from cell.paragraphs


def main():
    before, markdown, word = map(Path, sys.argv[1:4])
    old, new = before.read_text(encoding="utf-8-sig").splitlines(), markdown.read_text(encoding="utf-8-sig").splitlines()
    replacements = {"What we will deliver": "Delivery areas"}
    for kind, a, b, c, d in difflib.SequenceMatcher(a=old, b=new).get_opcodes():
        if kind != "replace" or b-a != d-c:
            continue
        for previous, current in zip(old[a:b], new[c:d]):
            if previous.startswith("|") and current.startswith("|"):
                for prior_cell, next_cell in zip(previous.strip("|").split("|"), current.strip("|").split("|")):
                    if plain(prior_cell) != plain(next_cell):
                        replacements[plain(prior_cell)] = plain(next_cell)
            elif plain(previous) != plain(current):
                replacements[plain(previous)] = plain(current)
    document = Document(word)
    matched = set()
    for paragraph in paragraphs(document):
        if paragraph.text in replacements:
            previous = paragraph.text
            paragraph.text = replacements[previous]
            matched.add(previous)
    missing = set(replacements)-matched
    if missing:
        raise RuntimeError("Word source does not match these corrected paragraphs: " + repr(sorted(missing)))
    anchor = next(p for p in document.paragraphs if p.text == "Delivery areas")
    start = next(i for i, line in enumerate(new) if line == "### Mandatory existing-project implementation scope")
    end = next(i for i, line in enumerate(new[start+1:], start+1) if line == "### Delivery areas")
    block = [line for line in new[start:end] if line.strip()]
    table_lines = []
    for line in block:
        if line.startswith("|"):
            table_lines.append(line)
            continue
        if table_lines:
            insert_table(document, anchor, table_lines)
            table_lines = []
        paragraph = document.add_paragraph(plain(line), style="Heading 2" if line.startswith("### ") else "Normal")
        anchor._p.addprevious(paragraph._p)
    if table_lines:
        insert_table(document, anchor, table_lines)
    document.save(word)
    verified = Document(word)
    text = "\n".join(p.text for p in paragraphs(verified))
    for required in ["Version 1.2", "No new project", "/admin?page=manage-plans", "Mandatory existing-project implementation scope"]:
        if required not in text:
            raise RuntimeError("Missing corrected contract: " + required)
    for forbidden in ["approve a maintained recreation", "record a maintained recreation", "Route family /super-admin", "Route family /staff-admin"]:
        if forbidden in text:
            raise RuntimeError("Retained superseded direction: " + forbidden)
    print({"updatedParagraphsOrCells": len(matched), "scopeTableRows": 11, "contentVerified": True})


def insert_table(document, anchor, lines):
    rows = [[plain(cell) for cell in line.strip("|").split("|")] for line in lines]
    rows = [row for row in rows if not all(re.fullmatch(r"[-: ]+", cell) for cell in row)]
    table = document.add_table(rows=len(rows), cols=3)
    table.style = "Table Grid"
    table.autofit = False
    for row_index, row in enumerate(table.rows):
        for cell_index, cell in enumerate(row.cells):
            cell.width = Inches([1.3, 2.0, 3.0][cell_index])
            cell.text = rows[row_index][cell_index]
            for paragraph in cell.paragraphs:
                paragraph.paragraph_format.space_after = Pt(5)
                paragraph.paragraph_format.space_before = Pt(5)
                for run in paragraph.runs:
                    run.font.size = Pt(9)
                    run.font.color.rgb = RGBColor(0, 0, 0)
                    run.bold = row_index == 0
            if row_index == 0:
                shading = OxmlElement("w:shd")
                shading.set(qn("w:fill"), "E7E6E6")
                cell._tc.get_or_add_tcPr().append(shading)
        if row_index == 0:
            repeat = OxmlElement("w:tblHeader")
            row._tr.get_or_add_trPr().append(repeat)
    anchor._p.addprevious(table._tbl)


if __name__ == "__main__":
    main()
